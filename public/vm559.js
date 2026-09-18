(()=>{
const E=window.EDU;if(!E)return;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],esc=E.esc;
const managers=new Set(['admin','tech','rector','prorector','dean','tutor']);
const creators=new Set(['teacher','admin','tech','rector','prorector','dean']);
const statusMeta={
  ready:['ok','Tayyor'],verified:['ok','Tasdiqlangan'],'evidence-added':['warn','Dalil kiritilgan'],
  partial:['warn','Qisman'],pending:['red','Dalil kerak'],blocked:['red','Bloklangan']
};
function manager(){return managers.has(E.state.user?.role)}
function statusBadge(s){const m=statusMeta[s]||['gray',s||'—'];return '<span class="badge '+m[0]+'">'+m[1]+'</span>'}
function fmt(v){try{return new Date(v).toLocaleString('uz-UZ')}catch{return String(v||'')}}
function err(e){return E.errorText?E.errorText(e):String(e?.message||'Xatolik')}

function addNav(){
  const nav=$('#sideNav');if(!nav||!E.state.user)return;
  const before=nav.querySelector('[data-nav="profile"]');
  const items=[['law559','✓','559 Talablar'],['scorm','S','SCORM'],['quality','◎','Monitoring']];
  if(manager())items.push(['academic559','▦','Akademik reyestr'],['integrations559','↔','Integratsiya']);
  for(const [id,ic,label] of items){
    if(nav.querySelector('[data-vm559="'+id+'"]'))continue;
    const b=document.createElement('button');b.className='nav-link';b.dataset.vm559=id;
    b.innerHTML='<span class="nav-icon">'+ic+'</span>'+label;b.onclick=()=>E.go(id);
    before?nav.insertBefore(b,before):nav.appendChild(b);
  }
  const top=$('.top-actions');
  if(top&&!$('#vm559Top')){
    const b=document.createElement('button');b.id='vm559Top';b.className='icon-btn';b.title='VM 559 talablar';b.textContent='✓';b.onclick=()=>E.go('law559');top.insertBefore(b,top.firstChild);
  }
}
setInterval(addNav,1000);setTimeout(addNav,250);

E.pages.law559=async()=>{
  const d=await E.api('/api/vm559/overview');
  $('#page').innerHTML='<div class="page-head"><div><span class="eyebrow">Vazirlar Mahkamasi 559-son</span><h1>Masofaviy ta’lim talablar paneli</h1><p>Amaldagi normativ talablar, dasturiy holat va tashqi dalillar.</p></div><a class="btn ghost" href="'+esc(d.law.url)+'" target="_blank" rel="noopener">LexUZ ↗</a></div>'+
  '<section class="vm559-summary"><div class="vm559-score"><b>'+d.stats.ready+'/'+d.stats.total+'</b><span>Tayyor/tasdiqlangan</span></div><div><h3>Bu panel “100% qonuniy sertifikat” emas</h3><p>Dastur bajaradigan talablar avtomatik ko‘rsatiladi. Server joylashuvi, auditoriya, xodimlar, O‘zDSt va rasmiy integratsiya kabi tashqi talablar hujjat bilan tasdiqlanadi.</p></div></section>'+
  '<div class="grid stats-grid"><div class="stat"><b>'+d.stats.ready+'</b><span>Tayyor</span></div><div class="stat"><b>'+d.stats.partial+'</b><span>Qisman</span></div><div class="stat"><b>'+d.stats.blocked+'</b><span>Kutilmoqda/blok</span></div><div class="stat"><b>'+d.capacity.filter(x=>!x.ok).length+'</b><span>1:50 buzilishi</span></div></div>'+
  '<section class="card"><div class="card-title"><div><h3>Bandma-band tekshiruv</h3><p class="page-sub">Holat real konfiguratsiya va rasmiy dalillarga qarab yangilanadi.</p></div><button class="btn ghost" id="vmSelfcheck">Self-check</button></div><div class="vm559-list">'+d.rows.map(r=>'<article class="vm559-row"><div class="vm559-clause">'+esc(r.clause)+'</div><div class="vm559-main"><b>'+esc(r.title)+'</b><p>'+esc(r.detail)+'</p>'+(r.evidence?.documentNo?'<small>Dalil: '+esc(r.evidence.documentNo)+'</small>':'')+'</div><div class="vm559-actions">'+statusBadge(r.status)+(manager()?'<button class="btn ghost small-btn" data-evidence="'+esc(r.code)+'">Dalil</button>':'')+'</div></article>').join('')+'</div></section>'+
  '<div class="grid two-col" style="margin-top:12px"><section class="card"><div class="card-title"><h3>1 o‘qituvchi : 50 talaba</h3><span class="badge '+(d.capacity.every(x=>x.ok)?'ok':'red')+'">'+(d.capacity.every(x=>x.ok)?'Normada':'Muammo bor')+'</span></div><div class="stack">'+(d.capacity.map(x=>'<div class="item-card"><div><b>'+esc(x.group)+'</b><p>'+x.students+' talaba · limit 50</p></div>'+statusBadge(x.ok?'ready':'blocked')+'</div>').join('')||'<div class="empty">Guruh ma’lumoti yo‘q</div>')+'</div></section>'+
  '<section class="card"><div class="card-title"><h3>Server talabi</h3>'+statusBadge(d.server.ready?'ready':'blocked')+'</div><div class="stack"><div class="item-card"><div><b>Davlat</b><p>'+esc(d.server.country)+'</p></div></div><div class="item-card"><div><b>Huquq</b><p>'+esc(d.server.ownership)+' · ijara '+esc(d.server.leaseYears)+' yil</p></div></div><div class="inline-alert">Production server O‘zbekiston hududida bo‘lishi va OTM mulki yoki kamida 5 yillik ijara hujjati bilan tasdiqlanishi kerak.</div></div></section></div>'+
  '<section class="card" style="margin-top:12px"><div class="card-title"><h3>Fan kontenti qamrovi</h3><span class="badge gray">'+d.coverage.length+' fan</span></div><div class="vm559-content-grid">'+d.coverage.map(x=>'<div class="mini-card"><b>'+esc(x.name)+'</b><span>'+x.materials+' material · '+x.assignments+' topshiriq · '+x.videos+' video</span>'+statusBadge(x.ok?'ready':'partial')+'</div>').join('')+'</div></section>';
  $$('[data-evidence]').forEach(b=>b.onclick=()=>evidenceModal(b.dataset.evidence,d.rows.find(x=>x.code===b.dataset.evidence)?.evidence));
  $('#vmSelfcheck').onclick=async()=>{const x=await E.api('/api/vm559/selfcheck');E.openModal('<h3>VM 559 self-check</h3><p class="page-sub">'+esc(x.generatedAt)+'</p><div class="stack">'+(x.failures.map(f=>'<div class="item-card"><div><b>'+esc(f.clause)+' · '+esc(f.title)+'</b><p>'+esc(f.code)+'</p></div>'+statusBadge(f.status)+'</div>').join('')||'<div class="inline-alert ok">Dasturiy self-check bo‘yicha ochiq muammo topilmadi.</div>')+'</div>',true)};
};
function evidenceModal(code,ev={}){
  E.openModal('<h3>'+esc(code)+' — rasmiy dalil</h3><p class="page-sub">Faqat haqiqiy hujjat rekvizitini kiriting. “Tasdiqlangan” belgisi hujjat amalda tekshirilgandan keyin qo‘yiladi.</p><form id="vmEvForm" class="form-grid"><label class="form-label full">Hujjat nomi<input class="field" name="title" value="'+esc(ev?.title||'')+'"></label><label class="form-label">Raqam / rekvizit<input class="field" name="documentNo" value="'+esc(ev?.documentNo||'')+'"></label><label class="form-label">URL<input class="field" name="url" value="'+esc(ev?.url||'')+'"></label><label class="form-label full">Izoh<textarea class="field" name="note">'+esc(ev?.note||'')+'</textarea></label><label class="form-label full"><input type="checkbox" name="verified" '+(ev?.verified?'checked':'')+'> Hujjat vakolatli shaxs tomonidan tekshirildi</label><div class="full"><button class="btn primary full">Saqlash</button></div></form>');
  $('#vmEvForm').onsubmit=async e=>{e.preventDefault();const f=e.target,body=Object.fromEntries(new FormData(f).entries());body.verified=f.verified.checked;await E.api('/api/vm559/evidence/'+encodeURIComponent(code),{method:'POST',body:JSON.stringify(body)});E.toast('Dalil saqlandi');E.closeModal();E.go('law559')};
}

E.pages.scorm=async()=>{
  const d=await E.api('/api/scorm/packages');
  const canCreate=creators.has(E.state.user?.role);
  $('#page').innerHTML='<div class="page-head"><div><h1>SCORM markazi</h1><p>SCORM 1.2 / 2004 paketlari, progress va LMS runtime.</p></div>'+(canCreate?'<button class="btn primary" id="uploadScorm">＋ SCORM ZIP</button>':'')+'</div><section class="card"><div class="stack">'+(d.items.map(x=>'<div class="item-card"><div class="item-card-main"><h4>'+esc(x.title)+'</h4><p>'+esc(x.version)+' · '+Math.round((x.bytes||0)/1024/1024*10)/10+' MB · '+esc((x.groups||[]).join(', ')||'Barcha guruhlar')+'</p></div><div class="item-actions"><span class="badge '+(x.published?'ok':'gray')+'">'+(x.published?'Faol':'Draft')+'</span><button class="btn primary" data-scorm="'+esc(x.id)+'">Ochish</button></div></div>').join('')||'<div class="empty">SCORM paketlar hali yuklanmagan</div>')+'</div></section>';
  $$('[data-scorm]').forEach(b=>b.onclick=()=>E.go('scormplayer',{packageId:b.dataset.scorm}));
  $('#uploadScorm')?.addEventListener('click',scormUploadModal);
};
function scormUploadModal(){
  E.openModal('<h3>SCORM paket yuklash</h3><p class="page-sub">ZIP ichida imsmanifest.xml bo‘lishi shart.</p><form id="scormForm" class="form-grid"><label class="form-label full">Nomi<input class="field" name="title"></label><label class="form-label">Fan ID<input class="field" name="subjectId" placeholder="SUB-MATH"></label><label class="form-label">Guruhlar<input class="field" name="groups" placeholder="MMT-520-25, MMT-519-25"></label><label class="form-label full">SCORM ZIP<input class="field" type="file" name="package" accept=".zip" required></label><div class="full"><button class="btn primary full">Import qilish</button></div></form>');
  $('#scormForm').onsubmit=async e=>{e.preventDefault();const f=e.target,fd=new FormData(f);const b=f.querySelector('button');b.disabled=true;b.textContent='Yuklanmoqda...';try{const r=await fetch('/api/scorm/packages',{method:'POST',credentials:'include',body:fd});const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||'upload_failed');E.toast('SCORM import qilindi');E.closeModal();E.go('scorm')}catch(ex){E.toast(err(ex));b.disabled=false;b.textContent='Import qilish'}};
}
E.pages.scormplayer=async p=>{
  const packageId=p?.packageId;if(!packageId)return E.go('scorm');
  const [launch,rt]=await Promise.all([E.api('/api/scorm/packages/'+encodeURIComponent(packageId)+'/launch'),E.api('/api/scorm/runtime/'+encodeURIComponent(packageId))]);
  const store={...(rt.data||{})};let timer=null,lastError='0';
  const commit=()=>fetch('/api/scorm/runtime/'+encodeURIComponent(packageId),{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:store})}).catch(()=>{});
  const set=(k,v)=>{store[String(k)]=String(v??'');clearTimeout(timer);timer=setTimeout(commit,900);return 'true'};
  const api12={LMSInitialize:()=>{lastError='0';return'true'},LMSFinish:()=>{commit();return'true'},LMSGetValue:k=>store[String(k)]??'',LMSSetValue:set,LMSCommit:()=>{commit();return'true'},LMSGetLastError:()=>lastError,LMSGetErrorString:e=>e==='0'?'No error':'Runtime error',LMSGetDiagnostic:()=>''};
  const api2004={Initialize:()=>{lastError='0';return'true'},Terminate:()=>{commit();return'true'},GetValue:k=>store[String(k)]??'',SetValue:set,Commit:()=>{commit();return'true'},GetLastError:()=>lastError,GetErrorString:e=>e==='0'?'No error':'Runtime error',GetDiagnostic:()=>''};
  window.API=api12;window.API_1484_11=api2004;window.__scormPackageId=packageId;
  $('#page').innerHTML='<div class="reader-toolbar-v5"><button class="btn ghost" id="backScorm">← SCORM</button><div><b>'+esc(launch.package.title)+'</b> <span class="badge">'+esc(launch.package.version)+'</span></div><button class="btn primary" id="saveScorm">Saqlash</button></div><section class="vm559-scorm-frame"><iframe id="scormFrame" title="SCORM content" src="'+esc(launch.launchUrl)+'" allow="fullscreen"></iframe></section>';
  $('#backScorm').onclick=()=>{commit();E.go('scorm')};$('#saveScorm').onclick=()=>{commit();E.toast('SCORM progress saqlandi')};
};

