const express = require('express');
const http = require('http');
const os = require('os');
const mediasoup = require('mediasoup');
const { Server } = require('socket.io');

const HTTP_PORT = Number(process.env.SFU_HTTP_PORT || 3010);
const RTC_PORT = Number(process.env.SFU_RTC_PORT || 40000);
const ANNOUNCED_IP = process.env.SFU_ANNOUNCED_IP || '';
const SHARED_SECRET = process.env.SFU_SHARED_SECRET || '';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true }, transports: ['websocket'] });

let worker;
let webRtcServer;
const rooms = new Map();

const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 600 } },
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } }
];

async function getRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);
  const router = await worker.createRouter({ mediaCodecs });
  const room = { id: roomId, router, peers: new Map() };
  rooms.set(roomId, room);
  return room;
}

function ensurePeer(room, socketId) {
  if (!room.peers.has(socketId)) room.peers.set(socketId, { transports: new Map(), producers: new Map(), consumers: new Map() });
  return room.peers.get(socketId);
}

function serializeTransport(t) {
  return {
    id: t.id,
    iceParameters: t.iceParameters,
    iceCandidates: t.iceCandidates,
    dtlsParameters: t.dtlsParameters,
    sctpParameters: t.sctpParameters || undefined
  };
}

async function cleanupPeer(room, socketId) {
  const peer = room?.peers.get(socketId);
  if (!peer) return;
  for (const c of peer.consumers.values()) c.close();
  for (const p of peer.producers.values()) p.close();
  for (const t of peer.transports.values()) t.close();
  room.peers.delete(socketId);
  if (!room.peers.size) {
    room.router.close();
    rooms.delete(room.id);
  }
}

app.get('/health', (req, res) => res.json({ ok: true, workerPid: worker?.pid || null, rooms: rooms.size, cpus: os.cpus().length, rtcPort: RTC_PORT }));

io.use((socket, next) => {
  if (!SHARED_SECRET) return next();
  const supplied = socket.handshake.auth?.secret || socket.handshake.query?.secret;
  if (supplied === SHARED_SECRET) return next();
  next(new Error('unauthorized'));
});

io.on('connection', socket => {
  socket.on('room:join', async ({ roomId }, cb = () => {}) => {
    try {
      roomId = String(roomId || '').slice(0, 80);
      if (!roomId) throw new Error('room_required');
      const room = await getRoom(roomId);
      ensurePeer(room, socket.id);
      socket.data.roomId = roomId;
      socket.join(roomId);
      cb({ ok: true, rtpCapabilities: room.router.rtpCapabilities });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('transport:create', async ({ direction }, cb = () => {}) => {
    try {
      const room = rooms.get(socket.data.roomId);
      if (!room) throw new Error('room_not_joined');
      const peer = ensurePeer(room, socket.id);
      const transport = await room.router.createWebRtcTransport({
        webRtcServer,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: direction === 'send' ? 900000 : 1400000,
        enableSctp: true,
        numSctpStreams: { OS: 1024, MIS: 1024 }
      });
      peer.transports.set(transport.id, transport);
      transport.on('dtlsstatechange', state => { if (state === 'closed') transport.close(); });
      cb({ ok: true, params: serializeTransport(transport) });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('transport:connect', async ({ transportId, dtlsParameters }, cb = () => {}) => {
    try {
      const room = rooms.get(socket.data.roomId);
      const peer = ensurePeer(room, socket.id);
      const transport = peer.transports.get(transportId);
      if (!transport) throw new Error('transport_not_found');
      await transport.connect({ dtlsParameters });
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, cb = () => {}) => {
    try {
      const room = rooms.get(socket.data.roomId);
      const peer = ensurePeer(room, socket.id);
      const transport = peer.transports.get(transportId);
      if (!transport) throw new Error('transport_not_found');
      const producer = await transport.produce({ kind, rtpParameters, appData });
      peer.producers.set(producer.id, producer);
      producer.on('transportclose', () => peer.producers.delete(producer.id));
      socket.to(room.id).emit('producer:new', { producerId: producer.id, peerId: socket.id, kind: producer.kind, appData: producer.appData });
      cb({ ok: true, id: producer.id });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('producers:list', ({ excludeSelf = true } = {}, cb = () => {}) => {
    try {
      const room = rooms.get(socket.data.roomId);
      if (!room) throw new Error('room_not_joined');
      const out = [];
      for (const [peerId, peer] of room.peers) {
        if (excludeSelf && peerId === socket.id) continue;
        for (const producer of peer.producers.values()) out.push({ producerId: producer.id, peerId, kind: producer.kind, appData: producer.appData });
      }
      cb({ ok: true, producers: out });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('consume', async ({ transportId, producerId, rtpCapabilities }, cb = () => {}) => {
    try {
      const room = rooms.get(socket.data.roomId);
      const peer = ensurePeer(room, socket.id);
      const transport = peer.transports.get(transportId);
      if (!transport) throw new Error('transport_not_found');
      if (!room.router.canConsume({ producerId, rtpCapabilities })) throw new Error('cannot_consume');
      const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
      peer.consumers.set(consumer.id, consumer);
      consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
      consumer.on('producerclose', () => {
        peer.consumers.delete(consumer.id);
        socket.emit('consumer:closed', { consumerId: consumer.id, producerId });
      });
      cb({ ok: true, params: { id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters, type: consumer.type, producerPaused: consumer.producerPaused } });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('consumer:resume', async ({ consumerId }, cb = () => {}) => {
    try {
      const room = rooms.get(socket.data.roomId);
      const peer = ensurePeer(room, socket.id);
      const consumer = peer.consumers.get(consumerId);
      if (!consumer) throw new Error('consumer_not_found');
      await consumer.resume();
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('disconnect', async () => {
    const room = rooms.get(socket.data.roomId);
    if (room) {
      await cleanupPeer(room, socket.id);
      socket.to(room.id).emit('peer:left', { peerId: socket.id });
    }
  });
});

(async () => {
  worker = await mediasoup.createWorker({ logLevel: process.env.SFU_LOG_LEVEL || 'warn', rtcMinPort: RTC_PORT, rtcMaxPort: RTC_PORT + 100 });
  worker.on('died', () => setTimeout(() => process.exit(1), 1500));
  webRtcServer = await worker.createWebRtcServer({
    listenInfos: [
      { protocol: 'udp', ip: '0.0.0.0', announcedAddress: ANNOUNCED_IP || undefined, port: RTC_PORT },
      { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: ANNOUNCED_IP || undefined, port: RTC_PORT }
    ]
  });
  server.listen(HTTP_PORT, '0.0.0.0', () => console.log(`QDTU SFU signalling=${HTTP_PORT}, rtc=${RTC_PORT}`));
})().catch(err => { console.error(err); process.exit(1); });
