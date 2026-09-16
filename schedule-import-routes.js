const XLSX=require('xlsx');
const crypto=require('crypto');

module.exports=function registerScheduleImportRoutes({app,getDb,auth,allow,io}){
 const db=()=>getDb();
 const clean=(v,n=200)=>String(v??'').trim().slice(0,n);
 const norm=v=>clean(v,200).toLowerCase().replace(/[ʻʼ’`']/g,"'").replace(/\s+/g,' ');
 const id=p=>`${p}_${crypto.randomUUID()}`;
 const overlap=(as,ae,bs,be)=>as<be&&bs<ae;
 const aliases={
  subject:['fan','subject','fan nomi','subject name'],
  subjectCode:['fan kodi','subject code','code'],
  group:['guruh','group','group code'],
  teacher:['oqituvchi','o‘qituvchi','teacher','fio','teacher name'],
  teacherUsername:['oqituvchi login','o‘qituvchi login','teacher login','teacher username','login'],
  date:['sana','date','kun'],
  start:['boshlanish','start','start time','vaqt'],
  end:['tugash','end','end time'],
  type:['turi','type','dars turi','lesson type'],
  course:['kurs','course']
 };
 const pick=(row,key)=>{for(const k of Object.keys(row||{})){if((aliases[key]||[]).some(a=>norm(a)===norm(k))&&row[k]!==''&&row[k]!=null)return row[k]}return ''};

 function dateFromParts(y,m,d){return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
 function excelDate(v){
  if(v instanceof Date&&!isNaN(v))return dateFromParts(v.getFullYear(),v.getMonth()+1,v.getDate());
  if(typeof v==='number'&&Number.isFinite(v)){const p=XLSX.SSF.parse_date_code(v);if(p)return dateFromParts(p.y,p.m,p.d)}
  const s=clean(v,40);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  let m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m=s.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  return s;
 }
 function excelTime(v){
  if(v instanceof Date&&!isNaN(v))return `${String(v.getHours()).padStart(2,'0')}:${String(v.getMinutes()).padStart(2,'0')}`;
  if(typeof v==='number'&&Number.isFinite(v)){const frac=((v%1)+1)%1,mins=Math.round(frac*1440)%1440;return `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`}
  const s=clean(v,30),m=s.match(/(\d{1,2})[:.](\d{2})/);return m?`${m[1].padStart(2,'0')}:${m[2]}`:s;
 }

 async function resolveTeacher(row,subjects,teachers){
  const login=norm(pick(row,'teacherUsername'));if(login){const u=teachers.find(x=>norm(x.username)===login);if(u)return u}
  const name=norm(pick(row,'teacher'));if(name){const exact=teachers.find(x=>norm(x.name)===name);if(exact)return exact;const loose=teachers.find(x=>norm(x.name).includes(name)||name.includes(norm(x.name)));if(loose)return loose}
  const sc=norm(pick(row,'subjectCode')),sn=norm(pick(row,'subject'));const s=subjects.find(x=>(sc&&norm(x.code)===sc)||(sn&&norm(x.name)===sn));
  return s?.teacherUsername?teachers.find(x=>norm(x.username)===norm(s.teacherUsername))||null:null;
 }

 async function processRows(rows,dryRun=false){
  if(!db())throw new Error('db_required');
  const [subjects,teachers,groups]=await Promise.all([
   db().collection('subjects').find({},{projection:{_id:0}}).toArray(),
   db().collection('users').find({role:'teacher',active:{$ne:false}},{projection:{_id:0,username:1,name:1}}).toArray(),
   db().collection('users').distinct('group',{role:'student',group:{$nin:['',null]}})
  ]);
  const existing=await db().collection('lessons').find({status:{$ne:'cancelled'}},{projection:{_id:0,id:1,date:1,start:1,end:1,group:1,teacherUsername:1,subject:1}}).limit(10000).toArray();
  const accepted=[],errors=[],warnings=[];
  for(let i=0;i<Math.min(rows.length,1500);i++){
   const r=rows[i]||{};
   const subjectName=clean(pick(r,'subject'),140),subjectCode=clean(pick(r,'subjectCode'),40),group=clean(pick(r,'group'),60),date=excelDate(pick(r,'date')),start=excelTime(pick(r,'start')),end=excelTime(pick(r,'end'));
   if(!subjectName&&!subjectCode){errors.push({row:i+2,error:'fan topilmadi'});continue}
   if(!group||!date||!/^\d{2}:\d{2}$/.test(start)||!/^\d{2}:\d{2}$/.test(end)||start>=end){errors.push({row:i+2,error:'guruh/sana/vaqt noto‘g‘ri'});continue}
   const subject=subjects.find(x=>(subjectCode&&norm(x.code)===norm(subjectCode))||(subjectName&&norm(x.name)===norm(subjectName)));
   const teacher=await resolveTeacher(r,subjects,teachers);
   if(!teacher){errors.push({row:i+2,error:'o‘qituvchi avtomatik aniqlanmadi',subject:subjectName||subjectCode});continue}
   if(groups.length&&!groups.includes(group))warnings.push({row:i+2,warning:'guruhda hozircha talaba topilmadi',group});
   const doc={id:id('les'),subjectId:subject?.id||'',subject:subject?.name||subjectName||subjectCode,group,course:clean(pick(r,'course'),30),teacherUsername:teacher.username,teacher:teacher.name,date,start,end,type:clean(pick(r,'type'),40)||'Ma’ruza',status:'next',online:0,createdBy:'schedule-import',createdAt:new Date()};
   const conflict=[...existing,...accepted].find(x=>x.date===date&&overlap(start,end,x.start,x.end)&&(x.group===group||x.teacherUsername===teacher.username));
   if(conflict){errors.push({row:i+2,error:'jadval to‘qnashuvi',conflict:{subject:conflict.subject,group:conflict.group,start:conflict.start,end:conflict.end}});continue}
   accepted.push(doc);
  }
  if(!dryRun&&accepted.length)await db().collection('lessons').insertMany(accepted);
  if(!dryRun&&accepted.length)io.emit('schedule:changed',{type:'bulk-import',count:accepted.length});
  return{ok:true,dryRun,created:dryRun?0:accepted.length,ready:accepted.length,errors,warnings,preview:accepted.slice(0,50).map(({_id,...x})=>x)};
 }

 function parseXlsx(buffer){
  if(!buffer||buffer.length<100)throw new Error('empty_or_invalid_xlsx');
  const wb=XLSX.read(buffer,{type:'buffer',cellDates:true,cellNF:false,cellText:false});
  const first=wb.SheetNames&&wb.SheetNames[0];if(!first)throw new Error('sheet_not_found');
  const ws=wb.Sheets[first];if(!ws)throw new Error('sheet_not_found');
  const rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:true,blankrows:false});
  if(!rows.length)throw new Error('jadval_qatorlari_topilmadi');
  return rows;
 }

 app.post('/api/manage/schedule/import-xlsx',auth,allow('admin','tech','dean'),require('express').raw({type:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/octet-stream'],limit:'12mb'}),async(req,res)=>{
  try{res.json(await processRows(parseXlsx(req.body),req.query.dryRun==='1'))}
  catch(e){console.error('xlsx import failed:',e?.stack||e);res.status(400).json({ok:false,error:e.message||'xlsx_parse_failed'})}
 });

 app.post('/api/manage/schedule/import-csv',auth,allow('admin','tech','dean'),require('express').text({type:['text/csv','text/plain','application/csv'],limit:'6mb'}),async(req,res)=>{
  try{
   const lines=String(req.body||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());if(!lines.length)throw new Error('empty_file');
   const parse=l=>{const out=[];let cur='',q=false;for(let i=0;i<l.length;i++){const c=l[i];if(c==='"'){if(q&&l[i+1]==='"'){cur+='"';i++}else q=!q}else if((c===','||c===';')&&!q){out.push(cur.trim());cur=''}else cur+=c}out.push(cur.trim());return out};
   const headers=parse(lines.shift());const rows=lines.map(l=>{const v=parse(l),o={};headers.forEach((h,i)=>o[h]=v[i]||'');return o});
   res.json(await processRows(rows,req.query.dryRun==='1'));
  }catch(e){console.error('csv import failed:',e?.stack||e);res.status(400).json({ok:false,error:e.message||'csv_parse_failed'})}
 });
};
