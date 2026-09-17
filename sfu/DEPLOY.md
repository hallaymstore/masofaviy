# QDTU Mediasoup SFU production deployment

## Why the SFU is separate
The main web app can stay on Render. Mediasoup must run on a VPS/server where raw UDP/TCP RTC ports are reachable from browsers. Do not deploy the media worker behind an HTTP-only reverse proxy.

## Recommended topology
- Web/API: `https://masofaviy-edu.onrender.com`
- SFU signalling: `https://rtc.your-domain.uz` -> local `3010` through Nginx/WebSocket proxy
- RTC media: public server IP on UDP/TCP `40000..40003` (one fixed port per worker)
- Optional TURN: separate coturn/managed TURN for restrictive networks

## Required environment
```bash
SFU_HTTP_PORT=3010
SFU_RTC_PORT=40000
SFU_WORKERS=1
SFU_ANNOUNCED_IP=PUBLIC_IPV4
WEB_ORIGIN=https://masofaviy-edu.onrender.com
RTC_TOKEN_SECRET=LONG_RANDOM_SECRET_SHARED_WITH_WEB_APP
SFU_LOG_LEVEL=warn
```

On the **web app** set the same token secret plus the public SFU URL:
```bash
RTC_BRIDGE_URL=https://rtc.your-domain.uz
RTC_TOKEN_SECRET=LONG_RANDOM_SECRET_SHARED_WITH_SFU
```

Optional TURN variables on the web app:
```bash
TURN_URLS=turn:turn.example.com:3478?transport=udp;turns:turn.example.com:5349?transport=tcp
TURN_USERNAME=USERNAME
TURN_CREDENTIAL=PASSWORD
```

## Firewall
For one worker:
```bash
sudo ufw allow 3010/tcp
sudo ufw allow 40000/udp
sudo ufw allow 40000/tcp
```
For 4 workers also open `40001..40003` UDP/TCP.

## Install and test
```bash
cd sfu
npm ci
npm test
npm start
```
`npm test` verifies worker creation, signed room authentication, Router RTP capabilities and WebRtcTransport creation.

## Browser end-to-end acceptance test
Use two different browser contexts/devices after `RTC_BRIDGE_URL` is configured:
1. teacher joins assigned lesson;
2. teacher mic/camera default ON;
3. student in the same group joins with mic/camera OFF;
4. student receives teacher Opus audio and VP8/H264 video;
5. student from another group receives HTTP 403 before an SFU token is issued;
6. changing `roomId` in the SFU Socket.IO join request returns `room_access_denied`;
7. screen share replaces the main stage while teacher camera remains PiP;
8. test Wi-Fi, mobile data and a restrictive network/TURN path.

## Load policy for low-end phones
Students consume teacher camera/screen first. Student video is not fanned out to every other student. The teacher may consume up to a small active set of student cameras. This keeps old Android devices and weak connections usable.
