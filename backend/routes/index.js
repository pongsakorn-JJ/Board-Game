const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../config/db');
const realtime = require('../services/realtime');
const { requireLogin, requireAdmin, requireCustomer, isAdmin } = require('../middleware/auth');

/* ---------- helpers ---------- */

// ฝังสถานะเริ่มต้นลงในหน้า (ให้ฝั่งเบราว์เซอร์วาดหน้าได้ทันทีด้วยโค้ดชุดเดียวกับตอนอัปเดตเรียลไทม์)
function toScriptJson(obj) {
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .split(LS).join('\\u2028')
    .split(PS).join('\\u2029');
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// วันที่วันนี้ตามเวลาเครื่อง (YYYY-MM-DD)
function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// แอดมินได้ข้อมูลเต็ม ลูกค้า/คนทั่วไปได้ข้อมูลที่ตัดชื่อ-เบอร์ลูกค้าคนอื่นออก
function stateFor(req, state) {
  return isAdmin(req) ? state : realtime.publicState(state);
}

// พนักงานระบบ "Online Booking" (ใช้เป็น EmployeeID ตอนลูกค้าจองเองผ่านเว็บ)
let onlineEmployeeId = null;
async function getOnlineEmployeeId(pool) {
  if (onlineEmployeeId) return onlineEmployeeId;
  const r = await pool.request().query(`SELECT TOP 1 EmployeeID FROM tbl_employee WHERE Position = 'System' ORDER BY EmployeeID`);
  if (!r.recordset.length) throw new Error('ไม่พบพนักงานระบบ Online Booking (ยังไม่ได้รัน update_v4_login.sql)');
  onlineEmployeeId = r.recordset[0].EmployeeID;
  return onlineEmployeeId;
}

// ข้อมูล "บัญชีของฉัน" ของลูกค้า: โปรไฟล์ โต๊ะที่กำลังใช้ คิวที่รอ ประวัติการจอง/เช่า
async function getMeData(pool, customerId) {
  const req = () => pool.request().input('C', sql.Int, customerId);
  const profile = (await req().query(`
    SELECT CustomerID, FirstName, LastName, Phone, Points, CreatedDate,
           CASE WHEN NationalID IS NULL THEN 0 ELSE 1 END AS HasNationalID
    FROM tbl_customer WHERE CustomerID = @C`)).recordset[0] || null;
  const active = (await req().query(`
    SELECT TOP 1 s.SessionID, s.TableID, t.Zone, s.StartTime, s.ExpectedEndTime,
           dbo.fn_RemainingMinutes(s.SessionID) AS MinutesLeft, tp.PackageName, s.AmountPaid,
           cur.BorrowID, cur.GameID, cur.GameName, cur.BorrowTime AS GameSince
    FROM tbl_session s
    JOIN tbl_table t ON t.TableID = s.TableID
    JOIN tbl_timepackage tp ON tp.PackageID = s.PackageID
    OUTER APPLY (SELECT TOP 1 ib.BorrowID, ib.GameID, g.Name AS GameName, ib.BorrowTime
                 FROM tbl_instoreborrow ib JOIN tbl_boardgame g ON g.GameID = ib.GameID
                 WHERE ib.SessionID = s.SessionID AND ib.ReturnTime IS NULL
                 ORDER BY ib.BorrowTime DESC) cur
    WHERE s.CustomerID = @C AND s.Status = 'Active'
    ORDER BY s.StartTime DESC`)).recordset[0] || null;
  const queue = (await req().query(`
    SELECT q.QueueID, q.TableID, q.QueueTime,
           (SELECT COUNT(*) FROM tbl_queue q2
             WHERE q2.Status = 'Waiting' AND q2.QueueID <= q.QueueID
               AND (q2.TableID = q.TableID OR (q2.TableID IS NULL AND q.TableID IS NULL))) AS Position
    FROM tbl_queue q
    WHERE q.CustomerID = @C AND q.Status = 'Waiting'
    ORDER BY q.QueueTime`)).recordset;
  const sessions = (await req().query(`
    SELECT TOP 20 s.SessionID, s.TableID, s.StartTime, s.ActualEndTime, s.AmountPaid, s.Status, tp.PackageName,
           (SELECT STRING_AGG(g.Name, ', ') FROM tbl_instoreborrow ib JOIN tbl_boardgame g ON g.GameID = ib.GameID
             WHERE ib.SessionID = s.SessionID) AS Games
    FROM tbl_session s
    JOIN tbl_timepackage tp ON tp.PackageID = s.PackageID
    WHERE s.CustomerID = @C
    ORDER BY s.StartTime DESC`)).recordset;
  const rentals = (await req().query(`
    SELECT TOP 20 RentalID, GameName, RentalDate, DueDate, RentalFee, Deposit,
           Status, ReturnDate, DepositRefunded, OverdueDays, IsOverdue
    FROM vw_RentalDetail
    WHERE CustomerID = @C
    ORDER BY RentalDate DESC`)).recordset;
  return { profile, active, queue, sessions, rentals };
}

function renderDbError(res, err) {
  console.error(err);
  res.status(500).render('error', { message: 'เชื่อมต่อฐานข้อมูลไม่ได้', error: err.message });
}

/* =========================================================
   หน้าเว็บ
   ========================================================= */

router.get('/', (req, res) => {
  const u = req.session.user;
  res.redirect(!u ? '/login' : u.role === 'admin' ? '/dashboard' : '/booking');
});

// จองโต๊ะ / เช่ากลับบ้าน — ฝั่งลูกค้าเท่านั้น (พนักงานจัดการคิว/โต๊ะที่หน้า "สถานะโต๊ะ")
router.get('/booking', (req, res, next) => (isAdmin(req) ? res.redirect('/dashboard') : next()), requireCustomer, async (req, res) => {
  try {
    const state = await realtime.buildState();
    const me = await getMeData(await getPool(), req.session.user.id);
    res.render('booking', {
      title: 'จองโต๊ะ / เช่ากลับบ้าน',
      packages: state.packages,
      today: todayLocal(),
      hasNationalId: !!(me.profile && me.profile.HasNationalID),
      initialStateJson: toScriptJson(realtime.publicState(state)),
      meJson: toScriptJson(me)
    });
  } catch (err) {
    renderDbError(res, err);
  }
});

// หน้าคิวเดิมถูกรวมเข้าหน้าจองโต๊ะแล้ว
router.get('/queue', (req, res) => res.redirect('/'));

// สถานะโต๊ะทั้งหมด (ว่าง/ไม่ว่าง + เวลาที่เหลือ + เกมที่หยิบอยู่ในแต่ละโต๊ะ)
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const state = await realtime.buildState();
    res.render('dashboard', { title: 'สถานะโต๊ะ', initialStateJson: toScriptJson(state) });
  } catch (err) {
    renderDbError(res, err);
  }
});

