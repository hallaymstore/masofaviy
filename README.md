# QDTU Masofaviy Ta'lim

Mobile-first, PWA-ready masofaviy ta'lim platformasi. Eski Android telefonlar va sust internet uchun ixcham interfeys, Low Data rejimi va audio-first dars modeli ko'zda tutilgan.

## Hozirgi modullar

- Student / teacher / admin rollari
- JWT + HttpOnly cookie auth
- Mobile-first Lumi uslubidagi UI
- Bugungi jadval va jonli dars kartasi
- Dars xonasi: kamera/mikrofon preflight, local preview, screen share
- Socket.IO realtime chat va presence
- Davomat join/leave eventlari
- Admin real-time overview UI
- PWA manifest + offline app shell
- Low Data mode
- MongoDB Atlas optional persistence; ulanmasa memory fallback
- `/health` monitoring endpoint
- Tashqi mediasoup SFU uchun `RTC_BRIDGE_URL`

## Nega mediasoup alohida SFU hostda?

Render web services HTTP/HTTPS ilovalar uchun juda qulay, lekin production mediasoup WebRTC SFU uchun kerak bo'ladigan public UDP/TCP media portlarini to'liq boshqarish uchun alohida UDP-capable VPS tavsiya qilinadi. Web/API/PWA Render'da, mediasoup esa VPS'da ishlaydi va `RTC_BRIDGE_URL` orqali ulanadi.

## Demo loginlar

- `student` / `Student@2026`
- `teacher` / `Teacher@2026`
- `admin` / `Admin@2026`

Production'da `ADMIN_PASSWORD` va `JWT_SECRET` albatta almashtirilishi kerak.

## Ishga tushirish

```bash
npm install
npm start
```

Health: `/health`

## Keyingi production bosqichlari

1. MongoDB Atlas URI ulash
2. Mediasoup SFU'ni alohida VPS'ga deploy qilish
3. TURN/coturn yoki mavjud TURN provider ulash
4. Real fan/guruh/jadval master-data import
5. Assignment, materials, test, recording va management analytics modullarini kengaytirish
