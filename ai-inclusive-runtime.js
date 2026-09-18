const crypto=require('crypto');
const jwt=require('jsonwebtoken');
const {MongoClient}=require('mongodb');
const expressPath=require.resolve('express');
const originalExpress=require(expressPath);

let mongoClient=null,db=null,connecting=null;
const json=originalExpress.json({limit:'1mb'});
const managers=new Set(['admin','tech','rector','prorector','dean','tutor']);
const creators=new Set(['teacher','admin','tech','rector','prorector','dean','tutor']);
const clean=(v,n=4000)=>String(v??'').trim().slice(0,n);

function cookieValue(header,name){
  const row=String(header||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
  if(!row)return'';
  try{return decodeURIComponent(row.slice(name.length+1))}catch{return row.slice(name.length+1)}
}

async function getDb(optional=false){
  if(db)return db;
  if(connecting)return connecting;
  const uri=process.env.MONGODB_URI||'';
  if(!uri){if(optional)return null;throw new Error('db_required')}
  connecting=(async()=>{
    mongoClient=new MongoClient(uri,{serverSelectionTimeoutMS:8000,connectTimeoutMS:10000,maxPoolSize:8,minPoolSize:0,maxIdleTimeMS:60000,retryReads:true,retryWrites:true});
    await mongoClient.connect();
    db=mongoClient.db(process.env.DB_NAME||'masofaviy');
    await Promise.all([
      db.collection('ai_usage').createIndex({username:1,createdAt:-1}),
      db.collection('accessibility_preferences').createIndex({username:1},{unique:true}),
      db.collection('caption_lines').createIndex({lessonId:1,at:1})
    ]).catch(()=>{});
    return db;
  })();
  try{return await connecting}finally{connecting=null}
}

async function currentUser(req){
  const token=cookieValue(req.headers.cookie,'session')||String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token)throw Object.assign(new Error('auth_required'),{status:401});
  let claims;
  try{claims=jwt.verify(token,process.env.JWT_SECRET)}catch{throw Object.assign(new Error('invalid_session'),{status:401})}
  const database=await getDb(true);
  if(!database)return {username:clean(claims.sub,80).toLowerCase(),name:clean(claims.name,160),role:clean(claims.role,40),group:clean(claims.group,80)};
  const u=await database.collection('users').findOne({username:clean(claims.sub,80).toLowerCase(),active:{$ne:false}},{projection:{_id:0,passwordHash:0}});
  if(!u)throw Object.assign(new Error('account_disabled'),{status:401});
  return u;
}

function fail(res,e){res.status(e.status||500).json({ok:false,error:e.message||'request_failed'})}

function aiProvider(){
  const groq=clean(process.env.GROQ_API_KEY,1000);
  const key=clean(process.env.AI_API_KEY||process.env.OPENAI_API_KEY||groq,1000);
  const base=clean(process.env.AI_BASE_URL||(groq?'https://api.groq.com/openai/v1':'https://api.openai.com/v1'),1000).replace(/\/$/,'');
  const model=clean(process.env.AI_MODEL||process.env.GROQ_MODEL||(groq?'llama-3.3-70b-versatile':'gpt-5-mini'),200);
  return {configured:Boolean(key),key,base,model};
}

async function complete(system,prompt,{temperature=.35,maxTokens=1400}={}){
  const p=aiProvider();
  if(!p.configured)return null;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),22000);
  try{
    const r=await fetch(p.base+'/chat/completions',{
      method:'POST',
      signal:ctrl.signal,
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+p.key},
      body:JSON.stringify({model:p.model,temperature,max_tokens:maxTokens,messages:[{role:'system',content:system},{role:'user',content:prompt}]})
    });
    if(!r.ok)throw new Error('ai_provider_'+r.status);
    const d=await r.json();
    return clean(d?.choices?.[0]?.message?.content,12000)||null;
  }finally{clearTimeout(timer)}
}

