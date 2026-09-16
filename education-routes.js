const crypto = require('crypto');

module.exports = function registerEducationRoutes({ app, io, getDb, auth, allow }) {
  const mem = {
    subjects: [], assignments: [], submissions: [], materials: [], notifications: [], messages: [], absence_requests: []
  };
  const managers = new Set(['admin', 'tech', 'rector', 'prorector', 'dean', 'tutor']);
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
    else (mem[name] || (mem[name] = [])).push(doc);
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
    let row = (mem[name] || []).find(x => Object.entries(query).every(([k, v]) => x[k] === v));
    if (!row && upsert) { row = { ...query }; (mem[name] || (mem[name] = [])).push(row); }
    if (row) Object.assign(row, patch);
  }

  const isManager = user => managers.has(user?.role);
  async function getSubject(subjectId) { return findOne('subjects', { id: clean(subjectId, 80) }); }
  async function getLesson(lessonId) {
    if (!db()) return null;
    return db().collection('lessons').findOne({ id: clean(lessonId, 80) }, { projection: { _id: 0 } });
  }
  async function subjectAllowed(user, subject) {
    if (!user || !subject) return false;
    if (isManager(user)) return true;
    if (user.role === 'teacher') return subject.teacherUsername === user.sub;
    if (user.role === 'student') return Boolean(user.group) && (subject.groups || []).includes(user.group);
    return false;
  }
  async function lessonAllowed(user, lesson) {
    if (!user || !lesson) return false;
    if (isManager(user)) return true;
    if (user.role === 'teacher') return lesson.teacherUsername === user.sub;
    if (user.role === 'student') return Boolean(user.group) && lesson.group === user.group;
    return false;
  }
  async function assignmentAllowed(user, assignment) {
    if (!user || !assignment) return false;
    if (isManager(user)) return true;
    if (user.role === 'student') return Boolean(user.group) && assignment.group === user.group;
    if (user.role === 'teacher') {
      if (assignment.createdBy === user.sub) return true;
      const subject = await getSubject(assignment.subjectId);
      return subject?.teacherUsername === user.sub && (!assignment.group || (subject.groups || []).includes(assignment.group));
    }
    return false;
  }
  async function roomAllowed(user, roomId) {
    const room = clean(roomId, 100);
    if (!user || !room) return false;
    if (isManager(user)) return true;
    if (room === 'general') return false;
    if (room.startsWith('group-')) {
      const group = clean(room.slice(6), 60);
      if (user.role === 'student') return Boolean(user.group) && group === user.group;
      if (user.role === 'teacher' && db()) {
        const count = await db().collection('subjects').countDocuments({ teacherUsername: user.sub, groups: group }, { limit: 1 });
        if (count) return true;
        return Boolean(await db().collection('lessons').findOne({ teacherUsername: user.sub, group }, { projection: { _id: 1 } }));
      }
      return false;
    }
    if (room.startsWith('subject-')) return subjectAllowed(user, await getSubject(room.slice(8)));
    if (room.startsWith('lesson-')) return lessonAllowed(user, await getLesson(room.slice(7)));
    return false;
  }

  let seeded = false;
  async function ensureSeed() {
    if (seeded) return;
    const d = db();
    if (d) {
      await Promise.all([
        d.collection('subjects').createIndex({ code: 1 }, { unique: true }),
        d.collection('assignments').createIndex({ group: 1, subjectId: 1, dueAt: 1 }),
        d.collection('submissions').createIndex({ assignmentId: 1, username: 1 }, { unique: true }),
        d.collection('materials').createIndex({ subjectId: 1, createdAt: -1 }),
        d.collection('messages').createIndex({ roomId: 1, createdAt: -1 }),
        d.collection('notifications').createIndex({ username: 1, read: 1, createdAt: -1 }),
        d.collection('absence_requests').createIndex({ username: 1, createdAt: -1 }),
        d.collection('absence_requests').createIndex({ lessonId: 1, status: 1 })
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
    if (req.user.role === 'student') rows = req.user.group ? rows.filter(x => (x.groups || []).includes(req.user.group)) : [];
    res.json({ ok: true, items: rows });
  });

  app.get('/api/edu/subjects/:id', auth, async (req, res) => {
    const subject = await getSubject(req.params.id);
    if (!subject) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!(await subjectAllowed(req.user, subject))) return res.status(403).json({ ok: false, error: 'subject_access_denied' });
    let assignments = await list('assignments', { subjectId: subject.id }, { sort: { createdAt: -1 }, limit: 50 });
    if (req.user.role === 'student') assignments = assignments.filter(x => x.group === req.user.group);
    if (req.user.role === 'teacher') assignments = assignments.filter(x => x.createdBy === req.user.sub || subject.teacherUsername === req.user.sub);
    const materials = await list('materials', { subjectId: subject.id }, { sort: { createdAt: -1 }, limit: 50 });
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
    if (req.user.role === 'student') q.group = req.user.group || '__NO_GROUP__';
    else if (req.user.role === 'teacher') q.createdBy = req.user.sub;
    else if (req.query.group) q.group = clean(req.query.group, 60);
    const items = await list('assignments', q, { sort: { dueAt: 1 }, limit: 100 });
    const submissions = req.user.role === 'student' ? await list('submissions', { username: req.user.sub }, { limit: 200 }) : [];
    res.json({ ok: true, items, submissions });
  });

  app.post('/api/edu/assignments', auth, allow('teacher', 'admin'), async (req, res) => {
    const subject = await getSubject(req.body.subjectId);
    if (!subject || !(await subjectAllowed(req.user, subject))) return res.status(403).json({ ok: false, error: 'subject_access_denied' });
    const group = clean(req.body.group, 60);
    if (req.user.role === 'teacher' && !(subject.groups || []).includes(group)) return res.status(403).json({ ok: false, error: 'group_access_denied' });
    const doc = { id: id('asg'), subjectId: subject.id, title: clean(req.body.title, 180), description: clean(req.body.description, 3000), group, points: clamp(req.body.points || 10, 1, 1000), dueAt: clean(req.body.dueAt, 40), status: 'active', createdBy: req.user.sub, createdAt: now() };
    if (!doc.title || !doc.group || !doc.dueAt) return res.status(400).json({ ok: false, error: 'required' });
    await insert('assignments', doc);
    res.status(201).json({ ok: true, item: doc });
  });

  app.post('/api/edu/assignments/:id/submit', auth, allow('student'), async (req, res) => {
    const assignment = await findOne('assignments', { id: clean(req.params.id, 80) });
    if (!assignment) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!(await assignmentAllowed(req.user, assignment))) return res.status(403).json({ ok: false, error: 'assignment_access_denied' });
    const doc = { id: id('subm'), assignmentId: assignment.id, username: req.user.sub, name: req.user.name, text: clean(req.body.text, 8000), attachmentUrl: clean(req.body.attachmentUrl, 1000), status: 'submitted', submittedAt: now(), score: null, feedback: '' };
    if (db()) await db().collection('submissions').updateOne({ assignmentId: assignment.id, username: req.user.sub }, { $set: doc }, { upsert: true });
    else {
      const idx = mem.submissions.findIndex(x => x.assignmentId === assignment.id && x.username === req.user.sub);
      if (idx >= 0) mem.submissions[idx] = doc; else mem.submissions.push(doc);
    }
    res.json({ ok: true, item: doc });
  });

  app.get('/api/edu/assignments/:id/submissions', auth, allow('teacher', 'admin', 'dean', 'tutor'), async (req, res) => {
    const assignment = await findOne('assignments', { id: clean(req.params.id, 80) });
    if (!assignment) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!(await assignmentAllowed(req.user, assignment))) return res.status(403).json({ ok: false, error: 'assignment_access_denied' });
    res.json({ ok: true, items: await list('submissions', { assignmentId: assignment.id }, { sort: { submittedAt: -1 }, limit: 250 }) });
  });

  app.patch('/api/edu/submissions/:id/grade', auth, allow('teacher', 'admin', 'dean'), async (req, res) => {
    const submission = await findOne('submissions', { id: clean(req.params.id, 80) });
    if (!submission) return res.status(404).json({ ok: false, error: 'not_found' });
    const assignment = await findOne('assignments', { id: submission.assignmentId });
    if (!assignment || !(await assignmentAllowed(req.user, assignment))) return res.status(403).json({ ok: false, error: 'assignment_access_denied' });
    await setOne('submissions', { id: submission.id }, { score: clamp(req.body.score || 0, 0, 1000), feedback: clean(req.body.feedback, 2000), status: 'graded', gradedAt: now(), gradedBy: req.user.sub });
    res.json({ ok: true });
  });

  app.get('/api/edu/materials', auth, async (req, res) => {
    if (req.query.subjectId) {
      const subject = await getSubject(req.query.subjectId);
      if (!subject || !(await subjectAllowed(req.user, subject))) return res.status(403).json({ ok: false, error: 'subject_access_denied' });
      return res.json({ ok: true, items: await list('materials', { subjectId: subject.id }, { sort: { createdAt: -1 }, limit: 100 }) });
    }
    let subjects = await list('subjects', {}, { limit: 100 });
    subjects = (await Promise.all(subjects.map(async s => (await subjectAllowed(req.user, s)) ? s : null))).filter(Boolean);
    const ids = subjects.map(s => s.id);
    if (!db()) {
      const items = mem.materials.filter(x => ids.includes(x.subjectId)).slice(0, 100);
      return res.json({ ok: true, items });
    }
    const items = ids.length ? await db().collection('materials').find({ subjectId: { $in: ids } }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray() : [];
    res.json({ ok: true, items });
  });

  app.post('/api/edu/materials', auth, allow('teacher', 'admin'), async (req, res) => {
    const subject = await getSubject(req.body.subjectId);
    if (!subject || !(await subjectAllowed(req.user, subject))) return res.status(403).json({ ok: false, error: 'subject_access_denied' });
    const doc = { id: id('mat'), subjectId: subject.id, title: clean(req.body.title, 180), type: clean(req.body.type, 30) || 'link', url: clean(req.body.url, 1200), size: clamp(req.body.size || 0, 0, 10000000000), createdBy: req.user.sub, createdAt: now() };
    if (!doc.title) return res.status(400).json({ ok: false, error: 'required' });
    await insert('materials', doc);
    res.status(201).json({ ok: true, item: doc });
  });

  app.get('/api/edu/messages/:roomId', auth, async (req, res) => {
    const roomId = clean(req.params.roomId, 100);
    if (!(await roomAllowed(req.user, roomId))) return res.status(403).json({ ok: false, error: 'chat_access_denied' });
    const items = await list('messages', { roomId }, { sort: { createdAt: -1 }, limit: 60 });
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
    const lessonId = clean(req.params.lessonId, 80), lesson = await getLesson(lessonId);
    if (!lesson || !(await lessonAllowed(req.user, lesson))) return res.status(403).json({ ok: false, error: 'lesson_access_denied' });
    const match = { lessonId };
    if (req.user.role === 'student') match.username = req.user.sub;
    const rows = await db().collection('attendance_events').aggregate([
      { $match: match }, { $sort: { at: 1 } },
      { $group: { _id: '$username', firstAt: { $min: '$at' }, lastAt: { $max: '$at' }, events: { $sum: 1 }, lastEvent: { $last: '$event' } } },
      { $sort: { firstAt: 1 } }
    ]).toArray();
    res.json({ ok: true, items: rows });
  });

  app.get('/api/edu/search', auth, async (req, res) => {
    const q = clean(req.query.q, 80).toLowerCase();
    if (q.length < 2) return res.json({ ok: true, items: [] });
    let subjects = await list('subjects', {}, { limit: 100 });
    subjects = (await Promise.all(subjects.map(async s => (await subjectAllowed(req.user, s)) ? s : null))).filter(Boolean);
    let assignments = await list('assignments', {}, { limit: 200 });
    assignments = (await Promise.all(assignments.map(async a => (await assignmentAllowed(req.user, a)) ? a : null))).filter(Boolean);
    const items = [
      ...subjects.filter(x => `${x.name} ${x.code}`.toLowerCase().includes(q)).slice(0, 8).map(x => ({ type: 'subject', id: x.id, title: x.name, meta: x.code })),
      ...assignments.filter(x => `${x.title} ${x.group}`.toLowerCase().includes(q)).slice(0, 8).map(x => ({ type: 'assignment', id: x.id, title: x.title, meta: x.group }))
    ].slice(0, 15);
    res.json({ ok: true, items });
  });

  app.get('/api/edu/student-center', auth, allow('student'), async (req, res) => {
    if (!req.user.group) return res.json({ ok: true, group: '', lessons: [], subjects: [], assignments: [], materials: [], notifications: [], summary: { overdue: 0, dueSoon: 0, todayLessons: 0 } });
    const subjects = (await list('subjects', {}, { limit: 100 })).filter(s => (s.groups || []).includes(req.user.group));
    const subjectIds = subjects.map(s => s.id);
    let lessons = [], assignments = [], materials = [], notifications = [], submissions = [];
    if (db()) {
      [lessons, assignments, materials, notifications, submissions] = await Promise.all([
        db().collection('lessons').find({ group: req.user.group, date: today(), status: { $ne: 'cancelled' } }, { projection: { _id: 0 } }).sort({ start: 1 }).limit(20).toArray(),
        db().collection('assignments').find({ group: req.user.group, status: 'active' }, { projection: { _id: 0 } }).sort({ dueAt: 1 }).limit(50).toArray(),
        subjectIds.length ? db().collection('materials').find({ subjectId: { $in: subjectIds } }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(12).toArray() : [],
        db().collection('notifications').find({ username: req.user.sub }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(12).toArray(),
        db().collection('submissions').find({ username: req.user.sub }, { projection: { _id: 0 } }).limit(100).toArray()
      ]);
    } else {
      assignments = mem.assignments.filter(a => a.group === req.user.group && a.status === 'active');
      materials = mem.materials.filter(m => subjectIds.includes(m.subjectId)).slice(0, 12);
      notifications = mem.notifications.filter(n => n.username === req.user.sub).slice(0, 12);
      submissions = mem.submissions.filter(s => s.username === req.user.sub);
    }
    const submitted = new Set(submissions.map(s => s.assignmentId));
    const ts = Date.now(), soon = ts + 48 * 3600000;
    const overdue = assignments.filter(a => !submitted.has(a.id) && a.dueAt && new Date(a.dueAt).getTime() < ts).length;
    const dueSoon = assignments.filter(a => !submitted.has(a.id) && a.dueAt && new Date(a.dueAt).getTime() >= ts && new Date(a.dueAt).getTime() <= soon).length;
    res.set('Cache-Control', 'private, max-age=10');
    res.json({ ok: true, group: req.user.group, lessons, subjects, assignments, materials, notifications, submissions, summary: { overdue, dueSoon, todayLessons: lessons.length, unread: notifications.filter(n => !n.read).length } });
  });

  app.get('/api/edu/absence-requests', auth, allow('student'), async (req, res) => {
    const items = await list('absence_requests', { username: req.user.sub }, { sort: { createdAt: -1 }, limit: 100 });
    res.json({ ok: true, items });
  });
  app.post('/api/edu/absence-requests', auth, allow('student'), async (req, res) => {
    const lesson = await getLesson(req.body.lessonId);
    if (!lesson || !(await lessonAllowed(req.user, lesson))) return res.status(403).json({ ok: false, error: 'lesson_access_denied' });
    const reason = clean(req.body.reason, 2000);
    if (!reason) return res.status(400).json({ ok: false, error: 'required' });
    const doc = { id: id('abs'), lessonId: lesson.id, subject: lesson.subject, group: lesson.group, username: req.user.sub, name: req.user.name, reason, attachmentUrl: clean(req.body.attachmentUrl, 1200), status: 'pending', createdAt: now(), updatedAt: now() };
    await insert('absence_requests', doc);
    res.status(201).json({ ok: true, item: doc });
  });
  app.get('/api/edu/absence-requests/manage', auth, allow('admin', 'dean', 'tutor', 'tech'), async (req, res) => {
    const q = {}; if (req.query.status) q.status = clean(req.query.status, 30); if (req.query.group) q.group = clean(req.query.group, 60);
    res.json({ ok: true, items: await list('absence_requests', q, { sort: { createdAt: -1 }, limit: 300 }) });
  });
  app.patch('/api/edu/absence-requests/:id', auth, allow('admin', 'dean', 'tutor'), async (req, res) => {
    const status = ['approved', 'rejected', 'pending'].includes(req.body.status) ? req.body.status : 'pending';
    const patch = { status, reviewer: req.user.sub, reviewNote: clean(req.body.reviewNote, 1200), reviewedAt: now(), updatedAt: now() };
    await setOne('absence_requests', { id: clean(req.params.id, 80) }, patch);
    res.json({ ok: true });
  });

  io.on('connection', socket => {
    socket.on('edu:room:join', async (roomId, ack) => {
      try {
        const cleanRoom = clean(roomId, 100); if (!cleanRoom) return ack?.({ ok: false, error: 'room_required' });
        if (!(await roomAllowed(socket.user, cleanRoom))) {
          socket.emit('edu:room:error', { error: 'chat_access_denied', roomId: cleanRoom });
          return ack?.({ ok: false, error: 'chat_access_denied' });
        }
        if (socket.data.eduRoom) socket.leave(socket.data.eduRoom);
        const room = `edu:${cleanRoom}`; socket.join(room); socket.data.eduRoom = room; socket.data.eduRoomId = cleanRoom;
        const count = io.sockets.adapter.rooms.get(room)?.size || 1;
        io.to(room).emit('edu:presence', { online: count });
        ack?.({ ok: true, roomId: cleanRoom, online: count });
      } catch { ack?.({ ok: false, error: 'room_join_failed' }); }
    });
    socket.on('edu:chat:send', async (payload, ack) => {
      try {
        if (!socket.data.eduRoom || !socket.data.eduRoomId) return ack?.({ ok: false, error: 'room_required' });
        if (!(await roomAllowed(socket.user, socket.data.eduRoomId))) return ack?.({ ok: false, error: 'chat_access_denied' });
        const text = clean(payload?.text, 1200); if (!text) return ack?.({ ok: false, error: 'message_required' });
        const msg = { id: id('msg'), roomId: socket.data.eduRoomId, text, username: socket.user?.sub || '', name: socket.user?.name || 'Foydalanuvchi', role: socket.user?.role || 'user', createdAt: now() };
        await insert('messages', msg);
        io.to(socket.data.eduRoom).emit('edu:chat:message', msg);
        ack?.({ ok: true, id: msg.id });
      } catch { ack?.({ ok: false, error: 'message_failed' }); }
    });
    socket.on('disconnect', () => {
      if (!socket.data.eduRoom) return;
      const count = io.sockets.adapter.rooms.get(socket.data.eduRoom)?.size || 0;
      io.to(socket.data.eduRoom).emit('edu:presence', { online: count });
    });
  });
};
