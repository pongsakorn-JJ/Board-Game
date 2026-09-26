const express = require('express');
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const session = require('express-session');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const authRoutes = require('./routes/auth');
const indexRoutes = require('./routes/index');
const adminRoutes = require('./routes/admin');
const realtime = require('./services/realtime');

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(express.static(__dirname + '/public'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));   // ฟอร์ม login / สมัครสมาชิก

// ---- Session (จำว่าใครล็อกอินอยู่) ----
// ถ้าไม่ได้ตั้ง SESSION_SECRET ใน .env จะสุ่มใหม่ทุกครั้งที่เปิดเซิร์ฟเวอร์ (ทุกคนต้อง login ใหม่หลังรีสตาร์ท)
const sessionMiddleware = session({
  name: 'bgc.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }   // 8 ชั่วโมง
});
app.use(sessionMiddleware);

// ให้ทุกหน้ารู้ path ปัจจุบัน + ผู้ใช้ที่ล็อกอินอยู่ (ใช้ทำเมนูตามสิทธิ์)
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.user = req.session.user || null;
  next();
});

app.use('/', authRoutes);
app.use('/', indexRoutes);
app.use('/', adminRoutes);

// ---- Realtime: Socket.IO (อ่าน session เดียวกับเว็บ เพื่อแยกข้อมูลแอดมิน/ลูกค้า) ----
realtime.attachIo(io);
io.engine.use(sessionMiddleware);

io.on('connection', async (socket) => {
  const user = socket.request.session && socket.request.session.user;
  const isAdmin = !!(user && user.role === 'admin');
  socket.join(isAdmin ? 'admin' : 'public');
  try {
    const state = await realtime.buildState();
    socket.emit('state:update', isAdmin ? state : realtime.publicState(state));
  } catch (err) {
    socket.emit('state:error', { message: 'เชื่อมต่อฐานข้อมูลไม่ได้ชั่วคราว' });
  }
});

// อัปเดตสถานะให้ทุกจอโดยอัตโนมัติทุก 3 วินาที (เผื่อมีการเปลี่ยนแปลงจากฝั่ง SSMS/SP โดยตรง)
realtime.startPolling(3000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Board Game Cafe web running at http://localhost:${PORT}`);
});
