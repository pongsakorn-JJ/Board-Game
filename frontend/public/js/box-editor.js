/* ตัวตัดแต่งรูปกล่องบอร์ดเกม → ใช้ทำกล่อง 3D
   รับรูปถ่ายสินค้า (จะตรงหรือเฉียง มีพื้นหลังขาวก็ได้) → ตรวจหามุมหน้ากล่อง (และด้านข้างถ้ามี) ให้อัตโนมัติ
   → ผู้ใช้ลากจุดมุมปรับได้ → ดัดมุมให้เป็นภาพตรง ตัดพื้นหลังออก → ได้ไฟล์ "หน้ากล่อง" (+ "ด้านข้าง")
   ใช้จาก admin-data.js:  BoxEditor.open({ src, onDone(result), onSkip() })
   result = { front: Blob(JPEG), side: Blob|null, sideAt: 'L'|'R'|null }  (ความหนากล่องถูกเข้ารหัสในสัดส่วนของรูปด้านข้าง) */
(function () {
  'use strict';
  const LANG = window.__lang === 'en' ? 'en' : 'th';
  const T = (k, v) => I18n.t(LANG, k, v);
  const MAX_SRC = 2000;          // ย่อรูปต้นฉบับไม่ให้ใหญ่เกินตอนประมวลผล
  const OUT_MAX_H = 1024;        // ความสูงสูงสุดของไฟล์ที่ส่งออก
  const PREVIEW_H = 190;

  /* ---------------- เรขาคณิต: ดัดมุม (perspective warp) ---------------- */
  // ตัวแปลงจากสี่เหลี่ยมจัตุรัสหน่วย (u,v) → สี่เหลี่ยมใด ๆ ในรูปต้นฉบับ (Heckbert) ; มุมเรียง TL, TR, BR, BL
  function squareToQuad(p) {
    const x0 = p[0][0], y0 = p[0][1], x1 = p[1][0], y1 = p[1][1], x2 = p[2][0], y2 = p[2][1], x3 = p[3][0], y3 = p[3][1];
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    let g = 0, h = 0, a, b, d, e;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x3 - x0; d = y1 - y0; e = y3 - y0; }
    else {
      const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
      g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den;
      a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3;
    }
    return { a, b, c: x0, d, e, f: y0, g, h };
  }
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

  function warp(src, quad, W, H) {                      // src = ImageData ; คืน ImageData ขนาด W×H
    const m = squareToQuad(quad), out = new ImageData(W, H), sd = src.data, sw = src.width, sh = src.height, od = out.data;
    for (let j = 0; j < H; j++) {
      const v = (j + 0.5) / H;
      for (let i = 0; i < W; i++) {
        const u = (i + 0.5) / W, den = m.g * u + m.h * v + 1;
        let sx = (m.a * u + m.b * v + m.c) / den - 0.5, sy = (m.d * u + m.e * v + m.f) / den - 0.5;
        sx = Math.min(sw - 1.001, Math.max(0, sx)); sy = Math.min(sh - 1.001, Math.max(0, sy));
        const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4, o = (j * W + i) * 4;
        for (let k = 0; k < 3; k++) {
          const top = sd[i00 + k] * (1 - fx) + sd[i10 + k] * fx, bot = sd[i01 + k] * (1 - fx) + sd[i11 + k] * fx;
          od[o + k] = top * (1 - fy) + bot * fy;
        }
        od[o + 3] = 255;
      }
    }
    return out;
  }

  // ขนาดผลลัพธ์ที่เหมาะสม: สูง = ความยาวขอบตั้งเฉลี่ย (ไม่ขยายเกินของจริง), กว้างตามสัดส่วนขอบนอน/ขอบตั้ง
  function frontSize(q, maxH) {
    const vh = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2, hw = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
    const H = Math.max(40, Math.min(maxH, Math.round(vh))), W = Math.max(24, Math.round(H * (hw / vh)));
    return { W, H, aspect: hw / vh };
  }

  /* ---------------- ตรวจหามุมอัตโนมัติ ---------------- */
  function analyze(srcCanvas) {
    const SW = srcCanvas.width, SH = srcCanvas.height, sc = Math.min(1, 420 / Math.max(SW, SH));
    const w = Math.max(8, Math.round(SW * sc)), h = Math.max(8, Math.round(SH * sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(srcCanvas, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, L = new Float32Array(w * h), fg = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    // สีพื้นหลัง = ค่าเฉลี่ยของมุมรูปทั้งสี่
    let br = 0, bg = 0, bb = 0, n = 0;
    [[0, 0], [w - 6, 0], [0, h - 6], [w - 6, h - 6]].forEach(([cx, cy]) => { for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 6; xx++) { const k = ((cy + yy) * w + cx + xx) * 4; br += d[k]; bg += d[k + 1]; bb += d[k + 2]; n++; } });
    br /= n; bg /= n; bb /= n;
    for (let i = 0; i < w * h; i++) fg[i] = Math.hypot(d[i * 4] - br, d[i * 4 + 1] - bg, d[i * 4 + 2] - bb) > 40 ? 1 : 0;
    const colCnt = new Int32Array(w), rowCnt = new Int32Array(h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (fg[yy * w + xx]) { colCnt[xx]++; rowCnt[yy]++; }
    const first = (arr, th) => { for (let i = 0; i < arr.length; i++) if (arr[i] >= th) return i; return 0; };
    const last = (arr, th) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] >= th) return i; return arr.length - 1; };
    let bx0 = first(colCnt, Math.max(2, h * 0.03)), bx1 = last(colCnt, Math.max(2, h * 0.03));
    let by0 = first(rowCnt, Math.max(2, w * 0.03)), by1 = last(rowCnt, Math.max(2, w * 0.03));
    if ((bx1 - bx0) * (by1 - by0) < w * h * 0.12) { bx0 = 0; bx1 = w - 1; by0 = 0; by1 = h - 1; }
    const bw = bx1 - bx0, bh = by1 - by0;
    const back = (p) => [p[0] / sc, p[1] / sc];
    const flat = () => ({ front: [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]].map(back), side: null, sideAt: null });

    // เส้นรอยต่อ "หน้ากล่อง | ด้านข้าง" = ขอบแนวตั้งที่ต่อเนื่องเกือบเต็มความสูงกล่อง (ลายบนปกมีขอบเป็นช่วง ๆ ไม่ต่อเนื่อง)
    // → นับสัดส่วนแถวที่มีขอบชัดในแต่ละคอลัมน์ และค้นหาเฉพาะแถบใกล้ขอบกล่อง (ด้านข้างกว้างไม่เกิน ~30% ของความกว้างรวม)
    const y0 = Math.round(by0 + bh * 0.12), y1 = Math.round(by1 - bh * 0.12), rows = Math.max(1, y1 - y0 + 1), C = new Float32Array(w);
    for (let xx = bx0 + 1; xx < bx1; xx++) { let cnt = 0; for (let yy = y0; yy <= y1; yy++) if (Math.abs(L[yy * w + xx + 1] - L[yy * w + xx - 1]) > 16) cnt++; C[xx] = cnt / rows; }
    const S = new Float32Array(w); for (let xx = bx0 + 2; xx < bx1 - 1; xx++) S[xx] = (C[xx - 1] + 2 * C[xx] + C[xx + 1]) / 4;
    const peak = (from, to) => { let bi = -1, bv = 0; for (let xx = Math.round(from); xx <= Math.round(to); xx++) if (S[xx] > bv) { bv = S[xx]; bi = xx; } return { x: bi, v: bv }; };
    const pl = peak(bx0 + bw * 0.06, bx0 + bw * 0.3), pr = peak(bx1 - bw * 0.3, bx1 - bw * 0.06);
    const best = pl.v >= pr.v ? { ...pl, at: 'L' } : { ...pr, at: 'R' };
    if (best.v < 0.5 || best.x < 0) return flat();                // ไม่เจอรอยต่อชัด ๆ = ถือว่าเป็นภาพหน้ากล่องตรง

    // ขอบบน/ล่างของคอลัมน์ที่กำหนด (ขอบบนถอยลงมาหาเส้นขอบหน้ากล่องจริง กรณีเห็นฝาด้านบน)
    const colEdges = (xc) => {
      xc = Math.max(6, Math.min(w - 7, xc));
      const tops = [], bots = [];
      for (let xx = xc - 2; xx <= xc + 2; xx++) {
        let t = by0; while (t < by1 && !fg[t * w + xx]) t++;
        let b = by1; while (b > by0 && !fg[b * w + xx]) b--;
        tops.push(t); bots.push(b);
      }
      tops.sort((p, q) => p - q); bots.sort((p, q) => p - q);
      let top = tops[2]; const bot = bots[2], hh = bot - top;
      let bestY = top, bestG = 0, sum = 0, cnt = 0;
      for (let yy = top + 2; yy <= top + hh * 0.18; yy++) {
        let g = 0; for (let xx = xc - 4; xx <= xc + 4; xx++) g += Math.abs(L[(yy + 1) * w + xx] - L[(yy - 1) * w + xx]);
        g /= 9; sum += g; cnt++; if (g > bestG) { bestG = g; bestY = yy; }
      }
      if (cnt && bestG > 2.2 * (sum / cnt) && bestG > 14) top = bestY;
      return [top, bot];
    };
    const fitLine = (pts) => {
      if (pts.length < 2) return { m: 0, b: pts[0] ? pts[0][1] : 0 };
      const sl = [];
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j][0] !== pts[i][0]) sl.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
      sl.sort((p, q) => p - q);
      const m = sl[sl.length >> 1] || 0, bs = pts.map((p) => p[1] - m * p[0]).sort((p, q) => p - q);
      return { m, b: bs[bs.length >> 1] };
    };
    const edgesBetween = (xa, xb) => {                            // คืนฟังก์ชัน x → [y ขอบบน, y ขอบล่าง]
      const n = Math.max(3, Math.min(11, Math.floor((xb - xa) / 4))), tp = [], bp = [];
      for (let i = 0; i < n; i++) { const xc = Math.round(xa + 4 + (xb - xa - 8) * (i / (n - 1))), e = colEdges(xc); tp.push([xc, e[0]]); bp.push([xc, e[1]]); }
      const t = fitLine(tp), bt = fitLine(bp);
      return (x) => [t.m * x + t.b, bt.m * x + bt.b];
    };
    const xs = best.x;
    let frontQ, sideQ;
    if (best.at === 'L') {
      const fe = edgesBetween(xs, bx1), se = edgesBetween(bx0, xs);
      frontQ = [[xs, fe(xs)[0]], [bx1, fe(bx1)[0]], [bx1, fe(bx1)[1]], [xs, fe(xs)[1]]];
      sideQ = [[bx0, se(bx0)[0]], [xs, fe(xs)[0]], [xs, fe(xs)[1]], [bx0, se(bx0)[1]]];
    } else {
      const fe = edgesBetween(bx0, xs), se = edgesBetween(xs, bx1);
      frontQ = [[bx0, fe(bx0)[0]], [xs, fe(xs)[0]], [xs, fe(xs)[1]], [bx0, fe(bx0)[1]]];
      sideQ = [[xs, fe(xs)[0]], [bx1, se(bx1)[0]], [bx1, se(bx1)[1]], [xs, fe(xs)[1]]];
    }
    return { front: frontQ.map(back), side: sideQ.map(back), sideAt: best.at };
  }

  /* ---------------- หน้าต่างตัดแต่ง ---------------- */
  let dlg = null, st = null;

  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'admin-dialog box-editor';
    dlg.innerHTML =
      '<h2>' + T('✂️ ตัดแต่งรูปกล่อง 3D') + '</h2>' +
      '<p class="be-hint">' + T('ลากจุดมุมให้ตรงกับมุมหน้ากล่อง (สีฟ้า) และด้านข้างกล่อง (สีชมพู) ระบบจะดัดมุมให้เป็นภาพตรง ตัดพื้นหลังออก แล้วนำไปแปะบนกล่อง 3D') + '</p>' +
      '<div class="be-body">' +
        '<div class="be-stage"><canvas class="be-canvas"></canvas></div>' +
        '<div class="be-side">' +
          '<div class="be-previews"><figure><canvas class="be-pf"></canvas><figcaption>' + T('ภาพหน้ากล่อง (หลังดัดมุม)') + '</figcaption></figure>' +
          '<figure class="be-fs"><canvas class="be-ps"></canvas><figcaption>' + T('ภาพด้านข้าง') + '</figcaption></figure></div>' +
          '<label class="check-inline"><input type="checkbox" class="be-hasside"> ' + T('มีด้านข้างของกล่องในรูป') + '</label>' +
          '<div class="be-at"><label class="check-inline"><input type="radio" name="be-at" value="L"> ' + T('ด้านข้างอยู่ทางซ้าย') + '</label>' +
          '<label class="check-inline"><input type="radio" name="be-at" value="R"> ' + T('ด้านข้างอยู่ทางขวา') + '</label></div>' +
          '<label class="be-depth">' + T('ความหนากล่อง') + ' <output class="be-depth-out"></output><input type="range" class="be-depth-in" min="8" max="45" value="26"></label>' +
          '<button type="button" class="btn-secondary be-auto">' + T('ตรวจหาอัตโนมัติ') + '</button>' +
        '</div>' +
      '</div>' +
      '<p class="form-msg be-msg"></p>' +
      '<div class="dialog-actions">' +
        '<button type="button" class="btn-secondary be-skip">' + T('ข้าม (ใช้รูปเดิม)') + '</button>' +
        '<button type="button" class="btn-secondary be-cancel">' + T('ยกเลิก') + '</button>' +
        '<button type="button" class="btn-primary be-ok">' + T('ใช้รูปนี้') + '</button>' +
      '</div>';
    document.body.appendChild(dlg);
    const q = (s) => dlg.querySelector(s);
    st = { canvas: q('.be-canvas'), pf: q('.be-pf'), ps: q('.be-ps'), hasSide: q('.be-hasside'), at: dlg.querySelectorAll('input[name="be-at"]'), depth: q('.be-depth-in'), depthOut: q('.be-depth-out'), msg: q('.be-msg'), fs: q('.be-fs') };

    st.hasSide.addEventListener('change', () => { if (st.hasSide.checked && !st.quads.side) st.quads.side = defaultSide(); sync(); });
    st.at.forEach((r) => r.addEventListener('change', () => { st.sideAt = r.value; if (st.hasSide.checked) st.quads.side = defaultSide(); sync(); }));
    st.depth.addEventListener('input', () => { st.depthOut.textContent = st.depth.value + '%'; preview(); });
    q('.be-auto').addEventListener('click', () => { autoDetect(); sync(); });
    q('.be-cancel').addEventListener('click', () => close());
    q('.be-skip').addEventListener('click', () => { const cb = st.opts.onSkip; close(); if (cb) cb(); });
    q('.be-ok').addEventListener('click', done);
    dlg.addEventListener('cancel', () => { st.opts = {}; });                 // กด Esc = ยกเลิก

    // ลากจุดมุม
    let drag = null;
    st.canvas.addEventListener('pointerdown', (e) => {
      const p = toImg(e), hit = nearestHandle(p);
      if (hit) { drag = hit; st.canvas.setPointerCapture(e.pointerId); }
    });
    st.canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = toImg(e);
      st.quads[drag.q][drag.i] = [Math.min(st.sw, Math.max(0, p[0])), Math.min(st.sh, Math.max(0, p[1]))];
      redraw(); schedulePreview();
    });
    const end = () => { drag = null; };
    st.canvas.addEventListener('pointerup', end); st.canvas.addEventListener('pointercancel', end);
  }

  function toImg(e) {
    const r = st.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * st.sw, (e.clientY - r.top) / r.height * st.sh];
  }
  function activeQuads() { return st.hasSide.checked && st.quads.side ? ['front', 'side'] : ['front']; }
  function nearestHandle(p) {
    const r = st.canvas.getBoundingClientRect(), k = st.sw / r.width, reach = 18 * k;
    let best = null, bd = reach;
    activeQuads().forEach((qn) => st.quads[qn].forEach((pt, i) => { const dd = dist(p, pt); if (dd < bd) { bd = dd; best = { q: qn, i }; } }));
    return best;
  }
  function defaultSide() {                      // ด้านข้างเริ่มต้น: แถบแคบข้างหน้ากล่อง
    const f = st.quads.front, wdt = dist(f[0], f[1]) * 0.18;
    return st.sideAt === 'L'
      ? [[f[0][0] - wdt, f[0][1] - 4], [f[0][0], f[0][1]], [f[3][0], f[3][1]], [f[3][0] - wdt, f[3][1] - 4]]
      : [[f[1][0], f[1][1]], [f[1][0] + wdt, f[1][1] - 4], [f[2][0] + wdt, f[2][1] - 4], [f[2][0], f[2][1]]];
  }
  function autoDetect() {
    const r = analyze(st.src);
    st.quads = { front: r.front, side: r.side };
    st.sideAt = r.sideAt || st.sideAt || 'L';
    st.hasSide.checked = !!r.side;
  }
  function sync() {
    st.at.forEach((r) => { r.checked = r.value === st.sideAt; r.disabled = !st.hasSide.checked; });
    st.depthOut.textContent = st.depth.value + '%';
    st.depth.disabled = !st.hasSide.checked;
    st.fs.hidden = !st.hasSide.checked;
    redraw(); preview();
  }

  function redraw() {
    const c = st.canvas, x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(st.srcView, 0, 0, c.width, c.height);
    const k = c.width / st.sw;
    const draw = (pts, color) => {
      x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0] * k, p[1] * k) : x.moveTo(p[0] * k, p[1] * k))); x.closePath();
      x.fillStyle = color + '22'; x.fill(); x.lineWidth = 2; x.strokeStyle = color; x.stroke();
      pts.forEach((p, i) => { x.beginPath(); x.arc(p[0] * k, p[1] * k, 8, 0, Math.PI * 2); x.fillStyle = '#0b0d14'; x.fill(); x.lineWidth = 3; x.strokeStyle = color; x.stroke(); if (i === 0) { x.fillStyle = color; x.font = 'bold 11px sans-serif'; x.fillText('TL', p[0] * k + 11, p[1] * k - 8); } });
    };
    draw(st.quads.front, '#4cc9ff');
    if (activeQuads().length > 1) draw(st.quads.side, '#ff5fd2');
  }

  let raf = 0;
  function schedulePreview() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; preview(); }); }
  function show(canvas, data) { canvas.width = data.width; canvas.height = data.height; canvas.getContext('2d').putImageData(data, 0, 0); }
  function preview() {
    const fs = frontSize(st.quads.front, PREVIEW_H);
    show(st.pf, warp(st.srcData, st.quads.front, fs.W, fs.H));
    if (activeQuads().length > 1) show(st.ps, warp(st.srcData, st.quads.side, Math.max(12, Math.round(fs.H * st.depth.value / 100)), fs.H));
  }

  async function done() {
    st.msg.className = 'form-msg'; st.msg.textContent = T('กำลังบันทึก...');
    const fs = frontSize(st.quads.front, OUT_MAX_H);
    const toBlob = (data) => new Promise((resolve) => { const c = document.createElement('canvas'); c.width = data.width; c.height = data.height; c.getContext('2d').putImageData(data, 0, 0); c.toBlob(resolve, 'image/jpeg', 0.92); });
    try {
      const front = await toBlob(warp(st.srcData, st.quads.front, fs.W, fs.H));
      const withSide = activeQuads().length > 1;
      const side = withSide ? await toBlob(warp(st.srcData, st.quads.side, Math.max(12, Math.round(fs.H * st.depth.value / 100)), fs.H)) : null;
      const cb = st.opts.onDone; close();
      if (cb) cb({ front, side, sideAt: withSide ? st.sideAt : null });
    } catch (e) { st.msg.className = 'form-msg error'; st.msg.textContent = T('บันทึกรูปไม่สำเร็จ'); }
  }

  function close() { if (dlg.open) dlg.close(); st.opts = {}; }

  function open(opts) {
    if (!dlg) build();
    st.opts = opts; st.msg.textContent = ''; st.msg.className = 'form-msg';
    const img = new Image();
    img.onload = () => {
      // เตรียมรูปต้นฉบับ (วางบนพื้นขาวกัน PNG โปร่งใส) ไม่ให้ใหญ่เกิน MAX_SRC
      const s = Math.min(1, MAX_SRC / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      st.src = c; st.srcData = x.getImageData(0, 0, c.width, c.height); st.sw = c.width; st.sh = c.height;
      // ภาพที่ใช้แสดงในกรอบแก้ไข (ย่อให้พอดีหน้าจอ)
      const maxW = Math.min(560, window.innerWidth - 56), maxH = Math.min(520, window.innerHeight * 0.55), ds = Math.min(1, maxW / c.width, maxH / c.height);
      st.canvas.width = Math.round(c.width * ds); st.canvas.height = Math.round(c.height * ds);
      st.srcView = c; st.sideAt = 'L'; st.hasSide.checked = false; st.depth.value = 26;
      autoDetect(); sync();
      if (!dlg.open) dlg.showModal();
    };
    img.onerror = () => { if (opts.onError) opts.onError(T('โหลดรูปไม่ได้')); };
    img.src = opts.src;
  }

  window.BoxEditor = { open: open, _analyze: analyze, _warp: warp };
})();
