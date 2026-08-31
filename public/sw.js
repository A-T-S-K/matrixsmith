const CACHE = "matrixsmith-shell-v3";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const indexResponse = await fetch("./index.html", { cache: "no-cache" });
    const indexText = await indexResponse.clone().text();
    const builtAssets = [...indexText.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)]
      .map((match) => match[1])
      .filter(Boolean);
    await cache.put("./index.html", indexResponse);
    await cache.addAll([...new Set([...SHELL, ...builtAssets])]);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Navigations are network-first so a redeploy is picked up immediately; the
  // cached shell is only an offline fallback. Hashed assets stay cache-first.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put("./index.html", copy)));
        }
        return response;
      }).catch(() => caches.match("./index.html").then((cached) => cached ?? Response.error())),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request).then((response) => {
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
      }
      return response;
    })),
  );
});
