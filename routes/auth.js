const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { sql, getPool } = require('../config/db');
const { requireLogin } = require('../middleware/auth');

const PHONE_RE = /^0\d{8,9}$/;      // เบอร์ไทย 9-10 หลัก ขึ้นต้นด้วย 0
const MIN_PASSWORD = 6;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // ใช้เทียบตอนไม่พบผู้ใช้

/* ---------- กันเดารหัสผ่าน: ผิด 5 ครั้งติด ล็อก 1 นาที (เก็บในหน่วยความจำ) ---------- */
const attempts = new Map();
const LOCK_AFTER = 5, LOCK_MS = 60 * 1000;
function lockKey(req, role, id) { return `${req.ip}|${role}|${id}`; }
function isLocked(key) {
  const a = attempts.get(key);
  return a && a.until && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 1000) : 0;
}
function recordFail(key) {
  const a = attempts.get(key) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= LOCK_AFTER) { a.until = Date.now() + LOCK_MS; a.count = 0; }
  attempts.set(key, a);
}

// ปลายทางหลัง login ต้องเป็น path ภายในเว็บเท่านั้น (กัน open redirect)
function safeNext(next, user) {
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login')) return next;
  return user.role === 'admin' ? '/dashboard' : '/booking';
}

// เปลี่ยน session id ตอน login (กัน session fixation)
function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => {
      if (err) return reject(err);
      req.session.user = user;
      req.session.save(e => (e ? reject(e) : resolve()));
    });
  });
}

function customerSession(c) {
  return { role: 'customer', id: c.CustomerID, name: `${c.FirstName} ${c.LastName}`, firstName: c.FirstName, lastName: c.LastName, phone: c.Phone };
}

/* ================= Login ================= */
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(safeNext(null, req.session.user));
  res.render('login', {
    title: 'เข้าสู่ระบบ',
    as: req.query.as === 'staff' ? 'staff' : 'customer',
    next: req.query.next || '',
    error: null,
    identifier: ''
  });
});

router.post('/login', async (req, res) => {
  const as = req.body.as === 'staff' ? 'staff' : 'customer';
  const identifier = String(req.body.identifier || '').trim().slice(0, 30);
  const password = String(req.body.password || '');
  const next = req.body.next || '';
  const fail = (error, status = 400) => res.status(status).render('login', { title: 'เข้าสู่ระบบ', as, next, error, identifier });

  if (!identifier || !password) {
    return fail(as === 'staff' ? 'กรอกชื่อผู้ใช้และรหัสผ่าน' : 'กรอกเบอร์โทรและรหัสผ่าน');
  }
  const key = lockKey(req, as, identifier.toLowerCase());
  const wait = isLocked(key);
  if (wait) return fail(`ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ ${wait} วินาทีแล้วลองใหม่`, 429);

  try {
    const pool = await getPool();
    let user = null, hash = null;

    if (as === 'staff') {
      const r = await pool.request()
        .input('Username', sql.VarChar(30), identifier.toLowerCase())
        .query(`SELECT EmployeeID, Name, Position, Username, PasswordHash
                FROM tbl_employee WHERE Username = @Username AND PasswordHash IS NOT NULL`);
      if (r.recordset.length) {
        const e = r.recordset[0];
        hash = e.PasswordHash;
        user = { role: 'admin', id: e.EmployeeID, name: e.Name, username: e.Username, position: e.Position };
      }
    } else {
      const r = await pool.request()
        .input('Phone', sql.VarChar(15), identifier)
        .query(`SELECT CustomerID, FirstName, LastName, Phone, PasswordHash FROM tbl_customer WHERE Phone = @Phone`);
      if (r.recordset.length) {
        const c = r.recordset[0];
        if (!c.PasswordHash) {
          return fail('เบอร์นี้มีประวัติที่ร้านแต่ยังไม่ได้ตั้งรหัสผ่าน — กด "สมัครสมาชิก" ด้วยเบอร์นี้เพื่อตั้งรหัสผ่าน');
        }
        hash = c.PasswordHash;
        user = customerSession(c);
      }
    }

    // เทียบรหัสผ่านเสมอ (แม้ไม่เจอผู้ใช้) เพื่อให้เวลาตอบใกล้เคียงกัน
    const okPw = await bcrypt.compare(password, hash || DUMMY_HASH);
    if (!user || !okPw) {
      recordFail(key);
      return fail(as === 'staff' ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' : 'เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง', 401);
    }

    attempts.delete(key);
    await startSession(req, user);
    res.redirect(safeNext(next, user));
  } catch (err) {
    console.error(err);
    const hint = /Invalid column name/.test(err.message) ? ' (ฐานข้อมูลยังเป็นเวอร์ชันเก่า — รัน boardgame_cafe_sqlserver.sql ใหม่)' : '';
    fail('เข้าสู่ระบบไม่สำเร็จ: ' + err.message + hint, 500);
  }
});

/* ================= Register (ลูกค้า) ================= */
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect(safeNext(null, req.session.user));
  res.render('register', { title: 'สมัครสมาชิก', error: null, values: {} });
});

