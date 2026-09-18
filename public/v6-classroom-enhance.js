(()=>{
const E=window.EDU;if(!E)return;
const $=s=>document.querySelector(s);
function enhance(){
 const room=$('.classroom-v5');if(!room||room.dataset.v6Enhanced)return;room.dataset.v6Enhanced='1';
 const u=E.state.user||{},stage=$('.stage-v5'),pip=$('.pip-self-v5'),grid=$('#remoteGridV5'),side=$('.room-side-v5');
 if(u.role==='teacher'&&stage&&pip){
   room.classList.add('teacher-host-v6');
   pip.classList.add('teacher-main-camera-v6');
   const title=document.createElement('div');title.className='teacher-camera-title-v6';title.innerHTML='<b>🎥 Sizning kamerangiz</b><span>Asosiy o‘qituvchi video oynasi</span>';
   pip.prepend(title);stage.insertBefore(pip,grid||stage.firstChild);
   if(grid)grid.classList.add('student-preview-grid-v6');
   if(side){const h=document.createElement('div');h.className='side-section-title-v6';h.textContent='Talabalar ro‘yxati';side.prepend(h)}
 }
 const tools=$('.classroom-head-v5 .toolbar-actions');
 if(tools&&!$('#classAiV6')){const ai=document.createElement('button');ai.id='classAiV6';ai.className='btn ghost';ai.textContent='🧠 AI tahlil';ai.onclick=()=>E.go('insights');tools.prepend(ai)}
 if(!$('.class-access-v6')){const a=document.createElement('button');a.className='class-access-v6';a.title='Inkluziv sozlamalar';a.textContent='♿';a.onclick=()=>E.go('accessibility');room.appendChild(a)}
 E.api('/api/accessibility/preferences').then(d=>{const p=d.preferences||{},sel=$('#captionLangV5');if(sel&&p.captionLang)sel.value=p.captionLang;if(p.signLanguageSpotlight)room.classList.add('sign-spotlight-v6')}).catch(()=>{});
}
const old=E.pages.classroom;
if(old)E.pages.classroom=async p=>{await old(p);enhance()};
})();