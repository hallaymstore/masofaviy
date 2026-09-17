const {spawn}=require('child_process');
const path=require('path');
const fs=require('fs');
const os=require('os');
const jwt=require('jsonwebtoken');
const express=require('express');
const esbuild=require('esbuild');
const {chromium}=require('playwright');

const SFU_PORT=39210,RTC_PORT=49210,WEB_PORT=39211,SECRET='qdtuedu-browser-e2e-secret',ROOM='E2E-ROOM';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'qdtuedu-sfu-e2e-'));
const bundle=path.join(tmp,'mediasoup-client.js');
let sfu,webServer,browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function waitHealth(){for(let i=0;i<50;i++){try{const r=await fetch(`http://127.0.0.1:${SFU_PORT}/health`);if(r.ok)return r.json()}catch{}await sleep(300)}throw new Error('sfu_health_timeout')}
function token(role,sub){return jwt.sign({roomId:ROOM,sub,name:role==='teacher'?'Teacher E2E':'Student E2E',role,group:'E2E-GROUP',lessonGroup:'E2E-GROUP',mode:role==='teacher'?'host':'participant'},SECRET,{expiresIn:'10m',issuer:'qdtu-edu',audience:'qdtu-sfu'})}

const pageHtml=`<!doctype html><meta charset="utf-8"><title>QDTU SFU E2E</title>
<video id="remote" autoplay playsinline muted></video><canvas id="source" width="320" height="180"></canvas>
<script src="http://127.0.0.1:${SFU_PORT}/socket.io/socket.io.js"></script><script src="/mediasoup-client.js"></script>
<script>
const qs=new URLSearchParams(location.search),mode=qs.get('mode'),token=qs.get('token'),ROOM='${ROOM}';
window.E2E={ready:false,error:null,bytes:0,producerId:null};
const ack=(s,e,p)=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(e+'_timeout')),7000);s.emit(e,p,r=>{clearTimeout(t);r&&r.ok?resolve(r):reject(new Error((r&&r.error)||e+'_failed'))})});
(async()=>{try{
 const socket=io('http://127.0.0.1:${SFU_PORT}',{transports:['websocket'],auth:{token}});
 await new Promise((ok,bad)=>{const t=setTimeout(()=>bad(new Error('connect_timeout')),7000);socket.once('connect',()=>{clearTimeout(t);ok()});socket.once('connect_error',bad)});
 const joined=await ack(socket,'room:join',{roomId:ROOM});const device=new MediasoupDevice();await device.load({routerRtpCapabilities:joined.rtpCapabilities});
 if(mode==='teacher'){
  const tr=await ack(socket,'transport:create',{direction:'send'});const send=device.createSendTransport(tr.params);
  send.on('connect',({dtlsParameters},ok,bad)=>ack(socket,'transport:connect',{transportId:send.id,dtlsParameters}).then(ok).catch(bad));
  send.on('produce',({kind,rtpParameters,appData},ok,bad)=>ack(socket,'produce',{transportId:send.id,kind,rtpParameters,appData}).then(r=>ok({id:r.id})).catch(bad));
  const c=document.getElementById('source'),x=c.getContext('2d');let n=0;setInterval(()=>{n++;x.fillStyle='hsl('+n%360+' 80% 45%)';x.fillRect(0,0,320,180);x.fillStyle='white';x.font='28px sans-serif';x.fillText('QDTU '+n,55,95)},50);
  const track=c.captureStream(15).getVideoTracks()[0];const p=await send.produce({track,encodings:[{maxBitrate:350000}],appData:{source:'camera'}});window.E2E.producerId=p.id;window.E2E.ready=true;
 }else{
  const tr=await ack(socket,'transport:create',{direction:'recv'});const recv=device.createRecvTransport(tr.params);
  recv.on('connect',({dtlsParameters},ok,bad)=>ack(socket,'transport:connect',{transportId:recv.id,dtlsParameters}).then(ok).catch(bad));
  let list=[];for(let i=0;i<30&&!list.length;i++){const r=await ack(socket,'producers:list',{});list=(r.producers||[]).filter(p=>p.kind==='video');if(!list.length)await new Promise(r=>setTimeout(r,200))}
  if(!list.length)throw new Error('producer_not_found');const meta=list[0];const r=await ack(socket,'consume',{transportId:recv.id,producerId:meta.producerId,rtpCapabilities:device.rtpCapabilities});const consumer=await recv.consume(r.params);document.getElementById('remote').srcObject=new MediaStream([consumer.track]);await ack(socket,'consumer:resume',{consumerId:consumer.id});
  let bytes=0;for(let i=0;i<40&&bytes<1500;i++){await new Promise(r=>setTimeout(r,250));const stats=await consumer.getStats();stats.forEach(v=>{if(v.type==='inbound-rtp'&&v.kind==='video')bytes=Math.max(bytes,Number(v.bytesReceived||0))})}
  window.E2E.bytes=bytes;if(bytes<1500)throw new Error('no_video_rtp');window.E2E.ready=true;
 }
}catch(e){console.error(e);window.E2E.error=String(e&&e.message||e)}})();
</script>`;

