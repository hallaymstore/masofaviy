const CACHE='qdtu-edu-v6.0.2';
const STATIC=['/','/university.html','/styles.css?v=6.0.2','/enhanced.css?v=6.0.2','/premium-icons.css?v=6.0.2','/premium-v3.css?v=6.0.2','/v3-hotfix.css?v=6.0.2','/v5.css?v=6.0.2','/compliance-v5.css?v=6.0.2','/v6-ai-inclusive.css?v=6.0.2','/premium-icons.js?v=6.0.2','/core-v2.js?v=6.0.2','/pages-main.js?v=6.0.2','/pages-manage.js?v=6.0.2','/hotfix-v2.js?v=6.0.2','/stability-guard.js?v=6.0.2','/premium-v3.js?v=6.0.2','/v3-hotfix.js?v=6.0.2','/access-v4.js?v=6.0.2','/v5-learning.js?v=6.0.2','/v5-classroom.js?v=6.0.2','/v5-nav.js?v=6.0.2','/compliance-v5.js?v=6.0.2','/assessment-v5.js?v=6.0.2','/recording-v5.js?v=6.0.2','/v6-ai-pages.js?v=6.0.2','/v6-ai-extra.js?v=6.0.2','/v6-accessibility.js?v=6.0.2','/v6-classroom-enhance.js?v=6.0.2','/vendor/mediasoup-client.js','/manifest.webmanifest','/icon.svg'];

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/socket.io/')||u.pathname.startsWith('/recordings/'))return;

  if(e.request.mode==='navigate'){
    e.respondWith(
      fetch(e.request,{cache:'no-store'})
        .then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put('/',cp));return r})
        .catch(()=>caches.match('/'))
    );
    return;
  }

  const isCode=/\.(?:js|css)$/.test(u.pathname);
  if(isCode){
    e.respondWith(
      fetch(e.request,{cache:'no-store'})
        .then(r=>{if(r.ok){const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp))}return r})
        .catch(()=>caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{
      if(r.ok){const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp))}
      return r;
    }))
  );
});
