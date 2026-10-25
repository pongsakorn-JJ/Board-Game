// พื้นหลังเคลื่อนไหวแบบวนลูป (หน้าเข้าสู่ระบบ / สมัครสมาชิก)
// วิดีโอ intro-bg.mp4 = 5 วิแรกของคลิปร้าน เล่นไปข้างหน้าแล้วถอยกลับ (รวม ~10 วิ ไม่มีเสียง)
// จุดต้น-จุดจบเป็นเฟรมเดียวกัน จึงวนซ้ำได้เนียนไม่กระตุก
// ถ้าผู้ใช้ตั้งค่าลดการเคลื่อนไหว หรือเบราว์เซอร์เล่นไม่ได้ → ใช้รูปนิ่งเดิมจาก CSS
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const wrap = document.createElement('div');
  wrap.className = 'bg-intro';
  wrap.setAttribute('aria-hidden', 'true');

  const v = document.createElement('video');
  // เลือกไฟล์ที่เบราว์เซอร์เล่นได้: MP4 (Chrome/Edge/Safari/Firefox) หรือ WebM สำรอง
  const src = v.canPlayType('video/mp4; codecs="avc1.640028"') ? '/video/intro-bg.mp4'
            : v.canPlayType('video/webm; codecs="vp9"') ? '/video/intro-bg.webm' : null;
  if (!src) return;
  v.src = src;
  v.poster = '/images/brand/intro-poster.webp';
  v.muted = true;                  // ต้อง muted เบราว์เซอร์ถึงยอมให้เล่นอัตโนมัติ
  v.defaultMuted = true;
  v.autoplay = true;
  v.loop = true;                   // วนเล่นตลอด
  v.playsInline = true;            // iPhone: เล่นในหน้า ไม่เด้งเต็มจอ
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.disablePictureInPicture = true;
  wrap.appendChild(v);

  v.addEventListener('playing', () => wrap.classList.add('is-playing'), { once: true });
  v.addEventListener('error', () => wrap.remove());                   // โหลดไม่ได้ → กลับไปใช้รูปนิ่ง

  document.body.prepend(wrap);     // อยู่ก่อนชั้นประกาย (sparkle.js) ประกายจึงลอยอยู่ด้านบนวิดีโอ
  const p = v.play();
  if (p && p.catch) p.catch(() => wrap.remove());
})();
