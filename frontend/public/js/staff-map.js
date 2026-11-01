/* หน้าสถานะโต๊ะ (พนักงาน): แผนผังร้านสำหรับตรวจเช็ค
   - สีโต๊ะ: ว่าง / ว่างแต่มีคิว / ไม่ว่าง / ใกล้หมดเวลา (≤ 10 นาที) / เกินเวลา
   - แถบ "ต้องตรวจ" สรุปโต๊ะที่ต้องดูแล (ใกล้หมด / เกินเวลา / ว่างแล้วมีคิวรอ)
   - คลิกโต๊ะ → กล่องรายละเอียดด้านข้าง + ไฮไลต์แถวโต๊ะนั้นในตาราง (ปุ่มเลื่อนไปที่แถว)
   ข้อมูลมาจาก state เดียวกับตาราง (vw_TableStatus, vw_CurrentQueue, เกมที่หยิบอยู่) อัปเดตผ่าน event 'bgc:state' */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const mapBox = $('staff-map');
  if (!mapBox) return;
  const detail = $('staff-map-detail'), alerts = $('staff-map-alerts');

  const LANG = window.__lang === 'en' ? 'en' : 'th';
  const LOCALE = LANG === 'en' ? 'en-GB' : 'th-TH';
  const T = (key, vars) => I18n.t(LANG, key, vars);
  const SOON = 10;   // นาที — ถือว่า "ใกล้หมดเวลา"
  let state = window.__initialState || { tables: [], queue: [], borrowed: [] };
  let selected = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const queueOf = (id) => (state.queue || []).filter((q) => q.TableID === id);
  const gameOf = (t) => (state.borrowed || []).find((b) => t.SessionID && b.SessionID === t.SessionID);
  const minsLeft = (t) => (t.MinutesLeft === null || t.MinutesLeft === undefined ? null : Number(t.MinutesLeft));

  // สถานะสำหรับตรวจเช็ค
  function check(t) {
    if (t.Status === 'Available') return queueOf(t.TableID).length ? 'queue' : 'free';
    const m = minsLeft(t);
    if (m !== null && m < 0) return 'over';
    if (m !== null && m <= SOON) return 'soon';
    return 'busy';
  }
  const STATUS_TEXT = {
    free: () => T('ว่าง'), queue: () => T('ว่าง · มีคิวรอ'), busy: () => T('ไม่ว่าง'),
    soon: () => T('ใกล้หมดเวลา'), over: () => T('เกินเวลา')
  };
  function timeText(t) {
    const m = minsLeft(t);
    if (t.Status === 'Available' || m === null) return '';
    return m < 0 ? T('เกิน {n} นาที', { n: -m }) : T('เหลือ {n} นาที', { n: m });
  }

  /* ---------- แผนผัง isometric (รูปแบบเดียวกับหน้าจองโต๊ะของลูกค้า) ---------- */
  const SQ = Math.sqrt(3) / 2;
  const iso = (x, y, z) => [(x - y) * SQ * 26, (x + y) * 0.5 * 26 - (z || 0) * 26];
  const pts = (arr) => arr.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');

  function layout(tables) {
    const zones = [];
    tables.forEach((t) => { if (zones.indexOf(t.Zone) < 0) zones.push(t.Zone); });
    const ZW = 3.4, D = Math.max(6.4, 1.3 + Math.max(...zones.map((z) => tables.filter((t) => t.Zone === z).length)) * 2.6);
    const items = [];
    zones.forEach((z, zi) => {
      const list = tables.filter((t) => t.Zone === z);
      list.forEach((t, k) => {
        const len = 0.7 + Math.min(Number(t.Capacity) || 4, 10) * 0.16;
        items.push({ t, cx: zi * ZW + ZW / 2, cy: (D / (list.length + 1)) * (k + 1), w: 1.0, len });
      });
    });
    return { zones, W: zones.length * ZW, D, ZW, items };
  }

  let sig = '';
  function draw() {
    const tables = state.tables || [];
    if (!tables.length) { mapBox.innerHTML = ''; sig = ''; return; }
    const s = JSON.stringify([selected, tables.map((t) => [t.TableID, t.Zone, t.Capacity, check(t), timeText(t), queueOf(t.TableID).length, !!gameOf(t)])]);
    if (s === sig) return;
    sig = s;
    const { zones, W, D, ZW, items } = layout(tables);
    const WALL = 1.25;
    const corners = [iso(0, 0, WALL), iso(W, 0, WALL), iso(0, D, WALL), iso(W, D, 0), iso(0, D, 0), iso(W, 0, 0)];
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
    const pad = 16, vb = [Math.min(...xs) - pad, Math.min(...ys) - pad - 12, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2 + 12];
    let svg = `<svg viewBox="${vb.map((n) => n.toFixed(1)).join(' ')}" role="group" aria-label="${esc(T('แผนผังร้าน'))}">`;
    svg += `<polygon class="sm-wall" points="${pts([iso(0, 0, 0), iso(W, 0, 0), iso(W, 0, WALL), iso(0, 0, WALL)])}"/>`;
    svg += `<polygon class="sm-wall" points="${pts([iso(0, 0, 0), iso(0, D, 0), iso(0, D, WALL), iso(0, 0, WALL)])}"/>`;
    svg += `<polygon class="sm-floor" points="${pts([iso(0, 0), iso(W, 0), iso(W, D), iso(0, D)])}"/>`;
    for (let x = 1; x < W; x++) svg += `<line class="sm-grid" x1="${iso(x, 0)[0]}" y1="${iso(x, 0)[1]}" x2="${iso(x, D)[0]}" y2="${iso(x, D)[1]}"/>`;
    for (let y = 1; y < D; y++) svg += `<line class="sm-grid" x1="${iso(0, y)[0]}" y1="${iso(0, y)[1]}" x2="${iso(W, y)[0]}" y2="${iso(W, y)[1]}"/>`;
    zones.forEach((z, zi) => {
      if (zi > 0) { const a = iso(zi * ZW, 0), b = iso(zi * ZW, D); svg += `<line class="sm-zone-line" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`; }
      const p = iso(zi * ZW + ZW / 2, D - 0.35);
      svg += `<text class="sm-zone" x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" text-anchor="middle">${esc(T('โซน {zone}', { zone: z }))}</text>`;
    });
    items.slice().sort((a, b) => (a.cx + a.cy) - (b.cx + b.cy)).forEach(({ t, cx, cy, w, len }) => {
      const st = check(t), sel = String(t.TableID) === selected;
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - len / 2, y1 = cy + len / 2, H = 0.32;
      const q = queueOf(t.TableID).length, tt = timeText(t);
      let g = `<g class="sm-table is-${st}${sel ? ' is-selected' : ''}" data-table="${t.TableID}" tabindex="0" role="button" ` +
        `aria-label="${esc(T('โต๊ะ #{id} โซน {zone} {seats} ที่นั่ง', { id: t.TableID, zone: t.Zone, seats: t.Capacity }) + ' · ' + STATUS_TEXT[st]() + (tt ? ' · ' + tt : ''))}">`;
      const n = Math.max(1, Math.round((Number(t.Capacity) || 4) / 2));
      for (let k = 0; k < n; k++) {
        const sy = y0 + (len / n) * (k + 0.5);
        [[x0 - 0.28, sy], [x1 + 0.28, sy]].forEach(([sx, sy2]) => { const p = iso(sx, sy2, 0.06); g += `<ellipse class="sm-seat" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" rx="4.2" ry="2.4"/>`; });
      }
      if (sel || st === 'over') { const c = iso(cx, cy, 0); g += `<ellipse class="sm-ring" cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" rx="${(len * 26).toFixed(1)}" ry="${(len * 13).toFixed(1)}"/>`; }
      g += `<polygon class="sm-side-l" points="${pts([iso(x0, y1, 0), iso(x1, y1, 0), iso(x1, y1, H), iso(x0, y1, H)])}"/>`;
      g += `<polygon class="sm-side-r" points="${pts([iso(x1, y0, 0), iso(x1, y1, 0), iso(x1, y1, H), iso(x1, y0, H)])}"/>`;
      g += `<polygon class="sm-top" points="${pts([iso(x0, y0, H), iso(x1, y0, H), iso(x1, y1, H), iso(x0, y1, H)])}"/>`;
      const lp = iso(cx, cy, H + 0.62);
      g += `<text class="sm-label" x="${lp[0].toFixed(1)}" y="${lp[1].toFixed(1)}" text-anchor="middle">#${t.TableID}${gameOf(t) ? ' 🎲' : ''}</text>`;
      const sub = tt || (q ? T('คิว {n}', { n: q }) : '');
      if (sub) g += `<text class="sm-sub" x="${lp[0].toFixed(1)}" y="${(lp[1] + 11).toFixed(1)}" text-anchor="middle">${esc(sub)}</text>`;
      svg += g + '</g>';
    });
    const f = document.activeElement && mapBox.contains(document.activeElement) && document.activeElement.getAttribute('data-table');
    mapBox.innerHTML = svg + '</svg>';
    if (f) { const el = mapBox.querySelector(`[data-table="${f}"]`); if (el) el.focus({ preventScroll: true }); }
  }

  /* ---------- แถบ "ต้องตรวจ" ---------- */
  function renderAlerts() {
    const list = [];
    (state.tables || []).forEach((t) => {
      const st = check(t);
      if (st === 'over') list.push({ t, st, rank: 0, text: T('#{id} เกินเวลา {n} นาที', { id: t.TableID, n: -minsLeft(t) }) });
      else if (st === 'soon') list.push({ t, st, rank: 1, text: T('#{id} เหลือ {n} นาที', { id: t.TableID, n: minsLeft(t) }) });
      else if (st === 'queue') list.push({ t, st, rank: 2, text: T('#{id} ว่างแล้ว มีคิวรอ {n} คิว', { id: t.TableID, n: queueOf(t.TableID).length }) });
    });
    list.sort((a, b) => a.rank - b.rank || (minsLeft(a.t) || 0) - (minsLeft(b.t) || 0));
    alerts.innerHTML = list.length
      ? `<span class="sma-title">${esc(T('ต้องตรวจ'))}</span>` + list.map((a) => `<button type="button" class="sma-chip is-${a.st}" data-pick="${a.t.TableID}">${esc(a.text)}</button>`).join('')
      : `<span class="sma-ok">${esc(T('✓ ทุกโต๊ะเรียบร้อย ไม่มีโต๊ะที่ต้องตรวจ'))}</span>`;
  }

  /* ---------- กล่องรายละเอียด ---------- */
  function renderDetail() {
    const t = (state.tables || []).find((x) => String(x.TableID) === selected);
    if (!t) {
      detail.innerHTML = `<p class="smd-hint">${esc(T('คลิกโต๊ะบนแผนผังเพื่อดูรายละเอียด'))}</p>`;
      return;
    }
    const st = check(t), q = queueOf(t.TableID), b = gameOf(t), tt = timeText(t);
    const row = (k, v) => `<div class="smd-row"><span>${esc(k)}</span><strong>${v}</strong></div>`;
    let h = `<div class="smd-head"><span class="smd-title">${esc(T('โต๊ะ #{id}', { id: t.TableID }))}</span><span class="smd-badge is-${st}">${esc(STATUS_TEXT[st]())}</span></div>`;
    h += `<div class="smd-meta">${esc(T('โซน {zone} · {seats} ที่นั่ง', { zone: t.Zone, seats: t.Capacity }))}</div>`;
    if (t.Status !== 'Available') {
      h += row(T('ลูกค้า'), t.CustomerName ? esc(t.CustomerName) + (t.CustomerPhone ? `<span class="smd-sub">${esc(t.CustomerPhone)}</span>` : '') : esc(T('walk-in')));
      if (t.StartTime) h += row(T('เริ่มเล่น'), esc(new Date(t.StartTime).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })));
      if (t.ExpectedEndTime) h += row(T('หมดเวลา'), esc(new Date(t.ExpectedEndTime).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })));
      if (tt) h += row(T('เวลา'), `<span class="smd-time is-${st}">${esc(tt)}</span>`);
      h += row(T('บอร์ดเกม'), b ? '🎲 ' + esc(b.GameName) : `<span class="smd-sub">${esc(T('ยังไม่หยิบเกม'))}</span>`);
    }
    h += row(T('คิวรอ'), q.length ? esc(T('{n} คิว', { n: q.length })) : esc(T('ไม่มี')));
    if (q.length) h += `<ol class="smd-queue">${q.slice(0, 3).map((x) => `<li>${esc(x.CustomerName)}</li>`).join('')}${q.length > 3 ? `<li class="smd-sub">${esc(T('และอีก {n} คิว', { n: q.length - 3 }))}</li>` : ''}</ol>`;
    const hint = { over: T('เกินเวลาแล้ว — เช็คเอาท์หรือต่อเวลาที่แถวโต๊ะ'), soon: T('ใกล้หมดเวลา — แจ้งลูกค้าหรือเตรียมต่อเวลา'), queue: T('โต๊ะว่างแล้ว — เรียกคิวแรกเข้านั่งได้ที่ส่วนคิวรอโต๊ะ') }[st];
    if (hint) h += `<p class="smd-note is-${st}">${esc(hint)}</p>`;
    h += `<button type="button" class="smd-go" data-goto="${t.TableID}">${esc(T('ไปที่แถวโต๊ะนี้ ↓'))}</button>`;
    detail.innerHTML = h;
  }

  /* ---------- ไฮไลต์ / เลื่อนไปแถวในตาราง ---------- */
  function rowOf(id) { return document.querySelector(`#tables-body tr[data-table-id="${id}"]`); }
  function markRow() {
    document.querySelectorAll('#tables-body tr.is-map-selected').forEach((r) => r.classList.remove('is-map-selected'));
    const r = selected && rowOf(selected);
    if (r) r.classList.add('is-map-selected');
  }
  function flash(r) { r.classList.remove('row-flash'); void r.offsetWidth; r.classList.add('row-flash'); }

  function pick(id) {
    selected = String(id);
    draw(); renderDetail(); markRow();
    const r = rowOf(selected); if (r) flash(r);
  }
  function goto(id) {
    const r = rowOf(id);
    if (!r) return;
    r.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    flash(r);
    const btn = r.querySelector('button, select'); if (btn) btn.focus({ preventScroll: true });
  }

  mapBox.addEventListener('click', (e) => { const g = e.target.closest('[data-table]'); if (g) pick(g.dataset.table); });
  mapBox.addEventListener('keydown', (e) => {
    const g = e.target.closest('[data-table]');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(g.dataset.table); }
  });
  alerts.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) pick(b.dataset.pick); });
  detail.addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) goto(b.dataset.goto); });

  function refresh() { draw(); renderAlerts(); renderDetail(); markRow(); }
  document.addEventListener('bgc:state', (e) => { state = e.detail || state; refresh(); });
  refresh();
})();
