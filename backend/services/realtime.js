const { getPool } = require('../config/db');

let ioInstance = null;
let pollTimer = null;

// เก็บ Socket.IO instance ไว้ใช้ broadcast จากที่อื่น (เช่นหลัง insert ใน route)
function attachIo(io) {
  ioInstance = io;
}

// ดึงสถานะปัจจุบันทั้งหมดที่หน้าเว็บต้องใช้แสดงผลแบบเรียลไทม์
// (โต๊ะ+เวลาที่เหลือ, เกมที่หยิบอยู่ยังไม่คืน, สต๊อกเกมทั้งหมด, คิวที่รออยู่)
async function buildState() {
  const pool = await getPool();

  // VIEW vw_TableStatus (ข้างในเรียก fn_RemainingMinutes + fn_WaitingQueueCount) — update_v6
  const tables = (await pool.request().query(`
    SELECT TableID, Zone, Capacity, Status, SessionID, StartTime, ExpectedEndTime,
           MinutesLeft, CustomerName, CustomerPhone, WaitingCount
    FROM vw_TableStatus
    ORDER BY TableID
  `)).recordset;

  const games = (await pool.request().query(`
    SELECT g.GameID, g.Name, c.CategoryName, g.MinPlayer, g.MaxPlayer,
           g.Difficulty, g.TotalQty, g.AvailableQty,
           g.OffsiteRentalRate, g.DepositAmount
    FROM tbl_boardgame g
    LEFT JOIN tbl_gamecategory c ON g.CategoryID = c.CategoryID
    ORDER BY g.Name
  `)).recordset;

  const borrowed = (await pool.request().query(`
    SELECT ib.BorrowID, ib.SessionID, ib.GameID, g.Name AS GameName, ib.BorrowTime
    FROM tbl_instoreborrow ib
    JOIN tbl_boardgame g ON ib.GameID = g.GameID
    WHERE ib.ReturnTime IS NULL
    ORDER BY ib.BorrowTime ASC
  `)).recordset;

  // คิวที่รออยู่ — TableID = รอโต๊ะไหน (NULL = คิวรวม) ต้องรัน update_v2_queue_per_table.sql ก่อน
  // VIEW vw_CurrentQueue
  const queue = (await pool.request().query(`
    SELECT QueueID, TableID, CustomerID, CustomerName, Phone, QueueTime, WaitedMinutes
    FROM vw_CurrentQueue
    ORDER BY QueueTime ASC
  `)).recordset;

  // บิลเช่ากลับบ้าน (ที่ยังไม่คืนขึ้นก่อน) — ใช้ในหน้า "เช่ากลับบ้าน"
  // VIEW vw_RentalDetail (OverdueDays/IsOverdue มาจาก fn_RentalOverdueDays)
  const rentals = (await pool.request().query(`
    SELECT TOP 100 RentalID, FirstName, LastName, Phone, GameName, RentalDate, DueDate,
           RentalFee, Deposit, Status, ReturnDate, ReturnCondition, DepositRefunded,
           OverdueDays, IsOverdue
    FROM vw_RentalDetail
    ORDER BY CASE WHEN Status <> 'Returned' THEN 0 ELSE 1 END, DueDate ASC, RentalID DESC
  `)).recordset;

  // แพ็กเกจเวลา + พนักงาน ใช้ในฟอร์ม "จองโต๊ะ" (ข้อมูลนิ่ง เปลี่ยนไม่บ่อย แต่ส่งมาด้วยเพื่อให้ทุกจอเห็นตรงกัน)
  const packages = (await pool.request().query(`
    SELECT PackageID, PackageName, DurationMinutes, Price FROM tbl_timepackage ORDER BY PackageID
  `)).recordset;

  const employees = (await pool.request().query(`
    SELECT EmployeeID, Name, Position FROM tbl_employee ORDER BY EmployeeID
  `)).recordset;

  return { tables, games, borrowed, queue, rentals, packages, employees, serverTime: new Date().toISOString() };
}

// ข้อมูลสำหรับลูกค้า/ผู้ที่ยังไม่ login — ตัดข้อมูลส่วนตัวของลูกค้าคนอื่นออก (ชื่อ เบอร์ บิลเช่า)
// คิวเหลือแค่ "รอโต๊ะไหน" ไว้นับจำนวนคิว
function publicState(state) {
  return {
    serverTime: state.serverTime,
    tables: state.tables.map(t => ({
      TableID: t.TableID, Zone: t.Zone, Capacity: t.Capacity, Status: t.Status,
      SessionID: t.SessionID, StartTime: t.StartTime, ExpectedEndTime: t.ExpectedEndTime, MinutesLeft: t.MinutesLeft
    })),
    games: state.games,
    borrowed: state.borrowed.map(b => ({ SessionID: b.SessionID, GameID: b.GameID, GameName: b.GameName })),
    queue: state.queue.map(q => ({ TableID: q.TableID })),
    rentals: [],
    packages: state.packages,
    employees: []
  };
}

// ส่งสถานะล่าสุดไปทุกเบราว์เซอร์ที่เปิดอยู่ — แอดมิน (ห้อง 'admin') ได้ข้อมูลเต็ม,
// ลูกค้า/คนทั่วไป (ห้อง 'public') ได้ข้อมูลที่ตัดส่วนตัวออกแล้ว
async function broadcastState() {
  if (!ioInstance) return;
  try {
    const state = await buildState();
    ioInstance.to('admin').emit('state:update', state);
    ioInstance.to('public').emit('state:update', publicState(state));
  } catch (err) {
    console.error('broadcastState error:', err.message);
    ioInstance.emit('state:error', { message: 'เชื่อมต่อฐานข้อมูลไม่ได้ชั่วคราว' });
  }
}

function startPolling(intervalMs = 3000) {
  if (pollTimer) return;
  pollTimer = setInterval(broadcastState, intervalMs);
}

module.exports = { attachIo, buildState, broadcastState, startPolling, publicState };
