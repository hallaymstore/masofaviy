module.exports=function registerCaptionRoutes({app,io,getDb,auth}){
 const db=()=>getDb(),clean=(v,n=500)=>String(v??'').trim().slice(0,n);const cache=new Map();
 const managers=['admin','tech','rector','prorector','dean','tutor'];
 async function canPublish(user,lessonId){if(!db())return false;const l=await db().collection('lessons').findOne({id:lessonId},{projection:{teacherUsername:1}});if(!l)return false;return l.teacherUsername===user.sub||managers.includes(user.role)}
 async function translate(text,target,source='auto'){
  if(!text||target===source||cache.get(`${source}|${target}|${text}`))return cache.get(`${source}|${target}|${text}`)||text;
  const key=`${source}|${target}|${text}`;let out=text;
  try{
   const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),3500);
   const url=`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(source||'auto')}&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
   const r=await fetch(url,{signal:ctrl.signal,headers:{'User-Agent':'Mozilla/5.0'}});clearTimeout(t);if(r.ok){const d=await r.json();out=(d?.[0]||[]).map(x=>x?.[0]||'').join('').trim()||text}
  }catch{}
  cache.set(key,out);if(cache.size>500)cache.delete(cache.keys().next().value);return out;
 }
 app.get('/api/captions/status',auth,(req,res)=>res.json({ok:true,languages:['uz','ru','en'],speechRecognition:'browser',translation:'cloud'}));
 io.on('connection',socket=>{
  socket.on('caption:publish',async(payload,ack)=>{
   try{const lessonId=clean(payload?.lessonId,80),text=clean(payload?.text,260),source=clean(payload?.sourceLang,5)||'auto';if(!lessonId||!text||!(await canPublish(socket.user,lessonId))){ack?.({ok:false,error:'forbidden'});return}
    const targets=['uz','ru','en'];const translated={};for(const lang of targets)translated[lang]=source.startsWith(lang)?text:await translate(text,lang,source==='auto'?'auto':source.slice(0,2));
    const line={lessonId,text,sourceLang:source,translations:translated,speaker:socket.user.name,at:new Date().toISOString()};io.to(`lesson:${lessonId}`).emit('caption:line',line);ack?.({ok:true});
   }catch(e){ack?.({ok:false,error:'caption_failed'})}
  });
 });
};
