# HANDOFF — Bluff Chain (Board-Game) สรุปงานสำหรับ session/คนถัดไป

อัปเดตล่าสุด: 2026-10-31 · ผู้ใช้สื่อสารภาษาไทย · ตอบสั้น กระชับ · ชอบคำสั่งรันสั้นๆ (`cd backend; npm run dev`)

## 1. ภาพรวมโปรเจกต์
- เว็บจัดการบอร์ดเกมคาเฟ่: Node.js + Express + EJS + SQL Server + Socket.IO (เรียลไทม์) — **ไม่มี frontend แยก** หน้าเว็บ (`frontend/views/*.ejs`, `frontend/public/{css,js,images}`) ถูกเสิร์ฟจาก `backend`
- โฟลเดอร์: `C:\Users\My PC\Desktop\Board_Game\Board-Game` (อย่าสับสนกับ `Board_Game` ชั้นนอก และโปรเจกต์อื่น `Desktop\MywebApp` ซึ่งเป็นร้านกีฬา Delux ไม่เกี่ยวข้อง)
- branch ปัจจุบัน: `Board_Design_admin_newUx/Ui` · `origin` = `pongsakorn-JJ/Board-Game` · remote เพิ่มเอง `everything` = `SanCyberHansome/Project_Everything`
- รัน: `cd backend; npm run dev` (nodemon; พอร์ตตาม `backend/.env`, ล่าสุด 3000) · แก้ `.ejs/.css/.js` ของ frontend แค่รีเฟรช (มี `?v=<mtime>` กัน cache อัตโนมัติ)
- DB: SQL Server `BoardGameCafeDB` (เปิด TCP/IP แล้ว, mixed mode) · `backend/.env` ถูก gitignore (มี password `sa`) — คนอื่นต้อง copy จาก `.env.example`
- บัญชี staff ตัวอย่าง (dev): `somchai` / `admin1234` · ลูกค้าสมัครเองได้ที่ /register

## 2. งานที่ทำแล้ว (และไฟล์สำคัญ)
**A) ระบบแปล TH/EN** (commit แล้ว `5f9fd5e`)
- ปุ่ม TH|EN ที่ header, cookie `lang`; ข้อความไทยเป็น "key" ถ้าไม่มีคำแปลจะแสดงไทย
- พจนานุกรมจริงอยู่ที่ `frontend/public/js/i18n.en.js` (`dict` ~650 รายการ + `patterns` regex) ← **แก้ที่นี่ตรงๆ** (เซิร์ฟเวอร์โหลดใหม่เองเมื่อไฟล์เปลี่ยน)
- แกนกลาง `frontend/public/js/i18n.js`; ฝั่งเซิร์ฟเวอร์ `backend/services/i18n.js` (AsyncLocalStorage, แปล `res.json`/`res.render`, route `/lang/:code`)
- ใช้: EJS `t('ไทย {x}', {x})` / `tr(ข้อมูลจาก DB)`; JS ฝั่งเบราว์เซอร์ `T()`/`TR()` (ใน `realtime.js`, `admin-data.js`, `games3d.js`, `box-editor.js`)
- โหมดไทยต้องเหมือนเดิมทุกตัวอักษร (เคยตรวจด้วย HTML diff)

**B) ดีไซน์** (ยังไม่ commit ทั้งหมด)
- หน้า login/สมัคร/เปลี่ยนรหัส: การ์ดกระจกใส + ขอบไล่สี + ไอคอนในช่อง (`auth-ui.js` ปุ่มดู/ซ่อนรหัส); หัวข้อหน้าปรับให้ขาวสว่างลอยเหนือเงาโลโก้ (ล่าสุด)
- Design system v2 (ท้ายไฟล์ `style.css`): IBM Plex Sans Thai ทั้งเว็บ, line-height 1.7, เรียบสะอาด
- Neon glass v3: หน้าจองโต๊ะ/บอร์ดเกม/บัญชีของฉัน (ขอบนีออน, ปุ่ม CTA เรืองแสง, หัวข้อมีไอคอน) — แยกเป็นหน้าๆ ไม่รวม 3 คอลัมน์
- `style.css` เรียงเป็นชั้นๆ ต่อท้ายกัน (ชั้นหลังทับชั้นก่อน): ธีมเดิม → neon → auth glass → v2 → v3 → 3D → box editor