router.post('/register', async (req, res) => {
  const values = {
    firstName: String(req.body.firstName || '').trim().slice(0, 50),
    lastName: String(req.body.lastName || '').trim().slice(0, 50),
    phone: String(req.body.phone || '').trim()
  };
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');
  const fail = (error, status = 400) => res.status(status).render('register', { title: 'สมัครสมาชิก', error, values });

  if (!values.firstName || !values.lastName) return fail('กรอกชื่อและนามสกุล');
  if (!PHONE_RE.test(values.phone)) return fail('เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0 (เช่น 0812345678)');
  if (password.length < MIN_PASSWORD) return fail(`รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD} ตัวอักษร`);
  if (password !== confirm) return fail('ยืนยันรหัสผ่านไม่ตรงกัน');

  try {
    const pool = await getPool();
    const hash = await bcrypt.hash(password, 10);
    const sp = pool.request();
    sp.input('FirstName', sql.NVarChar(50), values.firstName);
    sp.input('LastName', sql.NVarChar(50), values.lastName);
    sp.input('Phone', sql.VarChar(15), values.phone);
    sp.input('PasswordHash', sql.VarChar(100), hash);
    sp.output('CustomerID', sql.Int);
    const result = await sp.execute('sp_RegisterCustomerAccount');
    const id = result.output.CustomerID;
    if (!id) return fail('สมัครสมาชิกไม่สำเร็จ ลองใหม่อีกครั้ง');

    await startSession(req, customerSession({ CustomerID: id, FirstName: values.firstName, LastName: values.lastName, Phone: values.phone }));
    res.redirect('/booking');
  } catch (err) {
    console.error(err);
    fail(err.message || 'สมัครสมาชิกไม่สำเร็จ');
  }
});

/* ================= Logout ================= */
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('bgc.sid');
    res.redirect('/login');
  });
});

/* ================= เปลี่ยนรหัสผ่าน (ลูกค้า + พนักงาน) ================= */
router.get('/account/password', requireLogin, (req, res) => {
  res.render('password', { title: 'เปลี่ยนรหัสผ่าน', error: null, success: null });
});

router.post('/account/password', requireLogin, async (req, res) => {
  const u = req.session.user;
  const current = String(req.body.current || '');
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');
  const render = (error, success, status = 200) => res.status(status).render('password', { title: 'เปลี่ยนรหัสผ่าน', error, success });

  if (password.length < MIN_PASSWORD) return render(`รหัสผ่านใหม่ต้องมีอย่างน้อย ${MIN_PASSWORD} ตัวอักษร`, null, 400);
  if (password !== confirm) return render('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน', null, 400);

  try {
    const pool = await getPool();
    const table = u.role === 'admin' ? 'tbl_employee' : 'tbl_customer';
    const idCol = u.role === 'admin' ? 'EmployeeID' : 'CustomerID';
    const r = await pool.request().input('ID', sql.Int, u.id)
      .query(`SELECT PasswordHash FROM ${table} WHERE ${idCol} = @ID`);
    const hash = r.recordset[0] && r.recordset[0].PasswordHash;
    if (!hash || !(await bcrypt.compare(current, hash))) return render('รหัสผ่านปัจจุบันไม่ถูกต้อง', null, 400);

    await pool.request()
      .input('ID', sql.Int, u.id)
      .input('Hash', sql.VarChar(100), await bcrypt.hash(password, 10))
      .query(`UPDATE ${table} SET PasswordHash = @Hash WHERE ${idCol} = @ID`);
    render(null, 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
  } catch (err) {
    console.error(err);
    render('เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + err.message, null, 500);
  }
});

module.exports = router;
module.exports.PHONE_RE = PHONE_RE;
