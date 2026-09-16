(()=>{
const E=window.EDU;if(!E||E.__timePolicyV5)return;E.__timePolicyV5=true;
const TZ='Asia/Tashkent';
function clock(){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
 const o={};for(const p of parts)if(p.type!=='literal')o[p.type]=p.value;
 return{date:`${o.year}-${o.month}-${o.day}`,time:`${o.hour}:${o.minute}`};
}
function effectiveLesson(l){
 if(!l||typeof l!=='object')return l;
 const x={...l},c=clock(),date=String(x.date||''),start=String(x.start||''),end=String(x.end||'');
 if(x.status==='cancelled')return x;
 if(date){
   if(date<c.date||(date===c.date&&end&&end<=c.time)){x.status='ended';x.effectiveStatus='ended';x.expired=true;return x}
   if(date>c.date||(date===c.date&&start&&start>c.time)){
     if(x.status==='live')x.status='next';x.effectiveStatus=x.status||'next';return x
   }
 }
 x.effectiveStatus=x.status||'next';return x;
}
function normalize(url,d){
 if(!d||typeof d!=='object')return d;
 if(Array.isArray(d.items)&&(/\/api\/manage\/(lessons|today)/.test(url)))d.items=d.items.map(effectiveLesson);
 if(Array.isArray(d.lessons)&&url.includes('/api/dashboard')){
   const all=d.lessons.map(effectiveLesson),visible=all.filter(x=>x.status!=='ended'&&x.status!=='cancelled');
   d.lessons=visible;
   if(d.stats){d.stats.liveLessons=visible.filter(x=>x.status==='live').length;d.stats.todayLessons=visible.length}
 }
 if(d.lesson&&url.includes('/api/lessons/'))d.lesson=effectiveLesson(d.lesson);
 return d;
}
const oldApi=E.api;
E.api=async function(url,opts){const d=await oldApi(url,opts);return normalize(String(url||''),d)};
})();
