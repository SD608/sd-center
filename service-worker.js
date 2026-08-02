"use strict";
const CACHE_NAME = "sd608-mobile-v3-sdcoin";
const APP_SHELL = [
  "./mobile.html",
  "./wallet-mobile.html",
  "./vault-mobile.html",
  "./odd-even-mobile.html",
  "./slot-mobile.html",
  "./sdcoin-mobile.html",
  "./login.html",
  "./signup.html",
  "./offline.html",
  "./assets/css/style.css?v=online2",
  "./assets/css/mobile-app.css?v=3",
  "./assets/css/sdcoin-mobile.css?v=1",
  "./assets/css/sdcoin-home-card.css?v=1",
  "./assets/js/supabase-config.js?v=2",
  "./assets/js/auth-common.js?v=2",
  "./assets/js/mobile-common.js?v=2",
  "./assets/js/mobile-sdcoin.js?v=1",
  "./assets/icons/center.png",
  "./assets/icons/wallet.png",
  "./assets/icons/vault.png",
  "./assets/icons/odd-even.png",
  "./assets/icons/slot.png",
  "./assets/icons/sdcoin.svg"
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match(request)) || caches.match("./offline.html")));
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
