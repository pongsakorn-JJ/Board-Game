/* Board Game Cafe — Realtime client
   รับสถานะล่าสุด (โต๊ะ/เกม/คิว/บิลเช่า) ผ่าน Socket.IO แล้วอัปเดตหน้าเว็บโดยไม่ต้องรีเฟรช
   ใช้ไฟล์เดียวทุกหน้า — แต่ละส่วนเช็คก่อนว่ามี element ของหน้านั้นอยู่ไหม */
(function () {
  const socket = io();

  const liveDot = document.getElementById('live-dot');
  const liveText = document.getElementById('live-text');
  const navQueueBadge = document.getElementById('nav-queue-badge');
  const $ = (id) => document.getElementById(id);

  /* ---------------- utils ---------------- */
  function setLive(status, text) {
    if (!liveDot) return;
    liveDot.className = 'dot ' + status;
    if (liveText) liveText.textContent = text;
    const box = document.getElementById('live-indicator');
    if (box) box.title = text;   // จอแคบซ่อนข้อความ เหลือจุดสถานะ + tooltip
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const money = (n) => Number(n || 0).toLocaleString('th-TH');
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('th-TH') : '-');
  const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-');

  function showToast(message, kind) {
    const area = $('toast-area');
    if (!area) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = message;
    area.appendChild(el);
    setTimeout(() => el.classList.add('toast-out'), 3500);
    setTimeout(() => el.remove(), 4000);
  }

  function setMsg(el, text, kind) {
    if (!el) return;
    el.className = 'form-msg' + (kind ? ' ' + kind : '');
    el.textContent = text;
  }

  async function postJson(url, body) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (resp.status === 401) {   // session หมดอายุ → กลับไปหน้า login แล้วกลับมาที่เดิม
      location.href = '/login?next=' + encodeURIComponent(location.pathname);
      return { ok: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    }
    return resp.json();
  }

  // สร้าง <option> ใหม่เฉพาะเมื่อข้อมูลเปลี่ยน (กันดรอปดาวน์ปิดเองระหว่างผู้ใช้กำลังเลือก) และคงค่าที่เลือกไว้
  function fillSelect(select, sig, optionsHtml) {
    if (!select || select.dataset.sig === sig) return false;
    const prev = select.value;
    select.innerHTML = optionsHtml;
    select.dataset.sig = sig;
    const opt = [...select.options].find(o => o.value === prev && !o.disabled);
    if (opt) select.value = prev;
    else {
      const firstEnabled = [...select.options].find(o => !o.disabled);
      if (firstEnabled) select.value = firstEnabled.value;
    }
    return true;
  }

  let currentState = null;
  const role = (window.__user && window.__user.role) || null;   // 'admin' | 'customer' | null
  const isStaff = role === 'admin';

  /* ---------------- connection ---------------- */
  socket.on('connect', () => setLive('live', 'เรียลไทม์ (เชื่อมต่อแล้ว)'));
  socket.on('disconnect', () => setLive('offline', 'ขาดการเชื่อมต่อ — กำลังลองใหม่...'));
  socket.on('connect_error', () => setLive('offline', 'เชื่อมต่อไม่ได้'));
  socket.on('state:error', (p) => setLive('offline', (p && p.message) || 'เชื่อมต่อฐานข้อมูลไม่ได้ชั่วคราว'));
  socket.on('state:update', (state) => {
    setLive('live', 'เรียลไทม์ (เชื่อมต่อแล้ว)');
    applyState(state);
  });

  function applyState(state) {
    currentState = state;

    const now = new Date(state.serverTime || Date.now()).toLocaleTimeString('th-TH');
    document.querySelectorAll('#last-updated').forEach(el => { el.textContent = now; });

    if (navQueueBadge) {
      const n = state.queue.length;
      navQueueBadge.textContent = n;
      navQueueBadge.style.display = n > 0 ? 'inline-block' : 'none';
    }

    renderDashboard(state);
    renderGames(state);
    renderBooking(state);
    renderRentals(state);
    renderQueueGroups(state);
    if (role === 'customer') refreshMe();
    // แจ้งสคริปต์อื่นในหน้า (เช่น หน้าจัดการข้อมูล) ว่ามีอัปเดตจากฐานข้อมูล
    document.dispatchEvent(new CustomEvent('bgc:state', { detail: state }));
  }

  /* ================= Dashboard ================= */
  // ตัวเลือกเกมที่หยิบได้ (มีของเหลือ)
  function gameOptionsHtml(state, placeholder) {
    const opts = state.games.map(g =>
      `<option value="${g.GameID}" ${g.AvailableQty <= 0 ? 'disabled' : ''}>${escapeHtml(g.Name)} ${g.AvailableQty > 0 ? '(เหลือ ' + g.AvailableQty + ')' : '(หมด)'}</option>`
    ).join('');
    return `<option value="">${placeholder}</option>` + opts;
  }

  function renderDashboard(state) {
    const tbody = $('tables-body');
    if (!tbody) return;

    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('stat-free', state.tables.filter(t => t.Status === 'Available').length);
    set('stat-busy', state.tables.filter(t => t.Status === 'Occupied').length);
    set('stat-queue', state.queue.length);
    set('stat-borrowed', new Set(state.borrowed.map(b => b.SessionID)).size);

    // วาดแถวใหม่เฉพาะเมื่อข้อมูลเปลี่ยน (กันเกมที่กำลังเลือกใน dropdown หาย) — เวลาที่เหลืออัปเดตแยกด้านล่าง
    const sig = JSON.stringify([
      state.tables.map(t => [t.TableID, t.Status, t.SessionID]),
      state.borrowed.map(b => [b.BorrowID, b.SessionID]),
      state.games.map(g => [g.GameID, g.AvailableQty > 0]),
      state.queue.map(q => q.TableID),
      state.packages.map(p => [p.PackageID, p.DurationMinutes, p.Price])
    ]);
    if (tbody.dataset.sig !== sig) {
      tbody.dataset.sig = sig;
      const anyGameLeft = state.games.some(g => g.AvailableQty > 0);
      tbody.innerHTML = state.tables.map(t => {
        const items = state.borrowed.filter(b => b.SessionID === t.SessionID);
        let gameCell = '<span class="empty">-</span>';
        if (items.length) {
          gameCell = items.map(b => `
            <span class="game-chip">🎲 ${escapeHtml(b.GameName)}
              <button type="button" class="chip-return" data-return-borrow-id="${b.BorrowID}">คืนเกม</button>
            </span>`).join('');
        } else if (t.Status === 'Occupied' && t.SessionID) {
          gameCell = anyGameLeft
            ? `<div class="pick-game">
                 <select class="pick-game-select" aria-label="เลือกเกมให้โต๊ะ #${t.TableID}">${gameOptionsHtml(state, 'เลือกเกม...')}</select>
                 <button type="button" class="btn-primary-sm" data-borrow-session="${t.SessionID}">หยิบเกม</button>
               </div>`
            : '<span class="muted">เกมถูกหยิบหมดทุกเกม</span>';
        }
        const waiting = state.queue.filter(q => q.TableID === t.TableID).length;
        const statusText = (t.Status === 'Available' ? 'ว่าง' : 'ไม่ว่าง') + (waiting ? ` · คิว ${waiting}` : '');
        const extendOpts = state.packages.filter(p => p.DurationMinutes)
          .map(p => `<option value="${p.PackageID}">+${p.DurationMinutes} นาที (${money(p.Price)} ฿)</option>`).join('');
        const checkoutHtml = (t.Status === 'Occupied' && t.SessionID)
          ? `<div class="row-actions">
               ${extendOpts ? `<div class="extend-box">
                 <select class="extend-pkg" aria-label="ต่อเวลาโต๊ะ #${t.TableID}">${extendOpts}</select>
                 <button type="button" class="btn-extend" data-extend-session="${t.SessionID}">⏱ ต่อเวลา</button>
               </div>` : ''}
               <button type="button" class="btn-checkout" data-checkout-session-id="${t.SessionID}">เช็คเอาท์</button>
             </div>`
          : '<span class="empty">-</span>';

        return `<tr class="${t.Status === 'Available' ? 'status-free' : 'status-busy'}" data-table-id="${t.TableID}">
          <td>#${t.TableID}</td>
          <td>${escapeHtml(t.Zone)}</td>
          <td>${t.Capacity}</td>
          <td><span class="badge">${statusText}</span></td>
          <td>${t.CustomerName ? `${escapeHtml(t.CustomerName)}<div class="muted">${escapeHtml(t.CustomerPhone || '')}</div>` : '<span class="empty">-</span>'}</td>
          <td>${t.StartTime ? new Date(t.StartTime).toLocaleTimeString('th-TH') : '-'}</td>
          <td data-minutes-left></td>
          <td>${gameCell}</td>
          <td>${checkoutHtml}</td>
        </tr>`;
      }).join('');
    }

    state.tables.forEach(t => {
      const cell = tbody.querySelector(`tr[data-table-id="${t.TableID}"] [data-minutes-left]`);
      if (cell) cell.textContent = (t.MinutesLeft !== null && t.MinutesLeft !== undefined) ? t.MinutesLeft : '-';
    });
  }

  /* ================= Games (แคตตาล็อก) — อัปเดตเฉพาะสต๊อก + โต๊ะที่กำลังเล่น ================= */
  function renderGames(state) {
    const cards = document.querySelectorAll('.game-card[data-game-id]');
    if (!cards.length) return;
    cards.forEach(card => {
      const id = Number(card.dataset.gameId);
      const g = state.games.find(x => x.GameID === id);
      if (!g) return;
      const badge = card.querySelector('[data-stock]');
      if (badge) {
        badge.className = 'stock-badge ' + (g.AvailableQty > 0 ? 'in' : 'out');
        badge.textContent = g.AvailableQty > 0 ? `ว่าง ${g.AvailableQty}/${g.TotalQty}` : `หมด 0/${g.TotalQty}`;
      }
      const inuse = card.querySelector('[data-inuse]');
      if (inuse) {
        const tableIds = state.borrowed
          .filter(b => b.GameID === id)
          .map(b => (state.tables.find(t => t.SessionID === b.SessionID) || {}).TableID)
          .filter(Boolean);
        inuse.hidden = tableIds.length === 0;
        inuse.textContent = tableIds.length ? `🪑 กำลังเล่นที่โต๊ะ ${tableIds.map(n => '#' + n).join(', ')}` : '';
      }
    });
    renderMyGame();
    applyGameFilter();
  }

  /* ---- ค้นหา / กรองเกม (หน้า /games) ---- */
  function applyGameFilter() {
    const search = $('game-search');
    if (!search) return;
    const q = search.value.trim().toLowerCase();
    const players = Number($('game-players').value) || 0;
    const onlyFree = $('game-available-only').checked;
    const cards = [...document.querySelectorAll('.game-card[data-game-id]')];
    let shown = 0;
    cards.forEach(card => {
      const g = currentState && currentState.games.find(x => x.GameID === Number(card.dataset.gameId));
      const ok = (!q || card.dataset.search.includes(q))
        && (!players || (players >= Number(card.dataset.min) && players <= Number(card.dataset.max)))
        && (!onlyFree || !g || g.AvailableQty > 0 || card.classList.contains('is-current'));
      card.hidden = !ok;
      if (ok) shown++;
    });
    const count = $('game-filter-count');
    if (count) count.textContent = (q || players || onlyFree) ? `แสดง ${shown} จาก ${cards.length} เกม` : `ทั้งหมด ${cards.length} เกม`;
    const empty = $('game-filter-empty');
    if (empty) empty.hidden = shown > 0;
  }
  ['game-search', 'game-players', 'game-available-only'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener(el.type === 'search' ? 'input' : 'change', applyGameFilter);
  });

  /* ---- ลูกค้า: เลือก/คืนเกมให้โต๊ะของตัวเอง (เมนู 🎲 บอร์ดเกม) ---- */
  let lastMe = null;
  function renderMyGame() {
    const me = lastMe;
    const a = me && me.active;

    // ป้าย "เลือกเกม" บนแถบเมนู: มีโต๊ะแต่ยังไม่ได้หยิบเกม
    const navBadge = $('nav-game-badge');
    if (navBadge) navBadge.hidden = !(a && !a.BorrowID);

    const panel = $('my-game-panel');
    if (!panel || !me) return;

    let html;
    if (a && a.BorrowID) {
      const img = document.querySelector(`.game-card[data-game-id="${a.GameID}"] .game-cover img`);
      html = `<div class="status-card is-playing">
        <div>
          <div class="status-title">🪑 โต๊ะ #${a.TableID} ของคุณกำลังเล่น</div>
          <div class="status-meta my-game-now">${img ? `<img src="${escapeHtml(img.getAttribute('src'))}" alt="">` : ''}
            <span>🎲 <strong>${escapeHtml(a.GameName)}</strong>${a.GameSince ? ' · หยิบเมื่อ ' + fmtTime(a.GameSince) : ''}</span></div>
          <div class="status-meta muted">อยากเล่นเกมอื่น? กด "คืนเกมนี้" ก่อน แล้วเลือกเกมใหม่ด้านล่าง</div>
        </div>
        <button type="button" class="btn-return-game" data-my-return>↩ คืนเกมนี้</button>
      </div>`;
    } else if (a) {
      html = `<div class="status-card is-pick">
        <div>
          <div class="status-title">🪑 โต๊ะ #${a.TableID} ยังไม่ได้เลือกเกม</div>
          <div class="status-meta">กด <strong>"หยิบเกมนี้เข้าโต๊ะ #${a.TableID}"</strong> ที่การ์ดเกมด้านล่าง แล้วรับกล่องเกมที่เคาน์เตอร์</div>
        </div>
      </div>`;
    } else if (me.queue && me.queue.length) {
      const q = me.queue[0];
      html = `<div class="status-card is-queued">
        <div class="status-title">🎫 คุณอยู่คิวที่ ${q.Position} ${q.TableID ? 'ของโต๊ะ #' + q.TableID : ''}</div>
        <div class="status-meta">ดูเกมไว้ก่อนได้เลย — ปุ่มหยิบเกมจะขึ้นทันทีเมื่อพนักงานเรียกคุณเข้านั่งโต๊ะ</div>
      </div>`;
    } else {
      html = `<div class="status-card is-empty">
        <div class="status-title">ยังไม่มีโต๊ะที่กำลังเล่น</div>
        <div class="status-meta"><a href="/booking">จองโต๊ะ</a> ก่อน แล้วกลับมาเลือกเกมที่หน้านี้ได้ตลอด (เลือกทีหลังได้ ไม่ต้องเลือกตอนจอง)</div>
      </div>`;
    }
    if (panel.dataset.html !== html) { panel.innerHTML = html; panel.dataset.html = html; }

    if (!currentState) return;
    document.querySelectorAll('.game-card[data-game-id]').forEach(card => {
      const box = card.querySelector('[data-my-actions]');
      if (!box) return;
      const id = Number(card.dataset.gameId);
      const g = currentState.games.find(x => x.GameID === id);
      const isCurrent = !!(a && a.BorrowID && a.GameID === id);
      card.classList.toggle('is-current', isCurrent);
      let h = '';
      if (a && isCurrent) {
        h = `<div class="current">✓ โต๊ะ #${a.TableID} กำลังเล่นเกมนี้</div>`;
      } else if (a && a.BorrowID) {
        h = `<button type="button" class="btn-primary-sm" disabled>🎲 หยิบเกมนี้</button>
             <span class="note">คืน "${escapeHtml(a.GameName)}" ก่อนถึงจะหยิบเกมนี้ได้ (1 โต๊ะ 1 เกม)</span>`;
      } else if (a && g && g.AvailableQty <= 0) {
        h = `<button type="button" class="btn-primary-sm" disabled>หมดชั่วคราว</button>
             <span class="note">ทุกกล่องถูกหยิบ/เช่าอยู่ — เลือกเกมอื่นหรือรอสักครู่</span>`;
      } else if (a) {
        h = `<button type="button" class="btn-primary-sm" data-my-borrow="${id}">🎲 หยิบเกมนี้เข้าโต๊ะ #${a.TableID}</button>`;
      }
      if (box.dataset.html !== h) { box.innerHTML = h; box.dataset.html = h; }
    });
  }

  /* ================= Booking: เล่นที่ร้าน / เช่ากลับบ้าน / คิว ================= */
  function tableWaiting(state, tableId) {
    return state.queue.filter(q => q.TableID === tableId).length;
  }

  function tableOptionLabel(t, waiting) {
    const base = `โต๊ะ #${t.TableID} (${t.Zone}, ${t.Capacity} คน)`;
    if (t.Status === 'Available' && waiting === 0) return `${base} — ว่าง`;
    if (t.Status === 'Available') return `${base} — ว่าง แต่มีคิวรอ ${waiting} คิว → เข้าคิว`;
    return `${base} — ไม่ว่าง · คิวรอ ${waiting} → เข้าคิว`;
  }

  function renderBooking(state) {
    const tableSelect = $('instore-table');
    if (!tableSelect) return;

    // โต๊ะ: แสดงทุกโต๊ะ (เลือกโต๊ะที่ไม่ว่างซ้ำได้ = เข้าคิว)
    fillSelect(tableSelect,
      JSON.stringify(state.tables.map(t => [t.TableID, t.Status, tableWaiting(state, t.TableID)])),
      state.tables.map(t => {
        const w = tableWaiting(state, t.TableID);
        return `<option value="${t.TableID}">${escapeHtml(tableOptionLabel(t, w))}</option>`;
      }).join(''));
    updateInstoreMode();

    // เกมที่หยิบเข้าโต๊ะได้ตอนเปิดโต๊ะ (ไม่บังคับ)
    fillSelect($('instore-game'),
      JSON.stringify(state.games.map(g => [g.GameID, g.AvailableQty])),
      gameOptionsHtml(state, '— ยังไม่หยิบเกม (เลือกทีหลังได้ที่เมนู 🎲 บอร์ดเกม) —'));

    // เกมที่เช่าได้ (มีของเหลือ)
    const gameSelect = $('rental-game');
    fillSelect(gameSelect,
      JSON.stringify(state.games.map(g => [g.GameID, g.AvailableQty, g.OffsiteRentalRate, g.DepositAmount])),
      state.games.map(g =>
        `<option value="${g.GameID}" data-rate="${g.OffsiteRentalRate}" data-deposit="${g.DepositAmount}" ${g.AvailableQty <= 0 ? 'disabled' : ''}>` +
        `${escapeHtml(g.Name)} — ค่าเช่า ${money(g.OffsiteRentalRate)} / มัดจำ ${money(g.DepositAmount)} บาท ` +
        `(${g.AvailableQty > 0 ? 'เหลือ ' + g.AvailableQty : 'หมด'})</option>`
      ).join(''));
    updateRentalSummary();

  }

  // เปลี่ยนหน้าตาฟอร์ม "เล่นที่ร้าน" ตามโต๊ะที่เลือก: ว่าง = จองเลย / ไม่ว่าง = เข้าคิว
  function updateInstoreMode() {
    const select = $('instore-table');
    if (!select || !currentState) return;
    const t = currentState.tables.find(x => String(x.TableID) === select.value);
    if (!t) return;
    const waiting = tableWaiting(currentState, t.TableID);
    const willQueue = !(t.Status === 'Available' && waiting === 0);

    const note = $('instore-table-note');
    if (note) {
      if (!willQueue) {
        note.className = 'field-note ok';
        note.textContent = '✓ โต๊ะว่าง — กดจองแล้วเช็คอินและเริ่มนับเวลาทันที';
      } else if (t.Status === 'Available') {
        note.className = 'field-note warn';
        note.textContent = isStaff
          ? `โต๊ะนี้ว่างแล้วแต่มีคิวรออยู่ ${waiting} คิว — ลูกค้าจะเข้าคิวเป็นคิวที่ ${waiting + 1} (เรียกคิวก่อนหน้าได้ที่ส่วน "คิวรอโต๊ะ" ด้านล่าง)`
          : `โต๊ะนี้มีคนรอคิวอยู่ ${waiting} คิว — คุณจะได้คิวที่ ${waiting + 1}`;
      } else {
        note.className = 'field-note warn';
        const left = (t.MinutesLeft !== null && t.MinutesLeft !== undefined) ? ` เหลือเวลาอีกประมาณ ${Math.max(t.MinutesLeft, 0)} นาที ·` : '';
        note.textContent = `โต๊ะนี้ไม่ว่าง —${left} ${isStaff ? 'ลูกค้า' : 'คุณ'}จะเข้าคิวรอโต๊ะนี้เป็นคิวที่ ${waiting + 1}`;
      }
    }

    document.querySelectorAll('#instore-form .checkin-only').forEach(el => { el.hidden = willQueue; });

    const btn = $('instore-submit');
    if (btn) btn.textContent = willQueue ? '🎫 เข้าคิวโต๊ะนี้' : '🪑 จองโต๊ะ';
  }

  function updateRentalSummary() {
    const select = $('rental-game');
    const box = $('rental-summary');
    const submit = $('rental-submit');
    if (!select || !box) return;
    const opt = select.options[select.selectedIndex];
    if (!opt || opt.disabled) {
      box.innerHTML = 'ตอนนี้ไม่มีเกมเหลือให้เช่ากลับบ้าน';
      if (submit) submit.disabled = true;
      return;
    }
    if (submit) submit.disabled = false;
    const rate = Number(opt.dataset.rate), deposit = Number(opt.dataset.deposit);
    box.innerHTML = `ยอดที่ต้องเก็บตอนเช่า: ค่าเช่า ${money(rate)} + มัดจำ ${money(deposit)} = <strong>${money(rate + deposit)} บาท</strong> <span class="muted">(มัดจำคืนตอนคืนเกม)</span>`;
  }

  // สลับโหมด เล่นที่ร้าน / เช่ากลับบ้าน
  document.addEventListener('change', (e) => {
    if (e.target.name === 'booking-mode') {
      const mode = e.target.value;
      document.querySelectorAll('.mode-option').forEach(l => {
        l.classList.toggle('is-active', l.querySelector('input').checked);
      });
      const instore = $('instore-pane'), rental = $('rental-form');
      if (instore) instore.hidden = mode !== 'instore';
      if (rental) rental.hidden = mode !== 'rental';
    }
    if (e.target.id === 'instore-table') updateInstoreMode();
    if (e.target.id === 'rental-game') updateRentalSummary();
  });

  // ค่าเริ่มต้นวันกำหนดคืน = อีก 3 วัน
  (function initDueDate() {
    const due = $('rental-due');
    if (!due || due.value) return;
    const d = new Date();
    d.setDate(d.getDate() + 3);
    const pad = (n) => String(n).padStart(2, '0');
    due.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  /* ---- คิวรอโต๊ะ (แยกตามโต๊ะ) ---- */
  function renderQueueGroups(state) {
    const box = $('queue-groups');
    if (!box) return;
    const total = $('queue-total');
    if (total) total.textContent = state.queue.length ? `(${state.queue.length} คิว)` : '';

    const sig = JSON.stringify([
      state.queue.map(q => [q.QueueID, q.TableID]),
      state.tables.map(t => [t.TableID, t.Status]),
      state.packages.map(p => p.PackageID)
    ]);
    if (box.dataset.sig === sig) return; // ไม่เปลี่ยน → ไม่วาดใหม่ (กันค่าที่เลือกไว้หาย)
    box.dataset.sig = sig;

    if (state.queue.length === 0) {
      box.innerHTML = '<p class="empty">ยังไม่มีคิวรอ</p>';
      return;
    }

    const pkgOptions = state.packages.map(p =>
      `<option value="${p.PackageID}">${escapeHtml(p.PackageName)} (${money(p.Price)} บาท)</option>`).join('');

    const listHtml = (items) => `<ol class="queue-list">${items.map(q => `
      <li>
        <span class="queue-name">${escapeHtml(q.CustomerName)}</span>
        <span class="muted">${q.Phone ? escapeHtml(q.Phone) + ' · ' : ''}ลงคิว ${fmtTime(q.QueueTime)}</span>
        <button type="button" class="btn-link-danger" data-cancel-queue="${q.QueueID}">ยกเลิกคิว</button>
      </li>`).join('')}</ol>`;

    let html = '';

    // คิวของแต่ละโต๊ะ
    state.tables.forEach(t => {
      const items = state.queue.filter(q => q.TableID === t.TableID);
      if (!items.length) return;
      const free = t.Status === 'Available';
      html += `
        <div class="queue-group">
          <div class="queue-group-head">
            <strong>โต๊ะ #${t.TableID}</strong>
            <span class="muted">${escapeHtml(t.Zone)}, ${t.Capacity} คน</span>
            <span class="badge ${free ? 'badge-free' : 'badge-busy'}">${free ? 'ว่างแล้ว — เรียกคิวได้' : 'ไม่ว่าง — รอเช็คเอาท์'}</span>
            ${free ? `
            <div class="queue-actions">
              <select class="seat-pkg" aria-label="แพ็กเกจเวลา">${pkgOptions}</select>
              <button type="button" class="btn-primary-sm" data-seat-table="${t.TableID}">เรียกคิวแรกเข้านั่ง</button>
            </div>` : ''}
          </div>
          ${listHtml(items)}
        </div>`;
    });

    // คิวรวม (ไม่ระบุโต๊ะ / คิวเก่าก่อนอัปเดต)
    const general = state.queue.filter(q => q.TableID === null || q.TableID === undefined);
    if (general.length) {
      const freeTables = state.tables.filter(t => t.Status === 'Available' && tableWaiting(state, t.TableID) === 0);
      html += `
        <div class="queue-group">
          <div class="queue-group-head">
            <strong>คิวรวม</strong>
            <span class="muted">ไม่ระบุโต๊ะ — ได้โต๊ะไหนว่างก่อนก็ได้</span>
            ${freeTables.length ? `
            <div class="queue-actions">
              <select class="seat-table" aria-label="โต๊ะว่าง">${freeTables.map(t => `<option value="${t.TableID}">โต๊ะ #${t.TableID} (${escapeHtml(t.Zone)}, ${t.Capacity} คน)</option>`).join('')}</select>
              <select class="seat-pkg" aria-label="แพ็กเกจเวลา">${pkgOptions}</select>
              <button type="button" class="btn-primary-sm" data-seat-table="general">เรียกคิวแรกเข้านั่ง</button>
            </div>` : '<span class="badge badge-busy">รอโต๊ะว่าง</span>'}
          </div>
          ${listHtml(general)}
        </div>`;
    }

    box.innerHTML = html;
  }

  document.addEventListener('input', (e) => {
    if (e.target.id === 'rental-nid') {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 13); // รับเฉพาะตัวเลข
    }
  });

  /* ================= Rentals (บิลเช่า + คืนเกม) ================= */
  function renderRentals(state) {
    const tbody = $('rentals-body');
    if (!tbody || !state.rentals) return;

    const active = state.rentals.filter(r => r.Status !== 'Returned');
    if ($('rent-active')) $('rent-active').textContent = active.length;
    if ($('rent-overdue')) $('rent-overdue').textContent = active.filter(r => r.IsOverdue).length;

    const sig = JSON.stringify(state.rentals.map(r => [r.RentalID, r.Status, r.IsOverdue, r.OverdueDays]));
    if (tbody.dataset.sig === sig) return;
    tbody.dataset.sig = sig;

    const empty = !state.rentals.length;
    if ($('rentals-empty')) $('rentals-empty').hidden = !empty;
    if ($('rentals-table')) $('rentals-table').hidden = empty;

    tbody.innerHTML = state.rentals.map(r => {
      const returned = r.Status === 'Returned';
      const status = returned
        ? `<span class="badge badge-free">คืนแล้ว</span><div class="muted">${fmtDate(r.ReturnDate)} · ${escapeHtml(r.ReturnCondition || '-')} · คืนมัดจำ ${money(r.DepositRefunded)}</div>`
        : `<span class="badge">กำลังเช่า</span>${r.IsOverdue ? `<span class="badge overdue">เกินกำหนด${r.OverdueDays ? ' ' + r.OverdueDays + ' วัน' : ''}</span>` : ''}`;
      const action = returned ? '<span class="empty">-</span>' : `
        <div class="return-controls">
          <select class="ret-cond" aria-label="สภาพเกมตอนคืน">
            <option value="ปกติ">ปกติ</option>
            <option value="ชำรุด">ชำรุด</option>
            <option value="ชิ้นส่วนหาย">ชิ้นส่วนหาย</option>
          </select>
          <label class="ret-deposit-label">คืนมัดจำ
            <input type="number" class="ret-deposit" min="0" max="${Number(r.Deposit)}" step="1" value="${Number(r.Deposit)}">
          </label>
          <button type="button" class="btn-primary-sm" data-return-rental="${r.RentalID}">คืนเกม</button>
        </div>`;
      return `<tr class="${r.IsOverdue && !returned ? 'status-busy' : ''}">
        <td>#${r.RentalID}</td>
        <td>${escapeHtml(r.FirstName)} ${escapeHtml(r.LastName)}<div class="muted">${escapeHtml(r.Phone)}</div></td>
        <td>${escapeHtml(r.GameName)}</td>
        <td>${fmtDate(r.RentalDate)}</td>
        <td>${fmtDate(r.DueDate)}</td>
        <td>${money(r.RentalFee)} / ${money(r.Deposit)}</td>
        <td>${status}</td>
        <td>${action}</td>
      </tr>`;
    }).join('');
  }

  /* ================= Form submits ================= */
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form || !form.id) return;

    // --- เล่นที่ร้าน: จองโต๊ะ หรือ เข้าคิว ---
    if (form.id === 'instore-form') {
      e.preventDefault();
      const msgEl = $('instore-msg');
      const btn = $('instore-submit');
      setMsg(msgEl, 'กำลังบันทึก...');
      if (btn) btn.disabled = true;
      try {
        const data = await postJson('/api/booking', {
          tableId: $('instore-table').value,
          packageId: $('instore-package').value,
          gameId: $('instore-game') ? $('instore-game').value : ''
        });
        setMsg(msgEl, data.message, data.ok ? (data.warning ? 'warn' : 'ok') : 'error');
        if (data.ok) {
          showToast(data.message, data.warning ? 'warn' : 'ok');
          if (role === 'customer') refreshMe(true);   // โชว์คิว/โต๊ะของฉันทันที ไม่ต้องรอรอบอัปเดต
          if ($('instore-game')) $('instore-game').value = '';
        }
      } catch (err) {
        setMsg(msgEl, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    // --- เช่ากลับบ้าน (ลูกค้าเช่าจากบัญชีตัวเอง) ---
    if (form.id === 'rental-form') {
      e.preventDefault();
      const msgEl = $('rental-msg');
      const nidRow = $('rental-nid-row');
      const needNid = nidRow && !nidRow.hidden;
      const nid = needNid ? $('rental-nid').value.trim() : '';
      if (needNid && !/^\d{13}$/.test(nid)) {
        setMsg(msgEl, 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก', 'error');
        $('rental-nid').focus();
        return;
      }
      const btn = $('rental-submit');
      setMsg(msgEl, 'กำลังบันทึก...');
      if (btn) btn.disabled = true;
      try {
        const data = await postJson('/api/rent', {
          nationalId: nid,
          gameId: $('rental-game').value,
          dueDate: $('rental-due').value
        });
        setMsg(msgEl, data.message, data.ok ? 'ok' : 'error');
        if (data.ok) {
          showToast(data.message, 'ok');
          if (needNid) setNidRegistered(true);   // บันทึกเลขบัตรแล้ว ครั้งต่อไปไม่ต้องกรอก
          refreshMe(true);
        } else if (data.field === 'nationalId') {
          setNidRegistered(false);
          $('rental-nid').focus();
        }
      } catch (err) {
        setMsg(msgEl, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error');
      } finally {
        if (btn) btn.disabled = false;
        updateRentalSummary();
      }
    }
  });

  function setNidRegistered(registered) {
    const row = $('rental-nid-row'), input = $('rental-nid'), note = $('rental-nid-note');
    if (!row) return;
    row.hidden = registered;
    input.required = !registered;
    if (registered) input.value = '';
    if (note) {
      note.className = 'field-note' + (registered ? ' ok' : '');
      note.textContent = registered
        ? '✓ บัญชีของคุณลงทะเบียนเลขบัตรประชาชนแล้ว — เช่าได้เลย'
        : 'การเช่ากลับบ้านต้องใช้เลขบัตรประชาชน 13 หลัก กรอกครั้งแรกครั้งเดียว (พนักงานจะตรวจบัตรตอนรับเกม)';
    }
  }

  /* ================= Buttons (delegated — ใช้ได้กับแถวที่วาดใหม่) ================= */
  async function runButton(btn, url, body) {
    btn.disabled = true;
    try {
      const data = await postJson(url, body);
      showToast(data.message, data.ok ? 'ok' : 'error');
      return data;
    } catch (err) {
      showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  document.addEventListener('click', async (e) => {
    const target = e.target;

    // ลูกค้าหยิบเกมเข้าโต๊ะของตัวเอง
    const myBorrow = target.closest('[data-my-borrow]');
    if (myBorrow) {
      const res = await runButton(myBorrow, '/api/my/borrow', { gameId: myBorrow.dataset.myBorrow });
      refreshMe(true);
      return res;
    }

    // ลูกค้าคืนเกมของโต๊ะตัวเอง: กดครั้งแรกให้ยืนยันก่อน
    const myReturn = target.closest('[data-my-return]');
    if (myReturn) {
      if (!myReturn.classList.contains('confirming')) {
        myReturn.classList.add('confirming');
        myReturn.textContent = 'กดอีกครั้งเพื่อยืนยันคืนเกม';
        setTimeout(() => {
          myReturn.classList.remove('confirming');
          myReturn.textContent = '↩ คืนเกมนี้';
        }, 3000);
        return;
      }
      const res = await runButton(myReturn, '/api/my/return-game', {});
      refreshMe(true);
      return res;
    }

    const returnBorrow = target.closest('[data-return-borrow-id]');
    if (returnBorrow) {
      return runButton(returnBorrow, '/api/return-game', { borrowId: returnBorrow.dataset.returnBorrowId });
    }

    const borrow = target.closest('[data-borrow-session]');
    if (borrow) {
      const select = borrow.closest('.pick-game').querySelector('.pick-game-select');
      if (!select.value) {
        showToast('เลือกเกมก่อนกด "หยิบเกม"', 'error');
        select.focus();
        return;
      }
      return runButton(borrow, '/api/borrow', { sessionId: borrow.dataset.borrowSession, gameId: select.value });
    }

    const extend = target.closest('[data-extend-session]');
    if (extend) {
      return runButton(extend, '/api/extend', {
        sessionId: extend.dataset.extendSession,
        packageId: extend.closest('.extend-box').querySelector('.extend-pkg').value
      });
    }

    const checkout = target.closest('[data-checkout-session-id]');
    if (checkout) {
      return runButton(checkout, '/api/checkout', { sessionId: checkout.dataset.checkoutSessionId });
    }

    const seat = target.closest('[data-seat-table]');
    if (seat) {
      const group = seat.closest('.queue-group');
      const tableId = seat.dataset.seatTable === 'general'
        ? group.querySelector('.seat-table').value
        : seat.dataset.seatTable;
      return runButton(seat, '/api/queue/seat-next', {
        tableId,
        packageId: group.querySelector('.seat-pkg').value
      });
    }

    // ยกเลิกคิว: กดครั้งแรกให้ยืนยันก่อน (กันกดพลาด)
    const cancel = target.closest('[data-cancel-queue]');
    if (cancel) {
      if (!cancel.classList.contains('confirming')) {
        cancel.classList.add('confirming');
        cancel.textContent = 'กดอีกครั้งเพื่อยืนยัน';
        setTimeout(() => {
          cancel.classList.remove('confirming');
          cancel.textContent = 'ยกเลิกคิว';
        }, 3000);
        return;
      }
      const res = await runButton(cancel, '/api/queue/cancel', { queueId: cancel.dataset.cancelQueue });
      if (role === 'customer') refreshMe(true);
      return res;
    }

    const returnRental = target.closest('[data-return-rental]');
    if (returnRental) {
      const row = returnRental.closest('tr');
      return runButton(returnRental, '/api/rent/return', {
        rentalId: returnRental.dataset.returnRental,
        condition: row.querySelector('.ret-cond').value,
        depositRefunded: row.querySelector('.ret-deposit').value
      });
    }
  });

  /* ================= ลูกค้า: สถานะของฉัน + บัญชีของฉัน ================= */
  let meLoading = false, meLastFetch = 0;
  async function refreshMe(force) {
    if (!$('my-status') && !$('me-profile') && !$('my-game-panel')) return;
    if (meLoading || (!force && Date.now() - meLastFetch < 1500)) return;
    meLoading = true;
    try {
      const resp = await fetch('/api/me');
      if (resp.ok) { renderMe(await resp.json()); meLastFetch = Date.now(); }
    } catch (err) { /* ลองใหม่รอบถัดไป */ } finally { meLoading = false; }
  }

  function renderMe(me) {
    if (!me || !me.profile) return;
    const p = me.profile;
    lastMe = me;
    renderMyGame();

    const profile = $('me-profile');
    if (profile) {
      profile.innerHTML = `
        <div class="me-name">👤 ${escapeHtml(p.FirstName)} ${escapeHtml(p.LastName)}</div>
        <div class="me-meta">
          <span>📱 ${escapeHtml(p.Phone)}</span>
          <span>⭐ <strong>${money(p.Points)}</strong> แต้ม</span>
          <span>สมาชิกตั้งแต่ ${fmtDate(p.CreatedDate)}</span>
          <span class="badge ${p.HasNationalID ? 'badge-free' : ''}">${p.HasNationalID ? 'ลงทะเบียนเช่ากลับบ้านแล้ว' : 'ยังไม่ได้ลงทะเบียนเช่ากลับบ้าน (กรอกเลขบัตรตอนเช่าครั้งแรก)'}</span>
        </div>`;
    }

    const status = $('my-status');
    if (status) {
      let html = '';
      if (me.active) {
        const a = me.active;
        const left = a.MinutesLeft !== null && a.MinutesLeft !== undefined ? Math.max(a.MinutesLeft, 0) : '-';
        html += `<div class="status-card is-playing">
          <div class="status-title">🪑 คุณกำลังเล่นที่โต๊ะ #${a.TableID} <span class="muted">(${escapeHtml(a.Zone)})</span></div>
          <div class="status-meta">${escapeHtml(a.PackageName)} · เริ่ม ${fmtTime(a.StartTime)} · เหลือเวลาประมาณ <strong>${left}</strong> นาที</div>
          <div class="status-meta">🎲 ${a.GameName ? 'กำลังเล่น <strong>' + escapeHtml(a.GameName) + '</strong>' : 'ยังไม่ได้หยิบเกม'} · <a href="/games">${a.GameName ? 'เปลี่ยนเกม' : 'เลือกบอร์ดเกม →'}</a></div>
        </div>`;
      }
      me.queue.forEach(q => {
        html += `<div class="status-card is-queued">
          <div class="status-title">🎫 คุณอยู่คิวที่ <strong>${q.Position}</strong> ${q.TableID ? 'ของโต๊ะ #' + q.TableID : '(คิวรวม)'}</div>
          <div class="status-meta">ลงคิวเมื่อ ${fmtTime(q.QueueTime)} · พนักงานจะเรียกเมื่อโต๊ะว่าง
            <button type="button" class="btn-link-danger" data-cancel-queue="${q.QueueID}">ยกเลิกคิว</button></div>
        </div>`;
      });
      me.rentals.filter(r => r.Status !== 'Returned').forEach(r => {
        html += `<div class="status-card is-rental${r.IsOverdue ? ' is-overdue' : ''}">
          <div class="status-title">🏠 เช่า <strong>${escapeHtml(r.GameName)}</strong> กลับบ้านอยู่ <span class="muted">(บิล #${r.RentalID})</span></div>
          <div class="status-meta">คืนภายใน <strong>${fmtDate(r.DueDate)}</strong>${r.IsOverdue ? ` · <span class="badge overdue">เกินกำหนด${r.OverdueDays ? ' ' + r.OverdueDays + ' วัน' : ''} — กรุณาคืนที่เคาน์เตอร์</span>` : ''} · มัดจำ ${money(r.Deposit)} บาท (ได้คืนตอนคืนเกม)</div>
        </div>`;
      });
      if (!html) {
        html = $('booking-card')
          ? '<p class="muted">ยังไม่มีการจอง — จองโต๊ะหรือเช่าเกมด้านล่างได้เลย</p>'
          : '<p class="muted">ยังไม่มีการจองตอนนี้ — <a href="/booking">จองโต๊ะ / เช่าเกม</a></p>';
      }
      if (status.dataset.html !== html) { status.innerHTML = html; status.dataset.html = html; }
    }

    // มีโต๊ะหรือคิวอยู่แล้ว → ซ่อนเฉพาะฟอร์มจองโต๊ะ (จองได้ทีละ 1) ยังเช่ากลับบ้านได้
    const busy = !!(me.active || me.queue.length);
    if ($('instore-form')) $('instore-form').hidden = busy;
    if ($('instore-busy-note')) $('instore-busy-note').hidden = !busy;
    if ($('rental-nid-row') && p.HasNationalID && !$('rental-nid-row').hidden) setNidRegistered(true);

    const sBody = $('me-sessions');
    if (sBody) {
      sBody.innerHTML = me.sessions.map(x => `<tr>
        <td>${fmtDate(x.StartTime)} ${fmtTime(x.StartTime)}</td>
        <td>#${x.TableID}</td>
        <td>${escapeHtml(x.PackageName)}</td>
        <td>${x.Games ? escapeHtml(x.Games) : '<span class="empty">-</span>'}</td>
        <td>${money(x.AmountPaid)}</td>
        <td><span class="badge ${x.Status === 'Active' ? 'badge-busy' : ''}">${x.Status === 'Active' ? 'กำลังเล่น' : 'เสร็จแล้ว'}</span></td>
      </tr>`).join('');
      $('me-sessions-table').hidden = !me.sessions.length;
      $('me-sessions-empty').hidden = !!me.sessions.length;
    }
    const rBody = $('me-rentals');
    if (rBody) {
      rBody.innerHTML = me.rentals.map(r => `<tr class="${r.IsOverdue ? 'status-busy' : ''}">
        <td>#${r.RentalID}</td>
        <td>${escapeHtml(r.GameName)}</td>
        <td>${fmtDate(r.RentalDate)}</td>
        <td>${fmtDate(r.DueDate)}</td>
        <td>${money(r.RentalFee)} / ${money(r.Deposit)}</td>
        <td>${r.Status === 'Returned'
          ? '<span class="badge badge-free">คืนแล้ว</span>'
          : '<span class="badge">กำลังเช่า</span>' + (r.IsOverdue ? '<span class="badge overdue">เกินกำหนด</span>' : '')}</td>
      </tr>`).join('');
      $('me-rentals-table').hidden = !me.rentals.length;
      $('me-rentals-empty').hidden = !!me.rentals.length;
    }
  }

  // วาดหน้าทันทีจากข้อมูลที่เซิร์ฟเวอร์ฝังมา (ไม่ต้องรอ socket)
  if (window.__me) renderMe(window.__me);
  if (window.__initialState) applyState(window.__initialState);
})();
