const express=require('express');
const http=require('http');
const os=require('os');
const jwt=require('jsonwebtoken');
const mediasoup=require('mediasoup');
const {Server}=require('socket.io');

const HTTP_PORT=Number(process.env.SFU_HTTP_PORT||3010);
const RTC_BASE_PORT=Number(process.env.SFU_RTC_PORT||40000);
const ANNOUNCED_IP=String(process.env.SFU_ANNOUNCED_IP||'').trim();
const RTC_SECRET=process.env.RTC_TOKEN_SECRET||process.env.JWT_SECRET||'';
const WEB_ORIGIN=String(process.env.WEB_ORIGIN||'').trim();
const WORKER_COUNT=Math.max(1,Math.min(Number(process.env.SFU_WORKERS||1),Math.max(1,os.cpus().length)));

if(!RTC_SECRET){console.error('RTC_TOKEN_SECRET or JWT_SECRET is required');process.exit(1)}
if(!ANNOUNCED_IP)console.warn('SFU_ANNOUNCED_IP is empty; remote browsers will usually fail outside localhost/LAN');

const app=express();
app.disable('x-powered-by');
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:WEB_ORIGIN||true,credentials:true},transports:['websocket'],pingInterval:20000,pingTimeout:15000,maxHttpBufferSize:128*1024});

const workers=[];
const rooms=new Map();
const mediaCodecs=[
  {kind:'audio',mimeType:'audio/opus',clockRate:48000,channels:2,useinbandfec:1},
  {kind:'video',mimeType:'video/VP8',clockRate:90000,parameters:{'x-google-start-bitrate':500}},
  {kind:'video',mimeType:'video/H264',clockRate:90000,parameters:{'packetization-mode':1,'profile-level-id':'42e01f','level-asymmetry-allowed':1}}
];

function workerForRoom(roomId){let n=0;for(let i=0;i<roomId.length;i++)n=(n*31+roomId.charCodeAt(i))>>>0;return workers[n%workers.length]}
async function createWorkers(){
  for(let i=0;i<WORKER_COUNT;i++){
    const worker=await mediasoup.createWorker({logLevel:process.env.SFU_LOG_LEVEL||'warn',rtcMinPort:RTC_BASE_PORT+i*200+20,rtcMaxPort:RTC_BASE_PORT+i*200+199});
    worker.on('died',()=>{console.error('mediasoup worker died',worker.pid);setTimeout(()=>process.exit(1),1500)});
    const webRtcServer=await worker.createWebRtcServer({listenInfos:[
      {protocol:'udp',ip:'0.0.0.0',announcedAddress:ANNOUNCED_IP||undefined,port:RTC_BASE_PORT+i},
      {protocol:'tcp',ip:'0.0.0.0',announcedAddress:ANNOUNCED_IP||undefined,port:RTC_BASE_PORT+i}
    ]});
    workers.push({worker,webRtcServer,index:i});
  }
}
async function getRoom(roomId){
  if(rooms.has(roomId))return rooms.get(roomId);
  const slot=workerForRoom(roomId),router=await slot.worker.createRouter({mediaCodecs});
  const room={id:roomId,router,workerIndex:slot.index,webRtcServer:slot.webRtcServer,peers:new Map(),createdAt:Date.now()};
  rooms.set(roomId,room);return room;
}
function ensurePeer(room,socket){
  if(!room.peers.has(socket.id))room.peers.set(socket.id,{id:socket.id,user:socket.user,transports:new Map(),producers:new Map(),consumers:new Map(),joinedAt:Date.now()});
  return room.peers.get(socket.id);
}
function serializeTransport(t){return{id:t.id,iceParameters:t.iceParameters,iceCandidates:t.iceCandidates,dtlsParameters:t.dtlsParameters,sctpParameters:t.sctpParameters||undefined}}
async function cleanupPeer(room,socketId){
  const peer=room?.peers.get(socketId);if(!peer)return;
  for(const c of peer.consumers.values())try{c.close()}catch{}
  for(const p of peer.producers.values())try{p.close()}catch{}
  for(const t of peer.transports.values())try{t.close()}catch{}
  room.peers.delete(socketId);
  if(!room.peers.size){try{room.router.close()}catch{}rooms.delete(room.id)}
}
function roomStats(room){let producers=0,consumers=0,transports=0;for(const p of room.peers.values()){producers+=p.producers.size;consumers+=p.consumers.size;transports+=p.transports.size}return{roomId:room.id,workerIndex:room.workerIndex,peers:room.peers.size,producers,consumers,transports,uptimeSec:Math.round((Date.now()-room.createdAt)/1000)}}

app.get('/health',(req,res)=>{let peers=0,producers=0,consumers=0;for(const r of rooms.values()){const s=roomStats(r);peers+=s.peers;producers+=s.producers;consumers+=s.consumers}res.json({ok:true,workers:workers.length,rooms:rooms.size,peers,producers,consumers,rtcBasePort:RTC_BASE_PORT,announcedIpConfigured:Boolean(ANNOUNCED_IP),cpus:os.cpus().length,uptime:Math.round(process.uptime())})});

io.use((socket,next)=>{
  const token=socket.handshake.auth?.token||socket.handshake.query?.token;
  if(!token)return next(new Error('rtc_token_required'));
  try{socket.user=jwt.verify(String(token),RTC_SECRET,{audience:'qdtu-sfu',issuer:'qdtu-edu'});next()}catch(e){next(new Error('rtc_token_invalid'))}
});

