// ภาษาของเว็บ (th/en) — เก็บใน cookie "lang" และจำต่อ request ด้วย AsyncLocalStorage
// เพื่อให้เรียก t('ข้อความไทย') ได้ทุกที่ในโค้ดฝั่งเซิร์ฟเวอร์โดยไม่ต้องส่ง req ไปด้วย
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const JS_DIR = path.join(__dirname, '..', '..', 'frontend', 'public', 'js');
const CORE_FILE = path.join(JS_DIR, 'i18n.js');
const DICT_FILE = path.join(JS_DIR, 'i18n.en.js');

// โหลดพจนานุกรมใหม่เองเมื่อไฟล์คำแปลถูกแก้ (ไม่ต้องรีสตาร์ทเซิร์ฟเวอร์หลังเพิ่มคำแปล)
let core = require(CORE_FILE);
let dictStamp = fs.statSync(DICT_FILE).mtimeMs;
function refreshDict() {
  try {
    const m = fs.statSync(DICT_FILE).mtimeMs;
    if (m !== dictStamp) { dictStamp = m; delete require.cache[CORE_FILE]; delete require.cache[DICT_FILE]; core = require(CORE_FILE); }
  } catch (_) { /* อ่านไฟล์ไม่ได้ชั่วคราว: ใช้ของเดิม */ }
}

const als = new AsyncLocalStorage();
const currentLang = () => (als.getStore() || {}).lang || 'th';

const t = (key, vars) => core.t(currentLang(), key, vars);
const tr = (text) => core.tr(currentLang(), text);

function langFromCookie(header) {
  const m = /(?:^|;\s*)lang=(en|th)\b/.exec(header || '');
  return m ? m[1] : 'th';
}

// key ที่เป็นข้อความที่ผู้ใช้เห็น (ไม่แตะฟิลด์ข้อมูล เช่น value ของ <option> ที่ต้องส่งกลับเซิร์ฟเวอร์เป็นภาษาไทย)
const TEXT_KEYS = new Set(['message', 'error', 'warning', 'label', 'help', 'patternMsg', 'unique', 'title', 'note', 'placeholder', 'blocked', '_noDelete']);
function translateDeep(value, lang, key, inErrors) {
  if (typeof value === 'string') return (inErrors || TEXT_KEYS.has(key)) ? core.tr(lang, value) : value;
  // ตัวเลือก dropdown แบบ [ค่า, ป้ายชื่อ] — แปลเฉพาะป้ายชื่อ ค่าที่ส่งกลับเซิร์ฟเวอร์ต้องคงเดิม
  if (key === 'options' && Array.isArray(value)) return value.map((o) => (Array.isArray(o) ? [o[0], translateDeep(o[1], lang, 'label')] : translateDeep(o, lang, key, inErrors)));
  if (Array.isArray(value)) return value.map((v) => translateDeep(v, lang, key, inErrors));
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = translateDeep(value[k], lang, k, inErrors || k === 'errors');
    return out;
  }
  return value;
}

function middleware(req, res, next) {
  refreshDict();
  const lang = langFromCookie(req.headers.cookie);
  req.lang = lang;
  res.locals.lang = lang;
  res.locals.t = (key, vars) => core.t(lang, key, vars);
  res.locals.tr = (text) => core.tr(lang, text);
  res.locals.locale = core.locale(lang);

  if (lang === 'en') {
    // ข้อความ error/สำเร็จที่เซิร์ฟเวอร์ส่งกลับ (JSON) และตัวแปรที่ส่งเข้า view → แปลให้ตรงภาษา
    const json = res.json.bind(res);
    res.json = (body) => json(translateDeep(body, lang));
    const render = res.render.bind(res);
    res.render = (view, locals, cb) => {
      if (typeof locals === 'function') return render(view, locals);
      const l = Object.assign({}, locals);
      for (const k of ['title', 'message', 'error', 'success']) if (typeof l[k] === 'string') l[k] = core.tr(lang, l[k]);
      return render(view, l, cb);
    };
  }
  als.run({ lang }, next);
}

// GET /lang/en | /lang/th — จำภาษาแล้วกลับไปหน้าเดิม
function switchRoute(req, res) {
  const code = req.params.code === 'en' ? 'en' : 'th';
  res.setHeader('Set-Cookie', `lang=${code}; Path=/; Max-Age=31536000; SameSite=Lax`);
  let back = '/';
  try {
    const ref = req.get('referer');
    if (ref) {
      const u = new URL(ref);
      if (u.host === req.get('host') && !u.pathname.startsWith('/lang/')) back = u.pathname + u.search;
    }
  } catch (_) { /* referer ไม่ถูกต้อง → กลับหน้าแรก */ }
  res.redirect(back);
}

const localize = (obj) => translateDeep(obj, currentLang());

module.exports = { t, tr, localize, middleware, switchRoute, currentLang, locale: () => core.locale(currentLang()) };
