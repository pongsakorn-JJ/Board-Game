// หน้า "จัดการข้อมูล" ของแอดมิน: เพิ่ม / แก้ไข / ลบ ข้อมูลในฐานข้อมูลโดยตรง (ทุกอย่างผ่าน requireAdmin)
const express = require('express');
const router = express.Router();
const { getPool } = require('../config/db');
const realtime = require('../services/realtime');
const admin = require('../services/adminData');
const { requireAdmin, forgetAccount } = require('../middleware/auth');
const { t, tr, localize } = require('../services/i18n');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const dns = require('dns');
const http = require('http');
const https = require('https');

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
  res.status(500).json({ ok: false, message: t('เกิดข้อผิดพลาด: ') + tr(err.message) });
}

/* ---------- อัปโหลดรูปหน้ากล่องเกม (ใช้เป็นกล่อง 3D) ---------- */
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'frontend', 'public', 'images', 'games', 'uploads');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// ดูชนิดไฟล์จากไบต์แรก ๆ จริง ๆ (ไม่เชื่อนามสกุล/Content-Type ที่ผู้ใช้ส่งมา)
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

router.post('/api/admin/upload/game-image', requireAdmin,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: MAX_IMAGE_BYTES }),
  async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ ok: false, message: 'ไม่พบไฟล์รูป' });
    const ext = sniffImage(buf);
    if (!ext) return res.status(400).json({ ok: false, message: 'รองรับเฉพาะไฟล์ JPG, PNG หรือ WEBP' });
    try {
      await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
      let name = crypto.randomBytes(8).toString('hex') + '.' + ext;       // ตั้งชื่อไฟล์เอง กันชื่อแปลก/ทับไฟล์เดิม
      if (req.query.sideOf) {
        // ภาพด้านข้างกล่องจากตัวตัดแต่งรูป: เก็บเป็น <ชื่อไฟล์หน้ากล่อง>-sideL.jpg / -sideR.jpg (L = สันอยู่ซ้าย, R = ขวา)
        const m = /^\/images\/games\/uploads\/([0-9a-f]{16})\.(?:jpg|png|webp)$/.exec(String(req.query.sideOf));
        const at = String(req.query.at || '');
        if (!m || !['L', 'R'].includes(at) || ext !== 'jpg') return res.status(400).json({ ok: false, message: 'คำขอไม่ถูกต้อง' });
        name = m[1] + '-side' + at + '.jpg';
      }
      await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buf);
      res.json({ ok: true, url: '/images/games/uploads/' + name, message: t('อัปโหลดรูปแล้ว') });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, message: 'อัปโหลดไม่สำเร็จ' });
    }
  });
/* ----- ดึงรูปจาก URL ภายนอกมาเก็บในเว็บเรา (3D ใช้รูปข้ามเว็บตรง ๆ ไม่ได้เพราะ CORS) -----
   เซิร์ฟเวอร์ไปโหลดไฟล์ตามที่อยู่ที่ผู้ใช้ให้ จึงต้องกัน SSRF: ห้ามชี้เข้าเครื่อง/วงแลนภายใน, ตรวจ IP ตอนเชื่อมต่อจริง
   (กัน DNS rebinding), จำกัดพอร์ต 80/443, redirect ไม่เกิน 3 ครั้ง (ตรวจซ้ำทุกครั้ง), ขนาด ≤ 5 MB, เวลา ≤ 12 วินาที,
   และรับเฉพาะไฟล์ที่เนื้อไฟล์เป็น JPG/PNG/WEBP จริง */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || a >= 224;
  }
  const v = String(ip).toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}
