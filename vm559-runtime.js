const crypto=require('crypto');
const jwt=require('jsonwebtoken');
const {MongoClient}=require('mongodb');

const expressPath=require.resolve('express');
const originalExpress=require(expressPath);
const json=originalExpress.json({limit:'2mb'});
let mongoClient=null,db=null,connecting=null;

const managers=new Set(['admin','tech','rector','prorector','dean','tutor']);
const academicManagers=new Set(['admin','tech','rector','prorector','dean','tutor']);
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const now=()=>new Date();
const id=p=>`${p}_${crypto.randomUUID()}`;
const LAW_URL='https://lex.uz/docs/-6221502';

async function getDb(){
  if(db)return db;
  if(connecting)return connecting;
  const uri=process.env.MONGODB_URI||'';
  if(!uri)throw Object.assign(new Error('db_required'),{status:503});
  connecting=(async()=>{
    mongoClient=new MongoClient(uri,{serverSelectionTimeoutMS:8000,connectTimeoutMS:10000,maxPoolSize:15,minPoolSize:0,maxIdleTimeMS:60000,retryReads:true,retryWrites:true});
    await mongoClient.connect();
    db=mongoClient.db(process.env.DB_NAME||'masofaviy');
    const auditDays=Math.max(30,Number(process.env.AUDIT_RETENTION_DAYS||730));
    const proctorDays=Math.max(30,Number(process.env.PROCTOR_RETENTION_DAYS||180));
    await Promise.all([
      db.collection('vm559_evidence').createIndex({code:1},{unique:true}),
      db.collection('audit_logs').createIndex({at:1},{expireAfterSeconds:auditDays*86400}),
      db.collection('audit_logs').createIndex({username:1,at:-1}),
      db.collection('study_plans').createIndex({username:1,academicYear:1,semester:1},{unique:true}),
      db.collection('credit_records').createIndex({username:1,subjectId:1,academicYear:1,semester:1},{unique:true}),
      db.collection('student_movements').createIndex({username:1,at:-1}),
      db.collection('monitoring_activities').createIndex({at:-1}),
      db.collection('quality_surveys').createIndex({active:1,createdAt:-1}),
      db.collection('survey_responses').createIndex({surveyId:1,username:1},{unique:true}),
      db.collection('complaints').createIndex({username:1,createdAt:-1}),
      db.collection('programs').createIndex({code:1},{unique:true}),
      db.collection('practices').createIndex({username:1,startAt:1}),
      db.collection('integration_sync_logs').createIndex({createdAt:-1}),
      db.collection('proctor_events').createIndex({at:1},{expireAfterSeconds:proctorDays*86400})
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
function claimsFrom(req){
  const token=cookieValue(req.headers.cookie,'session')||String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token||!process.env.JWT_SECRET)return null;
  try{return jwt.verify(token,process.env.JWT_SECRET)}catch{return null}
}
async function currentUser(req){
  const claims=claimsFrom(req);
  if(!claims)throw Object.assign(new Error('auth_required'),{status:401});
  const database=await getDb();
  const user=await database.collection('users').findOne({username:clean(claims.sub,80).toLowerCase(),active:{$ne:false}},{projection:{_id:0,passwordHash:0}});
  if(!user)throw Object.assign(new Error('account_disabled'),{status:401});
  return user;
}
function fail(res,e){res.status(e.status||500).json({ok:false,error:e.message||'request_failed'})}
function requireManager(user){if(!managers.has(user?.role))throw Object.assign(new Error('forbidden'),{status:403})}
function evidenceStatus(ev){return ev?.verified===true?'verified':(ev?.documentNo||ev?.url)?'evidence-added':'pending'}
async function getEvidence(database){
  const rows=await database.collection('vm559_evidence').find({},{projection:{_id:0}}).toArray();
  return new Map(rows.map(x=>[x.code,x]));
}
async function groupCapacity(database){
  const groups=await database.collection('users').aggregate([
    {$match:{role:'student',active:{$ne:false},group:{$nin:['',null]}}},
    {$group:{_id:'$group',students:{$sum:1}}},
    {$sort:{_id:1}}
  ]).toArray();
  return groups.map(x=>({group:x._id,students:x.students,limit:50,ok:x.students<=50,overflow:Math.max(0,x.students-50)}));
}
async function contentCoverage(database){
  const subjects=await database.collection('subjects').find({},{projection:{_id:0,id:1,name:1,groups:1}}).toArray();
  const out=[];
  for(const s of subjects){
    const [materials,assignments,videos]=await Promise.all([
      database.collection('materials').countDocuments({subjectId:s.id}),
      database.collection('assignments').countDocuments({subjectId:s.id}),
      database.collection('videos').countDocuments({subjectId:s.id}).catch(()=>0)
    ]);
    out.push({subjectId:s.id,name:s.name,materials,assignments,videos,ok:materials>0&&assignments>0});
  }
  return out;
}
async function buildRequirements(database){
  const ev=await getEvidence(database);
  const [capacity,coverage,studentCount,programs]=await Promise.all([
    groupCapacity(database),
    contentCoverage(database),
    database.collection('users').countDocuments({role:'student',active:{$ne:false}}),
    database.collection('programs').find({},{projection:{_id:0}}).toArray()
  ]);
  const noOver=capacity.every(x=>x.ok);
  const coverageOk=coverage.length>0&&coverage.every(x=>x.ok);
  const serverCountry=String(process.env.SERVER_COUNTRY||'').toUpperCase();
  const ownership=String(process.env.SERVER_OWNERSHIP||'').toLowerCase();
  const leaseYears=Number(process.env.SERVER_LEASE_YEARS||0);
  const serverReady=serverCountry==='UZ'&&(ownership==='owned'||(ownership==='lease'&&leaseYears>=5));
  const hemisConfigured=Boolean(process.env.HEMIS_API_URL&&process.env.HEMIS_API_TOKEN);
  const proctorAi=Boolean(process.env.PROCTOR_AI_ENDPOINT);
  const onsiteMissing=await database.collection('users').countDocuments({role:'student',active:{$ne:false},onsiteRegistrationVerifiedAt:{$exists:false}});
  const programPolicyOk=programs.every(p=>p.distanceAllowed!==false&&p.daytimeExists!==false&&(p.isICT===true||Number(p.admissionQuota||0)<= (p.level==='master'?30:300)));
  const rows=[
    ['VM559-8-LMS','8-band','LMS platformasi','Dasturiy LMS mavjud va foydalanuvchi rollari bilan ishlaydi.','ready'],
    ['VM559-8-INTERNET','8-band','Internet va AKT infratuzilmasi','Universitetning yuqori tezlikdagi Internet va AKT infratuzilmasi rasmiy dalil bilan tasdiqlanadi.',evidenceStatus(ev.get('VM559-8-INTERNET'))],
    ['VM559-8-CONTENT','8-band','O‘quv yili kontenti va elektron O‘UM','Barcha fanlar bo‘yicha material, topshiriq va metodik resurslar to‘ldirilishi nazorat qilinadi.',coverageOk?'ready':'partial'],
    ['VM559-8-ROOMS','8-band','Jihozlangan auditoriyalar','Sanitariya normalariga mos kompyuter auditoriyasi bo‘yicha dalil talab qilinadi.',evidenceStatus(ev.get('VM559-8-ROOMS'))],
    ['VM559-8-STAFF','8-band','Muhandis-texnik xodimlar','Masofaviy ta’lim texnik xodimlari bo‘yicha buyruq/shtat dalili talab qilinadi.',evidenceStatus(ev.get('VM559-8-STAFF'))],
    ['VM559-8-SERVER','8-band','O‘zbekistondagi server va 5 yillik huquq','Server mamlakat hududida va OTM mulki yoki kamida 5 yillik ijara asosida bo‘lishi kerak.',serverReady?'ready':evidenceStatus(ev.get('VM559-8-SERVER'))],
    ['VM559-8-WEBSITE','8-band','Rasmiy veb-sahifa','Ustav/nizom, reja-dasturlar, pedagoglar va akademik kalendar rasmiy saytda bo‘lishi kerak.',evidenceStatus(ev.get('VM559-8-WEBSITE'))],
    ['VM559-9-OZDST','9-band','O‘zDSt 36.2030','Elektron metodik resurslar standartga muvofiqligi tashqi/ruxsatli tekshiruv bilan tasdiqlanadi.',evidenceStatus(ev.get('VM559-9-OZDST'))],
    ['VM559-10-SCORM','10-band','SCORM mosligi','SCORM 1.2/2004 paket importi va runtime API moduli.',global.__QDTU_SCORM_ENABLED===true?'ready':'partial'],
    ['VM559-10-PROCTOR','10-band','Avtoproktoring','Kamera, ekran, fokus/fullscreen, yuz soni va hodisa hisobotlari mavjud; gaze/identity/audio AI tashqi modul bilan kuchaytiriladi.',proctorAi?'ready':'partial'],
    ['VM559-11-RESOURCES','11-band','Axborot-resurslari komponenti','Materiallar va tashqi resurslar katalogi mavjud.','ready'],
    ['VM559-11-MANAGEMENT','11-band','Boshqarish, autentifikatsiya va audit','Rolga asoslangan ruxsat, foydalanuvchi reyestri va audit jurnali mavjud.','ready'],
    ['VM559-11-ATTENDANCE','11-band','Davomat, o‘zlashtirish va individual reja','Davomat, topshiriq baholari, kredit yozuvlari va individual o‘quv reja moduli mavjud.','ready'],
    ['VM559-11-COMMS','11-band','Kommunikatsiya','Chat, xabar, videodars/jonli dars va teskari aloqa modullari mavjud.','ready'],
    ['VM559-11-CONTINGENT','11-band','Kontingent reyestri','Talaba/pedagog reyestri va talaba harakati tarixi yuritiladi.','ready'],
    ['VM559-11-COURSES','11-band','Kurslarni boshqarish','Fan, material, topshiriq, videodars, SCORM va havolalar boshqariladi.','ready'],
    ['VM559-11-TEACHING','11-band','O‘qitishni boshqarish','Jadval, konsultatsiya, deadline, kredit va kursdan-kursga o‘tkazish uchun akademik modul mavjud.','ready'],
    ['VM559-11-STATS','11-band','Statistika va arxiv','Kontingent, dars, topshiriq, davomat va talaba harakati bo‘yicha statistik ma’lumotlar shakllanadi.','ready'],
    ['VM559-11-ASSESS','11-band','Bilim nazorati','Test, topshiriq, baholash va proktoring hodisalari mavjud.','ready'],
    ['VM559-18-LANGUAGE','18-band','Ta’lim tiliga mos kontent','Kontent metadata-sida ta’lim tili saqlanishi va audit qilinishi nazarda tutilgan.','partial'],
    ['VM559-21-REG','21-band','LMS ro‘yxatdan o‘tishi uchun shaxsan tashrif','Talabaga onsite ro‘yxatdan o‘tish tasdig‘i saqlanadi.',studentCount>0&&onsiteMissing===0?'ready':'partial'],
    ['VM559-21-FINAL','21-band','Yakuniy nazorat va himoya — an’anaviy','Semestr yakuniy nazorati, davlat attestatsiyasi va himoyani masofaviy imtihon sifatida yaratish bloklanadi.','ready'],
    ['VM559-24-LMS','24-band','Barcha dars, amaliyot, mustaqil ish va baholash LMSda','Amaliyot, topshiriq, baholash va dars modullari yagona LMSda yuritiladi.','ready'],
    ['VM559-26-RATIO','26-band','1 o‘qituvchi : 50 talaba','50 nafardan ortiq guruhga yangi masofaviy dars yaratish server darajasida bloklanadi.',noOver?'ready':'blocked'],
    ['VM559-29-INTEGRATION','29-band','Vazirlik axborot tizimlari bilan integratsiya','HEMIS/tegishli davlat tizimi uchun eksport va konfiguratsiyalanuvchi sync adapter mavjud; real ulanish uchun rasmiy API rekvizitlari kerak.',hemisConfigured?'ready':evidenceStatus(ev.get('VM559-29-INTEGRATION'))],
    ['VM559-30-MONITOR','30-band','Sifat monitoringi','So‘rovnoma, monitoring faoliyati, intervyu/fokus-guruh qaydlari va hisobotlar moduli mavjud.','ready'],
    ['VM559-32-COMPLAINT','32-band','Shikoyat/murojaat','Talaba va xodimlar murojaat yuborishi, vakolatli xodim ko‘rib chiqishi mumkin.','ready'],
    ['VM559-PROGRAM','Qaror 2-band va 3-bob','Yo‘nalish/kvota siyosati','Masofaviy yo‘nalishlar reyestri kunduzgi shakl mavjudligi va 300/30 qabul chegaralarini nazorat qiladi.',programs.length&&programPolicyOk?'ready':'partial']
  ];
  return {rows:rows.map(([code,clause,title,detail,status],i)=>({order:i+1,code,clause,title,detail,status,evidence:ev.get(code)||null})),capacity,coverage,server:{country:serverCountry||'unknown',ownership:ownership||'unknown',leaseYears,ready:serverReady},hemisConfigured,proctorAi,onsiteMissing,programs};
}
async function makeHemisPayload(database){
  const [students,teachers,subjects,lessons,credits,movements]=await Promise.all([
    database.collection('users').find({role:'student'},{projection:{_id:0,passwordHash:0,preferences:0}}).toArray(),
    database.collection('users').find({role:'teacher'},{projection:{_id:0,passwordHash:0,preferences:0}}).toArray(),
    database.collection('subjects').find({},{projection:{_id:0}}).toArray(),
    database.collection('lessons').find({},{projection:{_id:0}}).sort({date:-1}).limit(5000).toArray(),
    database.collection('credit_records').find({},{projection:{_id:0}}).limit(10000).toArray(),
    database.collection('student_movements').find({},{projection:{_id:0}}).sort({at:-1}).limit(10000).toArray()
  ]);
  return {schema:'qdtu-lms-export-v1',generatedAt:now().toISOString(),students,teachers,subjects,lessons,credits,movements};
}
function install(app){
  const loginAttempts=new Map();
  app.use('/api/auth/login',(req,res,next)=>{
    const key=clean(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown',100).split(',')[0];
    const t=Date.now(),row=loginAttempts.get(key)||{count:0,reset:t+15*60*1000};
    if(t>row.reset){row.count=0;row.reset=t+15*60*1000}
    if(row.count>=12)return res.status(429).json({ok:false,error:'too_many_login_attempts'});
    res.on('finish',()=>{if(res.statusCode===401){row.count++;loginAttempts.set(key,row)}else if(res.statusCode<400)loginAttempts.delete(key)});
    next();
  });

  app.use('/api/manage/lessons',json,async(req,res,next)=>{
    if(!['POST','PATCH'].includes(req.method))return next();
    try{
      const user=await currentUser(req); if(!managers.has(user.role)&&user.role!=='teacher')return next();
      const database=await getDb();
      let group=clean(req.body?.group,60);
      if(!group&&req.method==='PATCH'){
        const lessonId=clean(req.path.split('/').filter(Boolean).pop(),80);
        const lesson=await database.collection('lessons').findOne({id:lessonId},{projection:{group:1}});
        group=lesson?.group||'';
      }
      if(group){
        const count=await database.collection('users').countDocuments({role:'student',active:{$ne:false},group});
        if(count>50)return res.status(409).json({ok:false,error:'teacher_student_ratio_exceeded',group,students:count,limit:50,requiredSections:Math.ceil(count/50)});
      }
      next();
    }catch(e){fail(res,e)}
  });

  app.use('/api/exams',json,async(req,res,next)=>{
    if(req.method!=='POST')return next();
    const type=clean(req.body?.assessmentType||'current',50).toLowerCase();
    if(['semester_final','state_attestation','bachelor_defense','master_defense','final'].includes(type)){
      return res.status(409).json({ok:false,error:'onsite_final_required',law:'VM 559, 21-band'});
    }
    next();
  });

  app.use('/api',(req,res,next)=>{
    if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return next();
    if(/^\/proctor\/.+\/event$/.test(req.path)||/\/attendance$/.test(req.path))return next();
    const started=Date.now(),claims=claimsFrom(req);
    res.on('finish',()=>{
      getDb().then(database=>database.collection('audit_logs').insertOne({
        id:id('aud'),username:clean(claims?.sub||'anonymous',80),role:clean(claims?.role||'',30),
        method:req.method,path:clean(req.originalUrl,500),status:res.statusCode,ip:clean(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'',120),
        userAgent:clean(req.headers['user-agent'],300),durationMs:Date.now()-started,at:now()
      })).catch(()=>{});
    });
    next();
  });

  app.get('/api/vm559/overview',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb(),data=await buildRequirements(database);
    const stats={total:data.rows.length,ready:data.rows.filter(x=>['ready','verified'].includes(x.status)).length,partial:data.rows.filter(x=>['partial','evidence-added'].includes(x.status)).length,blocked:data.rows.filter(x=>['blocked','pending'].includes(x.status)).length};
    res.set('Cache-Control','no-store');
    res.json({ok:true,law:{number:559,date:'2022-10-03',url:LAW_URL,lastKnownRevision:'2025-11-07'},userRole:user.role,stats,...data});
  }catch(e){fail(res,e)}});

  app.get('/api/vm559/audit',async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);const database=await getDb();
    const limit=Math.min(500,Math.max(1,Number(req.query.limit)||100));
    const items=await database.collection('audit_logs').find({},{projection:{_id:0}}).sort({at:-1}).limit(limit).toArray();
    res.json({ok:true,items});
  }catch(e){fail(res,e)}});

  app.post('/api/vm559/evidence/:code',json,async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);const database=await getDb();
    const code=clean(req.params.code,80).toUpperCase();
    const doc={code,title:clean(req.body?.title,220),documentNo:clean(req.body?.documentNo,150),url:clean(req.body?.url,1200),note:clean(req.body?.note,3000),verified:req.body?.verified===true,updatedBy:user.username,updatedAt:now()};
    await database.collection('vm559_evidence').updateOne({code},{$set:doc},{upsert:true});
    res.json({ok:true,item:{...doc,_id:undefined}});
  }catch(e){fail(res,e)}});

  app.post('/api/vm559/onsite-registration/:username',json,async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);const database=await getDb(),username=clean(req.params.username,80).toLowerCase();
    const docNo=clean(req.body?.documentNo,150);
    await database.collection('users').updateOne({username,role:'student'},{$set:{onsiteRegistrationVerifiedAt:now(),onsiteRegistrationDocumentNo:docNo,onsiteRegistrationVerifiedBy:user.username,updatedAt:now()}});
    res.json({ok:true});
  }catch(e){fail(res,e)}});

  app.get('/api/vm559/programs',async(req,res)=>{try{
    await currentUser(req);const database=await getDb();res.json({ok:true,items:await database.collection('programs').find({},{projection:{_id:0}}).sort({code:1}).toArray()});
  }catch(e){fail(res,e)}});
  app.post('/api/vm559/programs',json,async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);const database=await getDb();
    const level=clean(req.body?.level,20)==='master'?'master':'bachelor',isICT=req.body?.isICT===true,quota=Math.max(0,Number(req.body?.admissionQuota)||0);
    if(!isICT&&quota>(level==='master'?30:300))throw Object.assign(new Error('admission_quota_exceeded'),{status:409});
    if(req.body?.daytimeExists===false&&!isICT)throw Object.assign(new Error('daytime_program_required'),{status:409});
    const code=clean(req.body?.code,40).toUpperCase(),name=clean(req.body?.name,220);if(!code||!name)throw Object.assign(new Error('required'),{status:400});
    const doc={code,name,level,isICT,admissionQuota:quota,daytimeExists:req.body?.daytimeExists!==false,distanceAllowed:req.body?.distanceAllowed!==false,durationYears:Math.max(1,Number(req.body?.durationYears)||4),language:clean(req.body?.language,40)||'uz',updatedAt:now(),updatedBy:user.username};
    await database.collection('programs').updateOne({code},{$set:doc},{upsert:true});res.json({ok:true,item:doc});
  }catch(e){fail(res,e)}});

  app.get('/api/vm559/study-plan/:username',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb(),username=clean(req.params.username,80).toLowerCase();
    if(user.role==='student'&&user.username!==username)throw Object.assign(new Error('forbidden'),{status:403});
    if(user.role==='teacher'&&!managers.has(user.role)){const target=await database.collection('users').findOne({username,role:'student'},{projection:{group:1}});const owns=target&&await database.collection('subjects').findOne({teacherUsername:user.username,groups:target.group},{projection:{_id:1}});if(!owns)throw Object.assign(new Error('forbidden'),{status:403})}
    const [plans,credits]=await Promise.all([
      database.collection('study_plans').find({username},{projection:{_id:0}}).sort({academicYear:-1,semester:1}).toArray(),
      database.collection('credit_records').find({username},{projection:{_id:0}}).sort({academicYear:-1,semester:1}).toArray()
    ]);res.json({ok:true,plans,credits});
  }catch(e){fail(res,e)}});
  app.post('/api/vm559/study-plans',json,async(req,res)=>{try{
    const user=await currentUser(req);if(!academicManagers.has(user.role)&&user.role!=='teacher')throw Object.assign(new Error('forbidden'),{status:403});const database=await getDb();
    const username=clean(req.body?.username,80).toLowerCase(),academicYear=clean(req.body?.academicYear,20),semester=Math.max(1,Math.min(2,Number(req.body?.semester)||1));
    const subjects=(Array.isArray(req.body?.subjects)?req.body.subjects:[]).slice(0,80).map(x=>({subjectId:clean(x.subjectId,80),credits:Math.max(0,Number(x.credits)||0),type:clean(x.type,30)||'required'})).filter(x=>x.subjectId);
    if(!username||!academicYear)throw Object.assign(new Error('required'),{status:400});
    const doc={username,academicYear,semester,subjects,status:'active',updatedAt:now(),updatedBy:user.username};await database.collection('study_plans').updateOne({username,academicYear,semester},{$set:doc},{upsert:true});res.json({ok:true,item:doc});
  }catch(e){fail(res,e)}});
  app.post('/api/vm559/credits',json,async(req,res)=>{try{
    const user=await currentUser(req);if(!academicManagers.has(user.role)&&user.role!=='teacher')throw Object.assign(new Error('forbidden'),{status:403});const database=await getDb();
    const username=clean(req.body?.username,80).toLowerCase(),subjectId=clean(req.body?.subjectId,80),academicYear=clean(req.body?.academicYear,20),semester=Math.max(1,Math.min(2,Number(req.body?.semester)||1));
    const doc={username,subjectId,academicYear,semester,credits:Math.max(0,Number(req.body?.credits)||0),score:Math.max(0,Math.min(100,Number(req.body?.score)||0)),grade:clean(req.body?.grade,10),status:clean(req.body?.status,30)||'earned',updatedAt:now(),updatedBy:user.username};
    if(!username||!subjectId||!academicYear)throw Object.assign(new Error('required'),{status:400});
    await database.collection('credit_records').updateOne({username,subjectId,academicYear,semester},{$set:doc},{upsert:true});res.json({ok:true,item:doc});
  }catch(e){fail(res,e)}});

  app.get('/api/vm559/movements',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb();let q={};if(user.role==='student')q.username=user.username;else if(!academicManagers.has(user.role))throw Object.assign(new Error('forbidden'),{status:403});
    if(req.query.username)q.username=clean(req.query.username,80).toLowerCase();
    res.json({ok:true,items:await database.collection('student_movements').find(q,{projection:{_id:0}}).sort({at:-1}).limit(500).toArray()});
  }catch(e){fail(res,e)}});
  app.post('/api/vm559/movements',json,async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);const database=await getDb(),username=clean(req.body?.username,80).toLowerCase();
    const type=clean(req.body?.type,40);if(!['admitted','transferred_in','transferred_out','reinstated','expelled','graduated','course_promoted'].includes(type))throw Object.assign(new Error('invalid_movement'),{status:400});
    const doc={id:id('mov'),username,type,from:clean(req.body?.from,200),to:clean(req.body?.to,200),orderNo:clean(req.body?.orderNo,120),note:clean(req.body?.note,2000),at:req.body?.at?new Date(req.body.at):now(),createdBy:user.username,createdAt:now()};
    await database.collection('student_movements').insertOne(doc);
    const statusMap={admitted:'active',transferred_in:'active',reinstated:'active',transferred_out:'transferred',expelled:'expelled',graduated:'graduated'};
    if(statusMap[type])await database.collection('users').updateOne({username},{$set:{status:statusMap[type],active:!['transferred_out','expelled','graduated'].includes(type),updatedAt:now()}});
    res.status(201).json({ok:true,item:{...doc,_id:undefined}});
  }catch(e){fail(res,e)}});

  app.get('/api/vm559/practices',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb();let q={};if(user.role==='student')q.username=user.username;else if(!academicManagers.has(user.role)&&user.role!=='teacher')throw Object.assign(new Error('forbidden'),{status:403});
    res.json({ok:true,items:await database.collection('practices').find(q,{projection:{_id:0}}).sort({startAt:-1}).limit(500).toArray()});
  }catch(e){fail(res,e)}});
  app.post('/api/vm559/practices',json,async(req,res)=>{try{
    const user=await currentUser(req);if(!academicManagers.has(user.role)&&user.role!=='teacher')throw Object.assign(new Error('forbidden'),{status:403});const database=await getDb();
    const doc={id:id('pr'),username:clean(req.body?.username,80).toLowerCase(),organization:clean(req.body?.organization,220),workplaceAligned:req.body?.workplaceAligned===true,startAt:new Date(req.body?.startAt||Date.now()),endAt:new Date(req.body?.endAt||Date.now()),supervisor:clean(req.body?.supervisor,180),status:clean(req.body?.status,30)||'planned',reportUrl:clean(req.body?.reportUrl,1200),createdBy:user.username,createdAt:now()};
    if(!doc.username||!doc.organization)throw Object.assign(new Error('required'),{status:400});await database.collection('practices').insertOne(doc);res.status(201).json({ok:true,item:{...doc,_id:undefined}});
  }catch(e){fail(res,e)}});

  app.get('/api/vm559/monitoring',async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);const database=await getDb();res.json({ok:true,items:await database.collection('monitoring_activities').find({},{projection:{_id:0}}).sort({at:-1}).limit(500).toArray()});
  }catch(e){fail(res,e)}});
  app.post('/api/vm559/monitoring',json,async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);const database=await getDb(),type=clean(req.body?.type,40);
    if(!['lesson_observation','assessment_observation','survey','focus_group','interview','result_evaluation','other'].includes(type))throw Object.assign(new Error('invalid_monitoring_type'),{status:400});
    const doc={id:id('mon'),type,title:clean(req.body?.title,220),scope:clean(req.body?.scope,220),findings:clean(req.body?.findings,6000),actions:clean(req.body?.actions,6000),at:req.body?.at?new Date(req.body.at):now(),createdBy:user.username,createdAt:now()};
    await database.collection('monitoring_activities').insertOne(doc);res.status(201).json({ok:true,item:{...doc,_id:undefined}});
  }catch(e){fail(res,e)}});

  app.get('/api/vm559/surveys',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb();const q=managers.has(user.role)?{}:{active:true};
    const items=await database.collection('quality_surveys').find(q,{projection:{_id:0}}).sort({createdAt:-1}).limit(100).toArray();res.json({ok:true,items});
  }catch(e){fail(res,e)}});
  app.post('/api/vm559/surveys',json,async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);const database=await getDb();
    const questions=(Array.isArray(req.body?.questions)?req.body.questions:[]).slice(0,30).map(x=>clean(x,500)).filter(Boolean);
    const doc={id:id('sur'),title:clean(req.body?.title,220),questions,active:req.body?.active!==false,createdBy:user.username,createdAt:now()};if(!doc.title||!questions.length)throw Object.assign(new Error('required'),{status:400});
    await database.collection('quality_surveys').insertOne(doc);res.status(201).json({ok:true,item:{...doc,_id:undefined}});
  }catch(e){fail(res,e)}});
  app.post('/api/vm559/surveys/:id/respond',json,async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb(),surveyId=clean(req.params.id,100),survey=await database.collection('quality_surveys').findOne({id:surveyId,active:true},{projection:{questions:1}});if(!survey)throw Object.assign(new Error('not_found'),{status:404});
    const answers=(Array.isArray(req.body?.answers)?req.body.answers:[]).slice(0,survey.questions.length).map(x=>clean(x,2000));const doc={surveyId,username:user.username,role:user.role,answers,createdAt:now()};
    await database.collection('survey_responses').updateOne({surveyId,username:user.username},{$set:doc},{upsert:true});res.json({ok:true});
  }catch(e){fail(res,e)}});

  app.get('/api/vm559/complaints',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb(),q=managers.has(user.role)?{}:{username:user.username};
    res.json({ok:true,items:await database.collection('complaints').find(q,{projection:{_id:0}}).sort({createdAt:-1}).limit(300).toArray()});
  }catch(e){fail(res,e)}});
  app.post('/api/vm559/complaints',json,async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb();const doc={id:id('cmp'),username:user.username,name:user.name||user.username,role:user.role,subject:clean(req.body?.subject,220),body:clean(req.body?.body,6000),status:'new',createdAt:now()};if(!doc.subject||!doc.body)throw Object.assign(new Error('required'),{status:400});await database.collection('complaints').insertOne(doc);res.status(201).json({ok:true,item:{...doc,_id:undefined}});
  }catch(e){fail(res,e)}});
  app.patch('/api/vm559/complaints/:id',json,async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);const database=await getDb(),status=clean(req.body?.status,30);if(!['new','reviewing','resolved','rejected'].includes(status))throw Object.assign(new Error('invalid_status'),{status:400});
    await database.collection('complaints').updateOne({id:clean(req.params.id,100)},{$set:{status,response:clean(req.body?.response,6000),resolvedBy:user.username,updatedAt:now()}});res.json({ok:true});
  }catch(e){fail(res,e)}});

  app.get('/api/vm559/integrations/hemis/status',async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);res.json({ok:true,configured:Boolean(process.env.HEMIS_API_URL&&process.env.HEMIS_API_TOKEN),baseUrl:process.env.HEMIS_API_URL?clean(process.env.HEMIS_API_URL,500):'',syncPath:clean(process.env.HEMIS_SYNC_PATH||'/lms/sync',200)});
  }catch(e){fail(res,e)}});
  app.get('/api/vm559/integrations/hemis/export',async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);const database=await getDb(),payload=await makeHemisPayload(database);res.set('Content-Disposition','attachment; filename="qdtu-lms-hemis-export.json"');res.json(payload);
  }catch(e){fail(res,e)}});
  app.post('/api/vm559/integrations/hemis/sync',json,async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);if(!process.env.HEMIS_API_URL||!process.env.HEMIS_API_TOKEN)throw Object.assign(new Error('hemis_not_configured'),{status:409});
    const database=await getDb(),payload=await makeHemisPayload(database),url=String(process.env.HEMIS_API_URL).replace(/\/$/,'')+'/'+String(process.env.HEMIS_SYNC_PATH||'lms/sync').replace(/^\//,'');
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.HEMIS_API_TOKEN}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});
    const text=await r.text();const log={id:id('sync'),system:'hemis',status:r.status,ok:r.ok,response:clean(text,3000),createdBy:user.username,createdAt:now()};await database.collection('integration_sync_logs').insertOne(log);
    if(!r.ok)throw Object.assign(new Error('hemis_sync_failed'),{status:502});res.json({ok:true,status:r.status});
  }catch(e){fail(res,e)}});

  app.get('/api/vm559/selfcheck',async(req,res)=>{try{
    const user=await currentUser(req);requireManager(user);const database=await getDb(),data=await buildRequirements(database);
    res.json({ok:true,generatedAt:now().toISOString(),law:LAW_URL,failures:data.rows.filter(x=>!['ready','verified'].includes(x.status)).map(x=>({code:x.code,clause:x.clause,status:x.status,title:x.title})),capacity:data.capacity,server:data.server});
  }catch(e){fail(res,e)}});
}

function wrappedExpress(...args){const app=originalExpress(...args);install(app);return app}
Object.assign(wrappedExpress,originalExpress);
require.cache[expressPath].exports=wrappedExpress;
process.on('SIGTERM',()=>mongoClient?.close().catch(()=>{}));
