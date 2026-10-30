/* 3D บอร์ดเกม (Three.js) — พรีวิว 3D บนการ์ดเกม + หน้าต่างส่อง 3D แบบเต็ม (หมุน 360° / ซูม / แยกชิ้นส่วน)
   ต้องโหลด three.min.js + OrbitControls.js ก่อนไฟล์นี้ (ดู games.ejs) — ถ้าโหลดไม่ได้หรือไม่มี WebGL
   การ์ดจะแสดงรูปปก 2 มิติตามเดิม ไม่พัง
   โมเดลสำเร็จรูป: carcassonne, catan, codenames, ticket to ride, uno (จับคู่จากชื่อเกม)
   เกมอื่นที่เพิ่มทีหลังจะได้กล่อง 3D ทั่วไปที่ติดชื่อเกมบนหน้าปก */
(function () {
  'use strict';
  if (typeof THREE === 'undefined' || !THREE.OrbitControls) return;
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl') || probe.getContext('experimental-webgl'))) return;

  const LANG = window.__lang === 'en' ? 'en' : 'th';
  const T = (key, vars) => I18n.t(LANG, key, vars);
  const REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAX_PREVIEWS = 12;                     // จำกัดจำนวน WebGL context บนหน้า (เบราว์เซอร์รับได้ ~16)
  const role = window.__user && window.__user.role;

  const slugOf = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  /* รายการอุปกรณ์ในกล่อง (แสดงเฉพาะเกมที่มีโมเดลสำเร็จรูป) */
  const COMPONENTS = {
    carcassonne: [
      'กล่องเกม Carcassonne: Inns & Cathedrals สีฟ้าสดใส',
      'แผ่นไทล์แผนที่เมือง ปราสาท ถนน และมหาวิหาร 3D',
      'ตัวเดินไม้ Meeple 3D ขอบมน 5 สี (แดง, น้ำเงิน, เขียว, เหลือง, ดำ)'
    ],
    catan: [
      'กล่องเกม CATAN สีแดง-ส้มพร้อมภาพอาทิตย์อัสดง',
      'กระดานเกาะหกเหลี่ยมพร้อมภูมิประเทศ 3D (ภูเขา, ป่าสน, ทุ่งข้าว, บ่ออิฐ)',
      'เหรียญตัวเลข, โมเดลบ้าน/เมือง 3D, การ์ดทรัพยากร และลูกเต๋าคู่'
    ],
    codenames: [
      'กล่องเกม CODENAMES สีม่วง-ทอง ลายเงาสายลับ',
      'ตารางการ์ดคำศัพท์รหัสลับ 25 ใบบนโต๊ะ',
      'การ์ดสายลับสีแดง/น้ำเงิน, มือสังหารสีดำ และแท่นวางผังรหัสลับ (Key Stand)'
    ],
    tickettoride: [
      'กล่องเกม Ticket to Ride ลายหัวรถจักรไอน้ำวินเทจ',
      'กระดานแผนที่เส้นทางรถไฟเชื่อมเมืองสำคัญ',
      'ขบวนตู้รถไฟ 3D มีล้อและปล่องไฟหลากสี พร้อมกองตั๋วภารกิจ'
    ],
    uno: [
      'กล่องไพ่ UNO สีแดง Mattel พร้อมฝาติ่งแขวนเจาะรูด้านบนตามของจริง',
      'สำรับไพ่ UNO 4 สี (แดง, เหลือง, เขียว, น้ำเงิน) และไพ่ Wild เปลี่ยนสี',
      'พัดไพ่ 3D ลอยตัวที่กางออกให้เห็นหน้าไพ่ทุกใบชัดเจน'
    ]
  };
  const KNOWN = Object.keys(COMPONENTS);

  /* ---------------------------------------------------------
     รูปถ่ายกล่องจริง (public/images/games/3d/) — ตัดหน้ากล่อง/สันกล่องจากภาพถ่ายและปรับมุมมองให้ตรงแล้ว
     aspect = กว้าง/สูงของหน้ากล่อง, depth = ความหนากล่อง/ความสูง, color = สีด้านที่ไม่มีรูป
     ถ้าไฟล์รูปหาย/โหลดไม่ได้ จะใช้ปกที่วาดด้วย canvas แทนอัตโนมัติ
     --------------------------------------------------------- */
  const TEX_DIR = '/images/games/3d/';
  const REAL = {
    carcassonne: { aspect: 0.63, depth: 0.28, color: 0x3a78b8, side: true },
    catan: { aspect: 0.828, depth: 0.28, color: 0xa82a1a },
    codenames: { aspect: 0.717, depth: 0.22, color: 0x8c2a6e },
    tickettoride: { aspect: 0.937, depth: 0.26, color: 0xcfc6b4, side: true },
    uno: { aspect: 0.804, depth: 0.16, color: 0xd3201f, h: 2.15, hanger: 0.96 }
  };
  const texCache = {};
  function loadTexture(file, apply) {
    const url = TEX_DIR + file;
    if (texCache[url]) { apply(texCache[url]); return; }
    new THREE.TextureLoader().load(url, (tex) => { tex.anisotropy = 8; texCache[url] = tex; apply(tex); }, undefined, () => { /* ไม่มีไฟล์: ใช้ปก canvas ต่อไป */ });
  }

  /* ---------------------------------------------------------
     หน้าปกกล่อง: วาดด้วย canvas (เกมที่ไม่รู้จักจะได้ปกไล่สี + ชื่อเกม)
     --------------------------------------------------------- */
  function hueOf(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360; return h; }

  function createCoverTexture(slug, name) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 640;
    const ctx = c.getContext('2d');

    if (slug === 'carcassonne') {
      const sky = ctx.createLinearGradient(0, 0, 0, 640);
      sky.addColorStop(0, '#4ea8de'); sky.addColorStop(0.55, '#bae6fd'); sky.addColorStop(1, '#3f6212');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, 512, 640);
      ctx.fillStyle = '#cbd5e1'; ctx.fillRect(140, 175, 220, 130);
      [[335, 165], [130, 210], [395, 240]].forEach(([x, y]) => {
        ctx.fillStyle = '#e2e8f0'; ctx.fillRect(x, y + 40, 48, 90);
        ctx.fillStyle = '#1e3a8a'; ctx.beginPath(); ctx.moveTo(x - 6, y + 40); ctx.lineTo(x + 24, y); ctx.lineTo(x + 54, y + 40); ctx.fill();
      });
      ctx.fillStyle = '#fef3c7'; ctx.fillRect(150, 355, 200, 135);
      ctx.fillStyle = '#991b1b'; ctx.beginPath(); ctx.moveTo(130, 365); ctx.lineTo(250, 265); ctx.lineTo(370, 365); ctx.fill();
      ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.ellipse(260, 565, 115, 38, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1e3a8a'; ctx.fillRect(75, 65, 362, 72);
      ctx.strokeStyle = '#facc15'; ctx.lineWidth = 4; ctx.strokeRect(75, 65, 362, 72);
      ctx.fillStyle = '#fde047'; ctx.font = 'bold 46px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('Carcassonne', 256, 115);
      ctx.fillStyle = '#0f172a'; ctx.font = 'italic bold 22px Georgia, serif'; ctx.fillText('Inns and Cathedrals', 290, 158);
      ctx.fillStyle = '#3b82f6'; ctx.fillRect(60, 520, 64, 84);
      ctx.strokeStyle = '#e2e8f0'; ctx.strokeRect(60, 520, 64, 84);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 40px Georgia'; ctx.fillText('1', 92, 572);
    } else if (slug === 'catan') {
      const bg = ctx.createLinearGradient(0, 0, 0, 640);
      bg.addColorStop(0, '#7f1d1d'); bg.addColorStop(0.45, '#dc2626'); bg.addColorStop(0.7, '#f59e0b'); bg.addColorStop(1, '#365314');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 640);
      ctx.fillStyle = '#fef08a'; ctx.beginPath(); ctx.arc(256, 375, 130, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#65a30d'; ctx.beginPath(); ctx.moveTo(0, 420); ctx.quadraticCurveTo(180, 380, 512, 450); ctx.lineTo(512, 640); ctx.lineTo(0, 640); ctx.fill();
      ctx.fillStyle = '#eab308'; ctx.beginPath(); ctx.moveTo(200, 470); ctx.quadraticCurveTo(360, 420, 512, 470); ctx.lineTo(512, 640); ctx.lineTo(180, 640); ctx.fill();
      ctx.fillStyle = '#fde047'; ctx.font = 'bold 104px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('CATAN', 256, 165);
      ctx.font = 'bold 24px sans-serif'; ctx.fillText('THE GAME', 256, 208);
    } else if (slug === 'codenames') {
      const rad = ctx.createRadialGradient(256, 360, 20, 256, 360, 340);
      rad.addColorStop(0, '#facc15'); rad.addColorStop(0.45, '#ea580c'); rad.addColorStop(1, '#581c87');
      ctx.fillStyle = rad; ctx.fillRect(0, 0, 512, 640);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 8;
      for (let r = 60; r < 340; r += 38) { ctx.beginPath(); ctx.arc(256, 360, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = '#09090b';
      ctx.fillRect(155, 290, 68, 250); ctx.beginPath(); ctx.arc(189, 255, 28, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(285, 270, 78, 270); ctx.beginPath(); ctx.arc(324, 235, 30, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('CODENAMES', 256, 125);
    } else if (slug === 'tickettoride') {
      const bg = ctx.createLinearGradient(0, 0, 0, 640);
      bg.addColorStop(0, '#fef3c7'); bg.addColorStop(0.6, '#fde68a'); bg.addColorStop(1, '#78350f');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 640);
      ctx.fillStyle = '#1e293b'; ctx.fillRect(140, 290, 240, 160);
      ctx.fillStyle = '#334155'; ctx.beginPath(); ctx.arc(320, 360, 68, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#991b1b'; ctx.fillRect(130, 430, 250, 36);
      ctx.fillStyle = '#b91c1c'; ctx.font = 'bold 54px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('TICKET TO RIDE', 256, 130);
    } else if (slug === 'uno') {
      ctx.fillStyle = '#dc2626'; ctx.fillRect(0, 0, 512, 640);
      ctx.save(); ctx.translate(256, 265); ctx.rotate(-0.28);
      ctx.fillStyle = '#09090b'; ctx.beginPath(); ctx.ellipse(0, 0, 210, 115, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#facc15'; ctx.font = '900 125px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('UNO', 0, 5);
      ctx.restore();
      [{ x: 55, c: '#eab308', t: '2' }, { x: 145, c: '#16a34a', t: '3' }, { x: 235, c: '#2563eb', t: '4' }, { x: 330, c: '#111827', t: 'W' }].forEach((cd) => {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(cd.x, 455, 110, 165);
        ctx.fillStyle = cd.c; ctx.fillRect(cd.x + 8, 463, 94, 149);
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cd.t, cd.x + 55, 550);
      });
    } else {
      // เกมอื่น: ปกไล่สีตามชื่อ + ชื่อเกม (ตัดบรรทัดอัตโนมัติ)
      const h = hueOf(slug || name);
      const bg = ctx.createLinearGradient(0, 0, 512, 640);
      bg.addColorStop(0, 'hsl(' + h + ',65%,45%)'); bg.addColorStop(1, 'hsl(' + ((h + 50) % 360) + ',60%,22%)');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 640);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 6; ctx.strokeRect(28, 28, 456, 584);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.font = 'bold 60px Kanit, sans-serif';
      const words = String(name || '').split(/\s+/); const lines = []; let line = '';
      words.forEach((w) => { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > 400 && line) { lines.push(line); line = w; } else line = test; });
      if (line) lines.push(line);
      const y0 = 320 - (lines.length - 1) * 38;
      lines.slice(0, 4).forEach((l, i) => ctx.fillText(l, 256, y0 + i * 76));
    }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  /* ---------------------------------------------------------
     โมเดล 3D ของเกม (กล่อง + อุปกรณ์บนโต๊ะ) — ชิ้นส่วนที่ registerPart ไว้จะแยกออกได้ใน Explode View
     --------------------------------------------------------- */
  function buildModel(slug, name) {
    const group = new THREE.Group();
    const parts = [];
    const known = KNOWN.indexOf(slug) >= 0;

    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.5, 0.22, 48), new THREE.MeshStandardMaterial({ color: 0x1e1b2e, roughness: 0.5, metalness: 0.2 }));
    base.position.y = -0.12; group.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.38, 0.035, 16, 64), new THREE.MeshBasicMaterial({ color: 0x8b5cf6 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -0.02; group.add(ring);

    function registerPart(mesh, explodeVec) {
      mesh.userData.origPos = mesh.position.clone();
      mesh.userData.explodeVec = explodeVec;
      parts.push(mesh); group.add(mesh);
    }

    const real = REAL[slug];
    const hue = hueOf(slug || name) / 360;
    const sideCol = real ? real.color : new THREE.Color().setHSL(hue, 0.55, 0.35);
    const sideMat = new THREE.MeshStandardMaterial({ color: sideCol, roughness: 0.4 });
    // วัสดุที่ใช้รูปถ่าย: color เทา ๆ กันภาพสว่างจ้าเกินจากแสงในฉาก
    const photoMat = (fallbackMap) => new THREE.MeshStandardMaterial({ map: fallbackMap || null, color: real ? 0xe2e2e2 : 0xffffff, roughness: 0.42 });
    const frontMat = photoMat(createCoverTexture(slug, name));
    const spineMat = real && real.side ? photoMat(null) : sideMat;
    if (real) {
      loadTexture(slug + '-front.jpg', (tex) => { frontMat.map = tex; frontMat.needsUpdate = true; });
      if (real.side) loadTexture(slug + '-side.jpg', (tex) => { spineMat.map = tex; spineMat.color.set(0xe2e2e2); spineMat.needsUpdate = true; });
    }
    // BoxGeometry: [+x, -x, +y, -y, +z(หน้ากล่อง), -z]
    const boxMats = [sideMat, spineMat, sideMat, sideMat, frontMat, sideMat];

    const isUno = slug === 'uno';
    const boxH = real && real.h ? real.h : 2.55;
    const boxW = real ? boxH * real.aspect : 2.1;
    const boxD = real ? boxH * real.depth : 0.72;
    const box = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxD), boxMats);
    // กล่องกว้างกว่าปกติ → ขยับไปทางซ้ายไม่ให้ทับอุปกรณ์บนโต๊ะ
    const bx = known ? -0.95 - Math.max(0, (boxW - 2.1) / 2) : 0;
    box.position.set(bx, boxH / 2, known ? -0.65 : 0);
    box.rotation.y = known ? 0.28 : 0.2;
    registerPart(box, new THREE.Vector3(known ? -0.7 : 0, known ? 0.9 : 0.4, known ? -0.6 : 0));
    group.userData.boxCenter = box.position.clone();
    group.userData.boxHeight = boxH;

    if (isUno) {
      // ฝาติ่งแขวนเจาะรูด้านบน (ใช้รูปส่วนบนของกล่องจริง)
      const hw = boxW * real.hanger;
      const hh = hw / 3.7;
      const hangerMat = photoMat(null);
      loadTexture('uno-hanger.jpg', (tex) => { hangerMat.map = tex; hangerMat.needsUpdate = true; });
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, 0.06), [sideMat, sideMat, sideMat, sideMat, hangerMat, sideMat]);
      hanger.position.set(bx, boxH + hh / 2, -0.65); hanger.rotation.y = 0.28;
      registerPart(hanger, new THREE.Vector3(-0.7, 1.35, -0.6));
    }

    if (slug === 'carcassonne') {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const tile = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.68), new THREE.MeshStandardMaterial({ color: (r + c) % 2 === 0 ? 0x65a30d : 0x84cc16, roughness: 0.4 }));
        tile.position.set(0.35 + c * 0.72, 0.05, -0.35 + r * 0.72);
        registerPart(tile, new THREE.Vector3((c - 1) * 0.4, 0.55 + (r + c) * 0.15, (r - 1) * 0.4));
      }
      [0xef4444, 0x3b82f6, 0xeab308, 0x22c55e, 0x111827].forEach((col, idx) => {
        const m = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.12), new THREE.MeshStandardMaterial({ color: col }));
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), new THREE.MeshStandardMaterial({ color: col }));
        head.position.y = 0.18; m.add(body, head);
        m.position.set(0.35 + (idx % 3) * 0.72, 0.24, -0.35 + Math.floor(idx / 2) * 0.72);
        registerPart(m, new THREE.Vector3(0.4, 1.3 + idx * 0.18, 0.4));
      });
    } else if (slug === 'catan') {
      const hexCoords = [[0, 0], [0.78, 0], [-0.78, 0], [0.39, 0.68], [-0.39, 0.68], [0.39, -0.68], [-0.39, -0.68]];
      const hexColors = [0xfacc15, 0x15803d, 0x65a30d, 0xb45309, 0x64748b, 0xca8a04, 0x16a34a];
      hexCoords.forEach(([hx, hz], idx) => {
        const hg = new THREE.Group();
        hg.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 6), new THREE.MeshStandardMaterial({ color: hexColors[idx], roughness: 0.45 })));
        const prop = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 8), new THREE.MeshStandardMaterial({ color: idx % 2 === 0 ? 0x475569 : 0x14532d }));
        prop.position.y = 0.2; hg.add(prop);
        hg.position.set(0.95 + hx, 0.06, 0.25 + hz);
        registerPart(hg, new THREE.Vector3(hx * 0.6, 0.75 + idx * 0.14, hz * 0.6));
      });
      [-0.2, 0.25].forEach((dx, i) => {
        const die = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        die.position.set(0.2 + dx, 0.14, 1.45);
        registerPart(die, new THREE.Vector3(dx, 1.5 + i * 0.2, 0.8));
      });
    } else if (slug === 'codenames') {
      const agentColors = [0xdc2626, 0x2563eb, 0xfef3c7, 0xdc2626, 0x111827, 0x2563eb, 0xfef3c7, 0xdc2626];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        const idx = (r * 4 + c) % agentColors.length;
        const card = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.36), new THREE.MeshStandardMaterial({ color: agentColors[idx], roughness: 0.3 }));
        card.position.set(0.25 + c * 0.58, 0.04, -0.35 + r * 0.44);
        registerPart(card, new THREE.Vector3((c - 1.5) * 0.35, 0.65 + (r * 4 + c) * 0.08, (r - 1) * 0.35));
      }
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.55, 0.12), new THREE.MeshStandardMaterial({ color: 0x1e293b }));
      stand.position.set(1.1, 0.3, 1.15); stand.rotation.x = -0.25;
      registerPart(stand, new THREE.Vector3(0.5, 1.4, 0.7));
    } else if (slug === 'tickettoride') {
      const mapBoard = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.07, 1.65), new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.5 }));
      mapBoard.position.set(0.95, 0.04, 0.25);
      registerPart(mapBoard, new THREE.Vector3(0.3, 0.35, 0.2));
      const trainColors = [0xdc2626, 0x2563eb, 0x16a34a, 0xeab308, 0x111827];
      for (let i = 0; i < 6; i++) {
        const tg = new THREE.Group();
        const col = trainColors[i % trainColors.length];
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.16), new THREE.MeshStandardMaterial({ color: col }));
        const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 12), new THREE.MeshStandardMaterial({ color: 0x1f2937 }));
        chimney.position.set(0.1, 0.12, 0); tg.add(body, chimney);
        tg.position.set(0.25 + (i % 3) * 0.65, 0.16, -0.15 + Math.floor(i / 3) * 0.65);
        tg.rotation.y = (i % 2) * 0.4 - 0.2;
        registerPart(tg, new THREE.Vector3((i - 2.5) * 0.3, 1.1 + i * 0.15, 0.4));
      }
    } else if (slug === 'uno') {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.32, 1.1), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.3 }));
      deck.position.set(0.55, 0.16, 0.45);
      registerPart(deck, new THREE.Vector3(0.2, 0.5, 0.3));
      [0xdc2626, 0xeab308, 0x16a34a, 0x2563eb, 0x9333ea].forEach((col, i) => {
        const card = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.98, 0.03), new THREE.MeshStandardMaterial({ color: col, roughness: 0.25 }));
        const angle = (i - 2) * 0.26;
        card.position.set(1.05 + (i - 2) * 0.34, 0.75 + Math.cos(angle) * 0.15, -0.15 + i * 0.08);
        card.rotation.z = -angle; card.rotation.y = -0.25;
        registerPart(card, new THREE.Vector3((i - 2) * 0.55, 1.15 + i * 0.15, 0.5));
      });
    }

    group.userData.parts = parts;
    group.userData.known = known;
    return group;
  }

  function disposeObject(root) {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    });
  }

  function addLights(scene, strong) {
    scene.add(new THREE.AmbientLight(0xffffff, strong ? 0.9 : 0.85));
    const key = new THREE.DirectionalLight(0xffffff, strong ? 1.25 : 1.1);
    key.position.set(strong ? 5 : 4, strong ? 8 : 7, strong ? 6 : 5);
    scene.add(key);
    if (strong) { const rim = new THREE.PointLight(0xa855f7, 1.4, 15); rim.position.set(-4, 3, -3); scene.add(rim); }
  }

  /* ---------------------------------------------------------
     พรีวิว 3D บนการ์ด (สร้างตอนการ์ดเลื่อนเข้าจอ และหยุดเรนเดอร์ตอนอยู่นอกจอ)
     --------------------------------------------------------- */
  const previews = [];
  let rafId = null;

  function openByCard(card) { openInspector(card); }

  function createPreview(card) {
    const cover = card.querySelector('.game-cover');
    const title = card.querySelector('.game-title');
    if (!cover || !title) return null;
    const name = title.textContent.trim();
    const slug = slugOf(name);

    const stage = document.createElement('div');
    stage.className = 'g3d-stage';
    cover.insertBefore(stage, cover.firstChild);
    cover.classList.add('is-3d');

    const hint = document.createElement('span');
    hint.className = 'g3d-hint';
    hint.textContent = T('🧊 ลากหมุน 3D ได้');
    cover.appendChild(hint);

    const w = stage.clientWidth || 300, h = stage.clientHeight || 190;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 50);
    camera.position.set(0, 2.9, 6.5);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    stage.appendChild(renderer.domElement);
    addLights(scene, false);
    const model = buildModel(slug, name);
    scene.add(model);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enableZoom = false; controls.enablePan = false;
    controls.target.set(0, 0.8, 0);

    // คลิก (ไม่ใช่ลาก) บนพรีวิว = เปิดหน้าต่างส่อง 3D
    let down = null;
    stage.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    stage.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) openByCard(card); down = null; });

    const p = { card, stage, scene, camera, renderer, model, controls, visible: false };
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        const nw = stage.clientWidth, nh = stage.clientHeight;
        if (nw && nh) { renderer.setSize(nw, nh); camera.aspect = nw / nh; camera.updateProjectionMatrix(); }
      }).observe(stage);
    }
    return p;
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    for (let i = 0; i < previews.length; i++) {
      const p = previews[i];
      if (!p.visible) continue;
      if (!REDUCE_MOTION) p.model.rotation.y += 0.0035;
      p.controls.update();
      p.renderer.render(p.scene, p.camera);
    }
    renderInspector();
  }

  function initPreviews() {
    const cards = Array.prototype.slice.call(document.querySelectorAll('.game-card[data-game-id]'));
    let count = 0;
    cards.forEach((card) => {
      const btn = card.querySelector('[data-open-3d]');
      if (btn) { btn.hidden = false; btn.addEventListener('click', () => openByCard(card)); }
      if (count >= MAX_PREVIEWS) return;
      const p = createPreview(card);
      if (!p) return;
      count++; previews.push(p);
    });
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => { const p = previews.find((x) => x.stage === en.target); if (p) p.visible = en.isIntersecting; });
      }, { rootMargin: '80px' });
      previews.forEach((p) => io.observe(p.stage));
    } else previews.forEach((p) => { p.visible = true; });
    if (!rafId) loop();
  }

  /* ---------------------------------------------------------
     หน้าต่างส่อง 3D แบบเต็ม (Inspector)
     --------------------------------------------------------- */
  let modal = null, insp = null;

  function buildModal() {
    modal = document.createElement('div');
    modal.className = 'g3d-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'g3d-title');
    modal.innerHTML =
      '<div class="g3d-panel">' +
        '<div class="g3d-view">' +
          '<div class="g3d-tools">' +
            '<div class="g3d-cams">' +
              '<button type="button" class="g3d-cam is-active" data-cam="overview">' + T('🔄 มุมมองรวม 360°') + '</button>' +
              '<button type="button" class="g3d-cam" data-cam="box">' + T('📦 ซูมดูกล่องสินค้า') + '</button>' +
              '<button type="button" class="g3d-cam" data-cam="board">' + T('🔍 มุดดูกระดาน & ตัวหมาก') + '</button>' +
            '</div>' +
            '<button type="button" class="g3d-explode" data-explode>' + T('💥 แยกชิ้นส่วน (Explode 3D)') + '</button>' +
          '</div>' +
          '<div class="g3d-canvas"></div>' +
          '<div class="g3d-help"><span>' + T('<b>คลิกซ้ายลาก:</b> หมุนรอบทิศ 360° · <b>ลูกกลิ้งเมาส์:</b> ซูมเข้า-ออก · <b>คลิกขวาลาก:</b> เลื่อนจุดโฟกัส') + '</span><span class="g3d-tag">Real-time 3D WebGL</span></div>' +
        '</div>' +
        '<div class="g3d-info">' +
          '<div class="g3d-head"><div><div class="g3d-cat" id="g3d-cat"></div><h2 id="g3d-title"></h2></div>' +
            '<button type="button" class="g3d-close" data-close aria-label="' + T('ปิด') + '">✕</button></div>' +
          '<div class="g3d-chips" id="g3d-chips"></div>' +
          '<p class="g3d-desc" id="g3d-desc"></p>' +
          '<div class="g3d-box" id="g3d-comp-box"><div class="g3d-box-title">' + T('🧩 อุปกรณ์ภายในกล่อง (กดปุ่มด้านซ้ายเพื่อซูมส่องดีเทล)') + '</div><ul id="g3d-comp"></ul></div>' +
          '<div class="g3d-box g3d-box-howto" id="g3d-howto-box"><div class="g3d-box-title">📖 ' + T('วิธีเล่นแบบย่อ') + '</div><ol id="g3d-howto"></ol></div>' +
          '<div class="g3d-foot"><div class="g3d-price" id="g3d-price"></div><div class="g3d-actions" id="g3d-actions"></div></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close]')) return closeInspector();
      const cam = e.target.closest('[data-cam]');
      if (cam) return setCamera(cam.dataset.cam);
      if (e.target.closest('[data-explode]')) return toggleExplode();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal && !modal.hidden) closeInspector(); });
  }

  function openInspector(card) {
    if (!modal) buildModal();
    const name = card.querySelector('.game-title').textContent.trim();
    const slug = slugOf(name);
    const known = KNOWN.indexOf(slug) >= 0;
    const q = (sel) => modal.querySelector(sel);

    // ข้อมูลทั้งหมดดึงจากการ์ดจริง (ชื่อ/สต๊อก/ราคา/วิธีเล่นมาจากฐานข้อมูล และแปลภาษาแล้ว)
    const cat = card.querySelector('.game-meta .badge');
    q('#g3d-cat').textContent = cat ? cat.textContent : '';
    q('#g3d-cat').hidden = !cat;
    q('#g3d-title').textContent = name;
    const chips = q('#g3d-chips'); chips.innerHTML = '';
    card.querySelectorAll('.game-meta > span:not(.badge)').forEach((s) => { const c = document.createElement('span'); c.innerHTML = s.innerHTML; chips.appendChild(c); });
    const stock = card.querySelector('[data-stock]');
    if (stock) { const c = document.createElement('span'); c.className = 'g3d-stock' + (stock.classList.contains('out') ? ' out' : ''); c.textContent = stock.textContent.trim(); chips.appendChild(c); }
    q('#g3d-desc').textContent = card.querySelector('.game-desc').textContent;

    const compBox = q('#g3d-comp-box'), comp = q('#g3d-comp'); comp.innerHTML = '';
    if (known) COMPONENTS[slug].forEach((k) => { const li = document.createElement('li'); li.innerHTML = '<span>▸</span><span></span>'; li.lastChild.textContent = T(k); comp.appendChild(li); });
    compBox.hidden = !known;

    const howtoSrc = card.querySelector('.game-howto ol');
    const howtoBox = q('#g3d-howto-box');
    q('#g3d-howto').innerHTML = howtoSrc ? howtoSrc.innerHTML : '';
    howtoBox.hidden = !howtoSrc;

    q('#g3d-price').innerHTML = card.querySelector('.game-price').innerHTML;

    // ปุ่มลงมือ: ลูกค้า = หยิบเกมเข้าโต๊ะ (ถ้ามีโต๊ะ) / จองโต๊ะ ; ผู้ใช้ทั่วไป = เข้าสู่ระบบ ; พนักงานไม่แสดง
    const actions = q('#g3d-actions'); actions.innerHTML = '';
    if (role !== 'admin') {
      const pick = card.querySelector('[data-my-borrow]');
      const a1 = document.createElement(pick || role === 'customer' ? 'button' : 'a');
      a1.className = 'g3d-btn g3d-btn-primary';
      if (pick) { a1.type = 'button'; a1.textContent = T('🎲 เลือกเกมนี้ลงโต๊ะ'); a1.addEventListener('click', () => { closeInspector(); pick.click(); }); }
      else if (role === 'customer') { a1.type = 'button'; a1.textContent = T('จองโต๊ะก่อนเพื่อเลือกเกมนี้'); a1.addEventListener('click', () => { location.href = '/booking'; }); }
      else { a1.href = '/login?next=' + encodeURIComponent('/games'); a1.textContent = T('เข้าสู่ระบบเพื่อจอง'); }
      const a2 = document.createElement('a');
      a2.className = 'g3d-btn g3d-btn-rent';
      a2.href = role === 'customer' ? '/booking#rental' : '/login?next=' + encodeURIComponent('/booking');
      a2.textContent = T('🏠 เช่ากลับบ้าน');
      actions.append(a1, a2);
    }

    modal.hidden = false;
    document.body.classList.add('g3d-open');
    q('.g3d-close').focus();
    initInspector3D(slug, name, known);
  }

  function initInspector3D(slug, name, known) {
    const container = modal.querySelector('.g3d-canvas');
    container.innerHTML = '';
    const w = container.clientWidth || 600, h = container.clientHeight || 420;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    camera.position.set(0, 3.1, 6.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    addLights(scene, true);
    const model = buildModel(slug, name);
    scene.add(model);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.06; controls.minDistance = 1.6; controls.maxDistance = 11;
    controls.target.set(0, 0.85, 0);

    insp = { scene, camera, renderer, model, controls, known, exploded: false, target: 0, current: 0, desiredPos: null, desiredTarget: null,
      onResize: () => { const nw = container.clientWidth, nh = container.clientHeight; if (nw && nh) { renderer.setSize(nw, nh); camera.aspect = nw / nh; camera.updateProjectionMatrix(); } } };
    window.addEventListener('resize', insp.onResize);

    // ปุ่มที่ใช้ไม่ได้กับเกมที่ไม่มีอุปกรณ์ให้ส่อง
    modal.querySelector('[data-cam="board"]').hidden = !known;
    modal.querySelector('[data-explode]').hidden = model.userData.parts.length < 2;
    modal.querySelector('[data-explode]').textContent = T('💥 แยกชิ้นส่วน (Explode 3D)');
    setCamera('overview');
  }

  function setCamera(mode) {
    if (!insp) return;
    modal.querySelectorAll('[data-cam]').forEach((b) => b.classList.toggle('is-active', b.dataset.cam === mode));
    const box = insp.known;
    if (mode === 'overview') {
      // จอแคบ/สูง (มือถือ, หน้าต่างเล็ก) → ถอยกล้องออกให้เห็นโมเดลครบ
      const k = Math.min(1.9, Math.max(1, 1.35 / insp.camera.aspect));
      insp.desiredTarget = new THREE.Vector3(0, 0.85, 0);
      insp.desiredPos = new THREE.Vector3(0, 0.85 + 2.25 * k, 6.2 * k);
    }
    else if (mode === 'box') {
      const bc = insp.model.userData.boxCenter, bh = insp.model.userData.boxHeight || 2.55;
      insp.desiredTarget = new THREE.Vector3(bc.x, bh / 2, bc.z);
      const k = Math.min(1.7, Math.max(1, 1.2 / insp.camera.aspect));   // จอแคบ → ถอยกล้องออกให้เห็นกล่องครบ
      insp.desiredPos = box ? new THREE.Vector3(bc.x - 0.45 * k, bh / 2 + 0.4 * k, bc.z + 2.9 * k) : new THREE.Vector3(0.6, 1.7, 3.4);
    } else if (mode === 'board') { insp.desiredPos = new THREE.Vector3(1.45, 1.55, 2.15); insp.desiredTarget = new THREE.Vector3(0.85, 0.25, 0.25); }
  }

  function toggleExplode() {
    if (!insp) return;
    insp.exploded = !insp.exploded;
    insp.target = insp.exploded ? 1 : 0;
    modal.querySelector('[data-explode]').textContent = insp.exploded ? T('🔄 รวมชิ้นส่วนกลับ (Reset)') : T('💥 แยกชิ้นส่วน (Explode 3D)');
  }

  function renderInspector() {
    if (!insp) return;
    insp.current += (insp.target - insp.current) * 0.08;
    insp.model.userData.parts.forEach((part) => {
      part.position.lerpVectors(part.userData.origPos, part.userData.origPos.clone().add(part.userData.explodeVec), insp.current);
    });
    if (insp.desiredPos && insp.desiredTarget) {
      insp.camera.position.lerp(insp.desiredPos, 0.08);
      insp.controls.target.lerp(insp.desiredTarget, 0.08);
      if (insp.camera.position.distanceTo(insp.desiredPos) < 0.05) { insp.desiredPos = null; insp.desiredTarget = null; }
    }
    insp.controls.update();
    insp.renderer.render(insp.scene, insp.camera);
  }

  function closeInspector() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('g3d-open');
    if (insp) {
      window.removeEventListener('resize', insp.onResize);
      insp.controls.dispose();
      disposeObject(insp.scene);
      insp.renderer.dispose();
      if (insp.renderer.forceContextLoss) insp.renderer.forceContextLoss();
      insp.renderer.domElement.remove();
      insp = null;
    }
  }

  initPreviews();
})();