io.on('connection',socket=>{
  socket.on('room:join',async({roomId}={},cb=()=>{})=>{
    try{
      roomId=String(roomId||'').slice(0,80);
      if(!roomId||roomId!==socket.user.roomId)throw new Error('room_access_denied');
      const room=await getRoom(roomId);ensurePeer(room,socket);socket.data.roomId=roomId;socket.join(roomId);
      cb({ok:true,rtpCapabilities:room.router.rtpCapabilities,workerIndex:room.workerIndex});
    }catch(e){cb({ok:false,error:e.message})}
  });
  socket.on('transport:create',async({direction}={},cb=()=>{})=>{
    try{
      const room=rooms.get(socket.data.roomId);if(!room)throw new Error('room_not_joined');
      const peer=ensurePeer(room,socket),transport=await room.router.createWebRtcTransport({webRtcServer:room.webRtcServer,enableUdp:true,enableTcp:true,preferUdp:true,initialAvailableOutgoingBitrate:direction==='send'?800000:1400000,enableSctp:true,numSctpStreams:{OS:256,MIS:256}});
      try{await transport.setMaxIncomingBitrate(socket.user.role==='teacher'?1800000:700000)}catch{}
      peer.transports.set(transport.id,transport);
      transport.on('dtlsstatechange',state=>{if(state==='closed')transport.close()});
      transport.on('icestatechange',state=>{if(state==='disconnected')socket.emit('rtc:warning',{type:'ice_disconnected'})});
      cb({ok:true,params:serializeTransport(transport)});
    }catch(e){cb({ok:false,error:e.message})}
  });
  socket.on('transport:connect',async({transportId,dtlsParameters}={},cb=()=>{})=>{
    try{const room=rooms.get(socket.data.roomId),peer=ensurePeer(room,socket),transport=peer.transports.get(transportId);if(!transport)throw new Error('transport_not_found');await transport.connect({dtlsParameters});cb({ok:true})}catch(e){cb({ok:false,error:e.message})}
  });
  socket.on('produce',async({transportId,kind,rtpParameters,appData}={},cb=()=>{})=>{
    try{
      const room=rooms.get(socket.data.roomId),peer=ensurePeer(room,socket),transport=peer.transports.get(transportId);if(!transport)throw new Error('transport_not_found');
      const source=['mic','camera','screen'].includes(appData?.source)?appData.source:(kind==='audio'?'mic':'camera');
      if(source==='screen'&&socket.user.role!=='teacher')throw new Error('screen_share_teacher_only');
      for(const p of peer.producers.values())if(p.appData?.source===source)throw new Error('source_already_produced');
      const safeAppData={source,username:socket.user.sub,name:socket.user.name,role:socket.user.role,group:socket.user.group||'',mode:socket.user.mode};
      const producer=await transport.produce({kind,rtpParameters,appData:safeAppData});peer.producers.set(producer.id,producer);
      producer.on('transportclose',()=>peer.producers.delete(producer.id));producer.on('close',()=>peer.producers.delete(producer.id));
      socket.to(room.id).emit('producer:new',{producerId:producer.id,peerId:socket.id,kind:producer.kind,appData:safeAppData});
      cb({ok:true,id:producer.id});
    }catch(e){cb({ok:false,error:e.message})}
  });
  socket.on('producers:list',({excludeSelf=true}={},cb=()=>{})=>{
    try{const room=rooms.get(socket.data.roomId);if(!room)throw new Error('room_not_joined');const out=[];for(const[peerId,peer]of room.peers){if(excludeSelf&&peerId===socket.id)continue;for(const producer of peer.producers.values())out.push({producerId:producer.id,peerId,kind:producer.kind,appData:producer.appData})}cb({ok:true,producers:out})}catch(e){cb({ok:false,error:e.message})}
  });
  socket.on('consume',async({transportId,producerId,rtpCapabilities}={},cb=()=>{})=>{
    try{const room=rooms.get(socket.data.roomId),peer=ensurePeer(room,socket),transport=peer.transports.get(transportId);if(!transport)throw new Error('transport_not_found');if(!room.router.canConsume({producerId,rtpCapabilities}))throw new Error('cannot_consume');const consumer=await transport.consume({producerId,rtpCapabilities,paused:true});peer.consumers.set(consumer.id,consumer);consumer.on('transportclose',()=>peer.consumers.delete(consumer.id));consumer.on('producerclose',()=>{peer.consumers.delete(consumer.id);socket.emit('consumer:closed',{consumerId:consumer.id,producerId})});cb({ok:true,params:{id:consumer.id,producerId,kind:consumer.kind,rtpParameters:consumer.rtpParameters,type:consumer.type,producerPaused:consumer.producerPaused}})}catch(e){cb({ok:false,error:e.message})}
  });
  socket.on('consumer:resume',async({consumerId}={},cb=()=>{})=>{try{const room=rooms.get(socket.data.roomId),peer=ensurePeer(room,socket),consumer=peer.consumers.get(consumerId);if(!consumer)throw new Error('consumer_not_found');await consumer.resume();cb({ok:true})}catch(e){cb({ok:false,error:e.message})}});
  socket.on('stats:get',(_,cb=()=>{})=>{const room=rooms.get(socket.data.roomId);cb(room?{ok:true,...roomStats(room)}:{ok:false,error:'room_not_joined'})});
  socket.on('disconnect',async()=>{const room=rooms.get(socket.data.roomId);if(room){await cleanupPeer(room,socket.id);socket.to(room.id).emit('peer:left',{peerId:socket.id})}});
});

(async()=>{await createWorkers();server.listen(HTTP_PORT,'0.0.0.0',()=>console.log(`QDTU SFU v2 signalling=${HTTP_PORT}, workers=${workers.length}, rtc=${RTC_BASE_PORT}..${RTC_BASE_PORT+workers.length-1}`))})().catch(err=>{console.error(err);process.exit(1)});
process.on('SIGTERM',async()=>{for(const x of workers)try{x.worker.close()}catch{}server.close(()=>process.exit(0))});
