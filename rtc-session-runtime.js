const crypto=require('crypto');
const jwt=require('jsonwebtoken');
const {MongoClient}=require('mongodb');

// Ensure the app and this runtime use the same session secret even when an env
// secret was accidentally omitted. Production should still set JWT_SECRET.
if(!process.env.JWT_SECRET)process.env.JWT_SECRET=crypto.randomBytes(48).toString('hex');

// YouTube embedded players can return Error 153 when Helmet sends no-referrer.
// Preserve privacy while allowing the origin to be sent cross-origin.
try{
  const helmetPath=require.resolve('helmet');
  const originalHelmet=require(helmetPath);
  const wrappedHelmet=(options={})=>originalHelmet({...options,referrerPolicy:{policy:'strict-origin-when-cross-origin'}});
  Object.assign(wrappedHelmet,originalHelmet);
  require.cache[helmetPath].exports=wrappedHelmet;
}catch(e){console.warn('[rtc-runtime] helmet patch skipped:',e.message)}

const expressPath=require.resolve('express');
const originalExpress=require(expressPath);
let mongoClient=null,db=null,connecting=null;
const managers=new Set(['admin','tech','rector','prorector','dean','tutor']);

const clean=(v,n=200)=>String(v??'').trim().slice(0,n);
function cookieValue(header,name){
  const row=String(header||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
  if(!row)return'';
  try{return decodeURIComponent(row.slice(name.length+1))}catch{return row.slice(name.length+1)}
}
async function getDb(){
  if(db)return db;
  if(connecting)return connecting;
  const uri=process.env.MONGODB_URI||'';
  if(!uri)throw new Error('db_required');
  connecting=(async()=>{
    mongoClient=new MongoClient(uri,{serverSelectionTimeoutMS:8000,connectTimeoutMS:10000,maxPoolSize:8,minPoolSize:0,maxIdleTimeMS:60000,retryReads:true,retryWrites:true});
    await mongoClient.connect();
    db=mongoClient.db(process.env.DB_NAME||'masofaviy');
    return db;
  })();
  try{return await connecting}finally{connecting=null}
}
function parseIceServers(){
  if(process.env.RTC_ICE_SERVERS_JSON){
    try{const v=JSON.parse(process.env.RTC_ICE_SERVERS_JSON);if(Array.isArray(v))return v}catch(e){console.warn('[rtc-runtime] invalid RTC_ICE_SERVERS_JSON')}
  }
  const out=[];
  const stun=String(process.env.STUN_URLS||'').split(/[;,\n]/).map(x=>x.trim()).filter(Boolean);
  if(stun.length)out.push({urls:stun});
  const turn=String(process.env.TURN_URLS||'').split(/[;\n]/).map(x=>x.trim()).filter(Boolean);
  if(turn.length&&process.env.TURN_USERNAME&&process.env.TURN_CREDENTIAL)out.push({urls:turn,username:process.env.TURN_USERNAME,credential:process.env.TURN_CREDENTIAL});
  return out;
}
function allowed(user,lesson){
  if(!user||!lesson)return false;
  if(managers.has(user.role))return true;
  if(user.role==='teacher')return lesson.teacherUsername===user.username;
  if(user.role==='student')return Boolean(user.group)&&lesson.group===user.group;
  return false;
}
function mode(user,lesson){return user.role==='teacher'&&lesson.teacherUsername===user.username?'host':managers.has(user.role)?'monitor':'participant'}
function installRtcRoutes(app){
  app.get('/api/rtc/session/:lessonId',async(req,res)=>{
    try{
      const bridgeUrl=String(process.env.RTC_BRIDGE_URL||'').trim();
      if(!bridgeUrl)return res.status(503).json({ok:false,error:'rtc_bridge_not_configured'});
      const token=cookieValue(req.headers.cookie,'session')||String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
      if(!token)return res.status(401).json({ok:false,error:'auth_required'});
      let claims;try{claims=jwt.verify(token,process.env.JWT_SECRET)}catch{return res.status(401).json({ok:false,error:'invalid_session'})}
      const database=await getDb(),username=clean(claims.sub,80).toLowerCase();
      const [user,lesson]=await Promise.all([
        database.collection('users').findOne({username,active:{$ne:false}},{projection:{_id:0,username:1,name:1,role:1,group:1}}),
        database.collection('lessons').findOne({id:clean(req.params.lessonId,80)},{projection:{_id:0}})
      ]);
      if(!user)return res.status(401).json({ok:false,error:'account_disabled'});
      if(!lesson)return res.status(404).json({ok:false,error:'lesson_not_found'});
      if(!allowed(user,lesson))return res.status(403).json({ok:false,error:'lesson_access_denied'});
      if(user.role==='student'&&lesson.status!=='live')return res.status(409).json({ok:false,error:'lesson_not_live'});
      const rtcSecret=process.env.RTC_TOKEN_SECRET||process.env.JWT_SECRET;
      const rtcToken=jwt.sign({sub:user.username,name:user.name,role:user.role,group:user.group||'',roomId:lesson.id,lessonGroup:lesson.group||'',mode:mode(user,lesson)},rtcSecret,{expiresIn:'10m',audience:'qdtu-sfu',issuer:'qdtu-edu'});
      res.set('Cache-Control','no-store');
      res.json({ok:true,bridgeUrl,token:rtcToken,roomId:lesson.id,mode:mode(user,lesson),iceServers:parseIceServers(),defaults:{mic:user.role==='teacher',cam:user.role==='teacher'},expiresIn:600});
    }catch(e){console.error('[rtc-session]',e.message);res.status(500).json({ok:false,error:'rtc_session_failed'})}
  });
  app.get('/api/rtc/diagnostics',async(req,res)=>{
    res.set('Cache-Control','no-store');
    res.json({ok:true,bridgeConfigured:Boolean(process.env.RTC_BRIDGE_URL),turnConfigured:Boolean(process.env.TURN_URLS&&process.env.TURN_USERNAME&&process.env.TURN_CREDENTIAL),tokenAuth:true,groupIsolation:true,defaults:{student:{mic:false,cam:false},teacher:{mic:true,cam:true}}});
  });
}
function wrappedExpress(...args){const app=originalExpress(...args);installRtcRoutes(app);return app}
Object.assign(wrappedExpress,originalExpress);
require.cache[expressPath].exports=wrappedExpress;

process.on('SIGTERM',()=>mongoClient?.close().catch(()=>{}));
