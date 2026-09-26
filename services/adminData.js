/* =========================================================
   จัดการข้อมูลฝั่งแอดมิน (เพิ่ม / แก้ไข / ลบ) — นิยามทุกตารางไว้ที่ไฟล์นี้ที่เดียว
   - list    : SELECT ที่ใช้แสดงในตาราง (เวลาแปลงเป็นข้อความใน SQL เลย กันเวลาเพี้ยนตาม timezone)
   - columns : คอลัมน์ที่โชว์บนหน้าเว็บ (fmt = วิธีแสดงผลฝั่งเบราว์เซอร์)
   - fields  : ช่องในฟอร์มเพิ่ม/แก้ไข → ตรวจค่าที่นี่ก่อน แล้ว INSERT/UPDATE แบบ parameterized
   - impact  : ก่อนลบ นับว่ามีข้อมูลอะไรผูกอยู่บ้าง (โชว์ให้แอดมินยืนยัน)
   - deleteProc : Stored Procedure ลบแบบ cascade (sp_AdminDelete* ใน boardgame_cafe_sqlserver.sql)
   ========================================================= */
const bcrypt = require('bcryptjs');
const { sql } = require('../config/db');

const PHONE_RE = /^0\d{8,9}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DIFFICULTY = [['Easy', 'ง่าย'], ['Medium', 'ปานกลาง'], ['Hard', 'ยาก']];
const QUEUE_STATUS = [['Waiting', 'รอคิว'], ['Seated', 'ได้โต๊ะแล้ว'], ['Cancelled', 'ยกเลิก']];

// รายการตัวเลือกที่ดึงจากฐานข้อมูล (dropdown ในฟอร์ม)
const LOOKUPS = {
  categories: `SELECT CategoryID AS value, CategoryName AS label FROM tbl_gamecategory ORDER BY CategoryName`,
  tables: `SELECT TableID AS value, CONCAT(N'โต๊ะ #', TableID, ' (', ISNULL(Zone, '-'), ', ', Capacity, N' คน)') AS label FROM tbl_table ORDER BY TableID`
};

