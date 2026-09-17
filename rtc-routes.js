const jwt=require('jsonwebtoken');
module.exports=function registerRtcRoutes({app,auth,getLesson,lessonAllowed}){
 const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
 const bridge=()=>clean(process.env.RTC_BRIDGE_URL,500).replace(/\/$/,'');
 const secret=()=>process.env.SFU_TOKEN_SECRET||'';
 const turnServers=()=>{
   const urls=String(process.env.TURN_URLS||'').split(',').map(x=>x.trim()).filter(Boolean);
   if(!urls.length)return [];
   return [{urls,username:process.env.TURN_USERNAME||'',credential:process.env.TURN_CREDENTIAL||''}];
 };
 app.get('/api/rtc/session/:lessonId',auth,async(req,res)=>{
   try{
     const lesson=await getLesson(req.params.lessonId);
     if(!lesson)return res.status(404).json({ok:false,error:'not_found'});
     if(!lessonAllowed(req.user,lesson))return res.status(403).json({ok:false,error:'lesson_access_denied'});
     if(!bridge()||!secret())return res.status(503).json({ok:false,error:'sfu_not_configured',bridgeReady:Boolean(bridge()),tokenReady:Boolean(secret())});
     const token=jwt.sign({roomId:lesson.id,sub:req.user.sub,name:req.user.name,role:req.user.role,group:req.user.group||'',teacherUsername:lesson.teacherUsername},secret(),{expiresIn:'2h',issuer:'qdtuedu-web'});
     const role=req.user.role;
     res.set('Cache-Control','no-store');
     res.json({ok:true,bridgeUrl:bridge(),token,lesson:{id:lesson.id,subject:lesson.subject,group:lesson.group,teacher:lesson.teacher,teacherUsername:lesson.teacherUsername,date:lesson.date,start:lesson.start,end:lesson.end,status:lesson.status},mode:role==='teacher'?'host':['admin','tech','rector','prorector','dean','tutor'].includes(role)?'monitor':'participant',defaults:{mic:role==='teacher',cam:role==='teacher'},iceServers:turnServers(),policy:{studentGroupLocked:true,maxVisibleStudentVideos:3,audioFirst:true}});
   }catch(e){console.error('rtc session error',e);res.status(500).json({ok:false,error:'rtc_session_failed'})}
 });
 app.get('/api/rtc/config',auth,(req,res)=>res.json({ok:true,enabled:Boolean(bridge()&&secret()),bridgeUrl:bridge()||null,turnConfigured:Boolean(String(process.env.TURN_URLS||'').trim())}));
};
