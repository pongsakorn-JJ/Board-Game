/* หน้า "จัดการข้อมูล" (แอดมิน) — เพิ่ม / แก้ไข / ลบ ข้อมูลใน SQL Server
   - ตาราง/ฟอร์มสร้างจากนิยามใน services/adminData.js (window.__adminMeta)
   - ดึงข้อมูลใหม่ทุกครั้งที่ Socket.IO แจ้งอัปเดต (ทุก ~3 วินาที + ทันทีหลังมีคนแก้ข้อมูล)
   - ไม่วาดตารางใหม่ถ้าข้อมูลไม่เปลี่ยน / แถวที่เพิ่งเปลี่ยนจะกระพริบให้เห็น */
(function () {
  const META = window.__adminMeta;
  if (!META) return;
  const $ = (id) => document.getElementById(id);

  const DIFF = { Easy: 'ง่าย', Medium: 'ปานกลาง', Hard: 'ยาก' };
  const QSTATUS = { Waiting: 'รอคิว', Seated: 'ได้โต๊ะแล้ว', Cancelled: 'ยกเลิก' };

  let current = META[window.__adminStart] ? window.__adminStart : 'customers';
  let data = { rows: [], lookups: {} };
  let lastSig = '';
  let prevRowSig = new Map();   // ข้อมูลรอบก่อน (ไว้หาแถวที่เพิ่งเปลี่ยน)
  let flashIds = new Set();
  let loading = false, pending = false;

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

  function toast(message, kind) {
    const area = $('toast-area');
    if (!area) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = message;
    area.appendChild(el);
    setTimeout(() => el.classList.add('toast-out'), 3500);
    setTimeout(() => el.remove(), 4000);
  }

  async function api(method, url, body) {
    const resp = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    if (resp.status === 401) {
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
      return { ok: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    }
    try { return await resp.json(); } catch (e) { return { ok: false, message: 'เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (' + resp.status + ')' }; }
  }

  /* ---------------- แสดงค่าในแต่ละคอลัมน์ ---------------- */
  function cell(col, row) {
    const v = row[col.key];
    let html;
    switch (col.fmt) {
      case 'id': html = `<strong>#${esc(v)}</strong>`; break;
      case 'num': html = money(v); break;
      case 'money': html = money(v) + ' ฿'; break;
      case 'nid': html = v ? `<span title="${esc(v)}">•••••••••${esc(String(v).slice(-4))}</span>` : '<span class="empty">-</span>'; break;
      case 'yesno': html = v ? '<span class="badge badge-free">มี</span>' : '<span class="badge">ไม่มี</span>'; break;
      case 'img': html = `<img class="admin-thumb" src="${esc(v || '/images/games/default.svg')}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/images/games/default.svg'">`; break;
      case 'players': html = `${esc(row.MinPlayer)}–${esc(row.MaxPlayer)} คน`; break;
      case 'difficulty': html = esc(DIFF[v] || v || '-'); break;
      case 'stock': html = `<span class="badge ${row.AvailableQty > 0 ? 'badge-free' : 'badge-busy'}">${esc(row.AvailableQty)} / ${esc(row.TotalQty)}</span>`; break;
      case 'minutes': html = v == null ? 'เหมาวัน' : `${esc(v)} นาที`; break;
      case 'table': html = v ? `โต๊ะ #${esc(v)}` : '<span class="muted">คิวรวม</span>'; break;
      case 'tableStatus': html = v === 'Available' ? '<span class="badge badge-free">ว่าง</span>' : '<span class="badge badge-busy">ไม่ว่าง</span>'; break;
      case 'sessionStatus': html = v === 'Active' ? '<span class="badge badge-busy">กำลังเล่น</span>' : '<span class="badge">เสร็จแล้ว</span>'; break;
      case 'queueStatus': html = `<span class="badge ${v === 'Waiting' ? 'badge-busy' : ''}">${esc(QSTATUS[v] || v)}</span>`; break;
      case 'rentalStatus':
        html = v === 'Returned' ? '<span class="badge badge-free">คืนแล้ว</span>'
          : '<span class="badge">กำลังเช่า</span>' + (row.IsOverdue ? ' <span class="badge overdue">เกินกำหนด</span>' : '');
        break;
      default: html = (v === null || v === undefined || v === '') ? '<span class="empty">-</span>' : esc(v);
    }
    if (col.sub && row[col.sub]) html += `<div class="muted">${esc(row[col.sub])}</div>`;
    return html;
  }

  /* ---------------- วาดตาราง ---------------- */
  function render(force) {
    const m = META[current];
    const q = $('admin-search').value.trim().toLowerCase();
    const rows = q
      ? data.rows.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(q)))
      : data.rows;

    const sig = JSON.stringify([current, q, rows]);
    if (!force && sig === lastSig) return;
    lastSig = sig;

    $('admin-count').textContent = q ? `พบ ${rows.length} จาก ${data.rows.length} รายการ` : `${data.rows.length} รายการ`;
    $('admin-head').innerHTML = '<tr>' + m.columns.map(c => `<th>${esc(c.label)}</th>`).join('') + '<th>จัดการ</th></tr>';

    const body = $('admin-body');
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${m.columns.length + 1}" class="empty">${q ? 'ไม่พบข้อมูลที่ค้นหา' : 'ยังไม่มีข้อมูลในตารางนี้'}</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(r => {
      const id = r[m.pk];
      const changed = flashIds.has(String(id));   // แถวใหม่/แถวที่เพิ่งถูกแก้
      return `<tr data-id="${esc(id)}" class="${changed ? 'row-flash' : ''}">
        ${m.columns.map(c => `<td>${cell(c, r)}</td>`).join('')}
        <td class="admin-actions">
          <button type="button" class="btn-edit" data-edit="${esc(id)}">✏️ แก้ไข</button>
          <button type="button" class="btn-delete" data-delete="${esc(id)}">🗑 ลบ</button>
        </td>
      </tr>`;
    }).join('');
    flashIds = new Set();
  }

  async function load() {
    if (loading) { pending = true; return; }
    loading = true;
    const key = current;
    try {
      const res = await api('GET', '/api/admin/' + key);
      if (key !== current) return;           // ผู้ใช้เปลี่ยนแท็บระหว่างโหลด
      if (!res.ok) {
        $('admin-error').hidden = false;
        $('admin-error').textContent = res.message || 'โหลดข้อมูลไม่สำเร็จ';
        return;
      }
      $('admin-error').hidden = true;
      const next = new Map(res.rows.map(r => [String(r[META[key].pk]), JSON.stringify(r)]));
      if (prevRowSig.size) next.forEach((sig, id) => { if (prevRowSig.get(id) !== sig) flashIds.add(id); });
      prevRowSig = next;
      data = res;
      $('admin-updated').textContent = new Date().toLocaleTimeString('th-TH');
      render();
    } catch (err) {
      $('admin-error').hidden = false;
      $('admin-error').textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
    } finally {
      loading = false;
      if (pending) { pending = false; load(); }
    }
  }

  function selectEntity(key, push) {
    if (!META[key]) return;
    current = key;
    const m = META[key];
    data = { rows: [], lookups: {} };
    lastSig = ''; prevRowSig = new Map();
    document.querySelectorAll('#admin-tabs a').forEach(a => a.classList.toggle('active', a.dataset.entity === key));
    $('admin-title').textContent = `${m.icon} ${m.label}`;
    $('admin-add').hidden = !m.canCreate;
    $('admin-add').textContent = '+ เพิ่ม' + m.label;
    const note = $('admin-note');
    note.hidden = m.canCreate;
    note.textContent = m.canCreate ? '' : `${m.label}เกิดจากการจองของลูกค้า — แอดมินแก้ไขหรือลบได้ (เพิ่มใหม่ที่หน้าลูกค้า)`;
    $('admin-search').value = '';
    $('admin-body').innerHTML = `<tr><td class="empty">กำลังโหลดข้อมูลจากฐานข้อมูล...</td></tr>`;
    $('admin-head').innerHTML = '';
    if (push) history.replaceState(null, '', '/admin/data?t=' + key);
    load();
  }

  /* ---------------- ฟอร์มเพิ่ม / แก้ไข ---------------- */
  let editingId = null;

  function fieldHtml(f, value) {
    const id = 'f-' + f.name;
    const req = f.required ? ' <span class="required-mark">*</span>' : ' <span class="optional">(ไม่บังคับ)</span>';
    const v = value === null || value === undefined ? '' : value;
    const common = `id="${id}" name="${esc(f.name)}" ${f.required ? 'required' : ''}`;
    let input;
    switch (f.type) {
      case 'textarea':
        input = `<textarea ${common} rows="${f.rows || 3}" maxlength="${f.maxLength || ''}">${esc(v)}</textarea>`;
        break;
      case 'select': {
        const opts = f.options ? f.options.map(([val, label]) => ({ value: val, label }))
          : (data.lookups[f.lookup] || []);
        input = `<select ${common}>
          ${f.required ? '' : `<option value="">${esc(f.placeholder || '— ไม่ระบุ —')}</option>`}
          ${opts.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>`;
        break;
      }
      case 'int':
        input = `<input type="number" step="1" ${common} value="${esc(v)}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}>`;
        break;
      case 'money':
        input = `<input type="number" step="0.01" min="0" ${common} value="${esc(v)}">`;
        break;
      case 'datetime':
        input = `<input type="datetime-local" ${common} value="${esc(String(v).replace(' ', 'T').slice(0, 16))}">`;
        break;
      case 'date':
        input = `<input type="date" ${common} value="${esc(String(v).slice(0, 10))}">`;
        break;
      case 'password':
        input = `<input type="password" ${common.replace('required', '')} autocomplete="new-password" minlength="${f.minLength || ''}" placeholder="${editingId ? 'เว้นว่าง = ไม่เปลี่ยน' : ''}">`;
        break;
      default:
        input = `<input type="text" ${common} value="${esc(v)}" maxlength="${f.maxLength || ''}"
                   ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}
                   ${f.suggestions ? `list="${id}-list"` : ''}>`
          + (f.suggestions ? `<datalist id="${id}-list">${f.suggestions.map(s => `<option value="${esc(s)}">`).join('')}</datalist>` : '');
    }
    const wide = f.type === 'textarea' ? ' wide' : '';
    return `<label class="admin-field${wide}" data-field="${esc(f.name)}">
      <span class="label-text">${esc(f.label)}${req}</span>
      ${input}
      ${f.help ? `<small class="field-help">${esc(f.help)}</small>` : ''}
    </label>`;
  }

  function openEdit(id) {
    const m = META[current];
    editingId = id;
    const row = id ? data.rows.find(r => String(r[m.pk]) === String(id)) : null;
    if (id && !row) { toast('ไม่พบข้อมูลนี้แล้ว (อาจถูกลบไปก่อนหน้า)', 'error'); return; }
    $('edit-title').textContent = id ? `แก้ไข${m.label} #${id}` : `เพิ่ม${m.label}ใหม่`;
    $('edit-fields').innerHTML = m.fields.map(f => fieldHtml(f, row ? row[f.name] : f.default)).join('');
    $('edit-msg').className = 'form-msg';
    $('edit-msg').textContent = '';
    $('edit-dialog').showModal();
    const first = $('edit-fields').querySelector('input, select, textarea');
    if (first) first.focus();
  }

  function markField(name) {
    document.querySelectorAll('#edit-fields .admin-field').forEach(el => el.classList.toggle('has-error', el.dataset.field === name));
    const input = name && document.querySelector(`#edit-fields [name="${name}"]`);
    if (input) input.focus();
  }

  $('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = META[current];
    const body = {};
    m.fields.forEach(f => { const el = $('f-' + f.name); if (el) body[f.name] = el.value; });

    // เช็คช่องบังคับก่อนส่ง (เซิร์ฟเวอร์ตรวจซ้ำอีกรอบ)
    const missing = m.fields.find(f => f.required && !String(body[f.name] || '').trim());
    if (missing) {
      $('edit-msg').className = 'form-msg error';
      $('edit-msg').textContent = `กรุณากรอก "${missing.label}"`;
      markField(missing.name);
      return;
    }

    const btn = $('edit-save');
    btn.disabled = true;
    $('edit-msg').className = 'form-msg';
    $('edit-msg').textContent = 'กำลังบันทึกลงฐานข้อมูล...';
    try {
      const res = editingId
        ? await api('PUT', `/api/admin/${current}/${editingId}`, body)
        : await api('POST', `/api/admin/${current}`, body);
      if (res.ok) {
        $('edit-dialog').close();
        toast(res.message, 'ok');
        load();
      } else {
        $('edit-msg').className = 'form-msg error';
        $('edit-msg').textContent = res.message;
        markField(res.field);
      }
    } catch (err) {
      $('edit-msg').className = 'form-msg error';
      $('edit-msg').textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------------- ลบ (แสดงว่าจะลบอะไรบ้างก่อน) ---------------- */
  let deletingId = null;

  async function openDelete(id) {
    deletingId = id;
    const dlg = $('delete-dialog');
    $('delete-target').textContent = 'กำลังตรวจสอบข้อมูลที่ผูกอยู่...';
    $('delete-impact').innerHTML = '';
    $('delete-msg').textContent = '';
    $('delete-confirm').disabled = true;
    dlg.showModal();
    const res = await api('GET', `/api/admin/${current}/${id}/impact`);
    if (!res.ok) {
      $('delete-target').textContent = res.message;
      return;
    }
    $('delete-target').innerHTML = `ลบ <strong>${esc(res.title)}</strong> ออกจากฐานข้อมูล`;
    $('delete-impact').innerHTML = res.items.length
      ? `<p class="impact-head">ข้อมูลที่ผูกอยู่และจะถูกจัดการไปด้วย:</p>
         <ul class="impact-list">${res.items.map(it => `<li class="${it.warn ? 'warn' : ''}">${esc(it.label)}: <strong>${it.count}</strong> รายการ</li>`).join('')}</ul>`
      : '<p class="muted">ไม่มีข้อมูลอื่นผูกอยู่</p>';
    $('delete-msg').className = 'form-msg warn';
    $('delete-msg').textContent = 'ลบแล้วกู้คืนไม่ได้';
    $('delete-confirm').disabled = false;
  }

  $('delete-confirm').addEventListener('click', async () => {
    const btn = $('delete-confirm');
    btn.disabled = true;
    $('delete-msg').className = 'form-msg';
    $('delete-msg').textContent = 'กำลังลบ...';
    try {
      const res = await api('DELETE', `/api/admin/${current}/${deletingId}`);
      if (res.ok) {
        $('delete-dialog').close();
        toast(res.message, 'ok');
        load();
      } else {
        $('delete-msg').className = 'form-msg error';
        $('delete-msg').textContent = res.message;
        btn.disabled = false;
      }
    } catch (err) {
      $('delete-msg').className = 'form-msg error';
      $('delete-msg').textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
      btn.disabled = false;
    }
  });

  /* ---------------- events ---------------- */
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('#admin-tabs a[data-entity]');
    if (tab) { e.preventDefault(); selectEntity(tab.dataset.entity, true); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) return openEdit(edit.dataset.edit);
    const del = e.target.closest('[data-delete]');
    if (del) return openDelete(del.dataset.delete);
    const close = e.target.closest('[data-close-dialog]');
    if (close) close.closest('dialog').close();
  });
  $('admin-add').addEventListener('click', () => {
    // ฟอร์มที่มี dropdown จากฐานข้อมูล (หมวด/โต๊ะ) ใช้ lookups ล่าสุดที่โหลดมาแล้ว
    openEdit(null);
  });
  $('admin-search').addEventListener('input', () => render());

  // อัปเดตเรียลไทม์: realtime.js ยิง event ทุกครั้งที่ได้สถานะใหม่จาก Socket.IO
  document.addEventListener('bgc:state', () => load());

  selectEntity(current, false);
})();
