// Verhoog dit nummer bij elke nieuwe versie, zodat telefoons de update ophalen.
const CACHE = "opstellingen-v3";
const SHELL = ["./", "index.html", "styles.css", "app.js", "voorstel.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Eigen bestanden: eerst netwerk, bij geen verbinding de opgeslagen versie. Database-verkeer gaat altijd direct.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});