E.pages.academic559=async()=>{
  if(!manager())return E.go('home');
  const [mov,programs]=await Promise.all([E.api('/api/vm559/movements'),E.api('/api/vm559/programs')]);
  $('#page').innerHTML='<div class="page-head"><div><h1>Akademik reyestr</h1><p>Kontingent harakati, yo‘nalish siyosati, kredit va onsite ro‘yxatdan o‘tish.</p></div></div>'+
  '<div class="grid two-col"><section class="card"><div class="card-title"><h3>Masofaviy yo‘nalishlar</h3><button class="btn primary" id="addProgram">＋ Yo‘nalish</button></div><div class="stack">'+(programs.items.map(x=>'<div class="item-card"><div><b>'+esc(x.code)+' · '+esc(x.name)+'</b><p>'+esc(x.level)+' · kvota '+x.admissionQuota+' · kunduzgi: '+(x.daytimeExists?'ha':'yo‘q')+'</p></div>'+statusBadge((x.isICT||x.admissionQuota<=(x.level==='master'?30:300))&&x.daytimeExists?'ready':'blocked')+'</div>').join('')||'<div class="empty">Yo‘nalishlar kiritilmagan</div>')+'</div></section>'+
  '<section class="card"><div class="card-title"><h3>Talaba harakati</h3><button class="btn primary" id="addMove">＋ Harakat</button></div><div class="stack">'+(mov.items.slice(0,20).map(x=>'<div class="item-card"><div><b>'+esc(x.username)+' · '+esc(x.type)+'</b><p>'+esc(x.orderNo||'')+' · '+fmt(x.at)+'</p></div></div>').join('')||'<div class="empty">Harakatlar yo‘q</div>')+'</div></section></div>'+
  '<section class="card" style="margin-top:12px"><div class="card-title"><h3>Talabani onsite ro‘yxatdan o‘tganini tasdiqlash</h3></div><form id="onsiteForm" class="form-grid"><label class="form-label">Talaba login<input class="field" name="username" required></label><label class="form-label">Hujjat raqami<input class="field" name="documentNo"></label><div class="full"><button class="btn primary">Tasdiqlash</button></div></form></section>';
  $('#onsiteForm').onsubmit=async e=>{e.preventDefault();const f=e.target;await E.api('/api/vm559/onsite-registration/'+encodeURIComponent(f.username.value),{method:'POST',body:JSON.stringify({documentNo:f.documentNo.value})});E.toast('Onsite tasdiq saqlandi')};
  $('#addProgram').onclick=programModal;$('#addMove').onclick=movementModal;
};
function programModal(){
 E.openModal('<h3>Masofaviy yo‘nalish</h3><form id="programForm" class="form-grid"><label class="form-label">Kod<input class="field" name="code" required></label><label class="form-label">Nomi<input class="field" name="name" required></label><label class="form-label">Bosqich<select class="field" name="level"><option value="bachelor">Bakalavr</option><option value="master">Magistr</option></select></label><label class="form-label">Qabul kvotasi<input class="field" type="number" name="admissionQuota" value="50"></label><label class="form-label"><input type="checkbox" name="daytimeExists" checked> Kunduzgi shakli mavjud</label><label class="form-label"><input type="checkbox" name="isICT"> AKT yo‘nalishi</label><div class="full"><button class="btn primary full">Saqlash</button></div></form>');
 $('#programForm').onsubmit=async e=>{e.preventDefault();const f=e.target,body=Object.fromEntries(new FormData(f).entries());body.daytimeExists=f.daytimeExists.checked;body.isICT=f.isICT.checked;body.admissionQuota=Number(body.admissionQuota);await E.api('/api/vm559/programs',{method:'POST',body:JSON.stringify(body)});E.closeModal();E.go('academic559')};
}
function movementModal(){
 E.openModal('<h3>Talaba harakati</h3><form id="moveForm" class="form-grid"><label class="form-label">Login<input class="field" name="username" required></label><label class="form-label">Holat<select class="field" name="type"><option value="admitted">Qabul qilindi</option><option value="transferred_in">Ko‘chirib kelindi</option><option value="transferred_out">Ko‘chirildi</option><option value="reinstated">Qayta tiklandi</option><option value="expelled">Chetlashtirildi</option><option value="course_promoted">Kursga o‘tkazildi</option><option value="graduated">Bitirdi</option></select></label><label class="form-label">Buyruq №<input class="field" name="orderNo"></label><label class="form-label full">Izoh<textarea class="field" name="note"></textarea></label><div class="full"><button class="btn primary full">Saqlash</button></div></form>');
 $('#moveForm').onsubmit=async e=>{e.preventDefault();await E.api('/api/vm559/movements',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});E.closeModal();E.go('academic559')};
}