**C) 3D บอร์ดเกม** (`frontend/public/js/games3d.js`, Three.js r128 จาก CDN cdnjs + jsdelivr OrbitControls)
- พรีวิว 3D บนการ์ด + หน้าต่างส่อง 360° (ซูม/แยกชิ้นส่วน/มุมกล้อง); ถ้า WebGL/CDN ใช้ไม่ได้ → กลับไปรูปปก 2D
- 5 เกมเดิมใช้รูปหน้ากล่องจริงที่ดัดมุมแล้ว `frontend/public/images/games/3d/*.jpg` (ทำด้วย Python/OpenCV นอก repo)
- มาตรฐานเดียวกันทุกเกม: หาสีเด่นจากรูปกล่อง → ตั้งตัวแปร CSS `--nc` ของการ์ด (ขอบ/แสง/ปุ่ม) + สีฐาน; ฐานแท่น 3 ชั้น วงแหวนนีออน แสงใต้แท่น อนุภาค
- เกมใหม่ที่ไม่มีรูป → กล่อง 3D ทั่วไปสีตามชื่อเกม; เกมที่มี `ImageUrl` เป็นรูปจริง → ใช้เป็นหน้ากล่อง (ปรับสัดส่วนตามรูป); ถ้ามีไฟล์ด้านข้างคู่กัน (`<hex>-sideL.jpg` / `-sideR.jpg`) → ใช้เป็นสันกล่อง + ความหนาตามสัดส่วนรูป

**D) แอดมินเพิ่มเกม → 3D อัตโนมัติ**
- ฟอร์มจัดการข้อมูล (บอร์ดเกม) ช่อง "รูปเกม": ปุ่ม 📤 อัปโหลดรูป, วาง URL ได้, ปุ่ม ✂️ ตัดแต่งรูปกล่อง
- อัปโหลด: `POST /api/admin/upload/game-image` (≤5MB, ตรวจชนิดจากไบต์จริง JPG/PNG/WEBP, ชื่อสุ่ม, เก็บ `frontend/public/images/games/uploads/` — gitignore) ; ด้านข้าง: `?sideOf=<url หน้ากล่อง>&at=L|R`
- ดึงรูปจาก URL ภายนอก: `POST /api/admin/upload/game-image-url` พร้อมตัวกัน SSRF (ปฏิเสธที่อยู่ภายใน, ตรวจ IP ตอนเชื่อมต่อ, พอร์ต 80/443, redirect ≤3, ≤5MB, 12 วิ) — จำเป็นเพราะ WebGL โหลดรูปข้ามโดเมนไม่ได้ (CORS)
- ตัวตัดแต่งรูป `frontend/public/js/box-editor.js`: ตรวจหา "หน้ากล่อง/ด้านข้าง" อัตโนมัติ (ตัดพื้นขาว, หาเส้นรอยต่อ, ลากเส้นขอบแบบทนค่าผิดปกติ) ผู้ใช้ลาก 4 มุมปรับได้, ดัดมุม (perspective warp) เป็นภาพตรง, ปรับความหนากล่อง → อัปโหลดผลลัพธ์
- เกม "Dead by Datlight" (GameID 7, ของผู้ใช้) ถูกตัดแต่งและบันทึกแล้ว: `ImageUrl=/images/games/uploads/7af4586bee28efe3.jpg` (+ `-sideR.jpg`)

**E) อื่นๆ**: `/booking#rental` เปิดแท็บเช่ากลับบ้าน · cache-busting `asset()` ใน `server.js` + `header/footer.ejs`

