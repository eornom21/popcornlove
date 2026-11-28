/* Offline support for the Vancouver trip app. Bump VERSION when files change. */
var VERSION = 'van-v13';
var FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png',
  'img/hero.jpg', 'img/latte.jpg', 'img/polaroid.jpg', 'img/bridge.jpg', 'img/seaplane.jpg', 'img/market.jpg', 'img/poster.jpg',
  'fonts/kaushan.woff2', 'fonts/nunito.woff2', 'fonts/barlow-600.woff2', 'fonts/barlow-700.woff2'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('van-') === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // weather, exchange rate: straight to the network

  if (req.mode === 'navigate' || url.pathname.slice(-10) === 'index.html') {
    // Page: newest copy when online, saved copy when not.
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put('./', copy); });
      return res;
    }).catch(function () { return caches.match('./').then(function (r) { return r || caches.match('index.html'); }); }));
    return;
  }
  // Images, icons, fonts: saved copy first.
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res && (res.status === 200 || res.type === 'opaque')) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  }));
});