function localAssistant(question,role){
  const q=clean(question,1200);
  return [
    'AI provayder kaliti hozir ulanmagan, shuning uchun lokal yordamchi rejimi ishlayapti.',
    role==='student'?'Savolni bosqichma-bosqich tahlil qiling, asosiy tushunchani ajrating va keyin kichik misol bilan tekshiring.':'Mavzuni maqsad → tushuntirish → faoliyat → tekshiruv ketma-ketligida tashkil qiling.',
    q?('Siz kiritgan mavzu: “'+q+'”.'):'',
    'AI_API_KEY yoki GROQ_API_KEY ulangach, shu oynada to‘liq generativ javoblar ishlaydi.'
  ].filter(Boolean).join('\n\n');
}

function localLessonPlan(topic,duration){
  return `Mavzu: ${topic}\nDavomiyligi: ${duration} daqiqa\n\n1. Kirish — 5 daqiqa\n• Dars maqsadini ayting va oldingi bilimni faollashtiring.\n\n2. Tushuntirish — ${Math.max(10,Math.round(duration*.35))} daqiqa\n• Asosiy tushunchalarni sodda misollar bilan yoritish.\n• Vizual va og‘zaki izohni birga berish.\n\n3. Faol mashq — ${Math.max(10,Math.round(duration*.35))} daqiqa\n• Juftlik/guruh topshirig‘i.\n• Inkluziv variant: matn, audio va katta shriftli ko‘rsatma.\n\n4. Tekshiruv — 8 daqiqa\n• 3 ta tezkor savol va bitta amaliy vazifa.\n\n5. Yakun — 5 daqiqa\n• Qisqa xulosa, refleksiya va uy vazifasi.`;
}

function localQuiz(topic,count){
  return Array.from({length:count},(_,i)=>`${i+1}. ${topic} bo‘yicha ${i+1}-asosiy tushunchani aniqlang.\nA) Variant A\nB) Variant B\nC) Variant C\nD) Variant D\nJavob: o‘qituvchi tekshiradi`).join('\n\n');
}

async function logUsage(user,feature,meta={}){
  const database=await getDb(true);if(!database)return;
  database.collection('ai_usage').insertOne({username:user.username,role:user.role,feature,meta,createdAt:new Date()}).catch(()=>{});
}

function accessibilityDefaults(){
  return {fontScale:1,highContrast:false,reduceMotion:false,dyslexiaFont:false,captions:true,captionLang:'uz',transcript:true,keyboardMode:true,screenReaderHints:true,signLanguageSpotlight:false,audioDescriptions:false};
}