// แคตตาล็อกบอร์ดเกม: รูป + รายละเอียดย่อ + วิธีเล่น + สต๊อก (ต้องรัน update_v3 ก่อน)
router.get('/games', async (req, res) => {
  try {
    const pool = await getPool();
    const games = (await pool.request().query(`
      SELECT g.GameID, g.Name, c.CategoryName, g.MinPlayer, g.MaxPlayer, g.Difficulty,
             g.TotalQty, g.AvailableQty, g.OffsiteRentalRate, g.DepositAmount,
             g.ImageUrl, g.PlayTime, g.ShortDescription, g.HowToPlay
      FROM tbl_boardgame g
      LEFT JOIN tbl_gamecategory c ON g.CategoryID = c.CategoryID
      ORDER BY g.Name
    `)).recordset;
    const state = await realtime.buildState();
    // ลูกค้า: ฝังข้อมูลโต๊ะของตัวเองมาด้วย เพื่อให้กด "หยิบเกมนี้เข้าโต๊ะ" ได้ทันที
    const u = req.session.user;
    const me = u && u.role === 'customer' ? await getMeData(pool, u.id) : null;
    res.render('games', {
      title: me ? 'เลือกบอร์ดเกม' : 'บอร์ดเกมทั้งหมด',
      games,
      isCustomer: !!me,
      initialStateJson: toScriptJson(stateFor(req, state)),
      meJson: me ? toScriptJson(me) : null
    });
  } catch (err) {
    renderDbError(res, err);
  }
});

// บิลเช่ากลับบ้าน + คืนเกม
router.get('/rentals', requireAdmin, async (req, res) => {
  try {
    const state = await realtime.buildState();
    res.render('rentals', { title: 'เช่ากลับบ้าน', initialStateJson: toScriptJson(state) });
  } catch (err) {
    renderDbError(res, err);
  }
});

// บัญชีของฉัน (ลูกค้า): สถานะตอนนี้ + ประวัติ + แต้ม
router.get('/me', requireCustomer, async (req, res) => {
  try {
    const pool = await getPool();
    const me = await getMeData(pool, req.session.user.id);
    const state = await realtime.buildState();
    res.render('me', { title: 'บัญชีของฉัน', meJson: toScriptJson(me), initialStateJson: toScriptJson(realtime.publicState(state)) });
  } catch (err) {
    renderDbError(res, err);
  }
});

