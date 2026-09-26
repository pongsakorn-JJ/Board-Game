// หน้า "จัดการข้อมูล" ของแอดมิน: เพิ่ม / แก้ไข / ลบ ข้อมูลในฐานข้อมูลโดยตรง (ทุกอย่างผ่าน requireAdmin)
const express = require('express');
const router = express.Router();
const { getPool } = require('../config/db');
const realtime = require('../services/realtime');
const admin = require('../services/adminData');
const { requireAdmin, forgetAccount } = require('../middleware/auth');

function toId(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ฝัง JSON ลงหน้าอย่างปลอดภัย
function toScriptJson(obj) {
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  return JSON.stringify(obj).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
}

// ตรวจชื่อตารางจาก URL (กันเรียกตารางที่ไม่ได้เปิดให้แก้)
function entityParam(req, res, next) {
  const entity = admin.getEntity(req.params.entity);
  if (!entity) return res.status(404).json({ ok: false, message: 'ไม่พบตารางนี้' });
  req.entityKey = req.params.entity;
  req.entity = entity;
  next();
}

function sendError(res, err) {
  if (err.isInput) return res.status(400).json({ ok: false, message: err.message, field: err.field });
  const friendly = admin.friendlyDbError(err);
  if (friendly) return res.status(400).json({ ok: false, message: friendly });
  console.error(err);
  res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
}

/* ---------- หน้าเว็บ ---------- */
router.get('/admin/data', requireAdmin, (req, res) => {
  const meta = admin.publicMeta();
  const start = meta[req.query.t] ? req.query.t : 'customers';
  res.render('admin-data', { title: 'จัดการข้อมูล', metaJson: toScriptJson(meta), startEntity: start, meta });
});

/* ---------- API ---------- */
// อ่านทั้งตาราง (หน้าเว็บเรียกซ้ำทุกครั้งที่มีอัปเดตเรียลไทม์ → เห็นข้อมูลจากฐานข้อมูลล่าสุดเสมอ)
router.get('/api/admin/:entity', requireAdmin, entityParam, async (req, res) => {
  try {
    const data = await admin.listRows(await getPool(), req.entityKey);
    res.json({ ok: true, ...data });
  } catch (err) { sendError(res, err); }
});

// เพิ่ม
router.post('/api/admin/:entity', requireAdmin, entityParam, async (req, res) => {
  try {
    const id = await admin.createRow(await getPool(), req.entityKey, req.body || {});
    res.json({ ok: true, id, message: `เพิ่ม${req.entity.label} #${id} ลงฐานข้อมูลแล้ว` });
    realtime.broadcastState();
  } catch (err) { sendError(res, err); }
});

// แก้ไข
router.put('/api/admin/:entity/:id', requireAdmin, entityParam, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, message: 'รหัสไม่ถูกต้อง' });
  try {
    await admin.updateRow(await getPool(), req.entityKey, id, req.body || {});
    res.json({ ok: true, message: `บันทึกการแก้ไข${req.entity.label} #${id} แล้ว` });
    realtime.broadcastState();
  } catch (err) { sendError(res, err); }
});

// ก่อนลบ: มีข้อมูลอะไรผูกอยู่บ้าง
router.get('/api/admin/:entity/:id/impact', requireAdmin, entityParam, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, message: 'รหัสไม่ถูกต้อง' });
  try {
    const impact = await admin.deleteImpact(await getPool(), req.entityKey, id);
    if (!impact) return res.status(404).json({ ok: false, message: 'ไม่พบข้อมูลนี้แล้ว (อาจถูกลบไปก่อนหน้า)' });
    res.json({ ok: true, ...impact });
  } catch (err) { sendError(res, err); }
});

// ลบ (ผ่าน Stored Procedure แบบ cascade)
router.delete('/api/admin/:entity/:id', requireAdmin, entityParam, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, message: 'รหัสไม่ถูกต้อง' });
  if (req.entityKey === 'employees' && id === req.session.user.id) {
    return res.status(400).json({ ok: false, message: 'ลบบัญชีพนักงานที่กำลังใช้งานอยู่ไม่ได้ — ให้พนักงานคนอื่นลบให้' });
  }
  try {
    await admin.deleteRow(await getPool(), req.entityKey, id);
    if (req.entityKey === 'customers') forgetAccount('customer', id);
    if (req.entityKey === 'employees') forgetAccount('admin', id);
    res.json({ ok: true, message: `ลบ${req.entity.label} #${id} ออกจากฐานข้อมูลแล้ว` });
    realtime.broadcastState();
  } catch (err) { sendError(res, err); }
});

module.exports = router;
