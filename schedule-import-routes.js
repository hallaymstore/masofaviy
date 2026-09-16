const XLSX = require('xlsx');
const crypto = require('crypto');

module.exports = function registerScheduleImportRoutes({ app, getDb, auth, allow, io }) {
  const db = () => getDb();
  const clean = (v,n=200)=>String(v??'').trim().slice(0,n);
  const norm = v => clean(v,200).toLowerCase().replace(/[ʻʼ’`']/g,"'").replace(/\s+/g,' ');
  const id = p => `${p}_${crypto.randomUUID()}`;
  const overlap=(as,ae,bs,be)=>as<be&&bs<ae;
  const aliases={
    subject:['fan','subject','fan nomi','subject name'], subjectCode:['fan kodi','subject code','code'],
    group:['guruh','group','group code'], teacher:['oqituvchi','o‘qituvchi','teacher','fio','teacher name'],
    teacherUsername:['oqituvchi login','o‘qituvchi login','teacher login','teacher username','login'],
    date:['sana','date','kun'], start:['boshlanish','start','start time','vaqt'], end:['tugash','end','end time'],
    type:['turi','type','dars turi','lesson type'], course:['kurs','course']
  };
  function pick(row,key){const keys=Object.keys(row);for(const a of aliases[key]||[]){const k=keys.find(x=>norm(x)===norm(a));if(k!==undefined&&row[k]!==undefined&&row[k]!==null&&String(row[k]).trim()!=='')return row[k]}return ''}
  function excelDate(v){
    if(v instanceof Date&&!isNaN(v)) return v.toISOString().slice(0,10);
    if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v);if(d)return `${String(d.y).padStart(4,'0')}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`}
    const s=clean(v,30); if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
    const m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:s;
  }
  function excelTime(v){
    if(typeof v==='number'&&v>=0&&v<1){const mins=Math.round(v*24*60);return `${String(Math.floor(mins/60)%24).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`}
    const s=clean(v,20);const m=s.match(/(\d{1,2})[:.](\d{2})/);return m?`${m[1].padStart(2,'0')}:${m[2]}`:s;
  }
  async function resolveTeacher(row,subjects,teachers){
    const login=norm(pick(row,'teacherUsername')); if(login){const u=teachers.find(x=>norm(x.username)===login);if(u)return u}
    const name=norm(pick(row,'teacher')); if(name){const exact=teachers.find(x=>norm(x.name)===name);if(exact)return exact;const loose=teachers.find(x=>norm(x.name).includes(name)||name.includes(norm(x.name)));if(loose)return loose}
    const sc=norm(pick(row,'subjectCode')),sn=norm(pick(row,'subject'));
    const subject=subjects.find(x=>(sc&&norm(x.code)===sc)||(sn&&norm(x.name)===sn));
    if(subject?.teacherUsername)return teachers.find(x=>norm(x.username)===norm(subject.teacherUsername))||null;
    return null;
  }
  async function processRows(rows,dryRun=false){
    if(!db())throw new Error('db_required');
    const [subjects,teachers,existingGroups]=await Promise.all([
      db().collection('subjects').find({},{projection:{_id:0}}).toArray(),
      db().collection('users').find({role:'teacher',active:{$ne:false}},{projection:{_id:0,username:1,name:1}}).toArray(),
      db().collection('users').distinct('group',{role:'student',group:{$nin:['',null]}})
    ]);
    const existing=await db().collection('lessons').find({},{projection:{_id:0,id:1,date:1,start:1,end:1,group:1,teacherUsername:1,subject:1}}).limit(5000).toArray();
    const accepted=[],errors=[],warnings=[];
    for(let i=0;i<Math.min(rows.length,1500);i++){
      const r=rows[i]||{},subjectName=clean(pick(r,'subject'),140),subjectCode=clean(pick(r,'subjectCode'),40),group=clean(pick(r,'group'),60),date=excelDate(pick(r,'date')),start=excelTime(pick(r,'start')),end=excelTime(pick(r,'end'));
      if(!subjectName&&!subjectCode){errors.push({row:i+2,error:'fan topilmadi'});continue}
      if(!group||!date||!/^\d{2}:\d{2}$/.test(start)||!/^\d{2}:\d{2}$/.test(end)||start>=end){errors.push({row:i+2,error:'guruh/sana/vaqt noto‘g‘ri'});continue}
      const subject=subjects.find(x=>(subjectCode&&norm(x.code)===norm(subjectCode))||(subjectName&&norm(x.name)===norm(subjectName)));
      const teacher=await resolveTeacher(r,subjects,teachers);
      if(!teacher){errors.push({row:i+2,error:'o‘qituvchi avtomatik aniqlanmadi',subject:subjectName||subjectCode});continue}
      if(existingGroups.length&&!existingGroups.includes(group))warnings.push({row:i+2,warning:'guruhda hozircha talaba topilmadi',group});
      const doc={id:id('les'),subjectId:subject?.id||'',subject:subject?.name||subjectName||subjectCode,group,course:clean(pick(r,'course'),30),teacherUsername:teacher.username,teacher:teacher.name,date,start,end,type:clean(pick(r,'type'),40)||'Ma’ruza',status:'next',online:0,createdBy:'schedule-import',createdAt:new Date()};
      const conflict=[...existing,...accepted].find(x=>x.date===date&&overlap(start,end,x.start,x.end)&&(x.group===group||x.teacherUsername===teacher.username));
      if(conflict){errors.push({row:i+2,error:'jadval to‘qnashuvi',conflict:{subject:conflict.subject,group:conflict.group,start:conflict.start,end:conflict.end}});continue}
      accepted.push(doc);
    }
    if(!dryRun&&accepted.length)await db().collection('lessons').insertMany(accepted);
    if(!dryRun&&accepted.length)io.emit('schedule:changed',{type:'bulk-import',count:accepted.length});
    return {ok:true,dryRun,created:dryRun?0:accepted.length,ready:accepted.length,errors,warnings,preview:accepted.slice(0,50).map(({_id,...x})=>x)};
  }
  app.post('/api/manage/schedule/import-xlsx',auth,allow('admin','tech','dean'),expressRaw(),async(req,res)=>{
    try{const wb=XLSX.read(req.body,{type:'buffer',cellDates:true});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:''});res.json(await processRows(rows,req.query.dryRun==='1'))}catch(e){res.status(400).json({ok:false,error:e.message||'xlsx_parse_failed'})}
  });
  app.post('/api/manage/schedule/import-csv',auth,allow('admin','tech','dean'),expressText(),async(req,res)=>{
    try{const wb=XLSX.read(String(req.body||''),{type:'string'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:''});res.json(await processRows(rows,req.query.dryRun==='1'))}catch(e){res.status(400).json({ok:false,error:e.message||'csv_parse_failed'})}
  });
};

function expressRaw(){const express=require('express');return express.raw({type:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/octet-stream'],limit:'12mb'})}
function expressText(){const express=require('express');return express.text({type:['text/csv','text/plain','application/csv'],limit:'6mb'})}
