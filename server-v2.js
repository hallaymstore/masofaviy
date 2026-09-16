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
const registerEducationRoutes = require('./education-routes');
const registerAdminRoutes = require('./admin-routes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports:['websocket','polling'], pingInterval:25000, pingTimeout:20000, cors:{origin:true,credentials:true} });

const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET = process.env.JWT_SECRET || crypto.createHash('sha256').update(`dev-${process.pid}-${Date.now()}`).digest('hex');
const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.DB_NAME || 'masofaviy';
const APP_NAME = process.env.APP_NAME || "QDTU Masofaviy Ta'lim";
const RTC_BRIDGE_URL = process.env.RTC_BRIDGE_URL || '';
const SESSION_DAYS = Math.max(30, Number(process.env.SESSION_DAYS || 180));

app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
app.use(compression({threshold:1024}));
app.use(express.json({limit:'2mb'}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname,'public'),{maxAge:'1h',etag:true,immutable:false}));

let mongoClient=null, db=null, mongoStatus='memory';
const memory={users:[],lessons:[],announcements:[],attendance_events:[]};
const now=()=>new Date();
const clean=(v,n=200)=>String(v??'').trim().slice(0,n);

async function ensureBaseIndexes(){
  if(!db)return;
  await Promise.all([
    db.collection('users').createIndex({username:1},{unique:true}),
    db.collection('users').createIndex({role:1,group:1}),
    db.collection('lessons').createIndex({date:1,start:1,group:1}),
    db.collection('lessons').createIndex({teacherUsername:1,date:1}),
    db.collection('attendance_events').createIndex({lessonId:1,username:1,at:-1}),
    db.collection('announcements').createIndex({at:-1})
  ]).catch(e=>console.warn('index warning:',e.message));
}

async function maybeSeedBase(){
  if(!db)return;
  const users=db.collection('users');
  const configured=[
    {username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD,name:'Bosh administrator',role:'admin'},
    {username:process.env.DEMO_TEACHER_USERNAME,password:process.env.DEMO_TEACHER_PASSWORD,name:"O‘qituvchi Demo",role:'teacher'},
    {username:process.env.DEMO_STUDENT_USERNAME,password:process.env.DEMO_STUDENT_PASSWORD,name:'Talaba Demo',role:'student',group:'MMT-520-25'}
  ].filter(x=>x.username&&x.password);
  for(const u of configured){
    const username=clean(u.username,80).toLowerCase();
    const existing=await users.findOne({username},{projection:{_id:1,group:1}});
    if(!existing) await users.insertOne({username,name:u.name,role:u.role,group:u.group||'',active:true,passwordHash:await bcrypt.hash(String(u.password),10),preferences:{lowData:false,theme:'system'},createdAt:now(),updatedAt:now()});
    else if(u.group&&!existing.group) await users.updateOne({username},{$set:{group:u.group,updatedAt:now()}});
  }
  if(await db.collection('lessons').estimatedDocumentCount()===0){
    const date=new Date().toISOString().slice(0,10);
    await db.collection('lessons').insertMany([
      {id:'L-1001',subjectId:'SUB-MATH',subject:'Matematika',group:'MMT-520-25',teacherUsername:'teacher',teacher:"O‘qituvchi Demo",date,start:'10:30',end:'11:50',type:'Ma’ruza',status:'live',online:0,createdAt:now()},
      {id:'L-1002',subjectId:'SUB-IT',subject:'Axborot texnologiyalari',group:'MMT-519-25',teacherUsername:'teacher',teacher:"O‘qituvchi Demo",date,start:'13:00',end:'14:20',type:'Amaliy',status:'next',online:0,createdAt:now()},
      {id:'L-1003',subjectId:'SUB-ECO',subject:'Iqtisodiyot',group:'MMT-520-25',teacherUsername:'teacher',teacher:"O‘qituvchi Demo",date,start:'15:00',end:'16:20',type:'Seminar',status:'next',online:0,createdAt:now()}
    ]);
  }
  if(await db.collection('announcements').estimatedDocumentCount()===0) await db.collection('announcements').insertOne({id:'A1',title:'Masofaviy ta’lim platformasi ishga tushdi',body:'Darslar jadval asosida ushbu platformada olib boriladi.',audience:'all',at:now(),createdAt:now()});
}

