const express=require('express');
const http=require('http');
const os=require('os');
const jwt=require('jsonwebtoken');
const mediasoup=require('mediasoup');
const {Server}=require('socket.io');

const HTTP_PORT=Number(process.env.SFU_HTTP_PORT||3010);
const RTC_BASE_PORT=Number(process.env.SFU_RTC_PORT||40000);
const ANNOUNCED_IP=process.env.SFU_ANNOUNCED_IP||'';
const TOKEN_SECRET=process.env.SFU_TOKEN_SECRET||'';
const WORKER_COUNT=Math.max(1,Math.min(Number(process.env.SFU_WORKERS||Math.min(4,Math.max(1,os.cpus().length-1))),8));
const ALLOWED_ORIGIN=process.env.SFU_ALLOWED_ORIGIN||true;

if(!TOKEN_SECRET)console.warn('WARNING: SFU_TOKEN_SECRET is empty; production clients will be rejected.');
if(!ANNOUNCED_IP)console.warn('WARNING: SFU_ANNOUNCED_IP is empty; remote WebRTC will not work correctly behind NAT.');

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:ALLOWED_ORIGIN,credentials:true},transports:['websocket'],pingInterval:20000,pingTimeout:15000,maxHttpBufferSize:1e6});
const workers=[];
const rooms=new Map();
let rr=0;

const mediaCodecs=[
 {kind:'audio',mimeType:'audio/opus',clockRate:48000,channels:2},
 {kind:'video',mimeType:'video/VP8',clockRate:90000,parameters:{'x-google-start-bitrate':500}},
 {kind:'video',mimeType:'video/H264',clockRate:90000,parameters:{'packetization-mode':1,'profile-level-id':'42e01f','level-asymmetry-allowed':1}}
];

async function createWorkerSlot(index){
 const worker=await mediasoup.createWorker({logLevel:process.env.SFU_LOG_LEVEL||'warn'});
 worker.on('died',()=>{console.error('mediasoup worker died',worker.pid);setTimeout(()=>process.exit(1),1500)});
 const port=RTC_BASE_PORT+index;
 const webRtcServer=await worker.createWebRtcServer({listenInfos:[
   {protocol:'udp',ip:'0.0.0.0',announcedAddress:ANNOUNCED_IP||undefined,port},
   {protocol:'tcp',ip:'0.0.0.0',announcedAddress:ANNOUNCED_IP||undefined,port}
 ]});
 const slot={index,port,worker,webRtcServer,rooms:0};workers.push(slot);return slot;
}
function nextSlot(){const slot=workers[rr++%workers.length];return slot}
async function getRoom(roomId){
 if(rooms.has(roomId))return rooms.get(roomId);
 const slot=nextSlot();
 const router=await slot.worker.createRouter({mediaCodecs});
 const room={id:roomId,router,slot,peers:new Map(),createdAt:Date.now()};slot.rooms++;rooms.set(roomId,room);return room;
}
function ensurePeer(room,socket){
 if(!room.peers.has(socket.id))room.peers.set(socket.id,{socketId:socket.id,user:socket.user,transports:new Map(),producers:new Map(),consumers:new Map()});
 return room.peers.get(socket.id);
}
function serializeTransport(t){return{id:t.id,iceParameters:t.iceParameters,iceCandidates:t.iceCandidates,dtlsParameters:t.dtlsParameters,sctpParameters:t.sctpParameters||undefined}}
async function cleanupPeer(room,socketId){
 const peer=room?.peers.get(socketId);if(!peer)return;
 for(const c of peer.consumers.values())try{c.close()}catch{}
 for(const p of peer.producers.values())try{p.close()}catch{}
 for(const t of peer.transports.values())try{t.close()}catch{}
 room.peers.delete(socketId);
 if(!room.peers.size){try{room.router.close()}catch{}room.slot.rooms=Math.max(0,room.slot.rooms-1);rooms.delete(room.id)}
}
function totals(){let peers=0,producers=0,consumers=0;for(const room of rooms.values()){peers+=room.peers.size;for(const p of room.peers.values()){producers+=p.producers.size;consumers+=p.consumers.size}}return{peers,producers,consumers}}

