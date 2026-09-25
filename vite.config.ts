import { sourceCoveragePlugin } from "./scripts/source-coverage.mjs";
import { readFileSync } from "node:fs";
import { buildIdentity } from "./scripts/build-identity.mjs";
import { defineConfig, type Plugin } from "vitest/config";
import { loadEnv } from "vite";

// Vite's dev server injects styles inline and needs a WebSocket for HMR, which
// the strict production CSP forbids. Relax exactly those two directives for
// `vite dev` only; builds ship the unmodified index.html policy.
const devCsp: Plugin = {
  name: "matrixsmith-dev-csp",
  apply: "serve",
  transformIndexHtml: (html) =>
    html
      .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
      .replace("connect-src 'self'", "connect-src 'self' ws: wss:"),
};

/** Gives the service worker a build-time list of lazy chunks for first-install offline use. */
const identity = buildIdentity();
const offlineAssetManifest: Plugin = {
  name: "matrixsmith-offline-asset-manifest",
  apply: "build",
  generateBundle(_options, bundle) {
    this.emitFile({
      type: "asset",
      fileName: "third-party-notices.txt",
      source: readFileSync("THIRD_PARTY_NOTICES.md", "utf8"),
    });
    const assets = Object.values(bundle)
      .map((output) => `./${output.fileName}`)
      .filter((file) => file.startsWith("./assets/"))
      .sort();
    this.emitFile({
      type: "asset",
      fileName: "build-metadata.json",
      source: JSON.stringify(identity),
    });
    this.emitFile({
      type: "asset",
      fileName: "sw.js",
      source: readFileSync("public/sw.js", "utf8")
        .replaceAll("__MATRIXSMITH_BUILD_ID__", identity.buildId)
        .replace("/* __MATRIXSMITH_ASSETS__ */ []", JSON.stringify(assets)),
    });
    this.emitFile({
      type: "asset",
      fileName: "asset-manifest.json",
      source: JSON.stringify({ buildId: identity.buildId, assets }),
    });
  },
};

export default defineConfig(({ mode }) => {
  const host = loadEnv(
    mode,
    ".",
    "MATRIXSMITH_",
  ).MATRIXSMITH_TUNNEL_HOST?.trim();
  return {
    base: "./",
    define: {
      __MATRIXSMITH_VERSION__: JSON.stringify(
        `${identity.version}+${identity.buildId}`,
      ),
    },
    plugins: [
      devCsp,
      offlineAssetManifest,
      ...(process.env.VITE_COVERAGE === "true" && mode !== "production"
        ? [sourceCoveragePlugin()]
        : []),
    ],
    // Cloudflare quick tunnels get a new random subdomain on every launch.
    // Trust only that domain suffix so relaunches do not require config edits.
    server: {
      port: 5174,
      strictPort: true,
      allowedHosts: [".trycloudflare.com", ...(host ? [host] : [])],
    },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"],
      setupFiles:
        process.env.VITE_COVERAGE === "true"
          ? ["tests/helpers/coverage-setup.ts"]
          : [],
    },
  };
});
