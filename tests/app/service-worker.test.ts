import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Regression guards for the dev/production service-worker fixes. These are
 * static assertions on the shipped worker and entry point: they fail loudly
 * if the stale-HTML, cache-first-navigation, or body-already-used bugs are
 * reintroduced by an edit.
 */
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const main = readFileSync(new URL("../../src/main.tsx", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const viteConfig = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

describe("service worker regressions", () => {
  it("keeps navigations network-first with the cached shell only as fallback", () => {
    const navigationBlock = sw.split('mode === "navigate"')[1] ?? "";
    expect(navigationBlock).toContain("fetch(event.request)");
    expect(navigationBlock).toContain(".catch(");
    expect(navigationBlock.indexOf("fetch(event.request)")).toBeLessThan(navigationBlock.indexOf("caches.match"));
  });

  it("clones responses synchronously before any async cache usage", () => {
    // Every cache.put of a live response must use a clone taken before the
    // response is returned; the original body is consumed by the page.
    for (const segment of sw.split("event.respondWith")) {
      if (!segment.includes("cache.put(") || !segment.includes("return response")) continue;
      expect(segment).toContain("response.clone()");
      expect(segment.indexOf("response.clone()")).toBeLessThan(segment.indexOf("return response"));
    }
    expect(sw).toContain("indexResponse.clone()");
  });

  it("clears old caches on activate", () => {
    expect(sw).toContain('keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))');
  });

  it("registers the worker only in production and actively unregisters in dev", () => {
    expect(main).toContain("import.meta.env.PROD");
    expect(main).toMatch(/getRegistrations\(\)[\s\S]*unregister\(\)/);
    const registerBranch = main.split("import.meta.env.PROD")[1] ?? "";
    expect(registerBranch).toContain('serviceWorker.register("./sw.js")');
  });

  it("keeps the production CSP strict while dev relaxes only styles and websockets", () => {
    expect(indexHtml).toContain("Content-Security-Policy");
    expect(indexHtml).not.toContain("unsafe-inline");
    expect(indexHtml).not.toContain("ws:");
    expect(viteConfig).toContain('apply: "serve"');
    expect(viteConfig).toContain("style-src 'self' 'unsafe-inline'");
    expect(viteConfig).toContain("connect-src 'self' ws: wss:");
  });
});
