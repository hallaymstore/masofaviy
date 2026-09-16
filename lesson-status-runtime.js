const {MongoClient}=require('mongodb');
const URI=process.env.MONGODB_URI||'';
const DB=process.env.DB_NAME||'masofaviy';
const TZ='Asia/Tashkent';
let client=null,running=false;
function clock(){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
 const o={};for(const x of p)if(x.type!=='literal')o[x.type]=x.value;
 return{date:`${o.year}-${o.month}-${o.day}`,time:`${o.hour}:${o.minute}`};
}
async function sync(){
 if(!URI||running)return;running=true;
 try{
   if(!client){client=new MongoClient(URI,{maxPoolSize:2,minPoolSize:0,maxIdleTimeMS:60000,serverSelectionTimeoutMS:7000});await client.connect()}
   const {date,time}=clock(),c=client.db(DB).collection('lessons');
   const r=await c.updateMany({status:'live',$or:[{date:{$lt:date}},{date,end:{$lte:time}}]},{$set:{status:'ended',autoEnded:true,autoEndedAt:new Date(),updatedAt:new Date()}});
   if(r.modifiedCount)console.log(`[lesson-status] auto-ended ${r.modifiedCount} stale live lesson(s)`);
 }catch(e){console.warn('[lesson-status]',e.message)}finally{running=false}
}
if(URI){setTimeout(sync,1200).unref();setInterval(sync,20000).unref()}
