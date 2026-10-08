// ประกายวิบวับเบา ๆ บนพื้นหลัง (หน้าเข้าสู่ระบบ / สมัครสมาชิก)
// สร้างจุดแสงสีทอง/ฟ้าแบบสุ่ม แต่ละจุดค่อย ๆ สว่างแล้วจางหาย พอจบรอบก็ย้ายไปจุดใหม่
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const layer = document.createElement('div');
  layer.className = 'sparkles';
  layer.setAttribute('aria-hidden', 'true');

  const count = window.innerWidth < 700 ? 24 : 46;
  const rand = (min, max) => min + Math.random() * (max - min);

  function place(s) {
    s.style.left = rand(2, 98).toFixed(2) + '%';
    s.style.top = rand(4, 96).toFixed(2) + '%';
  }

  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    const star = Math.random() < 0.3;                       // ~30% เป็นประกายรูปดาว 4 แฉก ที่เหลือเป็นจุดแสง
    s.className = 'spark' + (star ? ' spark-star' : '') + (Math.random() < 0.4 ? ' spark-cyan' : '');
    s.style.setProperty('--s', (star ? rand(14, 22) : rand(3, 6)).toFixed(1) + 'px');
    s.style.animationDuration = rand(3.2, 7).toFixed(2) + 's';
    s.style.animationDelay = (-rand(0, 7)).toFixed(2) + 's';   // เริ่มคนละจังหวะ ไม่กะพริบพร้อมกัน
    place(s);
    s.addEventListener('animationiteration', () => place(s));
    layer.appendChild(s);
  }

  document.body.appendChild(layer);
})();