app.get('/health',(req,res)=>{const t=totals();res.json({ok:true,workers:workers.map(x=>({pid:x.worker.pid,port:x.port,rooms:x.rooms})),rooms:rooms.size,...t,cpus:os.cpus().length,announcedIp:Boolean(ANNOUNCED_IP),auth:Boolean(TOKEN_SECRET),uptime:Math.round(process.uptime())})});

io.use((socket,next)=>{
 try{
   if(!TOKEN_SECRET)throw new Error('sfu_not_configured');
   const token=socket.handshake.auth?.token;
   if(!token)throw new Error('token_required');
   const user=jwt.verify(token,TOKEN_SECRET,{issuer:'qdtuedu-web'});
   if(!user?.roomId||!user?.sub||!user?.role)throw new Error('invalid_token');
   socket.user=user;next();
 }catch(e){next(new Error(e.message||'unauthorized'))}
});

io.on('connection',socket=>{
 socket.on('room:join',async(payload={},cb=()=>{})=>{
  try{
   const requested=String(payload.roomId||'').slice(0,80),roomId=String(socket.user.roomId||'').slice(0,80);
   if(!roomId||requested!==roomId)throw new Error('room_access_denied');
   const room=await getRoom(roomId);ensurePeer(room,socket);socket.data.roomId=roomId;socket.join(roomId);
   cb({ok:true,rtpCapabilities:room.router.rtpCapabilities,peer:{username:socket.user.sub,name:socket.user.name,role:socket.user.role,group:socket.user.group||''},workerPort:room.slot.port});
   socket.to(roomId).emit('peer:joined',{peerId:socket.id,username:socket.user.sub,name:socket.user.name,role:socket.user.role});
  }catch(e){cb({ok:false,error:e.message})}
 });
 socket.on('transport:create',async({direction}={},cb=()=>{})=>{
  try{
   const room=rooms.get(socket.data.roomId);if(!room)throw new Error('room_not_joined');const peer=ensurePeer(room,socket);
   const transport=await room.router.createWebRtcTransport({webRtcServer:room.slot.webRtcServer,enableUdp:true,enableTcp:true,preferUdp:true,initialAvailableOutgoingBitrate:direction==='send'?700000:1200000,enableSctp:true,numSctpStreams:{OS:1024,MIS:1024}});
   await transport.setMaxIncomingBitrate(1500000).catch(()=>{});
   peer.transports.set(transport.id,transport);
   transport.on('dtlsstatechange',state=>{if(state==='closed')transport.close()});transport.on('routerclose',()=>peer.transports.delete(transport.id));
   cb({ok:true,params:serializeTransport(transport)});
  }catch(e){cb({ok:false,error:e.message})}
 });
 socket.on('transport:connect',async({transportId,dtlsParameters}={},cb=()=>{})=>{
  try{const room=rooms.get(socket.data.roomId);if(!room)throw new Error('room_not_joined');const t=ensurePeer(room,socket).transports.get(transportId);if(!t)throw new Error('transport_not_found');await t.connect({dtlsParameters});cb({ok:true})}catch(e){cb({ok:false,error:e.message})}
 });
 socket.on('produce',async({transportId,kind,rtpParameters,appData}={},cb=()=>{})=>{
  try{
   const room=rooms.get(socket.data.roomId);if(!room)throw new Error('room_not_joined');const peer=ensurePeer(room,socket),t=peer.transports.get(transportId);if(!t)throw new Error('transport_not_found');
   const source=['mic','camera','screen'].includes(appData?.source)?appData.source:(kind==='audio'?'mic':'camera');
   if(socket.user.role!=='teacher'&&source==='screen')throw new Error('screen_share_teacher_only');
   const producer=await t.produce({kind,rtpParameters,appData:{...appData,source,username:socket.user.sub,name:socket.user.name,role:socket.user.role}});peer.producers.set(producer.id,producer);
   producer.on('transportclose',()=>peer.producers.delete(producer.id));producer.on('close',()=>peer.producers.delete(producer.id));
   socket.to(room.id).emit('producer:new',{producerId:producer.id,peerId:socket.id,kind:producer.kind,appData:producer.appData});cb({ok:true,id:producer.id});
  }catch(e){cb({ok:false,error:e.message})}
 });
 socket.on('producer:close',({producerId}={},cb=()=>{})=>{try{const room=rooms.get(socket.data.roomId);const peer=room&&ensurePeer(room,socket),p=peer?.producers.get(producerId);if(p){p.close();peer.producers.delete(producerId)}cb({ok:true})}catch(e){cb({ok:false,error:e.message})}});
 socket.on('producers:list',(_payload={},cb=()=>{})=>{
  try{const room=rooms.get(socket.data.roomId);if(!room)throw new Error('room_not_joined');const out=[];for(const[peerId,peer]of room.peers){if(peerId===socket.id)continue;for(const producer of peer.producers.values())out.push({producerId:producer.id,peerId,kind:producer.kind,appData:producer.appData})}cb({ok:true,producers:out})}catch(e){cb({ok:false,error:e.message})}
 });
 socket.on('consume',async({transportId,producerId,rtpCapabilities}={},cb=()=>{})=>{
  try{
   const room=rooms.get(socket.data.roomId);if(!room)throw new Error('room_not_joined');const peer=ensurePeer(room,socket),t=peer.transports.get(transportId);if(!t)throw new Error('transport_not_found');if(!room.router.canConsume({producerId,rtpCapabilities}))throw new Error('cannot_consume');
   const consumer=await t.consume({producerId,rtpCapabilities,paused:true});peer.consumers.set(consumer.id,consumer);consumer.on('transportclose',()=>peer.consumers.delete(consumer.id));consumer.on('producerclose',()=>{peer.consumers.delete(consumer.id);socket.emit('consumer:closed',{consumerId:consumer.id,producerId})});
   cb({ok:true,params:{id:consumer.id,producerId,kind:consumer.kind,rtpParameters:consumer.rtpParameters,type:consumer.type,producerPaused:consumer.producerPaused}});
  }catch(e){cb({ok:false,error:e.message})}
 });
 socket.on('consumer:resume',async({consumerId}={},cb=()=>{})=>{try{const room=rooms.get(socket.data.roomId);const c=room&&ensurePeer(room,socket).consumers.get(consumerId);if(!c)throw new Error('consumer_not_found');await c.resume();cb({ok:true})}catch(e){cb({ok:false,error:e.message})}});
 socket.on('stats:get',async(_p={},cb=()=>{})=>{try{const room=rooms.get(socket.data.roomId),peer=room&&ensurePeer(room,socket);if(!peer)throw new Error('room_not_joined');const out=[];for(const t of peer.transports.values()){const stats=await t.getStats();out.push({transportId:t.id,stats:[...stats.values()]})}cb({ok:true,transports:out})}catch(e){cb({ok:false,error:e.message})}});
 socket.on('disconnect',async()=>{const room=rooms.get(socket.data.roomId);if(room){await cleanupPeer(room,socket.id);socket.to(room.id).emit('peer:left',{peerId:socket.id})}});
});

(async()=>{
 for(let i=0;i<WORKER_COUNT;i++)await createWorkerSlot(i);
 server.listen(HTTP_PORT,'0.0.0.0',()=>console.log(`QDTU SFU v2 signalling=${HTTP_PORT} rtc=${RTC_BASE_PORT}-${RTC_BASE_PORT+WORKER_COUNT-1} workers=${WORKER_COUNT}`));
})().catch(err=>{console.error(err);process.exit(1)});
process.on('SIGTERM',()=>{for(const x of workers)try{x.worker.close()}catch{}server.close(()=>process.exit(0))});
