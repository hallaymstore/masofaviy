const crypto=require('crypto');
const jwt=require('jsonwebtoken');
const {MongoClient}=require('mongodb');

const expressPath=require.resolve('express');
const originalExpress=require(expressPath);
let mongoClient=null,db=null,connecting=null;
const managers=new Set(['admin','tech','rector','prorector','dean','tutor']);
const creators=new Set(['teacher','admin','tech','rector','prorector','dean']);
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const now=()=>new Date();
const json=originalExpress.json({limit:'512kb'});

async function getDb(){
  if(db)return db;
  if(connecting)return connecting;
  const uri=process.env.MONGODB_URI||'';
  if(!uri)throw new Error('db_required');
  connecting=(async()=>{
    mongoClient=new MongoClient(uri,{serverSelectionTimeoutMS:8000,connectTimeoutMS:10000,maxPoolSize:10,minPoolSize:0,maxIdleTimeMS:60000,retryReads:true,retryWrites:true});
    await mongoClient.connect();
    db=mongoClient.db(process.env.DB_NAME||'masofaviy');
    await Promise.all([
      db.collection('compliance_evidence').createIndex({code:1},{unique:true}),
      db.collection('exams').createIndex({group:1,status:1,startAt:1}),
      db.collection('exam_attempts').createIndex({examId:1,username:1},{unique:true}),
      db.collection('proctor_events').createIndex({attemptId:1,at:-1})
    ]).catch(()=>{});
    return db;
  })();
  try{return await connecting}finally{connecting=null}
}
function cookieValue(header,name){
  const row=String(header||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
  if(!row)return'';
  try{return decodeURIComponent(row.slice(name.length+1))}catch{return row.slice(name.length+1)}
}
async function currentUser(req){
  const token=cookieValue(req.headers.cookie,'session')||String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token)throw Object.assign(new Error('auth_required'),{status:401});
  let claims;try{claims=jwt.verify(token,process.env.JWT_SECRET)}catch{throw Object.assign(new Error('invalid_session'),{status:401})}
  const database=await getDb();
  const user=await database.collection('users').findOne({username:clean(claims.sub,80).toLowerCase(),active:{$ne:false}},{projection:{_id:0,passwordHash:0}});
  if(!user)throw Object.assign(new Error('account_disabled'),{status:401});
  return user;
}
function fail(res,e){res.status(e.status||500).json({ok:false,error:e.message||'request_failed'})}
function allowedExam(user,exam){
  if(managers.has(user.role))return true;
  if(user.role==='teacher')return exam.teacherUsername===user.username;
  if(user.role==='student')return Boolean(user.group)&&exam.group===user.group&&exam.status!=='draft';
  return false;
}
const university={
  name:'Qarshi davlat texnika universiteti',
  shortName:'QDTU',
  established:{date:'2024-12-10',basis:'O‘zbekiston Respublikasi Prezidentining PQ-428-son qarori'},
  rector:'Nematov Sherzod Qalandarovich',
  address:'180100, Qashqadaryo viloyati, Qarshi shahri, Mustaqillik shoh ko‘chasi, 225-uy',
  callCenter:'+998 75 220-09-24',
  rectorPhone:'+998 75 221-09-23',
  rectorEmail:'rektor@kstu.uz',
  officialSite:'https://kstu.uz/uz',
  faculties:[
    'Transport va qurilish muhandisligi fakulteti','Energetika muhandisligi fakulteti','Neft-gaz va geologiya fakulteti','Raqamli texnologiyalar va sun’iy intellekt fakulteti','Shahrisabz oziq-ovqat muhandisligi fakulteti','Iqtisodiyot va boshqaruv fakulteti','Irrigatsiya muhandisligi fakulteti'
  ],
  officialResources:[
    {title:'QDTU rasmiy sayti',url:'https://kstu.uz/uz'},
    {title:'QDTU rahbariyati — rektor',url:'https://kstu.uz/en/page/rector'},
    {title:'QDTU masofaviy ta’lim tizimi',url:'https://moodle.kstu.uz/?lang=uz'},
    {title:'O‘qituvchi portfoliyasi',url:'https://portfel.kstu.uz/'},
    {title:'QDTU ilmiy repozitoriysi',url:'https://dspace.kstu.uz/'},
    {title:'Rasmiy dars jadvali sahifasi',url:'https://kstu.uz/uz/page/class-schedule'}
  ]
};
const requirementBase=[
  {code:'R3',order:3,title:'Raqamli o‘qitish (virtual classroom) infratuzilmasi',kind:'technical',detail:'Real vaqt audio/video, ekran ulashish, yozib olish/replay uchun LMS bilan integratsiya.'},
  {code:'R4',order:4,title:'Umumiy, guruh va individual ta’lim shakllari',kind:'technical',detail:'Ma’ruza, seminar, amaliy, mustaqil va individual mashg‘ulotlarni rejalashtirish.'},
  {code:'R7',order:7,title:'Ta’limga oid rasmiy ma’lumot va hujjatlar',kind:'evidence',detail:'Ustav/nizom, o‘quv reja va dasturlar, pedagog kadrlar, akademik kalendar va boshqa rasmiy ma’lumotlar.'},
  {code:'R2',order:2,title:'Avtoproktoring tizimi',kind:'technical',detail:'Onlayn nazorat: kamera, ekran, fokus/fullscreen nazorati va brauzer qo‘llasa yuzni aniqlash signallari.'},
  {code:'R8',order:8,title:'Kurslarni boshqarish komponenti',kind:'technical',detail:'Kurs/fan yaratish, tahrirlash, guruh va o‘qituvchilarni biriktirish.'},
  {code:'R9',order:9,title:'O‘qitishni boshqarish komponenti',kind:'technical',detail:'Jadval, material, topshiriq, dars, chat va monitoring.'},
  {code:'R10',order:10,title:'Statistika komponenti',kind:'technical',detail:'Foydalanuvchi, guruh, dars, davomat, topshiriq va nazorat statistikasi.'},
  {code:'R11',order:11,title:'Talabalar bilimini nazorat qilish komponenti',kind:'technical',detail:'Test/imtihon, topshiriq, baholash, natijalar va proktoring hodisalari.'},
  {code:'R12',order:12,title:'“Raqamli hukumat” yagona reestrida ro‘yxatdan o‘tganligi',kind:'external',detail:'Bu huquqiy/tashkiliy talab. Faqat rasmiy reestr hujjati yoki xulosasi bilan tasdiqlanadi.'},
  {code:'R13',order:13,title:'“Kiberxavfsizlik markazi” DUK ekspertiza xulosasi',kind:'external',detail:'Axborot xavfsizligi talablariga muvofiqlik bo‘yicha rasmiy ijobiy xulosa talab etiladi.'}
];

