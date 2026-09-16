(()=>{
const E=window.EDU;if(!E)return;
const oldInit=E.initSocket;let boundSocket=null,roomScheduleHandler=null;
E.initSocket=function(){const s=oldInit();if(s!==boundSocket){boundSocket=s;roomScheduleHandler=async ev=>{try{if(E.state.current!=='room'||!document.querySelector('.waiting-stage'))return;const status=ev?.status||ev?.patch?.status;if(status!=='live')return;const id=ev?.id||ev?.lesson?.id;if(!id)return;const d=await E.api('/api/manage/lessons');const lesson=(d.items||[]).find(x=>x.id===id);if(lesson){E.toast('O‘qituvchi darsni boshladi');E.openRoom({...lesson,status:'live'})}}catch{}};s.on('schedule:changed',roomScheduleHandler)}return s};
if(E.state.socket)E.initSocket();
})();
