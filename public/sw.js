/* Build identity and asset list are substituted by the production build. */
const CACHE_PREFIX = "matrixsmith-";
const VERSION = "__MATRIXSMITH_BUILD_ID__";
const ASSETS = /* __MATRIXSMITH_ASSETS__ */ [];
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}assets-${VERSION}`;
const META_CACHE = `${CACHE_PREFIX}releases`;
const OFFLINE_SHELL = "./index.html";
const SHELL_FILES = [
  OFFLINE_SHELL,
  "./asset-manifest.json",
  "./build-metadata.json",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./bundle-v3.schema.json",
  "./third-party-notices.txt",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const existing = new Set(await caches.keys());
      try {
        const shell = await caches.open(SHELL_CACHE);
        const assets = await caches.open(ASSET_CACHE);
        const responses = await Promise.all(
          SHELL_FILES.map(async (url) => {
            const response = await fetch(
              new Request(new URL(url, self.location.href), {
                cache: "reload",
              }),
            );
            if (!response.ok)
              throw new Error(`Cannot install ${url}: ${response.status}`);
            // Drain the network body before queuing asset downloads; otherwise
            // unread shell responses can occupy every HTTP connection.
            await response.clone().arrayBuffer();
            return [url, response];
          }),
        );
        const responseFor = (url) =>
          responses.find(([name]) => name === url)[1];
        const metadata = await responseFor("./build-metadata.json")
          .clone()
          .json();
        const manifest = await responseFor("./asset-manifest.json")
          .clone()
          .json();
        const html = await responseFor(OFFLINE_SHELL).clone().text();
        const references = [
          ...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g),
        ].map((match) => match[1]);
        if (
          metadata.buildId !== VERSION ||
          manifest.buildId !== VERSION ||
          references.some((asset) => !ASSETS.includes(asset))
        )
          throw new Error(
            "Deployment changed during installation. Retry the complete build.",
          );
        await assets.addAll(
          ASSETS.map(
            (url) =>
              new Request(new URL(url, self.location.href), {
                cache: "reload",
              }),
          ),
        );
        for (const [url, response] of responses) await shell.put(url, response);
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const client of clients)
          client.postMessage({ type: "matrixsmith:update-available" });
      } catch (error) {
        await Promise.all(
          [SHELL_CACHE, ASSET_CACHE]
            .filter((name) => !existing.has(name))
            .map((name) => caches.delete(name)),
        );
        throw error;
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const metadata = await caches.open(META_CACHE);
      const previous = await metadata.match("./active-build");
      const previousId = previous ? await previous.text() : null;
      const keep = new Set([META_CACHE, SHELL_CACHE, ASSET_CACHE]);
      if (previousId) {
        keep.add(`${CACHE_PREFIX}shell-${previousId}`);
        keep.add(`${CACHE_PREFIX}assets-${previousId}`);
      }
      await metadata.put("./active-build", new Response(VERSION));
      for (const key of await caches.keys())
        if (key.startsWith(CACHE_PREFIX) && !keep.has(key))
          await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function clientReady(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (ready) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), 3000);
    channel.port1.onmessage = (event) => finish(event.data?.ready === true);
    client.postMessage({ type: "matrixsmith:check-ready" }, [channel.port2]);
  });
}

let activating = false;
self.addEventListener("message", (event) => {
  if (event.data?.type !== "matrixsmith:apply-update") return;
  event.waitUntil(
    (async () => {
      if (activating) {
        event.ports[0]?.postMessage({
          error: "An update is already being activated.",
        });
        return;
      }
      activating = true;
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const readiness = await Promise.all(clients.map(clientReady));
      if (!readiness.every(Boolean)) {
        for (const client of clients)
          client.postMessage({ type: "matrixsmith:update-cancelled" });
        event.ports[0]?.postMessage({
          error:
            "Another app tab is busy or unavailable. Finish its work or close it, then retry.",
        });
        activating = false;
        return;
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      // A controlled page always gets the shell and assets of this build.
      const shell = await caches.open(SHELL_CACHE);
      if (event.request.mode === "navigate")
        return (await shell.match(OFFLINE_SHELL)) ?? fetch(event.request);
      const assets = await caches.open(ASSET_CACHE);
      const cached =
        (await assets.match(event.request, { ignoreSearch: true })) ??
        (await shell.match(event.request, { ignoreSearch: true }));
      if (cached) return cached;
      // Old open pages may still request an asset from the retained previous build.
      if (/\/assets\//.test(url.pathname)) {
        const previous = await caches.match(event.request, {
          ignoreSearch: true,
        });
        if (previous) return previous;
      }
      return fetch(event.request);
    })(),
  );
});
