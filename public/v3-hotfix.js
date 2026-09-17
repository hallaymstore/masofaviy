(()=>{
const E=window.EDU;if(!E)return;
const oldInit=E.initSocket;let boundSocket=null,roomScheduleHandler=null;
E.initSocket=function(){const s=oldInit();if(s!==boundSocket){boundSocket=s;roomScheduleHandler=async ev=>{try{if(E.state.current!=='room'||!document.querySelector('.waiting-stage'))return;const status=ev?.status||ev?.patch?.status;if(status!=='live')return;const id=ev?.id||ev?.lesson?.id;if(!id)return;const d=await E.api('/api/manage/lessons');const lesson=(d.items||[]).find(x=>x.id===id);if(lesson){E.toast('O‘qituvchi darsni boshladi');E.openRoom({...lesson,status:'live'})}}catch{}};s.on('schedule:changed',roomScheduleHandler)}return s};
if(E.state.socket)E.initSocket();
if(!document.querySelector('link[data-v5]')){const l=document.createElement('link');l.rel='stylesheet';l.href='/v5.css';l.dataset.v5='1';document.head.appendChild(l)}
const load=src=>new Promise((resolve,reject)=>{if(document.querySelector(`script[src="${src}"]`))return resolve();const s=document.createElement('script');s.src=src;s.async=false;s.onload=resolve;s.onerror=reject;document.body.appendChild(s)});
(async()=>{try{await load('/vendor/mediasoup-client.js');await load('/v5-learning.js');await load('/v5-classroom.js');await load('/v5-nav.js')}catch(e){console.warn('v5 enhancement load failed',e)}})();
})();