async function connectDb(){
  if(!MONGODB_URI){mongoStatus='memory';return;}
  try{
    mongoClient=new MongoClient(MONGODB_URI,{serverSelectionTimeoutMS:Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS||8000),connectTimeoutMS:10000,minPoolSize:Number(process.env.MONGODB_MIN_POOL_SIZE||1),maxPoolSize:Number(process.env.MONGODB_MAX_POOL_SIZE||20),maxIdleTimeMS:60000,retryReads:true,retryWrites:true});
    await mongoClient.connect(); db=mongoClient.db(DB_NAME); mongoStatus='connected'; await ensureBaseIndexes(); await maybeSeedBase(); console.log('MongoDB connected:',DB_NAME);
  }catch(e){mongoStatus='fallback-memory';db=null;console.error('MongoDB unavailable:',e.message);}
}

function sign(u){return jwt.sign({sub:u.username,role:u.role,name:u.name,group:u.group||''},JWT_SECRET,{expiresIn:`${SESSION_DAYS}d`});}
function auth(req,res,next){const token=req.cookies.session||(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)return res.status(401).json({ok:false,error:'auth_required'});try{req.user=jwt.verify(token,JWT_SECRET);next();}catch{return res.status(401).json({ok:false,error:'invalid_session'});}}
function allow(...roles){return(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({ok:false,error:'forbidden'});}
function cookieOptions(){return{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:SESSION_DAYS*86400000,path:'/'};}

app.get('/health',(req,res)=>res.json({ok:true,app:APP_NAME,version:'2.0',db:mongoStatus,rtc:RTC_BRIDGE_URL?'external-ready':'waiting-sfu',uptime:Math.round(process.uptime()),time:new Date().toISOString()}));
app.get('/api/config',(req,res)=>res.json({ok:true,appName:APP_NAME,version:'2.0',pwa:true,lowDataMode:true,sessionDays:SESSION_DAYS,rtcEnabled:Boolean(RTC_BRIDGE_URL),rtcBridgeUrl:RTC_BRIDGE_URL||null}));

app.post('/api/auth/login',async(req,res)=>{
  const username=clean(req.body.username,80).toLowerCase(),password=String(req.body.password||'').slice(0,200);
  let u=db?await db.collection('users').findOne({username},{projection:{username:1,name:1,role:1,group:1,passwordHash:1,active:1,preferences:1}}):memory.users.find(x=>x.username===username);
  if(!u||u.active===false||!(await bcrypt.compare(password,u.passwordHash)))return res.status(401).json({ok:false,error:'login_failed'});
  res.cookie('session',sign(u),cookieOptions());res.set('Cache-Control','no-store');
  if(db)db.collection('users').updateOne({username},{$set:{lastLoginAt:now(),updatedAt:now()}}).catch(()=>{});
  res.json({ok:true,user:{username:u.username,name:u.name,role:u.role,group:u.group||'',preferences:u.preferences||{}}});
});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('session',{path:'/'});res.json({ok:true});});
app.get('/api/me',auth,async(req,res)=>{
  if(!db)return res.json({ok:true,user:req.user});
  const u=await db.collection('users').findOne({username:req.user.sub},{projection:{_id:0,passwordHash:0}});if(!u||u.active===false)return res.status(401).json({ok:false,error:'account_disabled'});res.set('Cache-Control','no-store');res.json({ok:true,user:{username:u.username,name:u.name,role:u.role,group:u.group||'',faculty:u.faculty||'',department:u.department||'',preferences:u.preferences||{}}});
});