E.pages.quality=async()=>{
  const [sur,cmp]=await Promise.all([E.api('/api/vm559/surveys'),E.api('/api/vm559/complaints')]);
  $('#page').innerHTML='<div class="page-head"><div><h1>Sifat monitoringi va murojaatlar</h1><p>559-son Nizomning monitoring va shikoyat mexanizmlari.</p></div>'+(manager()?'<button class="btn primary" id="addMonitoring">＋ Monitoring qaydi</button>':'')+'</div>'+
  '<div class="grid two-col"><section class="card"><div class="card-title"><h3>So‘rovnomalar</h3>'+(manager()?'<button class="btn ghost" id="newSurvey">＋ So‘rov</button>':'')+'</div><div class="stack">'+(sur.items.map(x=>'<div class="item-card"><div><b>'+esc(x.title)+'</b><p>'+x.questions.length+' savol</p></div><span class="badge '+(x.active?'ok':'gray')+'">'+(x.active?'Faol':'Yopiq')+'</span></div>').join('')||'<div class="empty">So‘rovnoma yo‘q</div>')+'</div></section>'+
  '<section class="card"><div class="card-title"><h3>Murojaatlar</h3><button class="btn ghost" id="newComplaint">＋ Murojaat</button></div><div class="stack">'+(cmp.items.map(x=>'<div class="item-card"><div><b>'+esc(x.subject)+'</b><p>'+esc(x.username)+' · '+esc(x.status)+' · '+fmt(x.createdAt)+'</p></div></div>').join('')||'<div class="empty">Murojaat yo‘q</div>')+'</div></section></div>';
  $('#newComplaint').onclick=complaintModal;$('#newSurvey')?.addEventListener('click',surveyModal);$('#addMonitoring')?.addEventListener('click',monitoringModal);
};
function complaintModal(){E.openModal('<h3>Yangi murojaat</h3><form id="cmpForm" class="form-grid"><label class="form-label full">Mavzu<input class="field" name="subject" required></label><label class="form-label full">Matn<textarea class="field" name="body" required></textarea></label><div class="full"><button class="btn primary full">Yuborish</button></div></form>');$('#cmpForm').onsubmit=async e=>{e.preventDefault();await E.api('/api/vm559/complaints',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});E.closeModal();E.go('quality')}};
function surveyModal(){E.openModal('<h3>Sifat so‘rovnomasi</h3><form id="surveyForm" class="form-grid"><label class="form-label full">Nomi<input class="field" name="title" required></label><label class="form-label full">Savollar — har qatorda bittadan<textarea class="field" name="questions" required></textarea></label><div class="full"><button class="btn primary full">Yaratish</button></div></form>');$('#surveyForm').onsubmit=async e=>{e.preventDefault();const f=e.target;await E.api('/api/vm559/surveys',{method:'POST',body:JSON.stringify({title:f.title.value,questions:f.questions.value.split('\n').map(x=>x.trim()).filter(Boolean)})});E.closeModal();E.go('quality')}};
function monitoringModal(){E.openModal('<h3>Monitoring qaydi</h3><form id="monForm" class="form-grid"><label class="form-label">Turi<select class="field" name="type"><option value="lesson_observation">Dars kuzatuvi</option><option value="assessment_observation">Nazorat kuzatuvi</option><option value="survey">So‘rovnoma</option><option value="focus_group">Fokus-guruh</option><option value="interview">Intervyu</option><option value="result_evaluation">Natijalarni baholash</option></select></label><label class="form-label">Sarlavha<input class="field" name="title"></label><label class="form-label full">Aniqlangan holat<textarea class="field" name="findings"></textarea></label><label class="form-label full">Chora-tadbir<textarea class="field" name="actions"></textarea></label><div class="full"><button class="btn primary full">Saqlash</button></div></form>');$('#monForm').onsubmit=async e=>{e.preventDefault();await E.api('/api/vm559/monitoring',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});E.closeModal();E.toast('Monitoring qaydi saqlandi')}};

