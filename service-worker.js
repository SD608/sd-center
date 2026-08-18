"use strict";
const CACHE_NAME = "sd608-mobile-v21-profile-coins-gold";
const APP_SHELL = [
  "./mobile.html",
  "./wallet-mobile.html",
  "./vault-mobile.html",
  "./npc-vault-mobile.html",
  "./update/version.json",
  "./odd-even-mobile.html",
  "./slot-mobile.html",
  "./sdcoin-mobile.html",
  "./flea-market-mobile.html",
  "./profile.html",
  "./profile-card-edit.html",
  "./profile-card-edit.html?embed=1&v=2",
  "./profile-shop.html",
  "./login.html",
  "./signup.html",
  "./offline.html",
  "./assets/css/style.css?v=online2",
  "./assets/css/mobile-app.css?v=3",
  "./assets/css/mobile-nav-v2.css?v=1",
  "./assets/css/mobile-update.css?v=1",
  "./assets/css/mobile-vault.css?v=2",
  "./assets/css/npc-vault-mobile.css?v=1",
  "./assets/css/sdcoin-mobile.css?v=3",
  "./assets/css/sdcoin-home-card.css?v=3",
  "./assets/css/flea-market-mobile.css?v=1",
  "./assets/css/profile-page.css?v=1",
  "./assets/css/profile-card-layout.css?v=1",
  "./assets/css/profile-card-edit.css?v=2-embed",
  "./assets/css/profile-tabs.css?v=1",
  "./assets/css/profile-assets-v2.css?v=1",
  "./assets/js/supabase-config.js?v=2",
  "./assets/js/auth-common.js?v=2",
  "./assets/js/mobile-common.js?v=2",
  "./assets/js/mobile-native-update.js?v=1",
  "./assets/js/mobile-vault.js?v=9",
  "./assets/js/mobile-slot.js?v=13-stage7-ding",
  "./assets/js/npc-vault-mobile.js?v=1",
  "./assets/js/mobile-sdcoin.js?v=4",
  "./assets/js/mobile-sdcoin-summary.js?v=2",
  "./assets/js/flea-market-mobile.js?v=1",
  "./assets/js/profile-page-v2.js?v=1",
  "./assets/js/profile-card-edit-v2.js?v=1",
  "./assets/js/profile-card-edit-embed.js?v=1",
  "./assets/js/profile-tabs.js?v=1",
  "./assets/js/profile-shop.js?v=3-achievement-filters",
  "./assets/icons/center.png",
  "./assets/icons/wallet.png",
  "./assets/icons/vault.png",
  "./assets/icons/npc-vault.svg",
  "./assets/icons/odd-even.png",
  "./assets/icons/slot.png",
  "./assets/icons/sdcoin.svg",
  "./assets/icons/flea-market.png?v=3",
  "./assets/icons/coins/ddj.svg",
  "./assets/icons/coins/hsh.svg",
  "./assets/icons/coins/set.svg",
  "./assets/icons/coins/hiz.svg",
  "./assets/icons/coins/kng.svg",
  "./assets/icons/coins/sdc.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

async function fetchAndRefreshCache(request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(request)) || caches.match("./offline.html"))
    );
    return;
  }

  const networkFirst = request.destination === "script"
    || request.destination === "style"
    || url.pathname.endsWith(".json");

  if (networkFirst) {
    event.respondWith(
      fetchAndRefreshCache(request).catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetchAndRefreshCache(request))
  );
});
