
// Macro Tracker Service Worker v1.1.3
const CACHE_NAME="macro-tracker-cache-v1.1.3";
const ASSETS=["./","./index.html","./styles.css","./app.js","./manifest.json","./icons/icon-192.png","./icons/icon-512.png","./icons/apple-touch-icon.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>{if(k!==CACHE_NAME)return caches.delete(k)}))));self.clients.claim()});
self.addEventListener("message",e=>{if(e.data&&e.data.type==="SKIP_WAITING")self.skipWaiting()});
self.addEventListener("fetch",e=>{const req=e.request;if(req.method!=="GET")return;const url=new URL(req.url);if(url.origin===location.origin){e.respondWith(caches.match(req).then(c=>c||fetch(req).then(res=>{const clone=res.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,clone));return res}).catch(()=>caches.match("./index.html"))))}});