(async()=>{try{
 await esbuild.build({stdin:{contents:"import {Device} from 'mediasoup-client';window.MediasoupDevice=Device;",resolveDir:__dirname},bundle:true,minify:true,platform:'browser',format:'iife',outfile:bundle});
 sfu=spawn(process.execPath,[path.join(__dirname,'server-v2.js')],{env:{...process.env,SFU_HTTP_PORT:String(SFU_PORT),SFU_RTC_PORT:String(RTC_PORT),SFU_ANNOUNCED_IP:'127.0.0.1',RTC_TOKEN_SECRET:SECRET,SFU_WORKERS:'1',SFU_LOG_LEVEL:'error'},stdio:['ignore','pipe','pipe']});sfu.stdout.on('data',d=>process.stdout.write(d));sfu.stderr.on('data',d=>process.stderr.write(d));await waitHealth();
 const app=express();app.get('/mediasoup-client.js',(req,res)=>res.sendFile(bundle));app.get('/test',(req,res)=>res.type('html').send(pageHtml));webServer=await new Promise(resolve=>{const s=app.listen(WEB_PORT,'127.0.0.1',()=>resolve(s))});
 browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--no-sandbox']});const tctx=await browser.newContext(),teacher=await tctx.newPage();teacher.on('console',m=>console.log('teacher:',m.text()));await teacher.goto(`http://127.0.0.1:${WEB_PORT}/test?mode=teacher&token=${encodeURIComponent(token('teacher','teacher-e2e'))}`);await teacher.waitForFunction(()=>window.E2E.ready||window.E2E.error,{timeout:20000});const tr=await teacher.evaluate(()=>window.E2E);if(tr.error)throw new Error('teacher_'+tr.error);
 const sctx=await browser.newContext(),student=await sctx.newPage();student.on('console',m=>console.log('student:',m.text()));await student.goto(`http://127.0.0.1:${WEB_PORT}/test?mode=student&token=${encodeURIComponent(token('student','student-e2e'))}`);await student.waitForFunction(()=>window.E2E.ready||window.E2E.error,{timeout:25000});const sr=await student.evaluate(()=>window.E2E);if(sr.error)throw new Error('student_'+sr.error);if(Number(sr.bytes)<1500)throw new Error('insufficient_rtp_bytes');console.log('SFU_BROWSER_E2E_PASS',{producerId:tr.producerId,videoBytes:sr.bytes});process.exitCode=0;
 }catch(e){console.error('SFU_BROWSER_E2E_FAIL',e);process.exitCode=1}finally{try{await browser?.close()}catch{}try{await new Promise(r=>webServer?.close(r))}catch{}try{sfu?.kill('SIGTERM')}catch{}setTimeout(()=>process.exit(process.exitCode||0),300)}})();