function safeLookup(hostname, options, cb) {                     // ตรวจ IP ที่จะเชื่อมต่อจริงทุกครั้ง
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return cb(new Error('BLOCKED_ADDRESS'));
    if (options && options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}
function fetchImageBuffer(rawUrl, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(rawUrl); } catch (_) { return reject(new Error('BAD_URL')); }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return reject(new Error('BAD_URL'));
    if (u.port && !['80', '443'].includes(u.port)) return reject(new Error('BLOCKED_ADDRESS'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivateIp(host)) return reject(new Error('BLOCKED_ADDRESS'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { lookup: safeLookup, timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BluffChainImageImport/1.0)', Accept: 'image/*' } }, (resp) => {
      if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
        resp.resume();
        if (redirects >= 3) return reject(new Error('FETCH_FAILED'));
        return fetchImageBuffer(new URL(resp.headers.location, u).toString(), redirects + 1).then(resolve, reject);
      }
      if (resp.statusCode !== 200) { resp.resume(); return reject(new Error('FETCH_FAILED')); }
      const chunks = []; let size = 0;
      resp.on('data', (c) => { size += c.length; if (size > MAX_IMAGE_BYTES) { req.destroy(); reject(new Error('TOO_LARGE')); } else chunks.push(c); });
      resp.on('end', () => resolve(Buffer.concat(chunks)));
      resp.on('error', () => reject(new Error('FETCH_FAILED')));
    });
    req.on('timeout', () => req.destroy(new Error('FETCH_FAILED')));
    req.on('error', (e) => reject(e.message === 'BLOCKED_ADDRESS' ? e : new Error('FETCH_FAILED')));
  });
}

router.post('/api/admin/upload/game-image-url', requireAdmin, express.json({ limit: '4kb' }), async (req, res) => {
  const url = String((req.body && req.body.url) || '').trim();
  if (!url) return res.status(400).json({ ok: false, message: 'URL ไม่ถูกต้อง' });
  try {
    const buf = await fetchImageBuffer(url);
    const ext = sniffImage(buf);
    if (!ext) return res.status(400).json({ ok: false, message: 'รองรับเฉพาะไฟล์ JPG, PNG หรือ WEBP' });
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buf);
    res.json({ ok: true, url: '/images/games/uploads/' + name, message: t('ดึงรูปมาเก็บในเว็บแล้ว') });
  } catch (err) {
    const known = { BAD_URL: 'URL ไม่ถูกต้อง', BLOCKED_ADDRESS: 'ที่อยู่นี้ไม่อนุญาต', TOO_LARGE: 'รูปใหญ่เกินไป (ไม่เกิน 5 MB)' };
    res.status(400).json({ ok: false, message: known[err.message] || 'ดึงรูปจาก URL นี้ไม่ได้' });
  }
});

router.use('/api/admin/upload', (err, req, res, next) => {          // ไฟล์ใหญ่เกิน / อ่านข้อมูลไม่ได้
  res.status(err.status === 413 ? 413 : 400).json({ ok: false, message: err.status === 413 ? 'รูปใหญ่เกินไป (ไม่เกิน 5 MB)' : 'อัปโหลดไม่สำเร็จ' });
});

/* ---------- หน้าเว็บ ---------- */
router.get('/admin/data', requireAdmin, (req, res) => {
  const meta = localize(admin.publicMeta());
  const start = meta[req.query.t] ? req.query.t : 'customers';
  res.render('admin-data', { title: 'จัดการข้อมูล', metaJson: toScriptJson(meta), startEntity: start, meta });
});

/* ---------- API ---------- */
// อ่านทั้งตาราง (หน้าเว็บเรียกซ้ำทุกครั้งที่มีอัปเดตเรียลไทม์ → เห็นข้อมูลจากฐานข้อมูลล่าสุดเสมอ)
router.get('/api/admin/:entity', requireAdmin, entityParam, async (req, res) => {
  try {
    const data = await admin.listRows(await getPool(), req.entityKey, { userId: req.session.user.id });
    res.json({ ok: true, ...data });
  } catch (err) { sendError(res, err); }
});

// เพิ่ม
router.post('/api/admin/:entity', requireAdmin, entityParam, async (req, res) => {
  try {
    const id = await admin.createRow(await getPool(), req.entityKey, req.body || {});
    res.json({ ok: true, id, message: t('เพิ่ม{label} #{id} ลงฐานข้อมูลแล้ว', { label: tr(req.entity.label), id }) });
    realtime.broadcastState();
  } catch (err) { sendError(res, err); }
});

// แก้ไข
router.put('/api/admin/:entity/:id', requireAdmin, entityParam, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, message: 'รหัสไม่ถูกต้อง' });
  try {
    await admin.updateRow(await getPool(), req.entityKey, id, req.body || {});
    res.json({ ok: true, message: t('บันทึกการแก้ไข{label} #{id} แล้ว', { label: tr(req.entity.label), id }) });
    realtime.broadcastState();
  } catch (err) { sendError(res, err); }
});

// ก่อนลบ: มีข้อมูลอะไรผูกอยู่บ้าง
router.get('/api/admin/:entity/:id/impact', requireAdmin, entityParam, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, message: 'รหัสไม่ถูกต้อง' });
  try {
    const impact = await admin.deleteImpact(await getPool(), req.entityKey, id, { userId: req.session.user.id });
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
    res.json({ ok: true, message: t('ลบ{label} #{id} ออกจากฐานข้อมูลแล้ว', { label: tr(req.entity.label), id }) });
    realtime.broadcastState();
  } catch (err) { sendError(res, err); }
});

module.exports = router;
