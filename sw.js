var CACHE = "simo-kotinaytto-github-v2";
var FILES = ["./", "./index.html", "./styles.css?v=20260812-2", "./app.js?v=20260812-2", "./icon.svg", "./icon-180.png", "./icon-512.png", "./manifest.webmanifest?v=20260812-2"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(FILES); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (key) { return key === CACHE ? null : caches.delete(key); }));
  }));
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  if (event.request.url.indexOf("/data/") !== -1) { return; }
  event.respondWith(fetch(event.request).then(function (response) {
    var copy = response.clone();
    caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
    return response;
  }).catch(function () { return caches.match(event.request); }));
});
