(()=>{
const E=window.EDU,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
if(!E)return;
const managers=['admin','tech','rector','prorector','dean','tutor'];
const esc=E.esc;
const oldHome=E.pages.home;

function bubble(m){const me=m.username===E.state.user?.username;return `<div class="bubble ${me?'me':''}"><b>${esc(me?'Siz':m.name||m.username||'Foydalanuvchi')}</b><p>${esc(m.text)}</p></div>`}
function scrollChat(){const b=$('#chatMessages');if(b)b.scrollTop=b.scrollHeight}

E.pages.messages=async function(){
 const d=await E.api('/api/edu/subjects'),subjects=d.items||[],role=E.state.user?.role,group=E.state.user?.group||'';
 const rooms=[];
 if(managers.includes(role))rooms.push({id:'general',name:'Boshqaruv suhbati',meta:'Universitet boshqaruvi'});
 if(role==='student'&&group)rooms.push({id:'group-'+group,name:'Guruhim',meta:group});
 if(role==='teacher'){
   const groups=[...new Set(subjects.flatMap(s=>s.groups||[]))];
   groups.forEach(g=>rooms.push({id:'group-'+g,name:g+' guruhi',meta:'Siz dars beradigan guruh'}));
 }
 subjects.forEach(s=>rooms.push({id:'subject-'+s.id,name:s.name,meta:role==='student'?(group||'Sizning guruhingiz'):(s.groups||[]).join(', ')}));
 $('#page').innerHTML=`<div class="page-head"><div><h1>Xabarlar</h1><p>${role==='student'?`Faqat ${esc(group||'sizning')} guruhingiz va fanlaringiz`:'Ruxsat berilgan guruh va fan suhbatlari'}</p></div></div>${role==='student'?`<div class="inline-alert ok" style="margin-bottom:10px"><b>${E.icon('lock','🔒','Himoyalangan')} Guruh himoyasi yoqilgan.</b> Boshqa guruh chatlari sizga ko‘rinmaydi va server ham kirishga ruxsat bermaydi.</div>`:''}<div class="chat-shell"><aside class="chat-rooms">${rooms.length?rooms.map((r,i)=>`<div class="chat-room ${i===0?'active':''}" data-chat-room="${esc(r.id)}"><b>${esc(r.name)}</b><span>${esc(r.meta)}</span></div>`).join(''):'<div class="empty">Suhbat xonasi biriktirilmagan</div>'}</aside><section class="chat-main"><div class="chat-head"><b id="chatRoomName">${esc(rooms[0]?.name||'Suhbat')}</b><span class="page-sub" id="chatPresence"></span></div><div id="chatMessages" class="chat-messages"><div class="empty">Xonani tanlang</div></div><form id="chatCompose" class="chat-compose"><input class="field" id="chatText" maxlength="1200" placeholder="Xabar yozing..." ${rooms.length?'':'disabled'}><button class="btn primary" aria-label="Yuborish" ${rooms.length?'':'disabled'}>${E.icon('send','➤','Yuborish')}</button></form></section></div>`;
 if(!rooms.length)return;
 let active=rooms[0];const socket=E.initSocket();
 const open=async r=>{
   active=r;$$('[data-chat-room]').forEach(x=>x.classList.toggle('active',x.dataset.chatRoom===r.id));$('#chatRoomName').textContent=r.name;$('#chatMessages').innerHTML='<div class="skeleton"></div>';
   try{const hist=await E.api('/api/edu/messages/'+encodeURIComponent(r.id));$('#chatMessages').innerHTML=hist.items.length?hist.items.map(bubble).join(''):'<div class="empty">Suhbatni birinchi bo‘lib boshlang</div>';scrollChat()}catch(ex){$('#chatMessages').innerHTML=`<div class="inline-alert red">${esc(E.errorText(ex))}</div>`;return}
   socket.emit('edu:room:join',r.id,ack=>{if(!ack?.ok){$('#chatMessages').innerHTML='<div class="inline-alert red">Bu suhbat xonasiga kirishga ruxsat yo‘q.</div>'}})
 };
 socket.off('edu:chat:message');socket.on('edu:chat:message',m=>{if(m.roomId!==active.id)return;const box=$('#chatMessages');if(box.querySelector('.empty'))box.innerHTML='';box.insertAdjacentHTML('beforeend',bubble(m));scrollChat()});
 socket.off('edu:presence');socket.on('edu:presence',p=>{$('#chatPresence').textContent=`${p.online||0} online`});
 socket.off('edu:room:error');socket.on('edu:room:error',()=>E.toast('Bu chatga kirishga ruxsat yo‘q'));
 $$('[data-chat-room]').forEach(x=>x.onclick=()=>open(rooms.find(r=>r.id===x.dataset.chatRoom)));
 $('#chatCompose').onsubmit=e=>{e.preventDefault();const i=$('#chatText'),text=i.value.trim();if(!text)return;socket.emit('edu:chat:send',{text},ack=>{if(!ack?.ok)E.toast('Xabar yuborishga ruxsat yo‘q')});i.value=''};
 await open(active)
};

if(oldHome)E.pages.home=async function(payload){
 await oldHome(payload);
 if(E.state.user?.role!=='student')return;
 try{
   const d=await E.api('/api/edu/student-center'),s=d.summary||{},head=$('#page .page-head');
   if(!head||$('#studentCenterStrip'))return;
   head.insertAdjacentHTML('afterend',`<section id="studentCenterStrip" class="card" style="margin-bottom:12px"><div class="card-title"><div><span class="kicker">MENING TA’LIMIM</span><h3 style="margin:4px 0">${esc(d.group||'Guruh biriktirilmagan')}</h3></div><span class="badge ok">${E.icon('lock','🔒')} Faqat mening guruhim</span></div><div class="grid stats-grid" style="margin-top:10px"><div class="stat"><b>${esc(s.todayLessons||0)}</b><span>Bugungi dars</span></div><div class="stat"><b>${esc(s.dueSoon||0)}</b><span>48 soatda deadline</span></div><div class="stat"><b>${esc(s.overdue||0)}</b><span>Kechikkan vazifa</span></div><div class="stat"><b>${esc(s.unread||0)}</b><span>Yangi xabar</span></div></div><div class="toolbar-actions" style="margin-top:10px"><button class="btn ghost" id="v4GroupChat">Guruh chatiga o‘tish</button><button class="btn ghost" id="v4Absence">Sababli davomat arizasi</button></div></section>`);
   $('#v4GroupChat')?.addEventListener('click',()=>E.go('messages'));$('#v4Absence')?.addEventListener('click',absenceModal)
 }catch{}
};

async function absenceModal(){
 try{
   const [ld,rd]=await Promise.all([E.api('/api/manage/lessons'),E.api('/api/edu/absence-requests')]),lessons=ld.items||[],requests=rd.items||[];
   E.openModal(`<h3>Sababli davomat arizasi</h3><p class="page-sub">Dekan/tyutor ko‘rib chiqishi uchun sabab va tasdiqlovchi hujjat havolasini yuboring.</p><form id="v4AbsForm" class="form-grid"><label class="form-label full">Dars<select class="field" name="lessonId" required>${lessons.map(l=>`<option value="${esc(l.id)}">${esc(l.date||'')} · ${esc(l.subject)} · ${esc(l.start||'')}</option>`).join('')}</select></label><label class="form-label full">Sabab<textarea class="field" name="reason" required maxlength="2000"></textarea></label><label class="form-label full">Hujjat havolasi<input class="field" name="attachmentUrl" placeholder="PDF yoki rasm havolasi"></label><div class="full"><button class="btn primary full">Ariza yuborish</button></div></form><div class="stack" style="margin-top:14px">${requests.slice(0,5).map(r=>`<div class="item-card"><div><h4>${esc(r.subject||'Dars')}</h4><p>${esc(r.reason||'')}</p></div><span class="badge ${r.status==='approved'?'ok':r.status==='rejected'?'red':'warn'}">${r.status==='approved'?'Tasdiqlandi':r.status==='rejected'?'Rad etildi':'Ko‘rib chiqilmoqda'}</span></div>`).join('')||'<div class="empty">Oldingi arizalar yo‘q</div>'}</div>`,true);
   const f=$('#v4AbsForm');if(!lessons.length){f.querySelector('button').disabled=true;return}f.onsubmit=async e=>{e.preventDefault();await E.api('/api/edu/absence-requests',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f).entries()))});E.toast('Ariza yuborildi');E.closeModal()}
 }catch(ex){E.toast(E.errorText(ex))}
}
})();
