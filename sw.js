/* Canvas V5 poistaa vanhan iPadin aiemman sivuvälimuistin käytöstä. */
self.addEventListener("install", function () { self.skipWaiting(); });

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (key) { return caches.delete(key); }));
  }).then(function () { return self.registration.unregister(); }));
});
