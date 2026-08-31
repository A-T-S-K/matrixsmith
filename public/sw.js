const CACHE = "iledhat-shell-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
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
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request).then((response) => {
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      }
      return response;
    })),
  );
});
