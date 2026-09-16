(()=>{
const E=window.EDU,$=s=>document.querySelector(s);
$('#topSearchInput')?.addEventListener('click',()=>$('#searchBtn')?.click());
document.addEventListener('keydown',e=>{if(e.key==='Escape')E.closeModal()});

async function refreshNotificationDot(){
  if(!E.state.user)return;
  try{const d=await E.api('/api/edu/notifications');const unread=(d.items||[]).some(x=>!x.read);$('#notifDot')?.classList.toggle('hidden',!unread)}catch{}
}
setTimeout(refreshNotificationDot,1400);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshNotificationDot()});

E.pages.announcements=async function(){
  const d=await E.api('/api/manage/announcements');
  $('#page').innerHTML=`<div class="page-head"><div><h1>E’lonlar</h1><p>Talabalar va xodimlarga rasmiy xabarlar</p></div></div><div class="toolbar"><div></div><button class="btn primary" id="newAnnouncement">＋ E’lon yozish</button></div><div class="stack">${d.items.length?d.items.map(a=>`<section class="card"><div class="card-title"><h3>${E.esc(a.title)}</h3><span class="badge gray">${E.esc(a.audience||'all')}</span></div><p class="page-sub">${E.esc(a.body)}</p></section>`).join(''):'<section class="card empty">E’lonlar yo‘q</section>'}</div>`;
  $('#newAnnouncement').onclick=()=>{
    E.openModal(`<h3>Yangi e’lon</h3><form id="annForm" class="form-grid"><label class="form-label full">Sarlavha<input class="field" name="title" required></label><label class="form-label full">Matn<textarea class="field" name="body" required></textarea></label><label class="form-label">Kimga<select class="field" name="audience"><option value="all">Barchaga</option><option value="students">Talabalarga</option><option value="teachers">O‘qituvchilarga</option></select></label><div class="full"><button class="btn primary full">Yuborish</button></div></form>`);
    $('#annForm').onsubmit=async e=>{e.preventDefault();try{await E.api('/api/manage/announcements',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});E.toast('E’lon yuborildi');E.closeModal();E.go('announcements')}catch(ex){E.toast(E.errorText(ex))}};
  };
};
})();
