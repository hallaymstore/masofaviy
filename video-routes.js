const crypto=require('crypto');
module.exports=function registerVideoRoutes({app,getDb,auth,allow}){
 const db=()=>getDb(), clean=(v,n=300)=>String(v??'').trim().slice(0,n), id=p=>`${p}_${crypto.randomUUID()}`;
 const managers=['admin','tech','rector','prorector','dean','tutor'];
 async function ensure(){if(!db())return;await Promise.all([db().collection('video_lessons').createIndex({groups:1,publishedAt:-1}),db().collection('video_lessons').createIndex({subjectId:1,publishedAt:-1}),db().collection('video_comments').createIndex({videoId:1,createdAt:1}),db().collection('video_likes').createIndex({videoId:1,username:1},{unique:true})]).catch(()=>{})}
 app.use('/api/videos',async(req,res,next)=>{try{await ensure();next()}catch(e){next(e)}});
 app.get('/api/videos',auth,async(req,res)=>{
  if(!db())return res.json({ok:true,items:[]});const q={published:{$ne:false}};
  if(req.user.role==='student')q.$or=[{groups:req.user.group},{groups:{$size:0}},{groups:{$exists:false}}];
  if(req.user.role==='teacher')q.$or=[{teacherUsername:req.user.sub},{groups:{$exists:true}}];
  if(req.query.subjectId)q.subjectId=clean(req.query.subjectId,80);if(req.query.group&&managers.includes(req.user.role))q.groups=clean(req.query.group,60);
  const items=await db().collection('video_lessons').find(q,{projection:{_id:0}}).sort({featured:-1,publishedAt:-1,createdAt:-1}).limit(100).toArray();res.json({ok:true,items});
 });
 app.post('/api/videos',auth,allow('teacher','admin','tech','dean'),async(req,res)=>{
  if(!db())return res.status(503).json({ok:false,error:'db_required'});
  const groups=Array.isArray(req.body.groups)?req.body.groups.map(x=>clean(x,60)).filter(Boolean):clean(req.body.groups,500).split(',').map(x=>x.trim()).filter(Boolean);
  const subjectId=clean(req.body.subjectId,80);let teacherUsername=req.user.sub,teacher=req.user.name;
  if(req.user.role==='teacher'){const s=await db().collection('subjects').findOne({id:subjectId},{projection:{teacherUsername:1,groups:1,name:1}});if(!s||s.teacherUsername!==req.user.sub)return res.status(403).json({ok:false,error:'subject_not_assigned'});if(groups.some(g=>!(s.groups||[]).includes(g)))return res.status(403).json({ok:false,error:'group_not_assigned'})}
  else {teacherUsername=clean(req.body.teacherUsername,80)||req.user.sub;teacher=clean(req.body.teacher,140)||req.user.name}
  const doc={id:id('vid'),title:clean(req.body.title,180),description:clean(req.body.description,3000),subjectId,subject:clean(req.body.subject,140),groups,course:clean(req.body.course,40),teacherUsername,teacher,url:clean(req.body.url,1500),thumbnailUrl:clean(req.body.thumbnailUrl,1500),provider:clean(req.body.provider,30)||'link',duration:clean(req.body.duration,30),published:req.body.published!==false,featured:Boolean(req.body.featured),views:0,likes:0,createdAt:new Date(),publishedAt:new Date()};
  if(!doc.title||!doc.url)return res.status(400).json({ok:false,error:'required'});await db().collection('video_lessons').insertOne(doc);res.status(201).json({ok:true,item:{...doc,_id:undefined}})
 });
 app.patch('/api/videos/:id',auth,allow('teacher','admin','tech','dean'),async(req,res)=>{
  if(!db())return res.status(503).json({ok:false,error:'db_required'});const video=await db().collection('video_lessons').findOne({id:clean(req.params.id,80)});if(!video)return res.status(404).json({ok:false,error:'not_found'});if(req.user.role==='teacher'&&video.teacherUsername!==req.user.sub)return res.status(403).json({ok:false,error:'forbidden'});
  const patch={updatedAt:new Date()};['title','description','url','thumbnailUrl','provider','duration','course'].forEach(k=>{if(req.body[k]!==undefined)patch[k]=clean(req.body[k],k==='description'?3000:1500)});if(Array.isArray(req.body.groups))patch.groups=req.body.groups.map(x=>clean(x,60)).filter(Boolean);if(req.body.published!==undefined)patch.published=Boolean(req.body.published);if(req.body.featured!==undefined)patch.featured=Boolean(req.body.featured);await db().collection('video_lessons').updateOne({id:video.id},{$set:patch});res.json({ok:true})
 });
 app.post('/api/videos/:id/view',auth,async(req,res)=>{if(db())await db().collection('video_lessons').updateOne({id:clean(req.params.id,80)},{$inc:{views:1}});res.json({ok:true})});
 app.post('/api/videos/:id/like',auth,async(req,res)=>{if(!db())return res.json({ok:true,liked:false});const videoId=clean(req.params.id,80),q={videoId,username:req.user.sub};const ex=await db().collection('video_likes').findOne(q);if(ex){await db().collection('video_likes').deleteOne(q);await db().collection('video_lessons').updateOne({id:videoId},{$inc:{likes:-1}});return res.json({ok:true,liked:false})}await db().collection('video_likes').insertOne({...q,createdAt:new Date()});await db().collection('video_lessons').updateOne({id:videoId},{$inc:{likes:1}});res.json({ok:true,liked:true})});
 app.get('/api/videos/:id/comments',auth,async(req,res)=>{if(!db())return res.json({ok:true,items:[]});const items=await db().collection('video_comments').find({videoId:clean(req.params.id,80)},{projection:{_id:0}}).sort({createdAt:1}).limit(300).toArray();res.json({ok:true,items})});
 app.post('/api/videos/:id/comments',auth,async(req,res)=>{if(!db())return res.status(503).json({ok:false,error:'db_required'});const text=clean(req.body.text,1200);if(!text)return res.status(400).json({ok:false,error:'required'});const doc={id:id('vc'),videoId:clean(req.params.id,80),username:req.user.sub,name:req.user.name,role:req.user.role,text,parentId:clean(req.body.parentId,80),createdAt:new Date()};await db().collection('video_comments').insertOne(doc);res.status(201).json({ok:true,item:{...doc,_id:undefined}})});
};