app.get('/api/dashboard',auth,async(req,res)=>{
  if(!db)return res.json({ok:true,role:req.user.role,stats:{todayLessons:0,liveLessons:0,attendance:0,pendingTasks:0,unread:0},lessons:[],announcements:[]});
  const date=new Date().toISOString().slice(0,10);const q={$or:[{date},{date:{$exists:false}}]};
  if(req.user.role==='student'&&req.user.group)q.group=req.user.group;if(req.user.role==='teacher')q.teacherUsername=req.user.sub;
  const [lessons,announcements,pending,unread]=await Promise.all([
    db.collection('lessons').find(q,{projection:{_id:0}}).sort({start:1}).limit(20).toArray(),
    db.collection('announcements').find({},{projection:{_id:0}}).sort({at:-1,createdAt:-1}).limit(8).toArray(),
    db.collection('assignments').countDocuments(req.user.role==='student'&&req.user.group?{group:req.user.group,status:'active'}:req.user.role==='teacher'?{createdBy:req.user.sub,status:'active'}:{status:'active'}).catch(()=>0),
    db.collection('notifications').countDocuments({username:req.user.sub,read:false}).catch(()=>0)
  ]);
  res.set('Cache-Control','private, max-age=8');res.json({ok:true,role:req.user.role,stats:{todayLessons:lessons.length,liveLessons:lessons.filter(x=>x.status==='live').length,attendance:92,pendingTasks:pending,unread},lessons,announcements});
});

app.post('/api/lessons/:id/attendance',auth,async(req,res)=>{const row={lessonId:clean(req.params.id,80),username:req.user.sub,name:req.user.name,role:req.user.role,event:['join','leave','heartbeat','reconnect'].includes(req.body.event)?req.body.event:'heartbeat',network:clean(req.body.network,30)||'unknown',at:now()};if(db)await db.collection('attendance_events').insertOne(row);else memory.attendance_events.push(row);res.json({ok:true});});
app.get('/api/rtc/status',auth,(req,res)=>res.json({ok:true,mode:RTC_BRIDGE_URL?'external-mediasoup':'preflight',bridge:RTC_BRIDGE_URL||null}));

io.use((socket,next)=>{const raw=socket.handshake.headers.cookie||'';const part=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith('session='));const token=socket.handshake.auth?.token||(part?decodeURIComponent(part.slice(8)):'');if(!token)return next(new Error('auth_required'));try{socket.user=jwt.verify(token,JWT_SECRET);next();}catch{return next(new Error('invalid_session'));}});

registerEducationRoutes({app,io,getDb:()=>db,auth,allow});
registerAdminRoutes({app,io,getDb:()=>db,auth,allow});

io.on('connection',socket=>{
  socket.join(`user:${socket.user.sub}`);
  socket.on('room:join',roomId=>{const room=`lesson:${clean(roomId,64)}`;socket.join(room);socket.data.room=room;const online=io.sockets.adapter.rooms.get(room)?.size||1;io.to(room).emit('presence',{type:'snapshot',online});});
  socket.on('chat:send',payload=>{if(!socket.data.room)return;const text=clean(payload?.text,800);if(!text)return;io.to(socket.data.room).emit('chat:message',{id:crypto.randomUUID(),text,user:socket.user.name,role:socket.user.role,at:new Date().toISOString()});});
  socket.on('raise-hand',state=>socket.data.room&&io.to(socket.data.room).emit('hand',{user:socket.user.name,state:Boolean(state)}));
  socket.on('disconnect',()=>{if(!socket.data.room)return;const online=io.sockets.adapter.rooms.get(socket.data.room)?.size||0;io.to(socket.data.room).emit('presence',{type:'snapshot',online});});
});

app.use((err,req,res,next)=>{console.error(err);if(res.headersSent)return next(err);res.status(500).json({ok:false,error:'server_error'});});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

connectDb().finally(()=>server.listen(PORT,'0.0.0.0',()=>console.log(`${APP_NAME} v2 listening on ${PORT}`)));
process.on('SIGTERM',async()=>{try{await mongoClient?.close();}catch{}server.close(()=>process.exit(0));});
