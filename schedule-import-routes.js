const ExcelJS=require('exceljs');
const JSZip=require('jszip');
const crypto=require('crypto');

module.exports=function registerScheduleImportRoutes({app,getDb,auth,allow,io}){
 const db=()=>getDb(),clean=(v,n=200)=>String(v??'').trim().slice(0,n),norm=v=>clean(v,200).toLowerCase().replace(/[ʻʼ’`']/g,"'").replace(/\s+/g,' '),id=p=>`${p}_${crypto.randomUUID()}`,overlap=(as,ae,bs,be)=>as<be&&bs<ae;
 const aliases={subject:['fan','subject','fan nomi','subject name'],subjectCode:['fan kodi','subject code','code'],group:['guruh','group','group code'],teacher:['oqituvchi','o‘qituvchi','teacher','fio','teacher name'],teacherUsername:['oqituvchi login','o‘qituvchi login','teacher login','teacher username','login'],date:['sana','date','kun'],start:['boshlanish','start','start time','vaqt'],end:['tugash','end','end time'],type:['turi','type','dars turi','lesson type'],course:['kurs','course']};
 const pick=(row,key)=>{for(const k of Object.keys(row)){if((aliases[key]||[]).some(a=>norm(a)===norm(k))&&row[k]!==''&&row[k]!=null)return row[k]}return ''};
 const escRe=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

 function excelDate(v){if(v instanceof Date&&!isNaN(v))return v.toISOString().slice(0,10);const s=clean(v,30);if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:s}
 function excelTime(v){if(v instanceof Date&&!isNaN(v))return `${String(v.getHours()).padStart(2,'0')}:${String(v.getMinutes()).padStart(2,'0')}`;if(typeof v==='number'&&v>=0&&v<1){const mins=Math.round(v*1440);return `${String(Math.floor(mins/60)%24).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`}const s=clean(v,20),m=s.match(/(\d{1,2})[:.](\d{2})/);return m?`${m[1].padStart(2,'0')}:${m[2]}`:s}

 async function normalizeSpreadsheetNamespaces(input){
  const source=Buffer.isBuffer(input)?input:Buffer.from(input||[]);
  if(source.length<100)throw new Error('empty_or_invalid_xlsx');
  const zip=await JSZip.loadAsync(source);
  const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  let changed=false;
  for(const name of Object.keys(zip.files)){
   if(!/^xl\/.*\.xml$/i.test(name))continue;
   const entry=zip.file(name);if(!entry)continue;
   let xml=await entry.async('string');
   const match=xml.match(new RegExp(`xmlns:([A-Za-z_][\\w.-]*)=["']${escRe(MAIN)}["']`));
   if(!match)continue;
   const prefix=match[1],tagRe=new RegExp(`(<\\/?)(?:${escRe(prefix)}):`,'g'),nsRe=new RegExp(`\\sxmlns:${escRe(prefix)}=["']${escRe(MAIN)}["']`);
   xml=xml.replace(tagRe,'$1').replace(nsRe,` xmlns="${MAIN}"`);
   zip.file(name,xml);changed=true;
  }
  return changed?zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}}):source;
 }

 async function resolveTeacher(row,subjects,teachers){const login=norm(pick(row,'teacherUsername'));if(login){const u=teachers.find(x=>norm(x.username)===login);if(u)return u}const name=norm(pick(row,'teacher'));if(name){const exact=teachers.find(x=>norm(x.name)===name);if(exact)return exact;const loose=teachers.find(x=>norm(x.name).includes(name)||name.includes(norm(x.name)));if(loose)return loose}const sc=norm(pick(row,'subjectCode')),sn=norm(pick(row,'subject'));const s=subjects.find(x=>(sc&&norm(x.code)===sc)||(sn&&norm(x.name)===sn));return s?.teacherUsername?teachers.find(x=>norm(x.username)===norm(s.teacherUsername))||null:null}

 async function processRows(rows,dryRun=false){
  if(!db())throw new Error('db_required');
  const[subjects,teachers,groups]=await Promise.all([
   db().collection('subjects').find({},{projection:{_id:0}}).toArray(),
   db().collection('users').find({role:'teacher',active:{$ne:false}},{projection:{_id:0,username:1,name:1}}).toArray(),
   db().collection('users').distinct('group',{role:'student',group:{$nin:['',null]}})
  ]);
  const existing=await db().collection('lessons').find({status:{$ne:'cancelled'}},{projection:{_id:0,id:1,date:1,start:1,end:1,group:1,teacherUsername:1,subject:1}}).limit(10000).toArray();
  const accepted=[],errors=[],warnings=[];
  for(let i=0;i<Math.min(rows.length,1500);i++){
   const r=rows[i]||{},subjectName=clean(pick(r,'subject'),140),subjectCode=clean(pick(r,'subjectCode'),40),group=clean(pick(r,'group'),60),date=excelDate(pick(r,'date')),start=excelTime(pick(r,'start')),end=excelTime(pick(r,'end'));
   if(!subjectName&&!subjectCode){errors.push({row:i+2,error:'fan topilmadi'});continue}
   if(!group||!date||!/^\d{2}:\d{2}$/.test(start)||!/^\d{2}:\d{2}$/.test(end)||start>=end){errors.push({row:i+2,error:'guruh/sana/vaqt noto‘g‘ri'});continue}
   const subject=subjects.find(x=>(subjectCode&&norm(x.code)===norm(subjectCode))||(subjectName&&norm(x.name)===norm(subjectName))),teacher=await resolveTeacher(r,subjects,teachers);
   if(!teacher){errors.push({row:i+2,error:'o‘qituvchi avtomatik aniqlanmadi',subject:subjectName||subjectCode});continue}
   if(groups.length&&!groups.includes(group))warnings.push({row:i+2,warning:'guruhda hozircha talaba topilmadi',group});
   const doc={id:id('les'),subjectId:subject?.id||'',subject:subject?.name||subjectName||subjectCode,group,course:clean(pick(r,'course'),30),teacherUsername:teacher.username,teacher:teacher.name,date,start,end,type:clean(pick(r,'type'),40)||'Ma’ruza',status:'next',online:0,createdBy:'schedule-import',createdAt:new Date()};
   const conflict=[...existing,...accepted].find(x=>x.date===date&&overlap(start,end,x.start,x.end)&&(x.group===group||x.teacherUsername===teacher.username));
   if(conflict){errors.push({row:i+2,error:'jadval to‘qnashuvi',conflict:{subject:conflict.subject,group:conflict.group,start:conflict.start,end:conflict.end}});continue}
   accepted.push(doc)
  }
  if(!dryRun&&accepted.length)await db().collection('lessons').insertMany(accepted);
  if(!dryRun&&accepted.length)io.emit('schedule:changed',{type:'bulk-import',count:accepted.length});
  return{ok:true,dryRun,created:dryRun?0:accepted.length,ready:accepted.length,errors,warnings,preview:accepted.slice(0,50).map(({_id,...x})=>x)}
 }

 function sheetRows(ws){
  const header=[];ws.getRow(1).eachCell({includeEmpty:true},(c,col)=>header[col]=String(c.text||c.value||'').trim());
  const rows=[];
  for(let r=2;r<=ws.rowCount;r++){
   const row={};header.forEach((h,col)=>{if(!h||!col)return;const c=ws.getRow(r).getCell(col);row[h]=c.value instanceof Date?c.value:(c.text||c.value||'')});
   if(Object.values(row).some(v=>String(v??'').trim()))rows.push(row)
  }
  return rows
 }

 app.post('/api/manage/schedule/import-xlsx',auth,allow('admin','tech','dean'),require('express').raw({type:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/octet-stream'],limit:'12mb'}),async(req,res)=>{
  try{
   const normalized=await normalizeSpreadsheetNamespaces(req.body);
   const wb=new ExcelJS.Workbook();
   await wb.xlsx.load(normalized);
   const ws=wb.worksheets[0];if(!ws)throw new Error('sheet_not_found');
   const rows=sheetRows(ws);if(!rows.length)throw new Error('jadval_qatorlari_topilmadi');
   res.json(await processRows(rows,req.query.dryRun==='1'))
  }catch(e){console.error('xlsx import failed:',e?.stack||e);res.status(400).json({ok:false,error:e.message||'xlsx_parse_failed'})}
 });

 app.post('/api/manage/schedule/import-csv',auth,allow('admin','tech','dean'),require('express').text({type:['text/csv','text/plain','application/csv'],limit:'6mb'}),async(req,res)=>{
  try{
   const lines=String(req.body||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());if(!lines.length)throw new Error('empty_file');
   const parse=l=>{const out=[];let cur='',q=false;for(let i=0;i<l.length;i++){const c=l[i];if(c==='"'){if(q&&l[i+1]==='"'){cur+='"';i++}else q=!q}else if((c===','||c===';')&&!q){out.push(cur.trim());cur=''}else cur+=c}out.push(cur.trim());return out};
   const headers=parse(lines.shift());const rows=lines.map(l=>{const v=parse(l),o={};headers.forEach((h,i)=>o[h]=v[i]||'');return o});
   res.json(await processRows(rows,req.query.dryRun==='1'))
  }catch(e){console.error('csv import failed:',e?.stack||e);res.status(400).json({ok:false,error:e.message||'csv_parse_failed'})}
 });
};
