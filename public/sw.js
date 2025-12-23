const CACHE_NAME = "blot-cache-v1";
const CORE = [
  "/",
  "/index.html",
  "/css/app.css",
  "/js/main.js",
  "/manifest.webmanifest"
];

self.addEventListener("install", (e)=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e)=>{
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e)=>{
  const url = new URL(e.request.url);
  if(url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((cached)=>{
      return cached || fetch(e.request).then((resp)=>{
        const copy = resp.clone();
        if(resp.ok && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/css/") || url.pathname.startsWith("/js/"))){
          caches.open(CACHE_NAME).then(c=>c.put(e.request, copy));
        }
        return resp;
      }).catch(()=>cached);
    })
  );
});
