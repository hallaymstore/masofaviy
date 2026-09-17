const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const jwt=require('jsonwebtoken');
const {MongoClient}=require('mongodb');
const expressPath=require.resolve('express');
const originalExpress=require(expressPath);
let mongoClient=null,db=null,connecting=null;
const managers=new Set(['admin','tech','rector','prorector','dean','tutor']);
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const raw=originalExpress.raw({type:'application/octet-stream',limit:'16mb'});
const json=originalExpress.json({limit:'256kb'});
const recordingsDir=process.env.RECORDINGS_DIR||path.join(process.cwd(),'storage','recordings');
fs.mkdirSync(recordingsDir,{recursive:true});
async function getDb(){if(db)return db;if(connecting)return connecting;const uri=process.env.MONGODB_URI||'';if(!uri)throw new Error('db_required');connecting=(async()=>{mongoClient=new MongoClient(uri,{serverSelectionTimeoutMS:8000,maxPoolSize:6,minPoolSize:0});await mongoClient.connect();db=mongoClient.db(process.env.DB_NAME||'masofaviy');await db.collection('recordings').createIndex({lessonId:1,createdAt:-1});return db})();try{return await connecting}finally{connecting=null}}
function cookieValue(header,name){const row=String(header||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));if(!row)return'';try{return decodeURIComponent(row.slice(name.length+1))}catch{return row.slice(name.length+1)}}
async function user(req){const token=cookieValue(req.headers.cookie,'session')||String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)throw Object.assign(new Error('auth_required'),{status:401});let claims;try{claims=jwt.verify(token,process.env.JWT_SECRET)}catch{throw Object.assign(new Error('invalid_session'),{status:401})}const d=await getDb(),u=await d.collection('users').findOne({username:clean(claims.sub,80),active:{$ne:false}},{projection:{_id:0,passwordHash:0}});if(!u)throw Object.assign(new Error('account_disabled'),{status:401});return u}
function fail(res,e){res.status(e.status||500).json({ok:false,error:e.message||'request_failed'})}
async function lessonFor(d,id){return d.collection('lessons').findOne({id:clean(id,80)},{projection:{_id:0}})}
function canHost(u,l){return managers.has(u.role)||(u.role==='teacher'&&l?.teacherUsername===u.username)}
function canWatch(u,r){return managers.has(u.role)||(u.role==='teacher'&&r.teacherUsername===u.username)||(u.role==='student'&&u.group&&r.group===u.group)}
function partPath(id){return path.join(recordingsDir,`${id}.webm.part`)}
function finalPath(id){return path.join(recordingsDir,`${id}.webm`)}
function install(app){
  app.use('/recordings',originalExpress.static(recordingsDir,{fallthrough:true,maxAge:'1h',acceptRanges:true}));
  app.post('/api/recordings/start/:lessonId',json,async(req,res)=>{try{const u=await user(req),d=await getDb(),l=await lessonFor(d,req.params.lessonId);if(!l)throw Object.assign(new Error('lesson_not_found'),{status:404});if(!canHost(u,l))throw Object.assign(new Error('forbidden'),{status:403});const id=`REC-${crypto.randomUUID()}`;fs.writeFileSync(partPath(id),Buffer.alloc(0));const doc={id,lessonId:l.id,subject:l.subject||'',group:l.group||'',teacherUsername:l.teacherUsername||u.username,teacher:l.teacher||u.name||u.username,status:'recording',mimeType:clean(req.body?.mimeType,120)||'video/webm',createdAt:new Date(),createdBy:u.username,bytes:0};await d.collection('recordings').insertOne(doc);res.status(201).json({ok:true,id})}catch(e){fail(res,e)}});
  app.post('/api/recordings/chunk/:id',raw,async(req,res)=>{try{const u=await user(req),d=await getDb(),r=await d.collection('recordings').findOne({id:clean(req.params.id,120)});if(!r||r.status!=='recording')throw Object.assign(new Error('recording_not_found'),{status:404});const l=await lessonFor(d,r.lessonId);if(!canHost(u,l))throw Object.assign(new Error('forbidden'),{status:403});if(!Buffer.isBuffer(req.body)||!req.body.length)return res.json({ok:true,bytes:0});fs.appendFileSync(partPath(r.id),req.body);await d.collection('recordings').updateOne({id:r.id},{$inc:{bytes:req.body.length},$set:{updatedAt:new Date()}});res.json({ok:true,bytes:req.body.length})}catch(e){fail(res,e)}});
  app.post('/api/recordings/finish/:id',json,async(req,res)=>{try{const u=await user(req),d=await getDb(),r=await d.collection('recordings').findOne({id:clean(req.params.id,120)});if(!r)throw Object.assign(new Error('recording_not_found'),{status:404});const l=await lessonFor(d,r.lessonId);if(!canHost(u,l))throw Object.assign(new Error('forbidden'),{status:403});const src=partPath(r.id),dst=finalPath(r.id);if(fs.existsSync(src))fs.renameSync(src,dst);const size=fs.existsSync(dst)?fs.statSync(dst).size:0;const patch={status:'ready',url:`/recordings/${r.id}.webm`,bytes:size,durationSec:Math.max(0,Number(req.body?.durationSec)||0),finishedAt:new Date(),updatedAt:new Date()};await d.collection('recordings').updateOne({id:r.id},{$set:patch});res.json({ok:true,item:{id:r.id,lessonId:r.lessonId,...patch}})}catch(e){fail(res,e)}});
  app.get('/api/recordings',async(req,res)=>{try{const u=await user(req),d=await getDb();let q={status:'ready'};if(u.role==='student')q.group=u.group||'__NO_GROUP__';else if(u.role==='teacher')q.teacherUsername=u.username;const items=await d.collection('recordings').find(q,{projection:{_id:0}}).sort({createdAt:-1}).limit(100).toArray();res.json({ok:true,items})}catch(e){fail(res,e)}});
  app.delete('/api/recordings/:id',async(req,res)=>{try{const u=await user(req),d=await getDb(),r=await d.collection('recordings').findOne({id:clean(req.params.id,120)});if(!r)throw Object.assign(new Error('not_found'),{status:404});if(!canWatch(u,r)||u.role==='student')throw Object.assign(new Error('forbidden'),{status:403});for(const p of [partPath(r.id),finalPath(r.id)])if(fs.existsSync(p))fs.unlinkSync(p);await d.collection('recordings').deleteOne({id:r.id});res.json({ok:true})}catch(e){fail(res,e)}});
}
function wrappedExpress(...args){const app=originalExpress(...args);install(app);return app}
Object.assign(wrappedExpress,originalExpress);require.cache[expressPath].exports=wrappedExpress;
process.on('SIGTERM',()=>mongoClient?.close().catch(()=>{}));