E.pages.integrations559=async()=>{
 if(!manager())return E.go('home');
 const d=await E.api('/api/vm559/integrations/hemis/status');
 $('#page').innerHTML='<div class="page-head"><div><h1>Davlat tizimlari integratsiyasi</h1><p>HEMIS/tegishli vazirlik axborot tizimi uchun adapter.</p></div>'+statusBadge(d.configured?'ready':'pending')+'</div><section class="card"><div class="stack"><div class="item-card"><div><b>API holati</b><p>'+(d.configured?'Rasmiy API rekvizitlari sozlangan':'HEMIS_API_URL va HEMIS_API_TOKEN kiritilmagan')+'</p></div>'+statusBadge(d.configured?'ready':'pending')+'</div><div class="item-card"><div><b>Sync path</b><p>'+esc(d.syncPath||'')+'</p></div></div></div><div class="toolbar-actions" style="margin-top:12px"><a class="btn ghost" href="/api/vm559/integrations/hemis/export" target="_blank">JSON eksport</a><button class="btn primary" id="hemisSync" '+(d.configured?'':'disabled')+'>Sinxronlash</button></div></section>';
 $('#hemisSync')?.addEventListener('click',async()=>{await E.api('/api/vm559/integrations/hemis/sync',{method:'POST',body:'{}'});E.toast('Sinxronlash yuborildi')});
};

const oldErr=E.errorText;
E.errorText=e=>{
 const m=e?.message||String(e||'');
 const map={teacher_student_ratio_exceeded:'Guruhda 50 nafardan ortiq talaba bor. 559-son talabiga ko‘ra guruhni bo‘lish yoki alohida oqim tashkil qilish kerak.',onsite_final_required:'Semestr yakuniy nazorati/davlat attestatsiyasi/himoya masofadan o‘tkazilmaydi.',admission_quota_exceeded:'Qabul kvotasi 559-son qarordagi chegaradan oshdi.',daytime_program_required:'Ushbu yo‘nalishda kunduzgi ta’lim shakli mavjud bo‘lishi kerak.',hemis_not_configured:'Rasmiy integratsiya API rekvizitlari kiritilmagan.',scorm_manifest_missing:'SCORM ZIP ichida imsmanifest.xml topilmadi.',scorm_launch_missing:'SCORM manifestda ishga tushirish fayli topilmadi.'};
 return map[m]||(oldErr?oldErr(e):m);
};
})();
