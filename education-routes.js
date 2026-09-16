const crypto = require('crypto');

module.exports = function registerEducationRoutes({ app, io, getDb, auth, allow }) {
  const mem = {
    subjects: [], assignments: [], submissions: [], materials: [], notifications: [], messages: []
  };
  const id = p => `${p}_${crypto.randomUUID()}`;
  const clean = (v, n = 200) => String(v ?? '').trim().slice(0, n);
  const now = () => new Date().toISOString();
  const today = () => new Date().toISOString().slice(0, 10);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || min));
  const db = () => getDb();

  async function findOne(name, query) {
    if (db()) return db().collection(name).findOne(query);
    return mem[name]?.find(x => Object.entries(query).every(([k, v]) => x[k] === v)) || null;
  }
  async function insert(name, doc) {
    if (db()) await db().collection(name).insertOne(doc);
    else mem[name].push(doc);
    return doc;
  }
  async function list(name, query = {}, opts = {}) {
    if (db()) {
      let cur = db().collection(name).find(query, { projection: opts.projection || undefined });
      if (opts.sort) cur = cur.sort(opts.sort);
      if (opts.skip) cur = cur.skip(opts.skip);
      if (opts.limit) cur = cur.limit(opts.limit);
      return cur.toArray();
    }
    let rows = (mem[name] || []).filter(x => Object.entries(query).every(([k, v]) => x[k] === v));
    if (opts.sort) {
      const [k, dir] = Object.entries(opts.sort)[0] || [];
      if (k) rows.sort((a, b) => (a[k] > b[k] ? 1 : -1) * dir);
    }
    if (opts.skip) rows = rows.slice(opts.skip);
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows;
  }
  async function setOne(name, query, patch, upsert = false) {
    if (db()) return db().collection(name).updateOne(query, { $set: patch }, { upsert });
    let row = mem[name].find(x => Object.entries(query).every(([k, v]) => x[k] === v));
    if (!row && upsert) { row = { ...query }; mem[name].push(row); }
    if (row) Object.assign(row, patch);
  }

  let seeded = false;
  async function ensureSeed() {
    if (seeded) return;
    const d = db();
    if (d) {
      await Promise.all([
        d.collection('subjects').createIndex({ code: 1 }, { unique: true }),
        d.collection('assignments').createIndex({ subjectId: 1, dueAt: 1 }),
        d.collection('submissions').createIndex({ assignmentId: 1, username: 1 }, { unique: true }),
        d.collection('materials').createIndex({ subjectId: 1, createdAt: -1 }),
        d.collection('messages').createIndex({ roomId: 1, createdAt: -1 }),
        d.collection('notifications').createIndex({ username: 1, read: 1, createdAt: -1 })
      ]).catch(() => {});
    }
    const subjects = [
      { id: 'SUB-MATH', code: 'MAT-101', name: 'Matematika', teacherUsername: 'teacher', teacher: "O‘qituvchi Demo", groups: ['MMT-520-25'], color: '#3159d8' },
      { id: 'SUB-IT', code: 'AT-102', name: 'Axborot texnologiyalari', teacherUsername: 'teacher', teacher: "O‘qituvchi Demo", groups: ['MMT-519-25', 'MMT-520-25'], color: '#0f8f79' },
      { id: 'SUB-ECO', code: 'IQT-103', name: 'Iqtisodiyot', teacherUsername: 'teacher', teacher: "O‘qituvchi Demo", groups: ['MMT-520-25'], color: '#8b5cf6' }
    ];
    for (const s of subjects) if (!(await findOne('subjects', { code: s.code }))) await insert('subjects', { ...s, createdAt: now() });
    if (!(await findOne('assignments', { id: 'ASG-1' }))) await insert('assignments', {
      id: 'ASG-1', subjectId: 'SUB-MATH', title: '1-amaliy topshiriq', description: '1–10 masalalarni yeching va javoblarni yuboring.', group: 'MMT-520-25', points: 10,
      dueAt: new Date(Date.now() + 3 * 86400000).toISOString(), status: 'active', createdBy: 'teacher', createdAt: now()
    });
    if (!(await findOne('materials', { id: 'MAT-1' }))) await insert('materials', {
      id: 'MAT-1', subjectId: 'SUB-MATH', title: '1-mavzu: Kirish', type: 'pdf', url: '', size: 0, createdBy: 'teacher', createdAt: now()
    });
    seeded = true;
  }

  app.use('/api/edu', async (req, res, next) => { try { await ensureSeed(); next(); } catch (e) { next(e); } });

  app.get('/api/edu/subjects', auth, async (req, res) => {
    let rows = await list('subjects', {}, { sort: { name: 1 }, limit: 100 });
    if (req.user.role === 'teacher') rows = rows.filter(x => x.teacherUsername === req.user.sub);
    if (req.user.role === 'student' && req.user.group) rows = rows.filter(x => (x.groups || []).includes(req.user.group));
    res.json({ ok: true, items: rows });
  });

  app.get('/api/edu/subjects/:id', auth, async (req, res) => {
    const subject = await findOne('subjects', { id: clean(req.params.id, 80) });
    if (!subject) return res.status(404).json({ ok: false, error: 'not_found' });
    const [materials, assignments] = await Promise.all([
      list('materials', { subjectId: subject.id }, { sort: { createdAt: -1 }, limit: 50 }),
      list('assignments', { subjectId: subject.id }, { sort: { createdAt: -1 }, limit: 50 })
    ]);
    res.json({ ok: true, subject, materials, assignments });
  });

  app.post('/api/edu/subjects', auth, allow('admin', 'dean', 'prorector', 'rector'), async (req, res) => {
    const code = clean(req.body.code, 30).toUpperCase(), name = clean(req.body.name, 140);
    if (!code || !name) return res.status(400).json({ ok: false, error: 'required' });
    if (await findOne('subjects', { code })) return res.status(409).json({ ok: false, error: 'code_exists' });
    const doc = { id: id('sub'), code, name, teacherUsername: clean(req.body.teacherUsername, 80).toLowerCase(), teacher: clean(req.body.teacher, 140), groups: Array.isArray(req.body.groups) ? req.body.groups.map(x => clean(x, 60)).filter(Boolean) : [], color: clean(req.body.color, 20) || '#3159d8', createdAt: now() };
    await insert('subjects', doc);
    res.status(201).json({ ok: true, item: doc });
  });

  app.get('/api/edu/assignments', auth, async (req, res) => {
    const q = {};
    if (req.query.subjectId) q.subjectId = clean(req.query.subjectId, 80);
    if (req.query.group) q.group = clean(req.query.group, 60);
    if (req.user.role === 'teacher') q.createdBy = req.user.sub;
    const items = await list('assignments', q, { sort: { dueAt: 1 }, limit: 100 });
    const submissions = req.user.role === 'student' ? await list('submissions', { username: req.user.sub }, { limit: 200 }) : [];
    res.json({ ok: true, items, submissions });
  });

  app.post('/api/edu/assignments', auth, allow('teacher', 'admin'), async (req, res) => {
    const doc = { id: id('asg'), subjectId: clean(req.body.subjectId, 80), title: clean(req.body.title, 180), description: clean(req.body.description, 3000), group: clean(req.body.group, 60), points: clamp(req.body.points || 10, 1, 1000), dueAt: clean(req.body.dueAt, 40), status: 'active', createdBy: req.user.sub, createdAt: now() };
    if (!doc.subjectId || !doc.title || !doc.group || !doc.dueAt) return res.status(400).json({ ok: false, error: 'required' });
    await insert('assignments', doc);
    res.status(201).json({ ok: true, item: doc });
  });

  app.post('/api/edu/assignments/:id/submit', auth, allow('student'), async (req, res) => {
    const assignment = await findOne('assignments', { id: clean(req.params.id, 80) });
    if (!assignment) return res.status(404).json({ ok: false, error: 'not_found' });
    const doc = { id: id('subm'), assignmentId: assignment.id, username: req.user.sub, name: req.user.name, text: clean(req.body.text, 8000), attachmentUrl: clean(req.body.attachmentUrl, 1000), status: 'submitted', submittedAt: now(), score: null, feedback: '' };
    if (db()) await db().collection('submissions').updateOne({ assignmentId: assignment.id, username: req.user.sub }, { $set: doc }, { upsert: true });
    else {
      const idx = mem.submissions.findIndex(x => x.assignmentId === assignment.id && x.username === req.user.sub);
      if (idx >= 0) mem.submissions[idx] = doc; else mem.submissions.push(doc);
    }
    res.json({ ok: true, item: doc });
  });

  app.get('/api/edu/assignments/:id/submissions', auth, allow('teacher', 'admin'), async (req, res) => {
    res.json({ ok: true, items: await list('submissions', { assignmentId: clean(req.params.id, 80) }, { sort: { submittedAt: -1 }, limit: 250 }) });
  });

  app.patch('/api/edu/submissions/:id/grade', auth, allow('teacher', 'admin'), async (req, res) => {
    await setOne('submissions', { id: clean(req.params.id, 80) }, { score: clamp(req.body.score || 0, 0, 1000), feedback: clean(req.body.feedback, 2000), status: 'graded', gradedAt: now(), gradedBy: req.user.sub });
    res.json({ ok: true });
  });

  app.get('/api/edu/materials', auth, async (req, res) => {
    const q = {}; if (req.query.subjectId) q.subjectId = clean(req.query.subjectId, 80);
    res.json({ ok: true, items: await list('materials', q, { sort: { createdAt: -1 }, limit: 100 }) });
  });

  app.post('/api/edu/materials', auth, allow('teacher', 'admin'), async (req, res) => {
    const doc = { id: id('mat'), subjectId: clean(req.body.subjectId, 80), title: clean(req.body.title, 180), type: clean(req.body.type, 30) || 'link', url: clean(req.body.url, 1200), size: clamp(req.body.size || 0, 0, 10000000000), createdBy: req.user.sub, createdAt: now() };
    if (!doc.subjectId || !doc.title) return res.status(400).json({ ok: false, error: 'required' });
    await insert('materials', doc);
    res.status(201).json({ ok: true, item: doc });
  });

  app.get('/api/edu/messages/:roomId', auth, async (req, res) => {
    const items = await list('messages', { roomId: clean(req.params.roomId, 100) }, { sort: { createdAt: -1 }, limit: 60 });
    res.json({ ok: true, items: items.reverse() });
  });

  app.get('/api/edu/notifications', auth, async (req, res) => {
    res.json({ ok: true, items: await list('notifications', { username: req.user.sub }, { sort: { createdAt: -1 }, limit: 60 }) });
  });

  app.post('/api/edu/notifications/read', auth, async (req, res) => {
    if (db()) await db().collection('notifications').updateMany({ username: req.user.sub, read: false }, { $set: { read: true, readAt: now() } });
    else mem.notifications.filter(x => x.username === req.user.sub).forEach(x => { x.read = true; });
    res.json({ ok: true });
  });

  app.get('/api/edu/attendance/:lessonId', auth, async (req, res) => {
    if (!db()) return res.json({ ok: true, items: [] });
    const lessonId = clean(req.params.lessonId, 80);
    const rows = await db().collection('attendance_events').aggregate([
      { $match: { lessonId } }, { $sort: { at: 1 } },
      { $group: { _id: '$username', firstAt: { $min: '$at' }, lastAt: { $max: '$at' }, events: { $sum: 1 }, lastEvent: { $last: '$event' } } },
      { $sort: { firstAt: 1 } }
    ]).toArray();
    res.json({ ok: true, items: rows });
  });

  app.get('/api/edu/search', auth, async (req, res) => {
    const q = clean(req.query.q, 80).toLowerCase();
    if (q.length < 2) return res.json({ ok: true, items: [] });
    const [subjects, assignments] = await Promise.all([list('subjects', {}, { limit: 100 }), list('assignments', {}, { limit: 100 })]);
    const items = [
      ...subjects.filter(x => `${x.name} ${x.code}`.toLowerCase().includes(q)).slice(0, 8).map(x => ({ type: 'subject', id: x.id, title: x.name, meta: x.code })),
      ...assignments.filter(x => `${x.title} ${x.group}`.toLowerCase().includes(q)).slice(0, 8).map(x => ({ type: 'assignment', id: x.id, title: x.title, meta: x.group }))
    ].slice(0, 15);
    res.json({ ok: true, items });
  });

  io.on('connection', socket => {
    socket.on('edu:room:join', async roomId => {
      const cleanRoom = clean(roomId, 100); if (!cleanRoom) return;
      const room = `edu:${cleanRoom}`; socket.join(room); socket.data.eduRoom = room;
      const count = io.sockets.adapter.rooms.get(room)?.size || 1;
      io.to(room).emit('edu:presence', { online: count });
    });
    socket.on('edu:chat:send', async payload => {
      if (!socket.data.eduRoom) return;
      const text = clean(payload?.text, 1200); if (!text) return;
      const roomId = socket.data.eduRoom.replace(/^edu:/, '');
      const msg = { id: id('msg'), roomId, text, username: socket.user?.sub || '', name: socket.user?.name || 'Foydalanuvchi', role: socket.user?.role || 'user', createdAt: now() };
      await insert('messages', msg);
      io.to(socket.data.eduRoom).emit('edu:chat:message', msg);
    });
    socket.on('disconnect', () => {
      if (!socket.data.eduRoom) return;
      const count = io.sockets.adapter.rooms.get(socket.data.eduRoom)?.size || 0;
      io.to(socket.data.eduRoom).emit('edu:presence', { online: count });
    });
  });
};
