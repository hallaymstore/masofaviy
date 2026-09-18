const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const jwt=require('jsonwebtoken');
const multer=require('multer');
const JSZip=require('jszip');
const {MongoClient}=require('mongodb');

const expressPath=require.resolve('express');
const originalExpress=require(expressPath);
const json=originalExpress.json({limit:'2mb'});
let mongoClient=null,db=null,connecting=null;

const managers=new Set(['admin','tech','rector','prorector','dean','tutor']);
const creators=new Set(['teacher','admin','tech','rector','prorector','dean']);
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const now=()=>new Date();
const id=p=>`${p}_${crypto.randomUUID()}`;
const ROOT=path.resolve(process.env.SCORM_STORAGE_DIR||path.join(process.cwd(),'data','scorm'));
fs.mkdirSync(ROOT,{recursive:true});
global.__QDTU_SCORM_ENABLED=true;

async function getDb(){
  if(db)return db;
  if(connecting)return connecting;
  const uri=process.env.MONGODB_URI||'';
  if(!uri)throw Object.assign(new Error('db_required'),{status:503});
  connecting=(async()=>{
    mongoClient=new MongoClient(uri,{serverSelectionTimeoutMS:8000,connectTimeoutMS:10000,maxPoolSize:10,minPoolSize:0,maxIdleTimeMS:60000,retryReads:true,retryWrites:true});
    await mongoClient.connect();
    db=mongoClient.db(process.env.DB_NAME||'masofaviy');
    await Promise.all([
      db.collection('scorm_packages').createIndex({id:1},{unique:true}),
      db.collection('scorm_packages').createIndex({subjectId:1,published:1,createdAt:-1}),
      db.collection('scorm_runtime').createIndex({packageId:1,username:1},{unique:true}),
      db.collection('scorm_runtime').createIndex({username:1,updatedAt:-1})
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
  const claims=claimsFrom(req);if(!claims)throw Object.assign(new Error('auth_required'),{status:401});
  const database=await getDb(),user=await database.collection('users').findOne({username:clean(claims.sub,80).toLowerCase(),active:{$ne:false}},{projection:{_id:0,passwordHash:0}});
  if(!user)throw Object.assign(new Error('account_disabled'),{status:401});return user;
}
function fail(res,e){res.status(e.status||500).json({ok:false,error:e.message||'request_failed'})}
function attr(tag,name){const m=String(tag||'').match(new RegExp(name+'\\s*=\\s*["\\\']([^"\\\']+)["\\\']','i'));return m?m[1]:''}
function parseManifest(xml){
  const manifestTag=(xml.match(/<manifest\b[^>]*>/i)||[])[0]||'';
  const orgTag=(xml.match(/<organizations\b[^>]*>/i)||[])[0]||'';
  const defaultOrg=attr(orgTag,'default');
  let orgBody='';
  if(defaultOrg){
    const safe=defaultOrg.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
    const rx=new RegExp('<organization\\b[^>]*identifier\\s*=\\s*["\\\']'+safe+'["\\\'][^>]*>([\\s\\S]*?)<\\/organization>','i');
    orgBody=(xml.match(rx)||[])[1]||'';
  }
  if(!orgBody)orgBody=(xml.match(/<organization\b[^>]*>([\s\S]*?)<\/organization>/i)||[])[1]||'';
  const itemTag=(orgBody.match(/<item\b[^>]*>/i)||xml.match(/<item\b[^>]*>/i)||[])[0]||'';
  const identifierref=attr(itemTag,'identifierref');
  let resourceTag='';
  const resources=[...xml.matchAll(/<resource\b[^>]*>/ig)].map(x=>x[0]);
  if(identifierref)resourceTag=resources.find(t=>attr(t,'identifier')===identifierref)||'';
  if(!resourceTag)resourceTag=resources.find(t=>attr(t,'href'))||'';
  const launch=attr(resourceTag,'href');
  const schema=(xml.match(/<schema>([\s\S]*?)<\/schema>/i)||[])[1]?.trim()||'';
  const schemaVersion=(xml.match(/<schemaversion>([\s\S]*?)<\/schemaversion>/i)||[])[1]?.trim()||'';
  const version=/2004/i.test(schemaVersion)?'2004':(/1\.2/i.test(schemaVersion)?'1.2':'unknown');
  return {manifestIdentifier:attr(manifestTag,'identifier'),schema,schemaVersion,version,launch};
}
function safeRel(name){
  const n=String(name||'').replace(/\\/g,'/');
  const normalized=path.posix.normalize('/'+n).replace(/^\/+/, '');
  if(!normalized||normalized.startsWith('..')||path.isAbsolute(normalized))throw new Error('unsafe_zip_path');
  return normalized;
}
async function packageAllowed(database,user,pkg){
  if(!pkg)return false;
  if(managers.has(user.role))return true;
  if(user.role==='teacher')return pkg.createdBy===user.username||!pkg.teacherUsername||pkg.teacherUsername===user.username;
  if(user.role==='student')return pkg.published!==false&&(!Array.isArray(pkg.groups)||pkg.groups.length===0||pkg.groups.includes(user.group));
  return false;
}
function install(app){
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:Math.max(5,Number(process.env.SCORM_MAX_MB||80))*1024*1024,files:1}});

  app.get('/api/scorm/packages',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb();let q={};
    if(user.role==='student')q={published:{$ne:false}};
    else if(user.role==='teacher')q={$or:[{createdBy:user.username},{teacherUsername:user.username}]};
    let items=await database.collection('scorm_packages').find(q,{projection:{_id:0}}).sort({createdAt:-1}).limit(300).toArray();
    if(user.role==='student')items=items.filter(x=>!Array.isArray(x.groups)||!x.groups.length||x.groups.includes(user.group));
    res.json({ok:true,items});
  }catch(e){fail(res,e)}});

  app.post('/api/scorm/packages',upload.single('package'),async(req,res)=>{try{
    const user=await currentUser(req);if(!creators.has(user.role))throw Object.assign(new Error('forbidden'),{status:403});
    if(!req.file?.buffer)throw Object.assign(new Error('package_required'),{status:400});
    const zip=await JSZip.loadAsync(req.file.buffer,{checkCRC32:true});
    const manifestEntry=Object.values(zip.files).find(x=>!x.dir&&/^(?:.*\/)?imsmanifest\.xml$/i.test(x.name));
    if(!manifestEntry)throw Object.assign(new Error('scorm_manifest_missing'),{status:400});
    const xml=await manifestEntry.async('string'),parsed=parseManifest(xml);
    if(!parsed.launch)throw Object.assign(new Error('scorm_launch_missing'),{status:400});
    const packageId=id('scorm'),dir=path.join(ROOT,packageId);fs.mkdirSync(dir,{recursive:true});
    let total=0,count=0;
    for(const entry of Object.values(zip.files)){
      if(entry.dir)continue;
      const rel=safeRel(entry.name),buf=await entry.async('nodebuffer');total+=buf.length;count++;
      if(total>Math.max(50,Number(process.env.SCORM_EXTRACT_MAX_MB||300))*1024*1024)throw Object.assign(new Error('scorm_package_too_large'),{status:413});
      const out=path.resolve(dir,rel);if(!out.startsWith(dir+path.sep)&&out!==dir)throw new Error('unsafe_zip_path');
      fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,buf);
    }
    const manifestRel=safeRel(manifestEntry.name),manifestDir=path.posix.dirname(manifestRel),launchRel=safeRel(path.posix.join(manifestDir==='.'?'':manifestDir,parsed.launch));
    const groups=String(req.body?.groups||'').split(',').map(x=>clean(x,60)).filter(Boolean);
    const doc={id:packageId,title:clean(req.body?.title,220)||clean(req.file.originalname,220),subjectId:clean(req.body?.subjectId,80),groups,teacherUsername:clean(req.body?.teacherUsername,80).toLowerCase(),published:req.body?.published!=='false',version:parsed.version,schema:parsed.schema,schemaVersion:parsed.schemaVersion,manifestIdentifier:parsed.manifestIdentifier,manifestPath:manifestRel,launchPath:launchRel,fileCount:count,bytes:total,createdBy:user.username,createdAt:now()};
    const database=await getDb();await database.collection('scorm_packages').insertOne(doc);res.status(201).json({ok:true,item:{...doc,_id:undefined}});
  }catch(e){
    if(e?.code==='LIMIT_FILE_SIZE')return res.status(413).json({ok:false,error:'scorm_package_too_large'});
    fail(res,e)
  }});

  app.patch('/api/scorm/packages/:id',json,async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb(),pkg=await database.collection('scorm_packages').findOne({id:clean(req.params.id,120)},{projection:{_id:0}});
    if(!pkg||!(await packageAllowed(database,user,pkg))||user.role==='student')throw Object.assign(new Error('forbidden'),{status:403});
    const patch={updatedAt:now(),updatedBy:user.username};if(req.body?.title!==undefined)patch.title=clean(req.body.title,220);if(req.body?.published!==undefined)patch.published=Boolean(req.body.published);if(Array.isArray(req.body?.groups))patch.groups=req.body.groups.map(x=>clean(x,60)).filter(Boolean);
    await database.collection('scorm_packages').updateOne({id:pkg.id},{$set:patch});res.json({ok:true});
  }catch(e){fail(res,e)}});

  app.delete('/api/scorm/packages/:id',async(req,res)=>{try{
    const user=await currentUser(req);if(!managers.has(user.role))throw Object.assign(new Error('forbidden'),{status:403});
    const database=await getDb(),packageId=clean(req.params.id,120);await Promise.all([database.collection('scorm_packages').deleteOne({id:packageId}),database.collection('scorm_runtime').deleteMany({packageId})]);
    fs.rmSync(path.join(ROOT,packageId),{recursive:true,force:true});res.json({ok:true});
  }catch(e){fail(res,e)}});

  app.get('/api/scorm/packages/:id/launch',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb(),pkg=await database.collection('scorm_packages').findOne({id:clean(req.params.id,120)},{projection:{_id:0}});
    if(!pkg||!(await packageAllowed(database,user,pkg)))throw Object.assign(new Error('forbidden'),{status:403});
    res.json({ok:true,package:pkg,launchUrl:`/scorm-content/${encodeURIComponent(pkg.id)}/${pkg.launchPath.split('/').map(encodeURIComponent).join('/')}`});
  }catch(e){fail(res,e)}});

  app.get('/scorm-content/:packageId/*',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb(),pkg=await database.collection('scorm_packages').findOne({id:clean(req.params.packageId,120)},{projection:{_id:0}});
    if(!pkg||!(await packageAllowed(database,user,pkg)))return res.status(403).send('Forbidden');
    const rel=safeRel(decodeURIComponent(req.params[0]||'')),base=path.join(ROOT,pkg.id),file=path.resolve(base,rel);
    if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.status(404).send('Not found');
    res.set('Cache-Control','private, max-age=300');res.sendFile(file);
  }catch(e){res.status(e.status||500).send('SCORM error')}});

  app.get('/api/scorm/runtime/:packageId',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb(),pkg=await database.collection('scorm_packages').findOne({id:clean(req.params.packageId,120)},{projection:{_id:0}});
    if(!pkg||!(await packageAllowed(database,user,pkg)))throw Object.assign(new Error('forbidden'),{status:403});
    const row=await database.collection('scorm_runtime').findOne({packageId:pkg.id,username:user.username},{projection:{_id:0}});
    const defaults=pkg.version==='2004'?{'cmi.completion_status':'unknown','cmi.success_status':'unknown','cmi.location':'','cmi.score.raw':'','cmi.suspend_data':''}:{'cmi.core.lesson_status':'not attempted','cmi.core.lesson_location':'','cmi.core.score.raw':'','cmi.suspend_data':''};
    res.json({ok:true,package:pkg,data:{...defaults,...(row?.data||{})},updatedAt:row?.updatedAt||null});
  }catch(e){fail(res,e)}});

  app.post('/api/scorm/runtime/:packageId',json,async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb(),pkg=await database.collection('scorm_packages').findOne({id:clean(req.params.packageId,120)},{projection:{_id:0}});
    if(!pkg||!(await packageAllowed(database,user,pkg)))throw Object.assign(new Error('forbidden'),{status:403});
    const raw=req.body?.data&&typeof req.body.data==='object'?req.body.data:{},data={};for(const [k,v] of Object.entries(raw).slice(0,500))data[clean(k,120)]=clean(v,64000);
    const score=Number(data['cmi.score.raw']??data['cmi.core.score.raw']);const status=clean(data['cmi.completion_status']||data['cmi.core.lesson_status']||'',80);
    const doc={packageId:pkg.id,username:user.username,name:user.name||user.username,group:user.group||'',data,score:Number.isFinite(score)?score:null,status,updatedAt:now()};
    await database.collection('scorm_runtime').updateOne({packageId:pkg.id,username:user.username},{$set:doc,$setOnInsert:{createdAt:now()}},{upsert:true});res.json({ok:true});
  }catch(e){fail(res,e)}});

  app.get('/api/scorm/progress',async(req,res)=>{try{
    const user=await currentUser(req),database=await getDb();let q={};if(user.role==='student')q.username=user.username;else if(!creators.has(user.role))throw Object.assign(new Error('forbidden'),{status:403});
    if(req.query.packageId)q.packageId=clean(req.query.packageId,120);if(req.query.username&&managers.has(user.role))q.username=clean(req.query.username,80).toLowerCase();
    res.json({ok:true,items:await database.collection('scorm_runtime').find(q,{projection:{_id:0,data:0}}).sort({updatedAt:-1}).limit(500).toArray()});
  }catch(e){fail(res,e)}});
}

function wrappedExpress(...args){const app=originalExpress(...args);install(app);return app}
Object.assign(wrappedExpress,originalExpress);
require.cache[expressPath].exports=wrappedExpress;
process.on('SIGTERM',()=>mongoClient?.close().catch(()=>{}));