router.get('/api/me', requireCustomer, async (req, res) => {
  try {
    res.json(await getMeData(await getPool(), req.session.user.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// รายได้รายวัน (สรุป + รายละเอียดรายการจองโต๊ะ/เช่ากลับบ้านแต่ละบิล)
router.get('/revenue', requireAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    // VIEW vw_DailyRevenue
    const summaryResult = await pool.request().query(`
      SELECT RevenueDate, TotalRevenue FROM vw_DailyRevenue ORDER BY RevenueDate DESC
    `);

    const detailResult = await pool.request().query(`
      SELECT 'โต๊ะ' AS Type, s.SessionID AS RefID, s.StartTime AS TxnDate,
             CONCAT('โต๊ะ #', t.TableID, ' — ', tp.PackageName) AS Detail,
             CASE WHEN c.CustomerID IS NOT NULL THEN CONCAT(c.FirstName, ' ', c.LastName) ELSE 'walk-in' END AS CustomerName,
             s.AmountPaid AS Amount, s.Status
      FROM tbl_session s
      JOIN tbl_table t ON s.TableID = t.TableID
      JOIN tbl_timepackage tp ON s.PackageID = tp.PackageID
      LEFT JOIN tbl_customer c ON s.CustomerID = c.CustomerID
      UNION ALL
      SELECT 'เช่ากลับบ้าน' AS Type, r.RentalID AS RefID, r.RentalDate AS TxnDate,
             g.Name AS Detail,
             CONCAT(c.FirstName, ' ', c.LastName) AS CustomerName,
             r.RentalFee AS Amount, r.Status
      FROM tbl_offsiterental r
      JOIN tbl_boardgame g ON r.GameID = g.GameID
      JOIN tbl_customer c ON r.CustomerID = c.CustomerID
      ORDER BY TxnDate DESC
    `);

    res.render('revenue', {
      title: 'รายได้รายวัน',
      rows: summaryResult.recordset,
      details: detailResult.recordset
    });
  } catch (err) {
    renderDbError(res, err);
  }
});

/* =========================================================
   API — เล่นที่ร้าน: จองโต๊ะ (เช็คอิน) หรือเข้าคิวอัตโนมัติ
   ========================================================= */

async function getPackage(pool, packageId) {
  const r = await pool.request()
    .input('PackageID', sql.Int, packageId)
    .query(`SELECT PackageName, Price FROM tbl_timepackage WHERE PackageID = @PackageID`);
  return r.recordset[0] || null;
}

// หยิบเกมเข้าโต๊ะ — กฎ 1 โต๊ะ 1 เกม (ต้องคืนเกมเดิมก่อน) แล้วเรียก sp_BorrowGameInStore
// คืน { ok, message } สำหรับกรณีที่ผู้ใช้แก้ได้ / throw เฉพาะ error ที่ไม่คาดคิด
async function borrowGame(pool, sessionId, gameId) {
  const sess = await pool.request()
    .input('SessionID', sql.Int, sessionId)
    .query(`SELECT TableID FROM tbl_session WHERE SessionID = @SessionID AND Status = 'Active'`);
  if (sess.recordset.length === 0) {
    return { ok: false, message: 'โต๊ะนี้ยังไม่ได้เช็คอิน หรือเช็คเอาท์ไปแล้ว' };
  }
  const tableId = sess.recordset[0].TableID;

  const current = await pool.request()
    .input('SessionID', sql.Int, sessionId)
    .query(`
      SELECT TOP 1 g.Name FROM tbl_instoreborrow ib
      JOIN tbl_boardgame g ON ib.GameID = g.GameID
      WHERE ib.SessionID = @SessionID AND ib.ReturnTime IS NULL
    `);
  if (current.recordset.length > 0) {
    return {
      ok: false,
      message: `โต๊ะ #${tableId} กำลังเล่น "${current.recordset[0].Name}" อยู่ — ต้องคืนเกมนี้ก่อนถึงจะหยิบเกมใหม่ได้ (1 โต๊ะ 1 เกม)`
    };
  }

  const game = await pool.request()
    .input('GameID', sql.Int, gameId)
    .query(`SELECT Name, AvailableQty FROM tbl_boardgame WHERE GameID = @GameID`);
  if (game.recordset.length === 0) return { ok: false, message: 'ไม่พบเกมนี้' };
  if (game.recordset[0].AvailableQty <= 0) {
    return { ok: false, message: `"${game.recordset[0].Name}" หมดแล้ว (ถูกหยิบ/เช่าไปครบทุกกล่อง) เลือกเกมอื่น` };
  }

  try {
    await pool.request()
      .input('SessionID', sql.Int, sessionId)
      .input('GameID', sql.Int, gameId)
      .execute('sp_BorrowGameInStore');   // trigger ตัดสต๊อก
  } catch (err) {
    if (err.number === 2601 || err.number === 2627 || /1 โต๊ะ 1 เกม|มีเกมอยู่แล้ว/.test(err.message || '')) {
      return { ok: false, message: `โต๊ะ #${tableId} มีเกมอยู่แล้ว — ต้องคืนเกมเดิมก่อน (1 โต๊ะ 1 เกม)` };
    }
    if (/ไม่พอ|CK_boardgame_qty/.test(err.message || '')) {
      return { ok: false, message: `"${game.recordset[0].Name}" หมดแล้ว เลือกเกมอื่น` };
    }
    throw err;
  }
  return { ok: true, message: `หยิบ "${game.recordset[0].Name}" เข้าโต๊ะ #${tableId} แล้ว`, tableId };
}

// จองโต๊ะเล่นที่ร้าน (ลูกค้าจองเองเท่านั้น) — ผูกกับบัญชีลูกค้าเสมอ, พนักงานในบิล = "Online Booking"
// โต๊ะว่าง (ไม่มีคิว) → sp_CheckIn [+ sp_BorrowGameInStore]  /  ไม่ว่างหรือมีคิว → sp_AddToQueue
router.post('/api/booking', requireCustomer, async (req, res) => {
  const user = req.session.user;
  const tableId = toInt(req.body.tableId);
  const packageId = toInt(req.body.packageId);
  const gameId = toInt(req.body.gameId);   // ไม่บังคับ

  if (!tableId) return res.status(400).json({ ok: false, message: 'กรุณาเลือกโต๊ะ' });
  const { firstName, lastName, phone } = user;
  const fullName = `${firstName} ${lastName}`;

  try {
    const pool = await getPool();
    const customerId = user.id;
    const employeeId = await getOnlineEmployeeId(pool);

    // ใช้ได้ทีละ 1 โต๊ะ และรอคิวได้ทีละ 1 คิว
    const mine = await pool.request().input('C', sql.Int, customerId).query(`
      SELECT (SELECT TOP 1 TableID FROM tbl_session WHERE CustomerID = @C AND Status = 'Active') AS ActiveTable,
             (SELECT COUNT(*) FROM tbl_queue WHERE CustomerID = @C AND Status = 'Waiting') AS QueueCount`);
    const { ActiveTable, QueueCount } = mine.recordset[0];
    if (ActiveTable) return res.status(400).json({ ok: false, message: `คุณมีโต๊ะที่กำลังใช้อยู่แล้ว (โต๊ะ #${ActiveTable})` });
    if (QueueCount > 0) return res.status(400).json({ ok: false, message: 'คุณอยู่ในคิวแล้ว — ยกเลิกคิวเดิมก่อนถ้าต้องการเปลี่ยนโต๊ะ' });

    const tbl = await pool.request()
      .input('TableID', sql.Int, tableId)
      .query(`
        SELECT t.Status, dbo.fn_WaitingQueueCount(t.TableID) AS WaitingCount   -- FUNCTION (update_v6)
        FROM tbl_table t
        WHERE t.TableID = @TableID
      `);
    if (tbl.recordset.length === 0) return res.status(404).json({ ok: false, message: 'ไม่พบโต๊ะนี้' });
    const { Status, WaitingCount } = tbl.recordset[0];

    // ---- โต๊ะว่างจริงและไม่มีใครรอ → เช็คอินเลย ----
    if (Status === 'Available' && WaitingCount === 0) {
      if (!packageId) return res.status(400).json({ ok: false, message: 'กรุณาเลือกแพ็กเกจเวลา' });
      const pkg = await getPackage(pool, packageId);
      if (!pkg) return res.status(400).json({ ok: false, message: 'ไม่พบแพ็กเกจเวลานี้' });

      if (gameId) {   // เกมที่เลือกหมด → ยังไม่เปิดโต๊ะ
        const g = await pool.request()
          .input('GameID', sql.Int, gameId)
          .query(`SELECT Name, AvailableQty FROM tbl_boardgame WHERE GameID = @GameID`);
        if (g.recordset.length === 0 || g.recordset[0].AvailableQty <= 0) {
          const name = g.recordset[0] ? `"${g.recordset[0].Name}" ` : '';
          return res.status(400).json({ ok: false, message: `เกม ${name}หมดแล้ว — เลือกเกมอื่น หรือเลือก "ยังไม่หยิบเกม"` });
        }
      }

      try {
        const sp = pool.request();
        sp.input('TableID', sql.Int, tableId);
        sp.input('PackageID', sql.Int, packageId);
        sp.input('CustomerID', sql.Int, customerId);
        sp.input('EmployeeID', sql.Int, employeeId);
        sp.input('AmountPaid', sql.Decimal(10, 2), pkg.Price);
        sp.output('SessionID', sql.Int);
        const sessionId = (await sp.execute('sp_CheckIn')).output.SessionID;

        if (sessionId) {
          const price = Number(pkg.Price).toLocaleString('th-TH');
          let message = `จองโต๊ะ #${tableId} สำเร็จ — ${pkg.PackageName} ${price} บาท ชำระที่เคาน์เตอร์ได้เลย (ออเดอร์ #${sessionId})`;
          let warning = false;
          if (gameId) {
            const b = await borrowGame(pool, sessionId, gameId);
            if (b.ok) message += ` · ${b.message}`;
            else { message += ` · แต่หยิบเกมไม่สำเร็จ: ${b.message} (แจ้งพนักงานเพื่อเลือกเกมใหม่)`; warning = true; }
          }
          res.json({ ok: true, action: 'checkin', warning, message });
          realtime.broadcastState();
          return;
        }
      } catch (err) {
        if (!/ไม่ว่าง/.test(err.message || '')) throw err;
        // โต๊ะถูกจองตัดหน้าไปพอดี → ตกไปเข้าคิวด้านล่าง
      }
    }

    // ---- โต๊ะไม่ว่าง / มีคิวรอ → เข้าคิวรอโต๊ะนี้ (ผูกกับลูกค้า) ----
    const q = pool.request();
    q.input('CustomerName', sql.NVarChar(100), fullName);
    q.input('Phone', sql.VarChar(15), phone);
    q.input('TableID', sql.Int, tableId);
    q.input('CustomerID', sql.Int, customerId);
    q.output('QueueID', sql.Int);
    const queueId = (await q.execute('sp_AddToQueue')).output.QueueID;

    const pos = await pool.request()
      .input('TableID', sql.Int, tableId)
      .input('QueueID', sql.Int, queueId)
      .query(`SELECT COUNT(*) AS Pos FROM tbl_queue WHERE TableID = @TableID AND Status = 'Waiting' AND QueueID <= @QueueID`);

    res.json({
      ok: true,
      action: 'queued',
      message: `โต๊ะ #${tableId} ไม่ว่าง — คุณอยู่คิวที่ ${pos.recordset[0].Pos} ของโต๊ะนี้ พนักงานจะเรียกเมื่อโต๊ะว่าง`
    });
    realtime.broadcastState();
  } catch (err) {
    console.error(err);
    res.status(400).json({ ok: false, message: err.message || 'เกิดข้อผิดพลาดในการจองโต๊ะ' });
  }
});

// เรียกคิวถัดไปเข้านั่งโต๊ะที่ว่างแล้ว — sp_SeatNextInQueue (คิวของโต๊ะนั้นก่อน → คิวรวม)
router.post('/api/queue/seat-next', requireAdmin, async (req, res) => {
  const tableId = toInt(req.body.tableId);
  const packageId = toInt(req.body.packageId);
  const employeeId = req.session.user.id;   // พนักงานที่ล็อกอินอยู่

  if (!tableId || !packageId) {
    return res.status(400).json({ ok: false, message: 'กรุณาเลือกโต๊ะและแพ็กเกจเวลา' });
  }

  try {
    const pool = await getPool();
    const pkg = await getPackage(pool, packageId);
    if (!pkg) return res.status(400).json({ ok: false, message: 'ไม่พบแพ็กเกจเวลานี้' });

    // ชื่อคิวที่จะถูกเรียก (ลำดับเดียวกับใน stored procedure) — ใช้แสดงข้อความเท่านั้น
    const next = await pool.request()
      .input('TableID', sql.Int, tableId)
      .query(`
        SELECT TOP 1 CustomerName FROM tbl_queue
        WHERE Status = 'Waiting' AND (TableID = @TableID OR TableID IS NULL)
        ORDER BY CASE WHEN TableID = @TableID THEN 0 ELSE 1 END, QueueTime ASC
      `);

    const sp = pool.request();
    sp.input('TableID', sql.Int, tableId);
    sp.input('PackageID', sql.Int, packageId);
    sp.input('EmployeeID', sql.Int, employeeId);
    sp.input('AmountPaid', sql.Decimal(10, 2), pkg.Price);
    sp.output('SessionID', sql.Int);
    const result = await sp.execute('sp_SeatNextInQueue');
    const sessionId = result.output.SessionID;

    if (!sessionId) {
      return res.status(400).json({ ok: false, message: 'เรียกคิวไม่สำเร็จ (อาจไม่มีคิวรอ หรือโต๊ะไม่ว่างแล้ว)' });
    }

    const who = next.recordset[0] ? `"${next.recordset[0].CustomerName}" ` : '';
    res.json({
      ok: true,
      message: `เรียกคิว ${who}เข้านั่งโต๊ะ #${tableId} แล้ว — ${pkg.PackageName} เก็บเงิน ${Number(pkg.Price).toLocaleString('th-TH')} บาท`
    });
    realtime.broadcastState();
  } catch (err) {
    console.error(err);
    res.status(400).json({ ok: false, message: err.message || 'เกิดข้อผิดพลาดในการเรียกคิว' });
  }
});

// ยกเลิกคิว — sp_CancelQueue
router.post('/api/queue/cancel', requireLogin, async (req, res) => {
  const queueId = toInt(req.body.queueId);
  if (!queueId) return res.status(400).json({ ok: false, message: 'ไม่พบคิวที่จะยกเลิก' });
  try {
    const pool = await getPool();
    if (!isAdmin(req)) {   // ลูกค้ายกเลิกได้เฉพาะคิวของตัวเอง
      const own = await pool.request().input('QueueID', sql.Int, queueId)
        .query(`SELECT CustomerID FROM tbl_queue WHERE QueueID = @QueueID`);
      if (!own.recordset.length || own.recordset[0].CustomerID !== req.session.user.id) {
        return res.status(403).json({ ok: false, message: 'ยกเลิกได้เฉพาะคิวของคุณเอง' });
      }
    }
    await pool.request().input('QueueID', sql.Int, queueId).execute('sp_CancelQueue');
    res.json({ ok: true, message: 'ยกเลิกคิวแล้ว' });
    realtime.broadcastState();
  } catch (err) {
    console.error(err);
    res.status(400).json({ ok: false, message: err.message || 'ยกเลิกคิวไม่สำเร็จ' });
  }
});

// เช็คเอาท์ (เคลียร์โต๊ะ) — sp_CheckOut (คืนสต๊อกเกมทั้งหมดของโต๊ะนั้น + เปิดโต๊ะให้ว่าง)
// ต่อเวลาโต๊ะ (Smart Extension) — sp_ExtendTime: ไม่มีโต๊ะว่างและมีคิวรออยู่ = ต่อเวลาไม่ได้
// ใช้แพ็กเกจเวลาเป็นตัวกำหนดนาทีที่ต่อ + ค่าบริการเพิ่ม
router.post('/api/extend', requireAdmin, async (req, res) => {
  const sessionId = toInt(req.body.sessionId);
  const packageId = toInt(req.body.packageId);
  if (!sessionId) return res.status(400).json({ ok: false, message: 'ไม่พบโต๊ะที่จะต่อเวลา' });
  if (!packageId) return res.status(400).json({ ok: false, message: 'กรุณาเลือกระยะเวลาที่ต่อ' });
  try {
    const pool = await getPool();
    const pkg = await pool.request().input('PackageID', sql.Int, packageId)
      .query(`SELECT PackageName, DurationMinutes, Price FROM tbl_timepackage WHERE PackageID = @PackageID`);
    const p = pkg.recordset[0];
    if (!p || !p.DurationMinutes) return res.status(400).json({ ok: false, message: 'เลือกแพ็กเกจที่มีระยะเวลา (ไม่ใช่เหมาวัน)' });
    const sess = await pool.request().input('SessionID', sql.Int, sessionId)
      .query(`SELECT TableID FROM tbl_session WHERE SessionID = @SessionID AND Status = 'Active'`);
    if (!sess.recordset.length) return res.status(400).json({ ok: false, message: 'โต๊ะนี้เช็คเอาท์ไปแล้ว' });

    await pool.request()
      .input('SessionID', sql.Int, sessionId)
      .input('AdditionalMinutes', sql.Int, p.DurationMinutes)
      .input('AdditionalFee', sql.Decimal(10, 2), p.Price)
      .execute('sp_ExtendTime');
    res.json({ ok: true, message: `ต่อเวลาโต๊ะ #${sess.recordset[0].TableID} อีก ${p.DurationMinutes} นาที (+${Number(p.Price).toLocaleString('th-TH')} บาท) แล้ว` });
    realtime.broadcastState();
  } catch (err) {
    if (err.number === 50000) {
      return res.status(400).json({ ok: false, message: 'ต่อเวลาไม่ได้ — โต๊ะเต็มและมีลูกค้ารอคิวอยู่ ให้เช็คเอาท์ตามเวลาเดิม (ลูกค้าต่อคิวใหม่ได้)' });
    }
    console.error(err);
    res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

router.post('/api/checkout', requireAdmin, async (req, res) => {
  const sessionId = toInt(req.body.sessionId);
  if (!sessionId) return res.status(400).json({ ok: false, message: 'ไม่พบออเดอร์ที่จะเช็คเอาท์' });
  try {
    const pool = await getPool();
    await pool.request().input('SessionID', sql.Int, sessionId).execute('sp_CheckOut');

    // ถ้ามีคิวรอโต๊ะนี้ บอกพนักงานให้ไปเรียกคิว
    const q = await pool.request()
      .input('SessionID', sql.Int, sessionId)
      .query(`
        SELECT COUNT(*) AS Waiting FROM tbl_queue q
        JOIN tbl_session s ON s.SessionID = @SessionID
        WHERE q.Status = 'Waiting' AND (q.TableID = s.TableID OR q.TableID IS NULL)
      `);
    const waiting = q.recordset[0].Waiting;
    const extra = waiting > 0 ? ` — มีคิวรอ ${waiting} คิว เรียกเข้านั่งได้ที่ส่วน "คิวรอโต๊ะ" ด้านล่าง` : '';

    res.json({ ok: true, message: 'เช็คเอาท์โต๊ะเรียบร้อยแล้ว' + extra });
    realtime.broadcastState();
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

/* =========================================================
   API — เช่ากลับบ้าน
   ========================================================= */

// เช่าเกมกลับบ้าน (ลูกค้าเช่าเองจากบัญชีของตัวเอง) → sp_RentOffsite
// ต้องมีเลขบัตรประชาชน: ถ้าบัญชียังไม่มี ให้กรอก 13 หลักครั้งแรก (บันทึกลง tbl_customer — CHECK constraint ตรวจรูปแบบซ้ำอีกชั้น)
// ชำระค่าเช่า + มัดจำ และรับเกมที่เคาน์เตอร์ · พนักงานในบิล = "Online Booking"
router.post('/api/rent', requireCustomer, async (req, res) => {
  const customerId = req.session.user.id;
  const nationalId = String(req.body.nationalId || '').trim();
  const gameId = toInt(req.body.gameId);
  const dueDate = String(req.body.dueDate || '').trim();

  if (!gameId) return res.status(400).json({ ok: false, message: 'กรุณาเลือกเกม' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < todayLocal()) {
    return res.status(400).json({ ok: false, message: 'วันกำหนดคืนต้องเป็นวันนี้หรือหลังจากนี้' });
  }
  if (nationalId && !/^\d{13}$/.test(nationalId)) {
    return res.status(400).json({ ok: false, field: 'nationalId', message: 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก' });
  }

  try {
    const pool = await getPool();

    const g = await pool.request()
      .input('GameID', sql.Int, gameId)
      .query(`SELECT Name, AvailableQty FROM tbl_boardgame WHERE GameID = @GameID`);
    if (g.recordset.length === 0) return res.status(404).json({ ok: false, message: 'ไม่พบเกมนี้' });
    if (g.recordset[0].AvailableQty <= 0) {
      return res.status(400).json({ ok: false, message: `"${g.recordset[0].Name}" หมดสต๊อกแล้ว เลือกเกมอื่น` });
    }

    const c = await pool.request().input('C', sql.Int, customerId)
      .query(`SELECT NationalID FROM tbl_customer WHERE CustomerID = @C`);
    if (!c.recordset.length) return res.status(404).json({ ok: false, message: 'ไม่พบบัญชีลูกค้า' });
    if (!c.recordset[0].NationalID) {
      if (!nationalId) {
        return res.status(400).json({ ok: false, field: 'nationalId', message: 'การเช่ากลับบ้านต้องใช้เลขบัตรประชาชน — กรอกเลข 13 หลัก (กรอกครั้งเดียว)' });
      }
      await pool.request()
        .input('C', sql.Int, customerId)
        .input('NationalID', sql.Char(13), nationalId)
        .query(`UPDATE tbl_customer SET NationalID = @NationalID WHERE CustomerID = @C`);
    }

    const rent = pool.request();
    rent.input('CustomerID', sql.Int, customerId);
    rent.input('GameID', sql.Int, gameId);
    rent.input('EmployeeID', sql.Int, await getOnlineEmployeeId(pool));
    rent.input('DueDate', sql.VarChar(10), dueDate); // ส่งเป็น 'YYYY-MM-DD' กันวันเลื่อนจาก timezone
    rent.output('RentalID', sql.Int);
    const rentalId = (await rent.execute('sp_RentOffsite')).output.RentalID;
    if (!rentalId) return res.status(400).json({ ok: false, message: 'เช่าไม่สำเร็จ ลองใหม่อีกครั้ง' });

    const bill = await pool.request()
      .input('RentalID', sql.Int, rentalId)
      .query(`SELECT RentalFee, Deposit FROM tbl_offsiterental WHERE RentalID = @RentalID`);
    const { RentalFee, Deposit } = bill.recordset[0];
    const fmt = (n) => Number(n).toLocaleString('th-TH');
    const [y, m, d] = dueDate.split('-');

    res.json({
      ok: true,
      message: `เช่า "${g.recordset[0].Name}" สำเร็จ (บิล #${rentalId}) — ชำระค่าเช่า ${fmt(RentalFee)} + มัดจำ ${fmt(Deposit)} = ${fmt(Number(RentalFee) + Number(Deposit))} บาท และรับเกมที่เคาน์เตอร์ · คืนภายใน ${d}/${m}/${y}`
    });
    realtime.broadcastState();
  } catch (err) {
    console.error(err);
    if (err.number === 2627 || err.number === 2601) {
      return res.status(400).json({ ok: false, field: 'nationalId', message: 'เลขบัตรประชาชนนี้ถูกใช้กับบัญชีอื่นแล้ว — ติดต่อพนักงาน' });
    }
    if (err.number === 547) {
      return res.status(400).json({ ok: false, field: 'nationalId', message: 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก' });
    }
    res.status(400).json({ ok: false, message: err.message || 'เกิดข้อผิดพลาดในการเช่า' });
  }
});

// คืนเกม (เช่ากลับบ้าน) — sp_ReturnOffsite (คืนสต๊อก + สะสมแต้ม)
router.post('/api/rent/return', requireAdmin, async (req, res) => {
  const rentalId = toInt(req.body.rentalId);
  const allowed = ['ปกติ', 'ชำรุด', 'ชิ้นส่วนหาย'];
  const condition = allowed.includes(req.body.condition) ? req.body.condition : 'ปกติ';
  const depositRefunded = Number(req.body.depositRefunded);

  if (!rentalId) return res.status(400).json({ ok: false, message: 'ไม่พบบิลที่จะคืน' });
  if (!Number.isFinite(depositRefunded) || depositRefunded < 0) {
    return res.status(400).json({ ok: false, message: 'กรอกยอดคืนมัดจำให้ถูกต้อง' });
  }

  try {
    const pool = await getPool();
    const bill = await pool.request()
      .input('RentalID', sql.Int, rentalId)
      .query(`
        SELECT r.Status, r.Deposit, r.RentalFee, g.Name
        FROM tbl_offsiterental r JOIN tbl_boardgame g ON r.GameID = g.GameID
        WHERE r.RentalID = @RentalID
      `);
    if (bill.recordset.length === 0) return res.status(404).json({ ok: false, message: 'ไม่พบบิลนี้' });
    const b = bill.recordset[0];
    if (b.Status === 'Returned') return res.status(400).json({ ok: false, message: 'บิลนี้คืนเกมไปแล้ว' });
    if (depositRefunded > Number(b.Deposit)) {
      return res.status(400).json({ ok: false, message: `ยอดคืนมัดจำต้องไม่เกิน ${Number(b.Deposit).toLocaleString('th-TH')} บาท` });
    }

    const sp = pool.request();
    sp.input('RentalID', sql.Int, rentalId);
    sp.input('ReturnCondition', sql.NVarChar(100), condition);
    sp.input('DepositRefunded', sql.Decimal(10, 2), depositRefunded);
    await sp.execute('sp_ReturnOffsite');

    const points = Math.floor(Number(b.RentalFee) / 10);
    res.json({
      ok: true,
      message: `คืน "${b.Name}" แล้ว (สภาพ: ${condition}) — คืนมัดจำ ${depositRefunded.toLocaleString('th-TH')} บาท · ลูกค้าได้ ${points} แต้ม`
    });
    realtime.broadcastState();
  } catch (err) {
    console.error(err);
    res.status(400).json({ ok: false, message: err.message || 'เกิดข้อผิดพลาดในการคืนเกม' });
  }
});

/* =========================================================
   API — หยิบ/คืนบอร์ดเกมในร้าน (trigger ตัด/คืนสต๊อกให้เอง)
   ========================================================= */

// หยิบเกมเข้าโต๊ะที่เช็คอินอยู่ (1 โต๊ะ 1 เกม — ต้องคืนเกมเดิมก่อน)
router.post('/api/borrow', requireAdmin, async (req, res) => {
  const sessionId = toInt(req.body.sessionId);
  const gameId = toInt(req.body.gameId);
  if (!sessionId) return res.status(400).json({ ok: false, message: 'ไม่พบโต๊ะที่จะหยิบเกม' });
  if (!gameId) return res.status(400).json({ ok: false, message: 'กรุณาเลือกเกม' });

  try {
    const pool = await getPool();
    const result = await borrowGame(pool, sessionId, gameId);
    if (!result.ok) return res.status(400).json(result);
    res.json({ ok: true, message: result.message });
    realtime.broadcastState();
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

router.post('/api/return-game', requireAdmin, async (req, res) => {
  const borrowId = toInt(req.body.borrowId);
  if (!borrowId) return res.status(400).json({ ok: false, message: 'ไม่พบรายการที่จะคืน' });
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('BorrowID', sql.Int, borrowId)
      .query(`UPDATE tbl_instoreborrow SET ReturnTime = GETDATE() WHERE BorrowID = @BorrowID AND ReturnTime IS NULL`);

    if (result.rowsAffected[0] === 0) {
      return res.status(400).json({ ok: false, message: 'รายการนี้ถูกคืนไปแล้ว หรือไม่พบข้อมูล' });
    }
    // trigger trg_instoreborrow_return คืนสต๊อกอัตโนมัติ

    res.json({ ok: true, message: 'คืนเกมแล้ว — โต๊ะนี้เลือกหยิบเกมใหม่ได้' });
    realtime.broadcastState();
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

/* =========================================================
   API — ลูกค้าเลือก/คืนบอร์ดเกมให้โต๊ะของตัวเอง (เมนู "บอร์ดเกม")
   ใช้ได้เฉพาะโต๊ะที่ลูกค้าคนนั้นกำลังเล่นอยู่ — ห้ามส่ง sessionId มาเอง กันไปหยิบ/คืนให้โต๊ะคนอื่น
   ========================================================= */

async function getMyActiveSession(pool, customerId) {
  const r = await pool.request()
    .input('C', sql.Int, customerId)
    .query(`SELECT TOP 1 SessionID, TableID FROM tbl_session WHERE CustomerID = @C AND Status = 'Active' ORDER BY StartTime DESC`);
  return r.recordset[0] || null;
}

// หยิบเกมเข้าโต๊ะของฉัน (1 โต๊ะ 1 เกม — ต้องคืนเกมเดิมก่อน)
router.post('/api/my/borrow', requireCustomer, async (req, res) => {
  const gameId = toInt(req.body.gameId);
  if (!gameId) return res.status(400).json({ ok: false, message: 'กรุณาเลือกเกม' });
  try {
    const pool = await getPool();
    const my = await getMyActiveSession(pool, req.session.user.id);
    if (!my) {
      return res.status(400).json({ ok: false, message: 'คุณยังไม่มีโต๊ะที่กำลังเล่น — จองโต๊ะก่อน (หรือรอพนักงานเรียกคิว) แล้วค่อยเลือกเกม' });
    }
    const result = await borrowGame(pool, my.SessionID, gameId);
    if (!result.ok) return res.status(400).json(result);
    res.json({ ok: true, message: result.message + ' — รับเกมที่เคาน์เตอร์ได้เลย' });
    realtime.broadcastState();
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// คืนเกมที่โต๊ะของฉันกำลังเล่น → เลือกเกมใหม่ได้
router.post('/api/my/return-game', requireCustomer, async (req, res) => {
  try {
    const pool = await getPool();
    const my = await getMyActiveSession(pool, req.session.user.id);
    if (!my) return res.status(400).json({ ok: false, message: 'คุณยังไม่มีโต๊ะที่กำลังเล่น' });

    const current = await pool.request()
      .input('SessionID', sql.Int, my.SessionID)
      .query(`
        SELECT TOP 1 g.Name FROM tbl_instoreborrow ib
        JOIN tbl_boardgame g ON ib.GameID = g.GameID
        WHERE ib.SessionID = @SessionID AND ib.ReturnTime IS NULL
      `);
    if (!current.recordset.length) {
      return res.status(400).json({ ok: false, message: 'โต๊ะของคุณยังไม่ได้หยิบเกม' });
    }

    // trigger trg_instoreborrow_return คืนสต๊อกอัตโนมัติ
    await pool.request()
      .input('SessionID', sql.Int, my.SessionID)
      .query(`UPDATE tbl_instoreborrow SET ReturnTime = GETDATE() WHERE SessionID = @SessionID AND ReturnTime IS NULL`);

    res.json({ ok: true, message: `คืน "${current.recordset[0].Name}" แล้ว — เลือกเกมใหม่ให้โต๊ะ #${my.TableID} ได้เลย (นำกล่องเกมไปคืนที่เคาน์เตอร์)` });
    realtime.broadcastState();
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

module.exports = router;
