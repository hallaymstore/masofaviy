const XLSX=require('xlsx');
const bcrypt=require('bcryptjs');

module.exports=function registerStudentImportRoutes({app,getDb,auth,allow,io}){
 const db=()=>getDb(),clean=(v,n=300)=>String(v??'').trim().slice(0,n),norm=v=>clean(v,300).toLowerCase().replace(/[ʻʼ’`']/g,"'").replace(/\s+/g,' ');
 const aliases={
  name:['f.i.sh','fish','fio','talaba','talaba f.i.sh','ism familiya','full name','name'],
  username:['login','username','foydalanuvchi','student login'],password:['parol','password','boshlangich parol','boshlang‘ich parol'],
  group:['guruh','group','guruh kodi'],studentId:['talaba id','student id','studentid'],hemisId:['hemis id','hemis kodi','hemis code'],
  faculty:['fakultet','faculty'],department:['kafedra','department'],direction:['yonalish','yo‘nalish','direction','specialty','mutaxassislik'],
  course:['kurs','course'],educationForm:['talim shakli','ta’lim shakli','education form'],educationLanguage:['talim tili','ta’lim tili','education language','language'],
  admissionYear:['qabul yili','admission year'],phone:['telefon','phone','tel'],email:['email','e-mail'],status:['holat','status']
 };
 const pick=(row,key)=>{for(const k of Object.keys(row||{})){if((aliases[key]||[]).some(a=>norm(a)===norm(k))&&row[k]!==''&&row[k]!=null)return row[k]}return ''};
 const activeFrom=v=>!['0','false','inactive','bloklangan','chetlashtirilgan','bitirgan'].includes(norm(v));
 async function ensure(){if(!db())throw new Error('db_required');await Promise.all([
  db().collection('users').createIndex({username:1},{unique:true}),db().collection('users').createIndex({role:1,group:1}),
  db().collection('users').createIndex({studentId:1},{unique:true,sparse:true}),db().collection('users').createIndex({hemisId:1},{unique:true,sparse:true}),
  db().collection('groups').createIndex({name:1},{unique:true}),db().collection('groups').createIndex({faculty:1,direction:1,course:1})
 ]).catch(()=>{})}
 function mapRow(r,rowNo){
  const name=clean(pick(r,'name'),160),group=clean(pick(r,'group'),80),studentId=clean(pick(r,'studentId'),80),hemisId=clean(pick(r,'hemisId'),80);
  let username=clean(pick(r,'username'),80).toLowerCase();if(!username)username=(hemisId||studentId).toLowerCase();
  return {row:rowNo,name,username,password:String(pick(r,'password')||''),group,studentId,hemisId,
   faculty:clean(pick(r,'faculty'),140),department:clean(pick(r,'department'),140),direction:clean(pick(r,'direction'),180),course:clean(pick(r,'course'),20),
   educationForm:clean(pick(r,'educationForm'),80),educationLanguage:clean(pick(r,'educationLanguage'),60),admissionYear:clean(pick(r,'admissionYear'),10),
   phone:clean(pick(r,'phone'),40),email:clean(pick(r,'email'),160).toLowerCase(),status:clean(pick(r,'status'),60),active:activeFrom(pick(r,'status'))};
 }
 async function processRows(rawRows,dryRun){
  await ensure();const rows=rawRows.slice(0,2000).map((r,i)=>mapRow(r,i+2)),errors=[],warnings=[],ready=[];
  const seenUser=new Set(),seenStudent=new Set(),seenHemis=new Set();
  for(const s of rows){
   if(!s.name||!s.group||!s.username){errors.push({row:s.row,error:'F.I.Sh, Guruh va Login/Talaba ID majburiy'});continue}
   if(!/^[a-z0-9._@-]{3,80}$/i.test(s.username)){errors.push({row:s.row,error:'Login formati noto‘g‘ri'});continue}
   if(seenUser.has(s.username)||(s.studentId&&seenStudent.has(s.studentId))||(s.hemisId&&seenHemis.has(s.hemisId))){errors.push({row:s.row,error:'Excel ichida takroriy talaba/login'});continue}
   seenUser.add(s.username);if(s.studentId)seenStudent.add(s.studentId);if(s.hemisId)seenHemis.add(s.hemisId);
   const or=[{username:s.username}];if(s.studentId)or.push({studentId:s.studentId});if(s.hemisId)or.push({hemisId:s.hemisId});
   const existing=await db().collection('users').findOne({$or:or},{projection:{_id:0,username:1,role:1,group:1,passwordHash:1}});
   if(existing&&existing.role!=='student'){errors.push({row:s.row,error:'Login boshqa roldagi foydalanuvchiga tegishli'});continue}
   if(!existing&&s.password.length<6){errors.push({row:s.row,error:'Yangi talaba uchun parol kamida 6 belgi'});continue}
   if(existing&&existing.username!==s.username)warnings.push({row:s.row,warning:`Mavjud talaba ${existing.username} ID orqali topildi; login o‘zgartirilmaydi`});
   if(existing&&existing.group&&existing.group!==s.group)warnings.push({row:s.row,warning:`Guruh ${existing.group} → ${s.group} ga yangilanadi`});
   ready.push({...s,action:existing?'update':'create',targetUsername:existing?.username||s.username});
  }
  const groupMap=new Map();for(const s of ready){if(!groupMap.has(s.group))groupMap.set(s.group,{name:s.group,faculty:s.faculty,department:s.department,direction:s.direction,course:s.course,educationForm:s.educationForm,educationLanguage:s.educationLanguage,updatedAt:new Date()})}
  if(!dryRun){
   for(const g of groupMap.values())await db().collection('groups').updateOne({name:g.name},{$set:g,$setOnInsert:{createdAt:new Date()}},{upsert:true});
   for(const s of ready){
    const patch={name:s.name,role:'student',group:s.group,studentId:s.studentId||undefined,hemisId:s.hemisId||undefined,faculty:s.faculty,department:s.department,direction:s.direction,course:s.course,educationForm:s.educationForm,educationLanguage:s.educationLanguage,admissionYear:s.admissionYear,phone:s.phone,email:s.email,status:s.status||'Faol',active:s.active,academic:{group:s.group,faculty:s.faculty,department:s.department,direction:s.direction,course:s.course,educationForm:s.educationForm,educationLanguage:s.educationLanguage,admissionYear:s.admissionYear},updatedAt:new Date()};
    Object.keys(patch).forEach(k=>patch[k]===undefined&&delete patch[k]);
    if(s.password.length>=6){patch.passwordHash=await bcrypt.hash(s.password,8);patch.mustChangePassword=true}
    if(s.action==='create'){patch.username=s.username;patch.preferences={lowData:false,theme:'system'};patch.createdAt=new Date();await db().collection('users').insertOne(patch)}
    else await db().collection('users').updateOne({username:s.targetUsername},{$set:patch});
   }
   io.emit('students:imported',{count:ready.length,groups:groupMap.size});
  }
  return {ok:true,dryRun,ready:ready.length,create:ready.filter(x=>x.action==='create').length,update:ready.filter(x=>x.action==='update').length,groups:groupMap.size,errors,warnings,preview:ready.slice(0,80).map(x=>({row:x.row,name:x.name,username:x.targetUsername,group:x.group,faculty:x.faculty,direction:x.direction,course:x.course,action:x.action}))};
 }
 app.get('/api/manage/students/template.xlsx',auth,allow('admin','tech','dean'),(req,res)=>{
  const headers=['F.I.Sh','Login','Parol','Guruh','Talaba ID','HEMIS ID','Fakultet','Kafedra',"Yo'nalish",'Kurs',"Ta'lim shakli","Ta'lim tili",'Qabul yili','Telefon','Email','Holat'];
  const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([headers]);XLSX.utils.book_append_sheet(wb,ws,'Talabalar');
  const guide=XLSX.utils.aoa_to_sheet([['Majburiy','F.I.Sh, Guruh va Login (yoki Talaba ID/HEMIS ID). Yangi talaba uchun Parol kamida 6 belgi.'],['Guruh','Bir xil guruh kodi aynan bir xil yozilsin, masalan MMT-520-25.'],['Yangilash','Mavjud login/Talaba ID/HEMIS ID topilsa talaba ma’lumotlari va guruhi yangilanadi.'],['Xavfsizlik','JSHSHIRni login/parol sifatida ishlatmang.']]);XLSX.utils.book_append_sheet(wb,guide,"Qo'llanma");
  const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="QDTU_talabalar_import_shablon.xlsx"');res.send(buf)
 });
 app.post('/api/manage/students/import-xlsx',auth,allow('admin','tech','dean'),require('express').raw({type:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'],limit:'15mb'}),async(req,res)=>{
  try{const wb=XLSX.read(req.body,{type:'buffer',cellDates:true});const name=wb.SheetNames[0];if(!name)throw new Error('sheet_not_found');const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:false});if(!rows.length)throw new Error('talaba_qatorlari_topilmadi');res.json(await processRows(rows,req.query.dryRun==='1'))}catch(e){console.error('student xlsx import:',e);res.status(400).json({ok:false,error:e.message||'xlsx_import_failed'})}
 });
};
