/* หน้าจองโต๊ะ: แผนผังร้าน (กดเลือกโต๊ะ) · ปุ่มแพ็กเกจเวลา · กล่องบอร์ดเกม 3D ที่เปลี่ยนตามเกมที่เลือก
   · ทอยสุ่มเกม · สถานะร้านตอนนี้
   ฟอร์มจริง (#instore-table / #instore-package / #instore-game / #rental-game) ยังเป็นของ realtime.js —
   ไฟล์นี้แค่ตั้งค่าในช่องเหล่านั้นแล้วส่ง event 'change' ให้ realtime.js ทำงานต่อตามปกติ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('instore-table')) return;

  const LANG = window.__lang === 'en' ? 'en' : 'th';
  const T = (key, vars) => I18n.t(LANG, key, vars);
  const GAMES = window.__bookGames || [];
  const REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let state = window.__initialState || { tables: [], games: [], queue: [] };

  const fire = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const waitingAt = (id) => (state.queue || []).filter((q) => q.TableID === id).length;
  const liveGame = (id) => (state.games || []).find((g) => g.GameID === id) || {};
  const mode = () => (document.querySelector('input[name="booking-mode"]:checked') || {}).value || 'instore';

  /* ================= ปุ่มแพ็กเกจเวลา (แทน dropdown — ค่าจริงอยู่ใน #instore-package ที่ซ่อนไว้) ================= */
  const pkgSelect = $('instore-package');
  document.querySelectorAll('.pkg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pkg-btn').forEach((b) => { const on = b === btn; b.classList.toggle('is-active', on); b.setAttribute('aria-checked', on); });
      pkgSelect.value = btn.dataset.package; fire(pkgSelect);
    });
  });

  /* ================= แผนผังร้านแบบ isometric (สร้างจากโต๊ะจริงในฐานข้อมูล) ================= */
  const mapBox = $('store-map'), caption = $('store-map-caption'), tableSelect = $('instore-table');
  const SQ = Math.sqrt(3) / 2;
  const iso = (x, y, z) => [(x - y) * SQ * 26, (x + y) * 0.5 * 26 - (z || 0) * 26];
  const pts = (arr) => arr.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
  const tableStatus = (t) => (t.Status !== 'Available' ? 'busy' : waitingAt(t.TableID) > 0 ? 'queue' : 'free');

  function layout(tables) {
    const zones = [];
    tables.forEach((t) => { if (zones.indexOf(t.Zone) < 0) zones.push(t.Zone); });
    const ZW = 3.4, D = Math.max(6.4, 1.3 + Math.max(...zones.map((z) => tables.filter((t) => t.Zone === z).length)) * 2.6);
    const W = zones.length * ZW;
    const items = [];
    zones.forEach((z, zi) => {
      const list = tables.filter((t) => t.Zone === z);
      list.forEach((t, k) => {
        const len = 0.7 + Math.min(Number(t.Capacity) || 4, 10) * 0.16;
        items.push({ t, cx: zi * ZW + ZW / 2, cy: (D / (list.length + 1)) * (k + 1), w: 1.0, len });
      });
    });
    return { zones, W, D, ZW, items };
  }

  let mapSig = '';
  function drawMap() {
    const tables = state.tables || [];
    if (!tables.length) { mapBox.innerHTML = ''; mapSig = ''; return; }
    // วาดใหม่เฉพาะเมื่อสถานะโต๊ะ/คิว/โต๊ะที่เลือกเปลี่ยน (ไม่ทำให้โฟกัสคีย์บอร์ดหลุดทุก 3 วินาที)
    const sig = JSON.stringify([tableSelect.value, tables.map((t) => [t.TableID, t.Zone, t.Capacity, tableStatus(t), waitingAt(t.TableID)])]);
    if (sig === mapSig) { updateCaption(); return; }
    mapSig = sig;
    const { zones, W, D, ZW, items } = layout(tables);
    const WALL = 1.25;
    const corners = [iso(0, 0, WALL), iso(W, 0, WALL), iso(0, D, WALL), iso(W, D, 0), iso(0, D, 0), iso(W, 0, 0)];
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
    const pad = 14, vb = [Math.min(...xs) - pad, Math.min(...ys) - pad - 10, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2 + 10];
    let svg = `<svg viewBox="${vb.map((n) => n.toFixed(1)).join(' ')}" role="group">`;
    svg += '<defs><filter id="sm-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
    // ผนังด้านหลัง + พื้น
    svg += `<polygon class="sm-wall" points="${pts([iso(0, 0, 0), iso(W, 0, 0), iso(W, 0, WALL), iso(0, 0, WALL)])}"/>`;
    svg += `<polygon class="sm-wall" points="${pts([iso(0, 0, 0), iso(0, D, 0), iso(0, D, WALL), iso(0, 0, WALL)])}"/>`;
    svg += `<polygon class="sm-floor" points="${pts([iso(0, 0), iso(W, 0), iso(W, D), iso(0, D)])}"/>`;
    for (let x = 1; x < W; x++) svg += `<line class="sm-grid" x1="${iso(x, 0)[0]}" y1="${iso(x, 0)[1]}" x2="${iso(x, D)[0]}" y2="${iso(x, D)[1]}"/>`;
    for (let y = 1; y < D; y++) svg += `<line class="sm-grid" x1="${iso(0, y)[0]}" y1="${iso(0, y)[1]}" x2="${iso(W, y)[0]}" y2="${iso(W, y)[1]}"/>`;
    // เส้นแบ่งโซน + ป้ายโซน
    zones.forEach((z, zi) => {
      if (zi > 0) { const a = iso(zi * ZW, 0), b = iso(zi * ZW, D); svg += `<line class="sm-zone-line" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`; }
      const p = iso(zi * ZW + ZW / 2, D - 0.35);
      svg += `<text class="sm-zone" x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" text-anchor="middle">${esc(T('โซน {zone}', { zone: z }))}</text>`;
    });
    // โต๊ะ: วาดจากหลังมาหน้า
    const selected = tableSelect.value;
    items.slice().sort((a, b) => (a.cx + a.cy) - (b.cx + b.cy)).forEach(({ t, cx, cy, w, len }) => {
      const st = tableStatus(t), sel = String(t.TableID) === selected;
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - len / 2, y1 = cy + len / 2, H = 0.32;
      let g = `<g class="sm-table is-${st}${sel ? ' is-selected' : ''}" data-table="${t.TableID}" tabindex="0" role="button" ` +
        `aria-label="${esc(T('โต๊ะ #{id} โซน {zone} {seats} ที่นั่ง', { id: t.TableID, zone: t.Zone, seats: t.Capacity }))}">`;
      const n = Math.max(1, Math.round((Number(t.Capacity) || 4) / 2));
      for (let k = 0; k < n; k++) {
        const sy = y0 + (len / n) * (k + 0.5);
        [[x0 - 0.28, sy], [x1 + 0.28, sy]].forEach(([sx, sy2]) => { const p = iso(sx, sy2, 0.06); g += `<ellipse class="sm-seat" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" rx="4.2" ry="2.4"/>`; });
      }
      if (sel) { const c = iso(cx, cy, 0); g += `<ellipse class="sm-ring" cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" rx="${(len * 26).toFixed(1)}" ry="${(len * 13).toFixed(1)}"/>`; }
      g += `<polygon class="sm-side-l" points="${pts([iso(x0, y1, 0), iso(x1, y1, 0), iso(x1, y1, H), iso(x0, y1, H)])}"/>`;
      g += `<polygon class="sm-side-r" points="${pts([iso(x1, y0, 0), iso(x1, y1, 0), iso(x1, y1, H), iso(x1, y0, H)])}"/>`;
      g += `<polygon class="sm-top" points="${pts([iso(x0, y0, H), iso(x1, y0, H), iso(x1, y1, H), iso(x0, y1, H)])}"/>`;
      const lp = iso(cx, cy, H + 0.55);
      g += `<text class="sm-label" x="${lp[0].toFixed(1)}" y="${lp[1].toFixed(1)}" text-anchor="middle">#${t.TableID}</text>`;
      svg += g + '</g>';
    });
    mapBox.innerHTML = svg + '</svg>';
    updateCaption();
  }

  function updateCaption() {
    const t = (state.tables || []).find((x) => String(x.TableID) === tableSelect.value);
    if (!t) { caption.textContent = ''; return; }
    const st = tableStatus(t);
    caption.className = 'store-map-caption is-' + st;
    caption.textContent = T('คุณกำลังเลือกโต๊ะ #{id} (โซน {zone}) · {seats} ที่นั่ง · {status}', {
      id: t.TableID, zone: t.Zone, seats: t.Capacity,
      status: st === 'free' ? T('ว่าง') : st === 'queue' ? T('มีคิวรอ {n} คิว', { n: waitingAt(t.TableID) }) : T('ไม่ว่าง')
    });
  }

  function pickTable(id) {
    if (!id || tableSelect.value === id) return;
    tableSelect.value = id; fire(tableSelect);
    drawMap();
  }
  mapBox.addEventListener('click', (e) => { const g = e.target.closest('[data-table]'); if (g) pickTable(g.dataset.table); });
  mapBox.addEventListener('keydown', (e) => {
    const g = e.target.closest('[data-table]');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickTable(g.dataset.table); }
  });
  tableSelect.addEventListener('change', drawMap);

  /* ================= กล่องบอร์ดเกม 3D (ใช้โมเดลชุดเดียวกับหน้าบอร์ดเกม — games3d.js) ================= */
  const stage = $('spot-stage'), fallback = $('spot-fallback');
  let view = null, shownId = null;

  function gameOfTheDay() {
    const pool = GAMES.filter((g) => (liveGame(g.id).AvailableQty ?? g.avail) > 0);
    const list = pool.length ? pool : GAMES;
    if (!list.length) return null;
    const d = new Date(), day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
    return list[day % list.length];
  }

  function init3D() {
    if (!window.BGC3D || typeof THREE === 'undefined') return null;
    const B = window.BGC3D;
    const w = stage.clientWidth || 320, h = stage.clientHeight || 220;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 50);
    camera.position.set(0, 3.5, 8.6);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    stage.appendChild(renderer.domElement);
    stage.classList.add('is-3d');
    B.addLights(scene, true);
    let controls = null;
    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.enableZoom = false; controls.enablePan = false;
      controls.minPolarAngle = 0.6; controls.maxPolarAngle = 1.45;
      controls.target.set(0, 0.85, 0);
    }
    const v = { scene, camera, renderer, controls, model: null, visible: true, appear: 1 };
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        const nw = stage.clientWidth, nh = stage.clientHeight;
        if (nw && nh) { renderer.setSize(nw, nh); camera.aspect = nw / nh; camera.updateProjectionMatrix(); }
      }).observe(stage);
    }
    if (typeof IntersectionObserver !== 'undefined') new IntersectionObserver((en) => { v.visible = en[0].isIntersecting; }).observe(stage);
    (function loop() {
      requestAnimationFrame(loop);
      if (!v.visible || document.hidden || !v.model) return;
      if (v.appear < 1) {                                    // เกมใหม่ลอยลงมาบนแท่น
        v.appear = Math.min(1, v.appear + 0.045);
        const e = 1 - Math.pow(1 - v.appear, 3);
        v.model.scale.setScalar(0.82 + 0.18 * e); v.model.position.y = (1 - e) * 0.9;
      }
      if (!REDUCE_MOTION) v.model.rotation.y += 0.004;
      if (v.model.userData.tick) v.model.userData.tick();
      if (controls) controls.update();
      renderer.render(scene, camera);
    })();
    return v;
  }

  function showModel(g) {
    if (!view) view = init3D();
    if (!view) {                                           // ไม่มี WebGL / โหลด Three.js ไม่ได้ → ใช้รูปปก 2 มิติ
      fallback.src = g.img || '/images/games/default.svg'; fallback.alt = g.name; fallback.hidden = false;
      return;
    }
    fallback.hidden = true;
    const B = window.BGC3D;
    if (view.model) { view.scene.remove(view.model); B.disposeObject(view.model); }
    const accent = new THREE.Color(0x34d399);
    const img = g.img && !/default\.svg$/.test(g.img) ? g.img : null;
    view.model = B.buildModel(B.slugOf(g.name), g.name, accent, img);
    view.scene.add(view.model);
    view.appear = REDUCE_MOTION ? 1 : 0;
  }

  function renderSpot(g, picked) {
    if (!g) return;
    $('spot-title').textContent = picked ? T('บอร์ดเกมที่เลือก') : T('บอร์ดเกมแนะนำวันนี้');
    $('spot-sub').textContent = picked ? T('จากฟอร์มด้านซ้าย') : 'Game of the Day';
    $('spot-name').textContent = g.name;
    updateStock(g);
    const chips = [];
    if (g.cat) chips.push(`<span class="spot-chip">${esc(g.cat)}</span>`);
    chips.push(`<span class="spot-chip">👥 ${esc(T('{min}–{max} คน', { min: g.min, max: g.max }))}</span>`);
    if (g.time) chips.push(`<span class="spot-chip">⏱ ${esc(g.time)}</span>`);
    if (g.level) chips.push(`<span class="spot-chip">${esc(T('ระดับ {level}', { level: g.level }))}</span>`);
    $('spot-chips').innerHTML = chips.join('');
    $('spot-3d').href = '/games?view=' + encodeURIComponent(g.id);
    const howto = $('spot-howto');
    howto.innerHTML = g.howto.length ? g.howto.map((s) => `<li>${esc(s)}</li>`).join('') : `<li>${esc(T('ยังไม่มีวิธีเล่น'))}</li>`;
    if (shownId !== g.id) { shownId = g.id; showModel(g); }
  }

  function updateStock(g) {
    const live = liveGame(g.id);
    const avail = live.AvailableQty ?? g.avail, total = live.TotalQty ?? g.total;
    const el = $('spot-stock');
    el.textContent = avail > 0 ? T('ว่าง {n}/{total}', { n: avail, total }) : T('หมด');
    el.className = 'spot-stock' + (avail > 0 ? '' : ' is-out');
  }

  // เกมที่กำลังเลือกในฟอร์ม (ตามแท็บที่เปิดอยู่) — ไม่ได้เลือก = เกมแนะนำวันนี้
  function syncFromForm() {
    const sel = mode() === 'rental' ? $('rental-game') : $('instore-game');
    const id = sel && sel.value ? Number(sel.value) : null;
    const g = id && GAMES.find((x) => x.id === id);
    renderSpot(g || gameOfTheDay(), !!g);
  }
  ['instore-game', 'rental-game'].forEach((id) => { const el = $(id); if (el) el.addEventListener('change', syncFromForm); });
  document.addEventListener('change', (e) => { if (e.target.name === 'booking-mode') syncFromForm(); });

  $('spot-howto-btn').addEventListener('click', (e) => {
    const box = $('spot-howto'), open = box.hidden;
    box.hidden = !open; e.currentTarget.setAttribute('aria-expanded', open);
  });

  /* ================= ทอยสุ่มเกม ================= */
  const roll = $('roll-card');
  roll.addEventListener('click', () => {
    if (roll.classList.contains('is-rolling')) return;
    const pool = GAMES.filter((g) => (liveGame(g.id).AvailableQty ?? g.avail) > 0 && g.id !== shownId);
    const list = pool.length ? pool : GAMES.filter((g) => (liveGame(g.id).AvailableQty ?? g.avail) > 0);
    if (!list.length) { $('roll-desc').textContent = T('ตอนนี้ไม่มีเกมว่างให้สุ่ม'); return; }
    const g = list[Math.floor(Math.random() * list.length)];
    roll.classList.add('is-rolling');
    setTimeout(() => {
      roll.classList.remove('is-rolling');
      const sel = mode() === 'rental' ? $('rental-game') : $('instore-game');
      const usable = sel && !sel.closest('[hidden]') && !(sel.closest('.checkin-only') || {}).hidden;
      if (usable && Array.from(sel.options).some((o) => o.value === String(g.id) && !o.disabled)) {
        sel.value = String(g.id); fire(sel);                  // ตั้งค่าในฟอร์ม → กล่อง 3D เปลี่ยนตาม
      } else {
        renderSpot(g, true);
      }
      $('roll-desc').textContent = T('ได้เกม {name}! กดทอยใหม่ได้ถ้ายังไม่ถูกใจ', { name: g.name });
    }, REDUCE_MOTION ? 0 : 750);
  });

  /* ================= สถานะร้านตอนนี้ ================= */
  function renderLive() {
    const tables = state.tables || [];
    const free = tables.filter((t) => t.Status === 'Available').length;
    const q = (state.queue || []).length;
    $('live-line').innerHTML = T('โต๊ะว่าง <b>{free}</b> จาก {total} โต๊ะ · คิวรอ <b>{queue}</b> คิว', { free, total: tables.length, queue: q });
    $('live-card').classList.toggle('is-full', free === 0);
  }

  /* ================= อัปเดตตาม state เรียลไทม์ ================= */
  function refresh() {
    drawMap(); renderLive();
    const g = GAMES.find((x) => x.id === shownId); if (g) updateStock(g);
    // ปุ่มแพ็กเกจตรงกับค่าใน select เสมอ (เช่น หลังจองสำเร็จแล้วฟอร์มรีเซ็ต)
    document.querySelectorAll('.pkg-btn').forEach((b) => { const on = b.dataset.package === pkgSelect.value; b.classList.toggle('is-active', on); b.setAttribute('aria-checked', on); });
  }
  document.addEventListener('bgc:state', (e) => { state = e.detail || state; refresh(); syncFromForm(); });

  // เปิดหน้าครั้งแรก: ถ้าโต๊ะที่ถูกเลือกไว้ไม่ว่าง ให้เลือกโต๊ะว่างตัวแรกแทน (ฟอร์มจะเห็นแพ็กเกจ + เกมทันที)
  (function preferFreeTable() {
    const cur = (state.tables || []).find((t) => String(t.TableID) === tableSelect.value);
    if (cur && tableStatus(cur) === 'free') return;
    const free = (state.tables || []).find((t) => tableStatus(t) === 'free');
    if (free) pickTable(String(free.TableID));
  })();

  refresh();
  syncFromForm();
})();
