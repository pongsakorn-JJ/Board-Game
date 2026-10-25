// ตัวกันสิทธิ์: หน้าเว็บ → พาไปหน้า login / หน้าไม่มีสิทธิ์, API → ตอบ JSON 401/403

function isApi(req) {
  return req.originalUrl.startsWith('/api/');
}

function loginRedirect(req, res) {
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

function denied(req, res, message) {
  const user = req.session.user;
  if (isApi(req)) {
    return res.status(user ? 403 : 401).json({ ok: false, message: user ? message : 'กรุณาเข้าสู่ระบบก่อน' });
  }
  if (!user) return loginRedirect(req, res);
  res.status(403).render('forbidden', { title: 'ไม่มีสิทธิ์เข้าถึง', message });
}

// บัญชีที่ถูกแอดมินลบออกจากฐานข้อมูลแล้ว ต้องหลุดจากระบบทันที (ไม่ใช่รอ cookie หมดอายุ 8 ชม.)
// เช็คกับฐานข้อมูลแล้วจำผลไว้ 10 วินาที ไม่ให้ query ทุกรีเควสต์
const checkedAt = new Map();
async function accountStillExists(u) {
  const key = u.role + ':' + u.id;
  const t = checkedAt.get(key);
  if (t && Date.now() - t < 10000) return true;
  try {
    const { sql, getPool } = require('../config/db');
    const pool = await getPool();
    const q = u.role === 'admin'
      ? 'SELECT 1 AS ok FROM tbl_employee WHERE EmployeeID = @ID'
      : 'SELECT 1 AS ok FROM tbl_customer WHERE CustomerID = @ID';
    const r = await pool.request().input('ID', sql.Int, u.id).query(q);
    if (!r.recordset.length) { checkedAt.delete(key); return false; }
  } catch (err) {
    return true;   // ฐานข้อมูลล่ม: ไม่เตะผู้ใช้ออก (หน้าที่ใช้ข้อมูลจะแจ้ง error เอง)
  }
  checkedAt.set(key, Date.now());
  return true;
}

function guard(check, message) {
  return async (req, res, next) => {
    const u = req.session.user;
    if (!u || !check(u)) return denied(req, res, message);
    if (await accountStillExists(u)) return next();
    req.session.user = null;   // บัญชีถูกลบ → ออกจากระบบ
    req.session.destroy(() => {
      if (isApi(req)) return res.status(401).json({ ok: false, message: 'บัญชีนี้ถูกลบออกจากระบบแล้ว' });
      res.redirect('/login');
    });
  };
}

const requireLogin = guard(() => true, 'กรุณาเข้าสู่ระบบก่อน');
const requireAdmin = guard((u) => u.role === 'admin', 'หน้านี้สำหรับพนักงานเท่านั้น');
const requireCustomer = guard((u) => u.role === 'customer', 'หน้านี้สำหรับลูกค้าที่เป็นสมาชิก');

// เรียกหลังแอดมินลบบัญชี → ครั้งถัดไปที่บัญชีนั้นเรียกหน้าเว็บจะถูกเตะออกทันที
function forgetAccount(role, id) { checkedAt.delete(role + ':' + id); }

const isAdmin = (req) => !!(req.session.user && req.session.user.role === 'admin');

module.exports = { requireLogin, requireAdmin, requireCustomer, isAdmin, forgetAccount };
