const bcrypt = require('bcryptjs');
const crypto = require('crypto');

module.exports = function registerAdminRoutes({ app, io, getDb, auth, allow }) {
  const db = () => getDb();
  const clean = (v, n = 200) => String(v ?? '').trim().slice(0, n);
  const now = () => new Date().toISOString();
  const today = () => new Date().toISOString().slice(0, 10);
  const id = p => `${p}_${crypto.randomUUID()}`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || a));
  const publicUser = u => ({ username:u.username,name:u.name,role:u.role,group:u.group||'',faculty:u.faculty||'',department:u.department||'',active:u.active!==false,lastLoginAt:u.lastLoginAt||null,createdAt:u.createdAt||null });
  const roles = ['student','teacher','tutor','dean','rector','prorector','admin','tech'];
  const overlap = (as, ae, bs, be) => as < be && bs < ae;

  app.get('/api/manage/overview', auth, allow('admin','tech','rector','prorector','dean','tutor'), async (req,res) => {
    if (!db()) return res.json({ok:true,stats:{students:0,teachers:0,groups:0,liveLessons:0,online:io.engine.clientsCount,attendance:0,alerts:0},system:{db:'memory',socketClients:io.engine.clientsCount}});
    const [students,teachers,liveLessons,groups,alerts] = await Promise.all([
      db().collection('users').countDocuments({role:'student',active:{$ne:false}}),
      db().collection('users').countDocuments({role:'teacher',active:{$ne:false}}),
      db().collection('lessons').countDocuments({status:'live'}),
      db().collection('users').distinct('group',{role:'student',group:{$nin:['',null]}}),
      db().collection('notifications').countDocuments({read:false,type:'alert'}).catch(()=>0)
    ]);
    res.json({ok:true,stats:{students,teachers,groups:groups.length,liveLessons,online:io.engine.clientsCount,attendance:92,alerts},system:{db:'connected',socketClients:io.engine.clientsCount,uptime:Math.round(process.uptime())}});
  });

  app.get('/api/manage/users', auth, allow('admin','tech','dean','tutor'), async (req,res) => {
    if (!db()) return res.json({ok:true,items:[]});
    const limit=clamp(req.query.limit||50,1,100), skip=clamp(req.query.skip||0,0,100000);
    const query={}; if(req.query.role)query.role=clean(req.query.role,30); if(req.query.group)query.group=clean(req.query.group,60);
    const term=clean(req.query.q,80);
    if(term) query.$or=[{name:{$regex:term,$options:'i'}},{username:{$regex:term,$options:'i'}},{group:{$regex:term,$options:'i'}}];
    const items=await db().collection('users').find(query,{projection:{_id:0,passwordHash:0}}).sort({name:1}).skip(skip).limit(limit).toArray();
    res.json({ok:true,items:items.map(publicUser)});
  });

  app.post('/api/manage/users', auth, allow('admin','tech'), async (req,res) => {
    if(!db()) return res.status(503).json({ok:false,error:'db_required'});
    const username=clean(req.body.username,80).toLowerCase(), password=String(req.body.password||''), role=clean(req.body.role,30);
    if(!username || password.length<6 || !roles.includes(role)) return res.status(400).json({ok:false,error:'invalid_user'});
    if(await db().collection('users').findOne({username},{projection:{_id:1}})) return res.status(409).json({ok:false,error:'username_exists'});
    const doc={username,name:clean(req.body.name,140)||username,role,group:clean(req.body.group,60),faculty:clean(req.body.faculty,100),department:clean(req.body.department,100),active:true,passwordHash:await bcrypt.hash(password,10),preferences:{lowData:false,theme:'system'},createdAt:new Date(),updatedAt:new Date()};
    await db().collection('users').insertOne(doc); res.status(201).json({ok:true,user:publicUser(doc)});
  });

  app.post('/api/manage/users/bulk', auth, allow('admin','tech'), async (req,res) => {
    if(!db()) return res.status(503).json({ok:false,error:'db_required'});
    const rows=Array.isArray(req.body.items)?req.body.items.slice(0,200):[]; if(!rows.length)return res.status(400).json({ok:false,error:'items_required'});
    let created=0, skipped=0; const errors=[];
    for(let i=0;i<rows.length;i++){
      const r=rows[i]||{}, username=clean(r.username,80).toLowerCase(), password=String(r.password||''), role=clean(r.role||'student',30);
      if(!username||password.length<6||!roles.includes(role)){errors.push({row:i+1,error:'invalid'});continue;}
      if(await db().collection('users').findOne({username},{projection:{_id:1}})){skipped++;continue;}
      await db().collection('users').insertOne({username,name:clean(r.name,140)||username,role,group:clean(r.group,60),faculty:clean(r.faculty,100),department:clean(r.department,100),active:true,passwordHash:await bcrypt.hash(password,8),preferences:{lowData:false,theme:'system'},createdAt:new Date(),updatedAt:new Date()}); created++;
    }
    res.json({ok:true,created,skipped,errors});
  });

  app.patch('/api/manage/users/:username', auth, allow('admin','tech'), async (req,res) => {
    if(!db()) return res.status(503).json({ok:false,error:'db_required'});
    const patch={updatedAt:new Date()};
    ['name','group','faculty','department'].forEach(k=>{if(req.body[k]!==undefined)patch[k]=clean(req.body[k],140)});
    if(req.body.active!==undefined)patch.active=Boolean(req.body.active);
    if(req.body.role && roles.includes(req.body.role))patch.role=req.body.role;
    if(req.body.password && String(req.body.password).length>=6)patch.passwordHash=await bcrypt.hash(String(req.body.password),10);
    await db().collection('users').updateOne({username:clean(req.params.username,80).toLowerCase()},{$set:patch}); res.json({ok:true});
  });

  app.get('/api/manage/lessons', auth, async (req,res) => {
    if(!db()) return res.json({ok:true,items:[]});
    const query={}; if(req.query.date)query.date=clean(req.query.date,10); if(req.query.group)query.group=clean(req.query.group,60); if(req.query.status)query.status=clean(req.query.status,20);
    if(req.user.role==='teacher')query.teacherUsername=req.user.sub;
    if(req.user.role==='student'&&req.user.group)query.group=req.user.group;
    const items=await db().collection('lessons').find(query,{projection:{_id:0}}).sort({date:1,start:1}).limit(150).toArray(); res.json({ok:true,items});
  });

  app.post('/api/manage/lessons', auth, allow('admin','tech','dean','teacher'), async (req,res) => {
    if(!db()) return res.status(503).json({ok:false,error:'db_required'});
    const teacherSelf=req.user.role==='teacher';
    const doc={id:id('les'),subjectId:clean(req.body.subjectId,80),subject:clean(req.body.subject,140),group:clean(req.body.group,60),teacherUsername:teacherSelf?req.user.sub:clean(req.body.teacherUsername,80).toLowerCase(),teacher:teacherSelf?req.user.name:clean(req.body.teacher,140),date:clean(req.body.date,10),start:clean(req.body.start,5),end:clean(req.body.end,5),type:clean(req.body.type,40)||'Ma’ruza',status:'next',online:0,createdBy:req.user.sub,createdAt:new Date()};
    if(!doc.subject||!doc.group||!doc.date||!doc.start||!doc.end||doc.start>=doc.end)return res.status(400).json({ok:false,error:'invalid_lesson'});
    const same=await db().collection('lessons').find({date:doc.date},{projection:{_id:0,id:1,group:1,teacherUsername:1,start:1,end:1,subject:1}}).limit(500).toArray();
    const conflict=same.find(x=>overlap(doc.start,doc.end,x.start,x.end)&&(x.group===doc.group||(doc.teacherUsername&&x.teacherUsername===doc.teacherUsername)));
    if(conflict)return res.status(409).json({ok:false,error:'schedule_conflict',conflict});
    await db().collection('lessons').insertOne(doc); io.emit('schedule:changed',{type:'created',lesson:{...doc,_id:undefined}}); res.status(201).json({ok:true,item:{...doc,_id:undefined}});
  });

  app.patch('/api/manage/lessons/:id', auth, allow('admin','tech','dean','teacher'), async (req,res) => {
    if(!db()) return res.status(503).json({ok:false,error:'db_required'});
    const patch={updatedAt:new Date()}; ['subject','group','date','start','end','type','teacher','teacherUsername','subjectId'].forEach(k=>{if(req.body[k]!==undefined)patch[k]=clean(req.body[k],140)});
    if(req.body.status && ['next','live','ended','cancelled'].includes(req.body.status))patch.status=req.body.status;
    await db().collection('lessons').updateOne({id:clean(req.params.id,80)},{$set:patch}); io.emit('schedule:changed',{type:'updated',id:req.params.id,patch}); res.json({ok:true});
  });

  app.get('/api/manage/announcements', auth, async (req,res) => {
    if(!db()) return res.json({ok:true,items:[]});
    const items=await db().collection('announcements').find({},{projection:{_id:0}}).sort({at:-1,createdAt:-1}).limit(60).toArray(); res.json({ok:true,items});
  });

  app.post('/api/manage/announcements', auth, allow('admin','tech','dean','rector','prorector'), async (req,res) => {
    if(!db()) return res.status(503).json({ok:false,error:'db_required'});
    const doc={id:id('ann'),title:clean(req.body.title,180),body:clean(req.body.body,3000),audience:clean(req.body.audience,60)||'all',createdBy:req.user.sub,at:new Date(),createdAt:new Date()};
    if(!doc.title||!doc.body)return res.status(400).json({ok:false,error:'required'});
    await db().collection('announcements').insertOne(doc); io.emit('announcement:new',{...doc,_id:undefined}); res.status(201).json({ok:true,item:{...doc,_id:undefined}});
  });

  app.get('/api/manage/groups', auth, async (req,res) => {
    if(!db()) return res.json({ok:true,items:[]});
    const groups=await db().collection('users').aggregate([{$match:{role:'student',group:{$nin:['',null]}}},{$group:{_id:'$group',students:{$sum:1}}},{$sort:{_id:1}}]).toArray(); res.json({ok:true,items:groups.map(x=>({name:x._id,students:x.students}))});
  });

  app.get('/api/manage/today', auth, async (req,res) => {
    if(!db()) return res.json({ok:true,items:[]});
    const items=await db().collection('lessons').find({$or:[{date:today()},{date:{$exists:false}}]},{projection:{_id:0}}).sort({start:1}).limit(100).toArray(); res.json({ok:true,items});
  });
};
