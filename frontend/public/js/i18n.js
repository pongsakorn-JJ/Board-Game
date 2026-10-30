/* ระบบแปลภาษา ไทย → อังกฤษ (ใช้ร่วมกันทั้งเซิร์ฟเวอร์ Node และเบราว์เซอร์)

   วิธีใช้: เขียนข้อความไทยเป็น "คีย์" แล้วมีคำแปลอังกฤษใน i18n.en.js
     t('จองโต๊ะ')                              → ไทย: จองโต๊ะ   / อังกฤษ: Book a table
     t('โต๊ะ #{id} ว่าง', { id: 3 })           → {id} ถูกแทนด้วยค่าที่ส่งเข้ามา ทั้งสองภาษา
     tr(text)                                  → แปลข้อความสำเร็จรูป (เช่น ข้อความจากฐานข้อมูล) ถ้าไม่มีคำแปลคืนข้อความเดิม
   ถ้าคีย์ไหนยังไม่มีคำแปล จะแสดงข้อความไทยเดิม (ไม่พัง) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./i18n.en.js'));
  else root.I18n = factory(root.I18nEN);
})(typeof self !== 'undefined' ? self : this, function (EN) {
  const dict = (EN && EN.dict) || {};
  const patterns = (EN && EN.patterns) || [];

  function fmt(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? vars[k] : m; });
  }

  /* แปลข้อความสำเร็จรูป: ตรงทั้งประโยคก่อน แล้วลองรูปแบบ (regex) สำหรับข้อความที่มีตัวเลข/ชื่อแทรก */
  function tr(lang, text) {
    if (lang !== 'en' || typeof text !== 'string' || !/[฀-๿]/.test(text)) return text;
    if (Object.prototype.hasOwnProperty.call(dict, text)) return dict[text];
    for (let i = 0; i < patterns.length; i++) {
      const m = patterns[i][0].exec(text);
      if (m) return patterns[i][1](m, function (s) { return tr(lang, s); });
    }
    return text;
  }

  function t(lang, key, vars) {
    const s = (lang === 'en' && Object.prototype.hasOwnProperty.call(dict, key)) ? dict[key] : key;
    return fmt(s, vars);
  }

  const locale = (lang) => (lang === 'en' ? 'en-GB' : 'th-TH');

  return { t: t, tr: tr, fmt: fmt, locale: locale, dict: dict };
});