function install(app){
  app.get('/api/ai/capabilities',async(req,res)=>{try{
    const u=await currentUser(req),p=aiProvider();
    res.set('Cache-Control','no-store');
    res.json({ok:true,configured:p.configured,model:p.configured?p.model:'local-fallback',role:u.role,features:['assistant','lesson-plan','quiz-generator','summary','class-insights','accessibility-coach','multilingual-support']});
  }catch(e){fail(res,e)}});

  app.post('/api/ai/assistant',json,async(req,res)=>{try{
    const u=await currentUser(req),question=clean(req.body?.question,3000);
    if(!question)throw Object.assign(new Error('question_required'),{status:400});
    const system=`You are QDTU EDU academic assistant. User role: ${u.role}. Reply in Uzbek unless asked otherwise. Be concise, accurate, pedagogical and accessibility-aware. Never invent grades, attendance or university records.`;
    let content=await complete(system,question,{maxTokens:1600}).catch(()=>null);
    if(!content)content=localAssistant(question,u.role);
    await logUsage(u,'assistant',{chars:question.length});
    res.json({ok:true,content,mode:aiProvider().configured?'ai':'local'});
  }catch(e){fail(res,e)}});

  app.post('/api/ai/lesson-plan',json,async(req,res)=>{try{
    const u=await currentUser(req);if(!creators.has(u.role))throw Object.assign(new Error('forbidden'),{status:403});
    const topic=clean(req.body?.topic,500),subject=clean(req.body?.subject,300),duration=Math.max(20,Math.min(180,Number(req.body?.duration)||80)),level=clean(req.body?.level,160)||'universitet';
    if(!topic)throw Object.assign(new Error('topic_required'),{status:400});
    const system='You create practical university lesson plans for QDTU. Use Uzbek. Include objectives, timing, teacher actions, student actions, assessment, low-bandwidth alternative, and inclusive adaptations for hearing, vision, motor and learning differences.';
    const prompt=`Fan: ${subject||'ko‘rsatilmagan'}\nMavzu: ${topic}\nDaraja: ${level}\nDavomiylik: ${duration} daqiqa. To‘liq dars rejasini tuz.`;
    let content=await complete(system,prompt,{maxTokens:2200}).catch(()=>null);
    if(!content)content=localLessonPlan(topic,duration);
    await logUsage(u,'lesson-plan',{topic,duration});
    res.json({ok:true,content,mode:aiProvider().configured?'ai':'local'});
  }catch(e){fail(res,e)}});

  app.post('/api/ai/quiz-generator',json,async(req,res)=>{try{
    const u=await currentUser(req);if(!creators.has(u.role))throw Object.assign(new Error('forbidden'),{status:403});
    const topic=clean(req.body?.topic,500),count=Math.max(3,Math.min(20,Number(req.body?.count)||8)),difficulty=clean(req.body?.difficulty,40)||'o‘rta';
    if(!topic)throw Object.assign(new Error('topic_required'),{status:400});
    const system='Create clear university quiz questions in Uzbek. Return numbered multiple-choice questions with four options and an answer key. Avoid trick questions. Include at least one applied question and one accessibility-friendly plain-language question.';
    let content=await complete(system,`Mavzu: ${topic}\nSavollar: ${count}\nQiyinlik: ${difficulty}`,{maxTokens:2200}).catch(()=>null);
    if(!content)content=localQuiz(topic,count);
    await logUsage(u,'quiz-generator',{topic,count,difficulty});
    res.json({ok:true,content,mode:aiProvider().configured?'ai':'local'});
  }catch(e){fail(res,e)}});

  app.post('/api/ai/summarize',json,async(req,res)=>{try{
    const u=await currentUser(req),text=clean(req.body?.text,12000),lang=clean(req.body?.lang,8)||'uz';
    if(text.length<20)throw Object.assign(new Error('text_required'),{status:400});
    const system=`Summarize study material for a university learner. Output language: ${lang}. Produce: short summary, key terms, 5 recall questions, and a simple-language section for accessibility.`;
    let content=await complete(system,text,{maxTokens:1800}).catch(()=>null);
    if(!content){const s=text.split(/(?<=[.!?])\s+/).slice(0,6).join(' ');content='Qisqa xulosa:\n'+s+'\n\nKalit so‘zlar: matndan asosiy atamalarni belgilang.\n\nTekshiruv: mavzuni 3–5 gapda o‘z so‘zingiz bilan qayta ayting.'}
    await logUsage(u,'summary',{chars:text.length});
    res.json({ok:true,content,mode:aiProvider().configured?'ai':'local'});
  }catch(e){fail(res,e)}});

  app.get('/api/ai/class-insights/:lessonId',async(req,res)=>{try{
    const u=await currentUser(req);if(!(creators.has(u.role)||managers.has(u.role)))throw Object.assign(new Error('forbidden'),{status:403});
    const database=await getDb();const lesson=await database.collection('lessons').findOne({id:clean(req.params.lessonId,80)},{projection:{_id:0}});
    if(!lesson)throw Object.assign(new Error('lesson_not_found'),{status:404});
    if(u.role==='teacher'&&lesson.teacherUsername!==u.username)throw Object.assign(new Error('forbidden'),{status:403});
    const events=await database.collection('attendance_events').find({lessonId:lesson.id},{projection:{_id:0}}).sort({at:1}).limit(5000).toArray();
    const byUser=new Map();
    for(const e of events){if(e.role==='teacher')continue;const x=byUser.get(e.username)||{username:e.username,name:e.name||e.username,joins:0,leaves:0,heartbeats:0,firstJoin:null,lastSeen:null};if(e.event==='join'||e.event==='reconnect'){x.joins++;if(!x.firstJoin)x.firstJoin=e.at}if(e.event==='leave')x.leaves++;if(e.event==='heartbeat')x.heartbeats++;x.lastSeen=e.at;byUser.set(e.username,x)}
    const students=[...byUser.values()];
    const unstable=students.filter(x=>x.joins>=3).slice(0,20);
    const lowPresence=students.filter(x=>x.heartbeats<2).slice(0,20);
    res.json({ok:true,lesson:{id:lesson.id,subject:lesson.subject,group:lesson.group,start:lesson.start,end:lesson.end},stats:{participants:students.length,reconnectRisk:unstable.length,lowPresence:lowPresence.length,totalEvents:events.length},unstable,lowPresence,notes:['Ko‘p qayta ulanish — internet sifati past bo‘lishi mumkin.','Kam heartbeat — darsga kech kirish, tez chiqish yoki aloqa uzilishi bo‘lishi mumkin. Bu avtomatik baho emas.']});
  }catch(e){fail(res,e)}});

  app.get('/api/accessibility/preferences',async(req,res)=>{try{
    const u=await currentUser(req),database=await getDb(true),defaults=accessibilityDefaults();
    if(!database)return res.json({ok:true,preferences:defaults});
    const row=await database.collection('accessibility_preferences').findOne({username:u.username},{projection:{_id:0}});
    res.json({ok:true,preferences:{...defaults,...(row?.preferences||{})}});
  }catch(e){fail(res,e)}});

  app.patch('/api/accessibility/preferences',json,async(req,res)=>{try{
    const u=await currentUser(req),defaults=accessibilityDefaults(),body=req.body||{},next={};
    next.fontScale=Math.max(.85,Math.min(1.5,Number(body.fontScale)||1));
    for(const k of ['highContrast','reduceMotion','dyslexiaFont','captions','transcript','keyboardMode','screenReaderHints','signLanguageSpotlight','audioDescriptions'])next[k]=Boolean(body[k]);
    next.captionLang=['uz','ru','en'].includes(body.captionLang)?body.captionLang:'uz';
    const database=await getDb(true);
    if(database)await database.collection('accessibility_preferences').updateOne({username:u.username},{$set:{username:u.username,preferences:next,updatedAt:new Date()}},{upsert:true});
    res.json({ok:true,preferences:{...defaults,...next}});
  }catch(e){fail(res,e)}});

  app.get('/api/accessibility/features',async(req,res)=>{try{
    await currentUser(req);
    res.json({ok:true,items:[
      {id:'captions',title:'Jonli subtitr',detail:'O‘zbek, rus va ingliz tilida ko‘rsatish.'},
      {id:'transcript',title:'Dars transkripti',detail:'Subtitr satrlarini keyin qayta o‘qish.'},
      {id:'contrast',title:'Yuqori kontrast',detail:'Ko‘rish qulayligi uchun rang kontrastini kuchaytirish.'},
      {id:'font',title:'Katta matn',detail:'Interfeys matnlarini 85%–150% oralig‘ida moslash.'},
      {id:'motion',title:'Kam harakat',detail:'Animatsiyalarni kamaytirish.'},
      {id:'keyboard',title:'Klaviatura navigatsiyasi',detail:'Fokus ko‘rsatkichlari va tezkor navigatsiya.'},
      {id:'screenreader',title:'Screen reader yordamchilari',detail:'ARIA live xabarlar va tushunarli label lar.'},
      {id:'sign',title:'Imo-ishora oynasi',detail:'Darsda maxsus video oynani spotlight qilish.'},
      {id:'audio',title:'Audio tavsif',detail:'Muhim interfeys holatlarini ovozli o‘qish.'}
    ]});
  }catch(e){fail(res,e)}});
}

function wrappedExpress(...args){const app=originalExpress(...args);install(app);return app}
Object.assign(wrappedExpress,originalExpress);
require.cache[expressPath].exports=wrappedExpress;
process.on('SIGTERM',()=>mongoClient?.close().catch(()=>{}));
