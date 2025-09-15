// Macro Tracker Service Worker v1.1.2
const CACHE_NAME = "macro-tracker-cache-v1.1.2";
const ASSETS = [
  "./","./index.html","./styles.css","./app.js","./manifest.json",
  "./icons/icon-192.png","./icons/icon-512.png","./icons/apple-touch-icon.png"
];
self.addEventListener("install",(e)=>{ e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS))); });
self.addEventListener("activate",(e)=>{ e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>{ if(k!==CACHE_NAME) return caches.delete(k);})))) ; self.clients.claim(); });
self.addEventListener("message",(e)=>{ if(e.data && e.data.type==="SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("fetch",(event)=>{
  const req = event.request; if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin === location.origin){
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const resClone = res.clone(); caches.open(CACHE_NAME).then(cache => cache.put(req, resClone)); return res;
      }).catch(()=> caches.match("./index.html")))
    );
  }
});