async function computeRequirements(database){
  const evidence=await database.collection('compliance_evidence').find({}).project({_id:0}).toArray().catch(()=>[]);
  const evidenceMap=new Map(evidence.map(x=>[x.code,x]));
  const technical={R3:Boolean(process.env.RTC_BRIDGE_URL),R4:true,R2:true,R8:true,R9:true,R10:true,R11:true};
  return requirementBase.map(r=>{
    const ev=evidenceMap.get(r.code)||null;
    let status='pending';
    if(r.kind==='technical')status=technical[r.code]?'implemented':'pending';
    else if(ev?.verified===true)status='verified';
    else if(ev?.url||ev?.documentNo)status='evidence-added';
    return {...r,status,evidence:ev};
  });
}
function install(app){
  app.get('/api/compliance/overview',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb();
    const requirements=await computeRequirements(database);
    const [students,teachers,groups,lessons,subjects,exams,attempts]=await Promise.all([
      database.collection('users').countDocuments({role:'student'}),database.collection('users').countDocuments({role:'teacher'}),database.collection('users').distinct('group',{role:'student',group:{$nin:['',null]}}).then(x=>x.length),database.collection('lessons').countDocuments({}),database.collection('subjects').countDocuments({}),database.collection('exams').countDocuments({}),database.collection('exam_attempts').countDocuments({})
    ]);
    res.set('Cache-Control','no-store');
    res.json({ok:true,userRole:user.role,university,requirements,stats:{students,teachers,groups,lessons,subjects,exams,attempts},capabilities:{rtc:Boolean(process.env.RTC_BRIDGE_URL),groupIsolation:true,courseManagement:true,teachingManagement:true,statistics:true,assessment:true,proctoring:{camera:true,screen:true,focus:true,faceDetection:'browser-supported',externalAi:Boolean(process.env.PROCTOR_AI_ENDPOINT)}}});
  }catch(e){fail(res,e)}});

  app.post('/api/compliance/evidence/:code',json,async(req,res)=>{try{
    const user=await currentUser(req);if(!managers.has(user.role))throw Object.assign(new Error('forbidden'),{status:403});
    const code=clean(req.params.code,20).toUpperCase();if(!requirementBase.some(x=>x.code===code))throw Object.assign(new Error('unknown_requirement'),{status:404});
    const database=await getDb();
    const doc={code,title:clean(req.body?.title,220),documentNo:clean(req.body?.documentNo,120),url:clean(req.body?.url,1000),note:clean(req.body?.note,2000),verified:req.body?.verified===true,updatedAt:now(),updatedBy:user.username};
    await database.collection('compliance_evidence').updateOne({code},{$set:doc},{upsert:true});
    res.json({ok:true,item:{...doc,_id:undefined}});
  }catch(e){fail(res,e)}});

  app.get('/api/exams',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb();let q={};
    if(user.role==='student')q={group:user.group,status:{$in:['published','active']}};
    else if(user.role==='teacher')q={teacherUsername:user.username};
    const items=await database.collection('exams').find(q,{projection:{_id:0,answerKey:0}}).sort({createdAt:-1}).limit(100).toArray();
    res.json({ok:true,items});
  }catch(e){fail(res,e)}});

  app.post('/api/exams',json,async(req,res)=>{try{
    const user=await currentUser(req);if(!creators.has(user.role))throw Object.assign(new Error('forbidden'),{status:403});
    const title=clean(req.body?.title,180),group=clean(req.body?.group,60),subjectId=clean(req.body?.subjectId,80),durationMin=Math.max(5,Math.min(240,Number(req.body?.durationMin)||60));
    const raw=Array.isArray(req.body?.questions)?req.body.questions.slice(0,100):[];
    const questions=raw.map((q,i)=>({id:`q${i+1}`,text:clean(q.text,1000),options:(Array.isArray(q.options)?q.options:[]).slice(0,8).map(x=>clean(x,400)),answer:Math.max(0,Number(q.answer)||0),points:Math.max(1,Math.min(100,Number(q.points)||1))})).filter(q=>q.text&&q.options.length>=2&&q.answer<q.options.length);
    if(!title||!group||!questions.length)throw Object.assign(new Error('required'),{status:400});
    if(user.role==='teacher'){
      const database=await getDb();const owns=await database.collection('subjects').findOne({teacherUsername:user.username,groups:group},{projection:{_id:1}});if(!owns)throw Object.assign(new Error('group_access_denied'),{status:403});
    }
    const id=`EX-${crypto.randomUUID()}`,doc={id,title,group,subjectId,durationMin,status:req.body?.status==='draft'?'draft':'published',teacherUsername:user.username,teacher:user.name||user.username,proctor:{camera:req.body?.camera!==false,screen:req.body?.screen!==false,fullscreen:req.body?.fullscreen!==false,faceDetection:req.body?.faceDetection!==false},questions:questions.map(({answer,...q})=>q),answerKey:Object.fromEntries(questions.map(q=>[q.id,{answer:q.answer,points:q.points}])),createdAt:now()};
    const database=await getDb();await database.collection('exams').insertOne(doc);res.status(201).json({ok:true,item:{...doc,answerKey:undefined}});
  }catch(e){fail(res,e)}});

  app.post('/api/exams/:id/start',json,async(req,res)=>{try{
    const user=await currentUser(req);if(user.role!=='student')throw Object.assign(new Error('student_required'),{status:403});
    const database=await getDb(),exam=await database.collection('exams').findOne({id:clean(req.params.id,100)},{projection:{_id:0,answerKey:0}});
    if(!exam||!allowedExam(user,exam))throw Object.assign(new Error('exam_access_denied'),{status:403});
    const attemptId=`ATT-${crypto.randomUUID()}`,startedAt=now(),expiresAt=new Date(Date.now()+exam.durationMin*60000);
    const doc={attemptId,examId:exam.id,username:user.username,name:user.name,group:user.group,status:'in-progress',startedAt,expiresAt,proctorConsent:req.body?.consent===true,client:{userAgent:clean(req.headers['user-agent'],500)},warnings:0};
    try{await database.collection('exam_attempts').insertOne(doc)}catch(e){if(e?.code===11000){const old=await database.collection('exam_attempts').findOne({examId:exam.id,username:user.username},{projection:{_id:0}});return res.json({ok:true,attempt:old,exam})}throw e}
    res.json({ok:true,attempt:doc,exam});
  }catch(e){fail(res,e)}});

  app.post('/api/proctor/:attemptId/event',json,async(req,res)=>{try{
    const user=await currentUser(req);if(user.role!=='student')throw Object.assign(new Error('student_required'),{status:403});
    const database=await getDb(),attempt=await database.collection('exam_attempts').findOne({attemptId:clean(req.params.attemptId,120),username:user.username});
    if(!attempt)throw Object.assign(new Error('attempt_not_found'),{status:404});
    if(attempt.status!=='in-progress')throw Object.assign(new Error('attempt_closed'),{status:409});
    const type=clean(req.body?.type,60)||'heartbeat';const riskTypes=new Set(['tab-hidden','fullscreen-exit','camera-lost','screen-lost','multiple-faces','no-face']);
    const row={attemptId:attempt.attemptId,examId:attempt.examId,username:user.username,type,at:now(),cameraAlive:Boolean(req.body?.cameraAlive),screenAlive:Boolean(req.body?.screenAlive),fullscreen:Boolean(req.body?.fullscreen),visible:req.body?.visible!==false,faceCount:Number.isFinite(Number(req.body?.faceCount))?Math.max(0,Math.min(10,Number(req.body.faceCount))):null,note:clean(req.body?.note,500)};
    await database.collection('proctor_events').insertOne(row);if(riskTypes.has(type))await database.collection('exam_attempts').updateOne({attemptId:attempt.attemptId},{$inc:{warnings:1},$set:{lastRiskAt:row.at}});
    res.json({ok:true});
  }catch(e){fail(res,e)}});

  app.post('/api/exams/:id/submit',json,async(req,res)=>{try{
    const user=await currentUser(req);if(user.role!=='student')throw Object.assign(new Error('student_required'),{status:403});
    const database=await getDb(),exam=await database.collection('exams').findOne({id:clean(req.params.id,100)},{projection:{_id:0}});if(!exam||exam.group!==user.group)throw Object.assign(new Error('exam_access_denied'),{status:403});
    const attempt=await database.collection('exam_attempts').findOne({examId:exam.id,username:user.username});if(!attempt||attempt.status!=='in-progress')throw Object.assign(new Error('attempt_not_found'),{status:404});
    const answers=req.body?.answers&&typeof req.body.answers==='object'?req.body.answers:{};let score=0,maxScore=0;
    for(const [qid,key] of Object.entries(exam.answerKey||{})){maxScore+=Number(key.points)||1;if(Number(answers[qid])===Number(key.answer))score+=Number(key.points)||1}
    const pct=maxScore?Math.round(score/maxScore*100):0,submittedAt=now();await database.collection('exam_attempts').updateOne({attemptId:attempt.attemptId},{$set:{status:'submitted',answers,score,maxScore,percentage:pct,submittedAt}});
    res.json({ok:true,result:{score,maxScore,percentage:pct,warnings:attempt.warnings||0}});
  }catch(e){fail(res,e)}});

  app.get('/api/exams/:id/results',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb(),exam=await database.collection('exams').findOne({id:clean(req.params.id,100)},{projection:{_id:0,answerKey:0}});if(!exam||!allowedExam(user,exam)||user.role==='student')throw Object.assign(new Error('forbidden'),{status:403});
    const items=await database.collection('exam_attempts').find({examId:exam.id},{projection:{_id:0,answers:0}}).sort({percentage:-1,submittedAt:1}).toArray();
    res.json({ok:true,exam,items});
  }catch(e){fail(res,e)}});
}
function wrappedExpress(...args){const app=originalExpress(...args);install(app);return app}
Object.assign(wrappedExpress,originalExpress);
require.cache[expressPath].exports=wrappedExpress;
process.on('SIGTERM',()=>mongoClient?.close().catch(()=>{}));