const ENTITIES = {
  /* ---------------- ข้อมูลหลัก: เพิ่ม / แก้ไข / ลบ ---------------- */
  customers: {
    label: 'ลูกค้า', icon: '👤', table: 'tbl_customer', pk: 'CustomerID', canCreate: true,
    deleteProc: 'sp_AdminDeleteCustomer',
    list: `
      SELECT c.CustomerID, c.FirstName, c.LastName, c.Phone, c.NationalID, c.Points,
             CONVERT(varchar(16), c.CreatedDate, 120) AS CreatedDate,
             CASE WHEN c.PasswordHash IS NULL THEN 0 ELSE 1 END AS HasAccount,
             (SELECT COUNT(*) FROM tbl_session s WHERE s.CustomerID = c.CustomerID) AS SessionCount,
             (SELECT COUNT(*) FROM tbl_offsiterental r WHERE r.CustomerID = c.CustomerID) AS RentalCount
      FROM tbl_customer c ORDER BY c.CustomerID DESC`,
    rowLabel: (r) => `ลูกค้า #${r.CustomerID} ${r.FirstName} ${r.LastName}`,
    columns: [
      { key: 'CustomerID', label: '#', fmt: 'id' },
      { key: 'FirstName', label: 'ชื่อ' }, { key: 'LastName', label: 'นามสกุล' },
      { key: 'Phone', label: 'เบอร์โทร' },
      { key: 'NationalID', label: 'เลขบัตร ปชช.', fmt: 'nid' },
      { key: 'Points', label: 'แต้ม', fmt: 'num' },
      { key: 'HasAccount', label: 'บัญชีเว็บ', fmt: 'yesno' },
      { key: 'SessionCount', label: 'จองโต๊ะ', fmt: 'num' },
      { key: 'RentalCount', label: 'เช่า', fmt: 'num' },
      { key: 'CreatedDate', label: 'สมัครเมื่อ' }
    ],
    fields: [
      { name: 'FirstName', label: 'ชื่อ', type: 'text', required: true, maxLength: 50 },
      { name: 'LastName', label: 'นามสกุล', type: 'text', required: true, maxLength: 50 },
      { name: 'Phone', label: 'เบอร์โทร', type: 'text', required: true, maxLength: 15, pattern: PHONE_RE,
        patternMsg: 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0', unique: 'เบอร์โทรนี้มีลูกค้าคนอื่นใช้แล้ว', inputmode: 'numeric' },
      { name: 'NationalID', label: 'เลขบัตรประชาชน', type: 'text', maxLength: 13, pattern: /^\d{13}$/,
        patternMsg: 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก', unique: 'เลขบัตรนี้ถูกใช้กับลูกค้าคนอื่นแล้ว', inputmode: 'numeric',
        help: 'ไม่บังคับ (ต้องมีถ้าจะเช่ากลับบ้าน)' },
      { name: 'Points', label: 'แต้มสะสม', type: 'int', required: true, min: 0, max: 1000000, default: 0 },
      { name: 'Password', label: 'รหัสผ่านเว็บ', type: 'password', virtual: true, minLength: 6,
        help: 'ไม่บังคับ — ตั้งให้ลูกค้า login ด้วยเบอร์โทรได้ (ตอนแก้ไข: เว้นว่าง = ไม่เปลี่ยน)' }
    ],
    impact: [
      { label: 'การจองโต๊ะ (รวมประวัติ)', sql: `SELECT COUNT(*) AS n FROM tbl_session WHERE CustomerID = @id` },
      { label: 'การจองโต๊ะที่กำลังเล่นอยู่ → โต๊ะจะกลับเป็นว่าง', sql: `SELECT COUNT(*) AS n FROM tbl_session WHERE CustomerID = @id AND Status = 'Active'`, warn: true },
      { label: 'บิลเช่ากลับบ้าน', sql: `SELECT COUNT(*) AS n FROM tbl_offsiterental WHERE CustomerID = @id` },
      { label: 'บิลเช่าที่ยังไม่คืน → คืนสต๊อกเกม', sql: `SELECT COUNT(*) AS n FROM tbl_offsiterental WHERE CustomerID = @id AND Status <> 'Returned'`, warn: true },
      { label: 'คิว', sql: `SELECT COUNT(*) AS n FROM tbl_queue WHERE CustomerID = @id` }
    ]
  },

  employees: {
    label: 'พนักงาน', icon: '🛠', table: 'tbl_employee', pk: 'EmployeeID', canCreate: true,
    deleteProc: 'sp_AdminDeleteEmployee',
    list: `
      SELECT e.EmployeeID, e.Name, e.Position, e.Phone, e.Username,
             CASE WHEN e.PasswordHash IS NULL OR e.Username IS NULL THEN 0 ELSE 1 END AS CanLogin,
             (SELECT COUNT(*) FROM tbl_session s WHERE s.EmployeeID = e.EmployeeID) AS SessionCount,
             (SELECT COUNT(*) FROM tbl_offsiterental r WHERE r.EmployeeID = e.EmployeeID) AS RentalCount
      FROM tbl_employee e ORDER BY e.EmployeeID`,
    rowLabel: (r) => `พนักงาน #${r.EmployeeID} ${r.Name}`,
    columns: [
      { key: 'EmployeeID', label: '#', fmt: 'id' },
      { key: 'Name', label: 'ชื่อ' }, { key: 'Position', label: 'ตำแหน่ง' }, { key: 'Phone', label: 'เบอร์โทร' },
      { key: 'Username', label: 'Username' },
      { key: 'CanLogin', label: 'login ได้', fmt: 'yesno' },
      { key: 'SessionCount', label: 'บิลโต๊ะ', fmt: 'num' },
      { key: 'RentalCount', label: 'บิลเช่า', fmt: 'num' }
    ],
    fields: [
      { name: 'Name', label: 'ชื่อ', type: 'text', required: true, maxLength: 100 },
      { name: 'Position', label: 'ตำแหน่ง', type: 'text', maxLength: 50, suggestions: ['Staff', 'Manager', 'Cashier'] },
      { name: 'Phone', label: 'เบอร์โทร', type: 'text', maxLength: 15, pattern: PHONE_RE,
        patternMsg: 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0', inputmode: 'numeric' },
      { name: 'Username', label: 'Username (สำหรับ login)', type: 'text', maxLength: 30, lower: true,
        pattern: /^[a-z0-9_.]{3,30}$/, patternMsg: 'Username ใช้ a-z, 0-9, _ หรือ . ยาว 3-30 ตัว',
        unique: 'Username นี้มีพนักงานคนอื่นใช้แล้ว', help: 'เว้นว่าง = login ไม่ได้' },
      { name: 'Password', label: 'รหัสผ่าน', type: 'password', virtual: true, minLength: 6,
        help: 'ตอนแก้ไข: เว้นว่าง = ไม่เปลี่ยนรหัส' }
    ],
    impact: [
      { label: 'บิลจองโต๊ะที่พนักงานคนนี้บันทึก', sql: `SELECT COUNT(*) AS n FROM tbl_session WHERE EmployeeID = @id` },
      { label: 'ในนั้นกำลังเล่นอยู่ → โต๊ะจะกลับเป็นว่าง', sql: `SELECT COUNT(*) AS n FROM tbl_session WHERE EmployeeID = @id AND Status = 'Active'`, warn: true },
      { label: 'บิลเช่ากลับบ้านที่พนักงานคนนี้บันทึก', sql: `SELECT COUNT(*) AS n FROM tbl_offsiterental WHERE EmployeeID = @id` }
    ]
  },

  categories: {
    label: 'หมวดเกม', icon: '🏷', table: 'tbl_gamecategory', pk: 'CategoryID', canCreate: true,
    deleteProc: 'sp_AdminDeleteCategory',
    list: `
      SELECT c.CategoryID, c.CategoryName,
             (SELECT COUNT(*) FROM tbl_boardgame g WHERE g.CategoryID = c.CategoryID) AS GameCount
      FROM tbl_gamecategory c ORDER BY c.CategoryID`,
    rowLabel: (r) => `หมวด "${r.CategoryName}"`,
    columns: [
      { key: 'CategoryID', label: '#', fmt: 'id' },
      { key: 'CategoryName', label: 'ชื่อหมวด' },
      { key: 'GameCount', label: 'จำนวนเกม', fmt: 'num' }
    ],
    fields: [
      { name: 'CategoryName', label: 'ชื่อหมวด', type: 'text', required: true, maxLength: 50, unique: 'มีหมวดชื่อนี้แล้ว' }
    ],
    impact: [
      { label: 'เกมในหมวดนี้ → ไม่ถูกลบ แต่จะกลายเป็น "ไม่มีหมวด"', sql: `SELECT COUNT(*) AS n FROM tbl_boardgame WHERE CategoryID = @id` }
    ]
  },

  games: {
    label: 'บอร์ดเกม', icon: '🎲', table: 'tbl_boardgame', pk: 'GameID', canCreate: true,
    deleteProc: 'sp_AdminDeleteGame', lookups: ['categories'],
    list: `
      SELECT g.GameID, g.Name, g.CategoryID, c.CategoryName, g.MinPlayer, g.MaxPlayer, g.Difficulty,
             g.TotalQty, g.AvailableQty, g.OffsiteRentalRate, g.DepositAmount,
             g.ImageUrl, g.PlayTime, g.ShortDescription, g.HowToPlay
      FROM tbl_boardgame g LEFT JOIN tbl_gamecategory c ON c.CategoryID = g.CategoryID
      ORDER BY g.GameID`,
    rowLabel: (r) => `บอร์ดเกม "${r.Name}"`,
    columns: [
      { key: 'GameID', label: '#', fmt: 'id' },
      { key: 'ImageUrl', label: 'รูป', fmt: 'img' },
      { key: 'Name', label: 'ชื่อเกม' },
      { key: 'CategoryName', label: 'หมวด' },
      { key: 'MinPlayer', label: 'ผู้เล่น', fmt: 'players' },
      { key: 'Difficulty', label: 'ระดับ', fmt: 'difficulty' },
      { key: 'AvailableQty', label: 'ว่าง / ทั้งหมด', fmt: 'stock' },
      { key: 'OffsiteRentalRate', label: 'ค่าเช่า', fmt: 'money' },
      { key: 'DepositAmount', label: 'มัดจำ', fmt: 'money' }
    ],
    fields: [
      { name: 'Name', label: 'ชื่อเกม', type: 'text', required: true, maxLength: 100, unique: 'มีเกมชื่อนี้แล้ว' },
      { name: 'CategoryID', label: 'หมวด', type: 'select', lookup: 'categories', placeholder: '— ไม่มีหมวด —' },
      { name: 'MinPlayer', label: 'ผู้เล่นน้อยสุด', type: 'int', required: true, min: 1, max: 50, default: 2 },
      { name: 'MaxPlayer', label: 'ผู้เล่นมากสุด', type: 'int', required: true, min: 1, max: 50, default: 4 },
      { name: 'Difficulty', label: 'ระดับความยาก', type: 'select', options: DIFFICULTY, required: true, default: 'Easy' },
      { name: 'TotalQty', label: 'จำนวนกล่องทั้งหมด', type: 'int', required: true, min: 0, max: 999, default: 1,
        help: 'จำนวน "ว่าง" ปรับตามให้อัตโนมัติ (ไม่นับกล่องที่ถูกหยิบ/เช่าอยู่)' },
      { name: 'OffsiteRentalRate', label: 'ค่าเช่ากลับบ้าน (บาท)', type: 'money', required: true, default: 0 },
      { name: 'DepositAmount', label: 'ค่ามัดจำ (บาท)', type: 'money', required: true, default: 0 },
      { name: 'PlayTime', label: 'เวลาเล่นโดยประมาณ', type: 'text', maxLength: 30, placeholder: 'เช่น 30-60 นาที' },
      { name: 'ImageUrl', label: 'รูปเกม (URL)', type: 'text', maxLength: 255, placeholder: '/images/games/default.svg',
        pattern: /^(\/|https?:\/\/)\S+$/, patternMsg: 'รูปต้องขึ้นต้นด้วย / หรือ http(s)://',
        help: 'วางไฟล์ไว้ใน public/images/games/ แล้วใส่ /images/games/ชื่อไฟล์' },
      { name: 'ShortDescription', label: 'รายละเอียดย่อ', type: 'textarea', maxLength: 400, rows: 3, nvarchar: true },
      { name: 'HowToPlay', label: 'วิธีเล่นแบบย่อ (1 บรรทัด = 1 ขั้นตอน)', type: 'textarea', maxLength: 2000, rows: 5, nvarchar: true }
    ],
    // จำนวน "ว่าง" คำนวณจากของเดิม: เพิ่มกล่อง +n → ว่าง +n  (ฝั่งขวาของ SET ใช้ค่าก่อนอัปเดต)
    insertExtra: { AvailableQty: '@TotalQty' },
    updateExtra: ['AvailableQty = AvailableQty + (@TotalQty - TotalQty)'],
    impact: [
      { label: 'กำลังถูกหยิบเล่นที่โต๊ะ', sql: `SELECT COUNT(*) AS n FROM tbl_instoreborrow WHERE GameID = @id AND ReturnTime IS NULL`, warn: true },
      { label: 'ประวัติการหยิบเข้าโต๊ะ', sql: `SELECT COUNT(*) AS n FROM tbl_instoreborrow WHERE GameID = @id` },
      { label: 'บิลเช่ากลับบ้าน (รวมที่คืนแล้ว)', sql: `SELECT COUNT(*) AS n FROM tbl_offsiterental WHERE GameID = @id` },
      { label: 'บิลเช่าที่ยังไม่คืน', sql: `SELECT COUNT(*) AS n FROM tbl_offsiterental WHERE GameID = @id AND Status <> 'Returned'`, warn: true }
    ]
  },

  tables: {
    label: 'โต๊ะ', icon: '🪑', table: 'tbl_table', pk: 'TableID', canCreate: true,
    deleteProc: 'sp_AdminDeleteTable',
    list: `
      SELECT t.TableID, t.Zone, t.Capacity, t.HourlyRate, t.Status,
             (SELECT COUNT(*) FROM tbl_session s WHERE s.TableID = t.TableID) AS SessionCount,
             (SELECT COUNT(*) FROM tbl_queue q WHERE q.TableID = t.TableID AND q.Status = 'Waiting') AS Waiting
      FROM tbl_table t ORDER BY t.TableID`,
    rowLabel: (r) => `โต๊ะ #${r.TableID}`,
    columns: [
      { key: 'TableID', label: 'โต๊ะ', fmt: 'id' },
      { key: 'Zone', label: 'โซน' },
      { key: 'Capacity', label: 'ที่นั่ง', fmt: 'num' },
      { key: 'HourlyRate', label: 'ราคา/ชม.', fmt: 'money' },
      { key: 'Status', label: 'สถานะ', fmt: 'tableStatus' },
      { key: 'Waiting', label: 'คิวรอ', fmt: 'num' },
      { key: 'SessionCount', label: 'จองทั้งหมด', fmt: 'num' }
    ],
    fields: [
      { name: 'Zone', label: 'โซน', type: 'text', maxLength: 20, placeholder: 'เช่น A, B, VIP' },
      { name: 'Capacity', label: 'จำนวนที่นั่ง', type: 'int', required: true, min: 1, max: 50, default: 4 },
      { name: 'HourlyRate', label: 'ราคาต่อชั่วโมง (บาท)', type: 'money', required: true, default: 0 }
    ],
    impact: [
      { label: 'กำลังมีลูกค้าเล่นอยู่ → ลบการจองนี้ด้วย', sql: `SELECT COUNT(*) AS n FROM tbl_session WHERE TableID = @id AND Status = 'Active'`, warn: true },
      { label: 'การจองโต๊ะนี้ (รวมประวัติ)', sql: `SELECT COUNT(*) AS n FROM tbl_session WHERE TableID = @id` },
      { label: 'คิวของโต๊ะนี้', sql: `SELECT COUNT(*) AS n FROM tbl_queue WHERE TableID = @id` }
    ]
  },

  packages: {
    label: 'แพ็กเกจเวลา', icon: '⏱', table: 'tbl_timepackage', pk: 'PackageID', canCreate: true,
    deleteProc: 'sp_AdminDeletePackage',
    list: `
      SELECT p.PackageID, p.PackageName, p.DurationMinutes, p.Price,
             (SELECT COUNT(*) FROM tbl_session s WHERE s.PackageID = p.PackageID) AS SessionCount
      FROM tbl_timepackage p ORDER BY p.PackageID`,
    rowLabel: (r) => `แพ็กเกจ "${r.PackageName}"`,
    columns: [
      { key: 'PackageID', label: '#', fmt: 'id' },
      { key: 'PackageName', label: 'ชื่อแพ็กเกจ' },
      { key: 'DurationMinutes', label: 'ระยะเวลา', fmt: 'minutes' },
      { key: 'Price', label: 'ราคา', fmt: 'money' },
      { key: 'SessionCount', label: 'ถูกใช้จอง', fmt: 'num' }
    ],
    fields: [
      { name: 'PackageName', label: 'ชื่อแพ็กเกจ', type: 'text', required: true, maxLength: 50, unique: 'มีแพ็กเกจชื่อนี้แล้ว' },
      { name: 'DurationMinutes', label: 'ระยะเวลา (นาที)', type: 'int', min: 1, max: 1440, help: 'เว้นว่าง = เหมาวัน (ถึงเวลาปิดร้าน)' },
      { name: 'Price', label: 'ราคา (บาท)', type: 'money', required: true }
    ],
    impact: [
      { label: 'การจองโต๊ะที่ใช้แพ็กเกจนี้ (รวมประวัติ)', sql: `SELECT COUNT(*) AS n FROM tbl_session WHERE PackageID = @id` },
      { label: 'ในนั้นกำลังเล่นอยู่ → โต๊ะจะกลับเป็นว่าง', sql: `SELECT COUNT(*) AS n FROM tbl_session WHERE PackageID = @id AND Status = 'Active'`, warn: true }
    ]
  },

  /* ---------------- รายการที่เกิดจากการจอง: แก้ไข / ลบ (เพิ่มผ่านหน้าลูกค้าเท่านั้น) ---------------- */
  sessions: {
    label: 'การจองโต๊ะ', icon: '📋', table: 'tbl_session', pk: 'SessionID', canCreate: false, group: 'booking',
    deleteProc: 'sp_AdminDeleteSession',
    list: `
      SELECT TOP 300 s.SessionID, s.TableID, s.Status,
             CASE WHEN c.CustomerID IS NULL THEN 'walk-in' ELSE CONCAT(c.FirstName, ' ', c.LastName) END AS CustomerName,
             c.Phone, tp.PackageName, e.Name AS EmployeeName,
             CONVERT(varchar(16), s.StartTime, 120) AS StartTime,
             CONVERT(varchar(16), s.ExpectedEndTime, 120) AS ExpectedEndTime,
             CONVERT(varchar(16), s.ActualEndTime, 120) AS ActualEndTime,
             s.AmountPaid,
             (SELECT TOP 1 g.Name FROM tbl_instoreborrow ib JOIN tbl_boardgame g ON g.GameID = ib.GameID
               WHERE ib.SessionID = s.SessionID AND ib.ReturnTime IS NULL) AS CurrentGame
      FROM tbl_session s
      JOIN tbl_timepackage tp ON tp.PackageID = s.PackageID
      JOIN tbl_employee e ON e.EmployeeID = s.EmployeeID
      LEFT JOIN tbl_customer c ON c.CustomerID = s.CustomerID
      ORDER BY s.SessionID DESC`,
    rowLabel: (r) => `การจองโต๊ะ #${r.SessionID} (โต๊ะ #${r.TableID} — ${r.CustomerName})`,
    columns: [
      { key: 'SessionID', label: 'บิล', fmt: 'id' },
      { key: 'TableID', label: 'โต๊ะ', fmt: 'table' },
      { key: 'CustomerName', label: 'ลูกค้า', sub: 'Phone' },
      { key: 'PackageName', label: 'แพ็กเกจ' },
      { key: 'StartTime', label: 'เริ่ม' },
      { key: 'ExpectedEndTime', label: 'หมดเวลา' },
      { key: 'AmountPaid', label: 'จ่าย', fmt: 'money' },
      { key: 'CurrentGame', label: 'เกมบนโต๊ะ' },
      { key: 'Status', label: 'สถานะ', fmt: 'sessionStatus' },
      { key: 'EmployeeName', label: 'บันทึกโดย' }
    ],
    fields: [
      { name: 'ExpectedEndTime', label: 'เวลาหมด', type: 'datetime', required: true },
      { name: 'AmountPaid', label: 'ยอดที่จ่าย (บาท)', type: 'money', required: true }
    ],
    impact: [
      { label: 'กำลังเล่นอยู่ → โต๊ะจะกลับเป็นว่าง', sql: `SELECT COUNT(*) AS n FROM tbl_session WHERE SessionID = @id AND Status = 'Active'`, warn: true },
      { label: 'เกมที่ยังไม่คืน → คืนสต๊อก', sql: `SELECT COUNT(*) AS n FROM tbl_instoreborrow WHERE SessionID = @id AND ReturnTime IS NULL`, warn: true },
      { label: 'ประวัติการหยิบเกม', sql: `SELECT COUNT(*) AS n FROM tbl_instoreborrow WHERE SessionID = @id` },
      { label: 'ประวัติการต่อเวลา', sql: `SELECT COUNT(*) AS n FROM tbl_sessionextension WHERE SessionID = @id` }
    ]
  },

  queue: {
    label: 'คิว', icon: '🎫', table: 'tbl_queue', pk: 'QueueID', canCreate: false, group: 'booking',
    deleteProc: 'sp_AdminDeleteQueue', lookups: ['tables'],
    list: `
      SELECT TOP 300 q.QueueID, q.TableID, q.CustomerName, q.Phone, q.Status,
             CONVERT(varchar(16), q.QueueTime, 120) AS QueueTime
      FROM tbl_queue q ORDER BY CASE WHEN q.Status = 'Waiting' THEN 0 ELSE 1 END, q.QueueID DESC`,
    rowLabel: (r) => `คิว #${r.QueueID} (${r.CustomerName})`,
    columns: [
      { key: 'QueueID', label: 'คิว', fmt: 'id' },
      { key: 'TableID', label: 'รอโต๊ะ', fmt: 'table' },
      { key: 'CustomerName', label: 'ชื่อ', sub: 'Phone' },
      { key: 'QueueTime', label: 'ลงคิวเมื่อ' },
      { key: 'Status', label: 'สถานะ', fmt: 'queueStatus' }
    ],
    fields: [
      { name: 'CustomerName', label: 'ชื่อลูกค้า', type: 'text', required: true, maxLength: 100 },
      { name: 'Phone', label: 'เบอร์โทร', type: 'text', maxLength: 15, pattern: PHONE_RE,
        patternMsg: 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0', inputmode: 'numeric' },
      { name: 'TableID', label: 'รอโต๊ะ', type: 'select', lookup: 'tables', placeholder: '— คิวรวม (โต๊ะไหนก็ได้) —' },
      { name: 'Status', label: 'สถานะ', type: 'select', options: QUEUE_STATUS, required: true }
    ],
    impact: []
  },

  rentals: {
    label: 'เช่ากลับบ้าน', icon: '🏠', table: 'tbl_offsiterental', pk: 'RentalID', canCreate: false, group: 'booking',
    deleteProc: 'sp_AdminDeleteRental',
    list: `
      SELECT TOP 300 r.RentalID, CONCAT(c.FirstName, ' ', c.LastName) AS CustomerName, c.Phone, g.Name AS GameName,
             CONVERT(varchar(16), r.RentalDate, 120) AS RentalDate,
             CONVERT(varchar(10), r.DueDate, 120) AS DueDate,
             r.RentalFee, r.Deposit, r.Status,
             CONVERT(varchar(16), r.ReturnDate, 120) AS ReturnDate,
             CASE WHEN r.Status <> 'Returned' AND r.DueDate < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END AS IsOverdue
      FROM tbl_offsiterental r
      JOIN tbl_customer c ON c.CustomerID = r.CustomerID
      JOIN tbl_boardgame g ON g.GameID = r.GameID
      ORDER BY r.RentalID DESC`,
    rowLabel: (r) => `บิลเช่า #${r.RentalID} (${r.GameName} — ${r.CustomerName})`,
    columns: [
      { key: 'RentalID', label: 'บิล', fmt: 'id' },
      { key: 'CustomerName', label: 'ลูกค้า', sub: 'Phone' },
      { key: 'GameName', label: 'เกม' },
      { key: 'RentalDate', label: 'วันที่เช่า' },
      { key: 'DueDate', label: 'กำหนดคืน' },
      { key: 'RentalFee', label: 'ค่าเช่า', fmt: 'money' },
      { key: 'Deposit', label: 'มัดจำ', fmt: 'money' },
      { key: 'Status', label: 'สถานะ', fmt: 'rentalStatus' }
    ],
    fields: [
      { name: 'DueDate', label: 'กำหนดคืน', type: 'date', required: true },
      { name: 'RentalFee', label: 'ค่าเช่า (บาท)', type: 'money', required: true },
      { name: 'Deposit', label: 'ค่ามัดจำ (บาท)', type: 'money', required: true }
    ],
    impact: [
      { label: 'ยังไม่คืนเกม → คืนสต๊อกให้อัตโนมัติ', sql: `SELECT COUNT(*) AS n FROM tbl_offsiterental WHERE RentalID = @id AND Status <> 'Returned'`, warn: true }
    ]
  }
};

/* ---------- ข้อมูลที่ส่งให้หน้าเว็บ (ไม่มี SQL) ---------- */
function publicMeta() {
  const out = {};
  for (const [key, e] of Object.entries(ENTITIES)) {
    out[key] = {
      key, label: e.label, icon: e.icon, pk: e.pk, canCreate: e.canCreate, group: e.group || 'master',
      columns: e.columns,
      fields: e.fields.map(f => ({
        name: f.name, label: f.label, type: f.type, required: !!f.required, maxLength: f.maxLength,
        minLength: f.minLength, min: f.min, max: f.max, options: f.options, lookup: f.lookup,
        placeholder: f.placeholder, help: f.help, default: f.default, rows: f.rows,
        suggestions: f.suggestions, inputmode: f.inputmode,
        pattern: f.pattern ? f.pattern.source : undefined, patternMsg: f.patternMsg
      }))
    };
  }
  return out;
}

/* ---------- ตรวจค่าจากฟอร์ม ---------- */
class InputError extends Error {
  constructor(message, field) { super(message); this.field = field; this.isInput = true; }
}

function parseFields(entity, body, mode) {
  const values = {};
  for (const f of entity.fields) {
    let raw = body[f.name];
    if (raw === undefined || raw === null) raw = '';
    raw = String(raw).trim();
    if (f.lower) raw = raw.toLowerCase();

    if (raw === '') {
      if (f.type === 'password') continue;                         // ไม่กรอก = ไม่เปลี่ยน
      if (f.required) throw new InputError(`กรุณากรอก "${f.label}"`, f.name);
      values[f.name] = null;
      continue;
    }
    if (f.maxLength && raw.length > f.maxLength) throw new InputError(`"${f.label}" ยาวเกิน ${f.maxLength} ตัวอักษร`, f.name);
    if (f.minLength && raw.length < f.minLength) throw new InputError(`"${f.label}" ต้องยาวอย่างน้อย ${f.minLength} ตัวอักษร`, f.name);
    if (f.pattern && !f.pattern.test(raw)) throw new InputError(f.patternMsg || `"${f.label}" รูปแบบไม่ถูกต้อง`, f.name);

    switch (f.type) {
      case 'int': {
        if (!/^-?\d+$/.test(raw)) throw new InputError(`"${f.label}" ต้องเป็นจำนวนเต็ม`, f.name);
        const n = parseInt(raw, 10);
        if (f.min !== undefined && n < f.min) throw new InputError(`"${f.label}" ต้องไม่น้อยกว่า ${f.min}`, f.name);
        if (f.max !== undefined && n > f.max) throw new InputError(`"${f.label}" ต้องไม่เกิน ${f.max}`, f.name);
        values[f.name] = n;
        break;
      }
      case 'money': {
        if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new InputError(`"${f.label}" ต้องเป็นจำนวนเงิน ≥ 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)`, f.name);
        const n = Number(raw);
        if (n > 99999999) throw new InputError(`"${f.label}" มากเกินไป`, f.name);
        values[f.name] = n;
        break;
      }
      case 'select': {
        if (f.options) {
          if (!f.options.some(([v]) => v === raw)) throw new InputError(`เลือก "${f.label}" ไม่ถูกต้อง`, f.name);
          values[f.name] = raw;
        } else {
          const n = parseInt(raw, 10);
          if (!Number.isFinite(n) || n <= 0) throw new InputError(`เลือก "${f.label}" ไม่ถูกต้อง`, f.name);
          values[f.name] = n;
        }
        break;
      }
      case 'datetime':
        if (!DATETIME_RE.test(raw)) throw new InputError(`"${f.label}" ต้องเป็นวันที่และเวลา`, f.name);
        values[f.name] = raw.replace(' ', 'T').slice(0, 16) + ':00';   // ISO 8601 → CAST เป็น DATETIME ได้ทุก language
        break;
      case 'date':
        if (!DATE_RE.test(raw)) throw new InputError(`"${f.label}" ต้องเป็นวันที่`, f.name);
        values[f.name] = raw;
        break;
      default:
        values[f.name] = raw;
    }
  }
  return values;
}

// ชนิดข้อมูลของพารามิเตอร์ SQL + วิธีเขียนใน SQL (วันที่ต้อง CAST จากข้อความ)
function bindParam(request, f, value) {
  switch (f.type) {
    case 'int': return request.input(f.name, sql.Int, value);
    case 'select': return request.input(f.name, f.options ? sql.VarChar(30) : sql.Int, value);
    case 'money': return request.input(f.name, sql.Decimal(10, 2), value);
    case 'datetime':
    case 'date': return request.input(f.name, sql.VarChar(19), value);
    default: return request.input(f.name, sql.NVarChar(f.maxLength || 4000), value);
  }
}
function sqlValue(f) {
  if (f.type === 'datetime') return `CAST(@${f.name} AS DATETIME)`;
  if (f.type === 'date') return `CAST(@${f.name} AS DATE)`;
  return `@${f.name}`;
}

/* ---------- การตรวจเพิ่มเติมเฉพาะตาราง (ต้องใช้ข้อมูลในฐานข้อมูล) ---------- */
async function extraChecks(pool, key, values, mode, id) {
  if (key === 'games') {
    if (values.MinPlayer > values.MaxPlayer) throw new InputError('ผู้เล่นน้อยสุดต้องไม่มากกว่าผู้เล่นมากสุด', 'MinPlayer');
    if (mode === 'update') {
      const r = await pool.request().input('id', sql.Int, id)
        .query(`SELECT TotalQty - AvailableQty AS InUse FROM tbl_boardgame WHERE GameID = @id`);
      const inUse = r.recordset.length ? r.recordset[0].InUse : 0;
      if (values.TotalQty < inUse) {
        throw new InputError(`ตอนนี้เกมนี้ถูกหยิบ/เช่าอยู่ ${inUse} กล่อง — จำนวนทั้งหมดต้องไม่น้อยกว่า ${inUse}`, 'TotalQty');
      }
    }
  }
  if (key === 'employees' && mode === 'update') {
    // พนักงานระบบ Online Booking ต้องคงตำแหน่ง System ไว้ (เว็บใช้หาเป็น EmployeeID ตอนลูกค้าจองเอง)
    const r = await pool.request().input('id', sql.Int, id).query(`SELECT Position FROM tbl_employee WHERE EmployeeID = @id`);
    if (r.recordset.length && r.recordset[0].Position === 'System' && values.Position !== 'System') {
      throw new InputError('พนักงานระบบ Online Booking ต้องมีตำแหน่ง "System" เท่านั้น', 'Position');
    }
  }
  if (key === 'sessions' && mode === 'update') {
    const r = await pool.request().input('id', sql.Int, id).input('End', sql.VarChar(19), values.ExpectedEndTime)
      .query(`SELECT CASE WHEN CAST(@End AS DATETIME) > StartTime THEN 1 ELSE 0 END AS ok FROM tbl_session WHERE SessionID = @id`);
    if (r.recordset.length && !r.recordset[0].ok) throw new InputError('เวลาหมดต้องอยู่หลังเวลาเริ่มเล่น', 'ExpectedEndTime');
  }
}

async function checkUnique(pool, entity, values, id) {
  for (const f of entity.fields) {
    if (!f.unique || values[f.name] === null || values[f.name] === undefined) continue;
    const req = pool.request();
    bindParam(req, f, values[f.name]);
    req.input('id', sql.Int, id || 0);
    const r = await req.query(`SELECT TOP 1 1 AS dup FROM ${entity.table} WHERE ${f.name} = @${f.name} AND ${entity.pk} <> @id`);
    if (r.recordset.length) throw new InputError(f.unique, f.name);
  }
}

// ข้อความ error ของ SQL Server → ภาษาคน
function friendlyDbError(err) {
  const msg = err.message || '';
  if (err.number === 2601 || err.number === 2627) return 'ข้อมูลซ้ำกับที่มีอยู่แล้วในฐานข้อมูล (ค่าที่ต้องไม่ซ้ำ)';
  if (err.number === 547) {
    if (/CK_boardgame_qty/.test(msg)) return 'จำนวนกล่องทั้งหมดน้อยกว่าที่ถูกหยิบ/เช่าอยู่';
    if (/CK_session_time/.test(msg)) return 'เวลาหมดต้องอยู่หลังเวลาเริ่มเล่น';
    if (/CK_customer_NationalID/.test(msg)) return 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก';
    if (/REFERENCE constraint/i.test(msg)) return 'ยังมีข้อมูลอื่นผูกอยู่ — ลบไม่ได้';
    if (/FOREIGN KEY/i.test(msg)) return 'ค่าที่เลือกไม่มีอยู่ในฐานข้อมูลแล้ว (อาจเพิ่งถูกลบ) — รีเฟรชแล้วเลือกใหม่';
    return 'ข้อมูลไม่ผ่านเงื่อนไขของฐานข้อมูล: ' + msg;
  }
  if (err.number === 50000) return msg;   // RAISERROR จาก Stored Procedure (ข้อความภาษาไทยที่เขียนไว้แล้ว)
  if (err.number === 2812) return 'ฐานข้อมูลยังเป็นเวอร์ชันเก่า — รัน boardgame_cafe_sqlserver.sql ใหม่ใน SSMS (ไม่พบ Stored Procedure สำหรับลบ)';
  return null;
}

/* ---------- CRUD ---------- */
function getEntity(key) {
  return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : null;
}

async function listRows(pool, key) {
  const e = ENTITIES[key];
  const rows = (await pool.request().query(e.list)).recordset;
  const lookups = {};
  for (const name of (e.lookups || [])) lookups[name] = (await pool.request().query(LOOKUPS[name])).recordset;
  return { rows, lookups };
}

async function createRow(pool, key, body) {
  const e = ENTITIES[key];
  if (!e.canCreate) throw new InputError(`${e.label}เพิ่มจากหน้านี้ไม่ได้ — เกิดจากการจองของลูกค้าเท่านั้น`);
  const values = parseFields(e, body, 'create');
  await extraChecks(pool, key, values, 'create');
  await checkUnique(pool, e, values);

  const req = pool.request();
  const cols = [], vals = [];
  for (const f of e.fields) {
    if (f.virtual || !(f.name in values)) continue;
    bindParam(req, f, values[f.name]);
    cols.push(f.name); vals.push(sqlValue(f));
  }
  for (const [col, expr] of Object.entries(e.insertExtra || {})) { cols.push(col); vals.push(expr); }
  if (values.Password) {
    req.input('PasswordHash', sql.VarChar(100), await bcrypt.hash(values.Password, 10));
    cols.push('PasswordHash'); vals.push('@PasswordHash');
  }
  // ไม่ใช้ OUTPUT INSERTED เพราะบางตารางมี trigger (SQL Server ไม่ให้ใช้ OUTPUT แบบไม่มี INTO กับตารางที่มี trigger)
  const r = await req.query(`INSERT INTO ${e.table} (${cols.join(', ')}) VALUES (${vals.join(', ')});
                             SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`);
  return r.recordset[0].id;
}

async function updateRow(pool, key, id, body) {
  const e = ENTITIES[key];
  const values = parseFields(e, body, 'update');
  await extraChecks(pool, key, values, 'update', id);
  await checkUnique(pool, e, values, id);

  const req = pool.request().input('id', sql.Int, id);
  const sets = [];
  for (const f of e.fields) {
    if (f.virtual || !(f.name in values)) continue;
    bindParam(req, f, values[f.name]);
    sets.push(`${f.name} = ${sqlValue(f)}`);
  }
  sets.push(...(e.updateExtra || []));
  if (values.Password) {
    req.input('PasswordHash', sql.VarChar(100), await bcrypt.hash(values.Password, 10));
    sets.push('PasswordHash = @PasswordHash');
  }
  const r = await req.query(`UPDATE ${e.table} SET ${sets.join(', ')} WHERE ${e.pk} = @id`);
  if (!r.rowsAffected[0]) throw new InputError('ไม่พบข้อมูลนี้แล้ว (อาจถูกลบไปก่อนหน้า)');
}

async function getRow(pool, key, id) {
  const e = ENTITIES[key];
  const r = await pool.request().input('id', sql.Int, id)
    .query(`SELECT * FROM (${e.list.replace(/ORDER BY[\s\S]*$/i, '').replace(/SELECT TOP \d+/i, 'SELECT')}) x WHERE x.${e.pk} = @id`);
  return r.recordset[0] || null;
}

async function deleteImpact(pool, key, id) {
  const e = ENTITIES[key];
  const row = await getRow(pool, key, id);
  if (!row) return null;
  const items = [];
  for (const it of e.impact) {
    const r = await pool.request().input('id', sql.Int, id).query(it.sql);
    const n = r.recordset[0].n;
    if (n > 0) items.push({ label: it.label, count: n, warn: !!it.warn });
  }
  return { title: e.rowLabel(row), items };
}

async function deleteRow(pool, key, id) {
  const e = ENTITIES[key];
  await pool.request().input(e.pk, sql.Int, id).execute(e.deleteProc);
}

module.exports = {
  ENTITIES, publicMeta, getEntity, listRows, createRow, updateRow, deleteImpact, deleteRow,
  friendlyDbError, InputError
};