## 3. สถานะ git
- commit ล่าสุด `5f9fd5e` = ระบบแปล + auth glass + neon games + 3D viewer (รอบแรก)
- **ยังไม่ commit**: `.gitignore`, `backend/routes/admin.js`, `backend/server.js`, `backend/services/adminData.js`, `frontend/public/css/style.css`, `frontend/public/js/{admin-data,games3d,i18n.en}.js`, `frontend/public/js/box-editor.js` (ใหม่), `frontend/views/{admin-data,me}.ejs`, `frontend/views/partials/{header,footer}.ejs` (+ ไฟล์นี้)
- push ไป `everything` ติด 403 ตอนแรก (Git login เป็นบัญชี `tanawuttanun` ไม่ใช่ `SanCyberHansome`) — แนะนำตั้ง URL เป็น `https://SanCyberHansome@github.com/SanCyberHansome/Project_Everything.git` หรือเชิญเป็น collaborator ; เช็คด้วย `git ls-remote everything` (ยังไม่ทราบว่าสำเร็จหรือยัง)
- `git stash@{0}`: งาน sidebar/ไอคอนของ admin ที่ย้อนกลับตามคำขอ (ยังไม่ใช้)
- โปรเจกต์อื่น `MywebApp` มี branch `Board_Design_admin_newUx/Ui` ที่สร้างผิดที่ (เหมือน main) ลบได้ `git branch -d`

## 4. งานค้าง / ข้อเสนอถัดไป
1. commit งานที่ค้าง + push เข้า Project_Everything + เชิญ พน (pongsakorn) เป็น collaborator
2. ระดับ 3: อัปโหลดโมเดล `.glb` (ต้องเพิ่มคอลัมน์ `ModelUrl` ใน `tbl_boardgame` ด้วย `ALTER TABLE` — ระบบ upgrade อัตโนมัติรันแค่ CREATE OR ALTER ของ SP/View ไม่เพิ่มคอลัมน์ — + GLTFLoader)
3. ตัวตรวจอัตโนมัติของตัวตัดแต่งยังคลาดกับกล่องที่ขอบขาวครีมกลืนพื้นหลัง (เช่น Ticket to Ride ด้านข้างคลาด ~15%) ผู้ใช้ต้องลากมุมเอง
4. ถ้าร้านใช้ออฟไลน์: เก็บ Three.js ไว้ในเว็บเองแทน CDN (ยังไม่ได้ทำ ต้องขออนุญาตดาวน์โหลด)
5. รูป Catan ต้นฉบับ 280px ภาพนุ่ม ขอรูปใหญ่กว่านี้ได้

## 5. ข้อควรระวัง
- repo ใหม่เป็น Public แต่ README/SQL มีบัญชี staff เริ่มต้น — เปลี่ยนก่อนใช้งานจริง
- รูปใน `uploads/` ไม่อยู่ใน git (เครื่องอื่นไม่เห็น) และรูปเก่าไม่ถูกลบเมื่อเปลี่ยนรูป
- Git Bash บน Windows แปลง argument ที่ขึ้นต้นด้วย `/` เป็น path — ตอนทดสอบ API ด้วย node ให้ตั้ง `MSYS_NO_PATHCONV=1`
- ผู้ใช้มักรันคำสั่งผิดโฟลเดอร์ (`Board_Game` vs `Board_Game\Board-Game`) — ใส่ `cd` เต็มในคำสั่งเสมอ
- auto-mode เคยปฏิเสธ: เพิ่ม git remote, ปิด process ของผู้ใช้ (พอร์ต 3000) → ให้ผู้ใช้รันเอง
- วิธีทดสอบที่ใช้: รัน test server `PORT=3010 node server.js` แล้วปิดเอง (อย่าแตะพอร์ต 3000 ของผู้ใช้), login staff ด้วยบัญชีตัวอย่าง, สร้างข้อมูลทดสอบแล้ว**ลบทิ้งทุกครั้ง** (ลูกค้า/เกมทดสอบ/ไฟล์ใน uploads)
- สคริปต์ที่ใช้สร้างงานอยู่นอก repo (scratchpad) เช่น สคริปต์ดัดมุมรูปด้วย Python/OpenCV (`C:\Users\My PC\AppData\Local\Programs\Python\Python313`) — ถ้าจะทำรูปกล่องเกมใหม่ ใช้ตัวตัดแต่งในหน้าแอดมินแทนได้
