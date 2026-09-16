const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const compression = require('compression');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'], cors: { origin: true, credentials: true } });

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-' + crypto.randomBytes(32).toString('hex');
const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.DB_NAME || 'masofaviy';
const APP_NAME = process.env.APP_NAME || "QDTU Masofaviy Ta'lim";
const RTC_BRIDGE_URL = process.env.RTC_BRIDGE_URL || '';

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

let db = null;
let mongoStatus = 'memory';
const memory = {
  users: [],
  lessons: [
    { id: 'L-1001', subject: 'Matematika', group: 'MMT-520-25', teacher: "A. O'qituvchi", start: '10:30', end: '11:50', status: 'live', online: 27 },
    { id: 'L-1002', subject: 'Axborot texnologiyalari', group: 'MMT-519-25', teacher: "D. O'qituvchi", start: '13:00', end: '14:20', status: 'next', online: 0 },
    { id: 'L-1003', subject: 'Iqtisodiyot', group: 'MMT-520-25', teacher: "N. O'qituvchi", start: '15:00', end: '16:20', status: 'next', online: 0 }
  ],
  announcements: [
    { id: 'A1', title: 'Masofaviy ta’lim platformasi ishga tushdi', body: 'Darslar jadval asosida ushbu platformada olib boriladi.', at: new Date().toISOString() }
  ]
};

async function ensureSeed() {
  const seeds = [
    { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'Admin@2026', name: 'Bosh administrator', role: 'admin' },
    { username: 'teacher', password: 'Teacher@2026', name: "O'qituvchi Demo", role: 'teacher' },
    { username: 'student', password: 'Student@2026', name: 'Talaba Demo', role: 'student' }
  ];
  if (db) {
    const c = db.collection('users');
    for (const u of seeds) {
      const exists = await c.findOne({ username: u.username });
      if (!exists) await c.insertOne({ username: u.username, name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.password, 10), createdAt: new Date() });
    }
  } else if (!memory.users.length) {
    memory.users = await Promise.all(seeds.map(async u => ({ username: u.username, name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.password, 8) })));
  }
}

async function connectDb() {
  if (!MONGODB_URI) return ensureSeed();
  try {
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(DB_NAME);
    mongoStatus = 'connected';
    await ensureSeed();
    console.log('MongoDB connected');
  } catch (e) {
    mongoStatus = 'fallback-memory';
    console.error('MongoDB unavailable, using memory store:', e.message);
    await ensureSeed();
  }
}

function sign(user) {
  return jwt.sign({ sub: user.username, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const token = req.cookies.session || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'auth_required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ ok: false, error: 'invalid_session' }); }
}
function allow(...roles) { return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ ok: false, error: 'forbidden' }); }

app.get('/health', (req, res) => res.json({ ok: true, app: APP_NAME, db: mongoStatus, rtc: RTC_BRIDGE_URL ? 'external-ready' : 'ui-ready', uptime: Math.round(process.uptime()), time: new Date().toISOString() }));
app.get('/api/config', (req, res) => res.json({ ok: true, appName: APP_NAME, rtcEnabled: Boolean(RTC_BRIDGE_URL), rtcBridgeUrl: RTC_BRIDGE_URL, pwa: true, lowDataMode: true }));

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  let user = db ? await db.collection('users').findOne({ username }) : memory.users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ ok: false, error: 'login_failed' });
  const token = sign(user);
  res.cookie('session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 86400000 });
  res.json({ ok: true, user: { username: user.username, name: user.name, role: user.role } });
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('session'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ ok: true, user: req.user }));

app.get('/api/dashboard', auth, async (req, res) => {
  const lessons = db ? await db.collection('lessons').find({}).sort({ start: 1 }).limit(20).toArray() : memory.lessons;
  const announcements = db ? await db.collection('announcements').find({}).sort({ at: -1 }).limit(10).toArray() : memory.announcements;
  res.json({ ok: true, role: req.user.role, stats: { todayLessons: lessons.length, liveLessons: lessons.filter(x => x.status === 'live').length, attendance: 92, pendingTasks: 3 }, lessons, announcements });
});

app.get('/api/admin/overview', auth, allow('admin', 'rector', 'prorector', 'dean'), (req, res) => {
  res.json({ ok: true, stats: { students: 8421, teachers: 624, groups: 318, liveLessons: 42, online: 1874, attendance: 87, alerts: 7 } });
});

app.post('/api/lessons/:id/attendance', auth, async (req, res) => {
  const row = { lessonId: req.params.id, username: req.user.sub, role: req.user.role, event: req.body.event || 'join', at: new Date(), network: req.body.network || 'unknown' };
  if (db) await db.collection('attendance_events').insertOne(row);
  res.json({ ok: true, row });
});

app.get('/api/rtc/status', auth, (req, res) => res.json({ ok: true, mode: RTC_BRIDGE_URL ? 'external-mediasoup' : 'preflight', bridge: RTC_BRIDGE_URL || null, recommendation: 'Deploy mediasoup SFU on UDP-capable VPS and set RTC_BRIDGE_URL.' }));

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('session='))?.split('=')[1];
  if (!token) return next(new Error('auth_required'));
  try { socket.user = jwt.verify(decodeURIComponent(token), JWT_SECRET); next(); } catch { next(new Error('invalid_session')); }
});

io.on('connection', socket => {
  socket.on('room:join', roomId => {
    const room = `lesson:${String(roomId).slice(0, 64)}`;
    socket.join(room);
    socket.data.room = room;
    socket.to(room).emit('presence', { type: 'join', user: socket.user.name, role: socket.user.role, id: socket.id });
  });
  socket.on('chat:send', payload => {
    if (!socket.data.room) return;
    const text = String(payload?.text || '').trim().slice(0, 800);
    if (!text) return;
    io.to(socket.data.room).emit('chat:message', { id: crypto.randomUUID(), text, user: socket.user.name, role: socket.user.role, at: new Date().toISOString() });
  });
  socket.on('raise-hand', state => socket.data.room && socket.to(socket.data.room).emit('hand', { user: socket.user.name, state: Boolean(state) }));
  socket.on('disconnect', () => socket.data.room && socket.to(socket.data.room).emit('presence', { type: 'leave', user: socket.user.name, id: socket.id }));
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

connectDb().finally(() => server.listen(PORT, '0.0.0.0', () => console.log(`${APP_NAME} listening on ${PORT}`)));
