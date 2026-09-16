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
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.DB_NAME || 'masofaviy';
const APP_NAME = process.env.APP_NAME || "QDTU Masofaviy Ta'lim";
const RTC_BRIDGE_URL = process.env.RTC_BRIDGE_URL || '';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 90);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '512kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true, immutable: false }));

let db = null;
let mongoStatus = 'memory';
let dashboardCache = { at: 0, data: null };
const memory = {
  users: [],
  lessons: [
    { id: 'L-1001', subject: 'Matematika', group: 'MMT-520-25', teacher: "A. O'qituvchi", start: '10:30', end: '11:50', status: 'live', online: 27 },
    { id: 'L-1002', subject: 'Axborot texnologiyalari', group: 'MMT-519-25', teacher: "D. O'qituvchi", start: '13:00', end: '14:20', status: 'next', online: 0 },
    { id: 'L-1003', subject: 'Iqtisodiyot', group: 'MMT-520-25', teacher: "N. O'qituvchi", start: '15:00', end: '16:20', status: 'next', online: 0 }
  ],
  announcements: [
    { id: 'A1', title: 'Masofaviy ta’lim platformasi ishga tushdi', body: 'Darslar jadval asosida ushbu platformada olib boriladi.', at: new Date() }
  ]
};

async function ensureSeed() {
  const seeds = [
    { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'Admin@2026', name: 'Bosh administrator', role: 'admin' },
    { username: 'teacher', password: 'Teacher@2026', name: "O'qituvchi Demo", role: 'teacher' },
    { username: 'student', password: 'Student@2026', name: 'Talaba Demo', role: 'student' }
  ];
  if (db) {
    const users = db.collection('users');
    for (const u of seeds) {
      const exists = await users.findOne({ username: u.username }, { projection: { _id: 1 } });
      if (!exists) await users.insertOne({ username: u.username, name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.password, 10), active: true, createdAt: new Date() });
    }
    if (await db.collection('lessons').estimatedDocumentCount() === 0) await db.collection('lessons').insertMany(memory.lessons.map(x => ({ ...x, createdAt: new Date() })));
    if (await db.collection('announcements').estimatedDocumentCount() === 0) await db.collection('announcements').insertMany(memory.announcements);
  } else if (!memory.users.length) {
    memory.users = await Promise.all(seeds.map(async u => ({ username: u.username, name: u.name, role: u.role, active: true, passwordHash: await bcrypt.hash(u.password, 8) })));
  }
}

async function ensureIndexes() {
  if (!db) return;
  await Promise.all([
    db.collection('users').createIndex({ username: 1 }, { unique: true }),
    db.collection('lessons').createIndex({ status: 1, start: 1 }),
    db.collection('attendance_events').createIndex({ lessonId: 1, username: 1, at: -1 }),
    db.collection('announcements').createIndex({ at: -1 })
  ]);
}

async function connectDb() {
  if (!MONGODB_URI) return ensureSeed();
  try {
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 7000,
      connectTimeoutMS: 7000,
      minPoolSize: 1,
      maxPoolSize: 20,
      maxIdleTimeMS: 60000,
      retryReads: true,
      retryWrites: true
    });
    await client.connect();
    db = client.db(DB_NAME);
    mongoStatus = 'connected';
    await ensureIndexes();
    await ensureSeed();
    console.log('MongoDB connected:', DB_NAME);
  } catch (e) {
    mongoStatus = 'fallback-memory';
    console.error('MongoDB unavailable, using memory store:', e.message);
    await ensureSeed();
  }
}

function sign(user) {
  return jwt.sign({ sub: user.username, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
}
function auth(req, res, next) {
  const token = req.cookies.session || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'auth_required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ ok: false, error: 'invalid_session' }); }
}
function allow(...roles) { return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ ok: false, error: 'forbidden' }); }

app.get('/health', (req, res) => res.json({ ok: true, app: APP_NAME, db: mongoStatus, rtc: RTC_BRIDGE_URL ? 'external-ready' : 'ui-ready', uptime: Math.round(process.uptime()), time: new Date().toISOString() }));
app.get('/api/config', (req, res) => res.json({ ok: true, appName: APP_NAME, rtcEnabled: Boolean(RTC_BRIDGE_URL), rtcBridgeUrl: RTC_BRIDGE_URL, pwa: true, lowDataMode: true, sessionDays: SESSION_DAYS }));

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase().slice(0, 100);
  const password = String(req.body.password || '').slice(0, 200);
  let user = db ? await db.collection('users').findOne({ username }, { projection: { username: 1, name: 1, role: 1, passwordHash: 1, active: 1 } }) : memory.users.find(u => u.username === username);
  if (!user || user.active === false || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ ok: false, error: 'login_failed' });
  const token = sign(user);
  res.cookie('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 86400000,
    path: '/'
  });
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, user: { username: user.username, name: user.name, role: user.role } });
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('session', { path: '/' }); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, user: req.user }); });

app.get('/api/dashboard', auth, async (req, res) => {
  const now = Date.now();
  let data = dashboardCache.data;
  if (!data || now - dashboardCache.at > 12000) {
    const lessons = db ? await db.collection('lessons').find({}, { projection: { _id: 0, id: 1, subject: 1, group: 1, teacher: 1, start: 1, end: 1, status: 1, online: 1 } }).sort({ start: 1 }).limit(20).toArray() : memory.lessons;
    const announcements = db ? await db.collection('announcements').find({}, { projection: { _id: 0, id: 1, title: 1, body: 1, at: 1 } }).sort({ at: -1 }).limit(8).toArray() : memory.announcements;
    data = { stats: { todayLessons: lessons.length, liveLessons: lessons.filter(x => x.status === 'live').length, attendance: 92, pendingTasks: 3 }, lessons, announcements };
    dashboardCache = { at: now, data };
  }
  res.set('Cache-Control', 'private, max-age=10');
  res.json({ ok: true, role: req.user.role, ...data });
});

app.get('/api/admin/overview', auth, allow('admin', 'rector', 'prorector', 'dean'), (req, res) => {
  res.json({ ok: true, stats: { students: 8421, teachers: 624, groups: 318, liveLessons: 42, online: 1874, attendance: 87, alerts: 7 } });
});

app.post('/api/lessons/:id/attendance', auth, async (req, res) => {
  const row = { lessonId: String(req.params.id).slice(0, 80), username: req.user.sub, role: req.user.role, event: req.body.event === 'leave' ? 'leave' : 'join', at: new Date(), network: String(req.body.network || 'unknown').slice(0, 30) };
  if (db) await db.collection('attendance_events').insertOne(row);
  res.json({ ok: true });
});

app.get('/api/rtc/status', auth, (req, res) => res.json({ ok: true, mode: RTC_BRIDGE_URL ? 'external-mediasoup' : 'preflight', bridge: RTC_BRIDGE_URL || null }));

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
