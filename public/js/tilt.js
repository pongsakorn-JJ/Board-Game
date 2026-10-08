/* ภาพแบนเนอร์เอียงตามเมาส์ (3D tilt) — ใช้กับ element ที่มี data-tilt
   - ขยับเมาส์ที่ไหนในหน้าก็ได้ ภาพจะเอียงหาเมาส์ + มีแสงสะท้อนวิ่งตาม
   - มือถือ: ลากนิ้วบนภาพ · ผู้ใช้ที่ตั้ง "ลดการเคลื่อนไหว" ในเครื่อง จะไม่ขยับ */
(function () {
  const scenes = document.querySelectorAll('[data-tilt]');
  if (!scenes.length) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const MAX_Y = 16;   // องศาหมุนซ้าย-ขวาสูงสุด
  const MAX_X = 11;   // องศาก้ม-เงยสูงสุด

  scenes.forEach((scene) => {
    const card = scene.querySelector('.tilt-card');
    if (!card) return;
    let tx = 0, ty = 0;          // เป้าหมาย (-1..1)
    let cx = 0, cy = 0;          // ค่าปัจจุบัน (ค่อย ๆ ไล่ตามเป้าหมาย)
    let active = false, raf = 0;

    function aim(clientX, clientY) {
      const r = card.getBoundingClientRect();
      const nx = (clientX - (r.left + r.width / 2)) / (r.width / 2);
      const ny = (clientY - (r.top + r.height / 2)) / (r.height / 2);
      tx = Math.max(-1, Math.min(1, nx));
      ty = Math.max(-1, Math.min(1, ny));
      active = true;
      start();
    }
    function release() { tx = 0; ty = 0; active = false; start(); }

    function frame() {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      card.style.transform =
        `rotateY(${(cx * MAX_Y).toFixed(2)}deg) rotateX(${(-cy * MAX_X).toFixed(2)}deg) scale(${active ? 1.02 : 1})`;
      card.style.setProperty('--gx', `${((cx + 1) * 50).toFixed(1)}%`);
      card.style.setProperty('--gy', `${((cy + 1) * 50).toFixed(1)}%`);
      card.style.setProperty('--glare', active ? '1' : '0');
      if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) raf = requestAnimationFrame(frame);
      else raf = 0;
    }
    function start() { if (!raf) raf = requestAnimationFrame(frame); }

    // เมาส์: ตามตำแหน่งเมาส์ทั้งหน้า
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') aim(e.clientX, e.clientY); });
    document.addEventListener('mouseleave', release);
    window.addEventListener('blur', release);
    // นิ้ว/ปากกา: ลากบนภาพ
    card.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') aim(e.clientX, e.clientY); });
    card.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') release(); });
    card.addEventListener('pointercancel', release);
  });
})();
