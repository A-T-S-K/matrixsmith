import { defineConfig, type Plugin } from "vitest/config";
import { loadEnv } from "vite";

// Vite's dev server injects styles inline and needs a WebSocket for HMR, which
// the strict production CSP forbids. Relax exactly those two directives for
// `vite dev` only; builds ship the unmodified index.html policy.
const devCsp: Plugin = {
  name: "matrixsmith-dev-csp",
  apply: "serve",
  transformIndexHtml: (html) => html
    .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
    .replace("connect-src 'self'", "connect-src 'self' ws: wss:"),
};

export default defineConfig(({ mode }) => {
  const host = loadEnv(mode, ".", "MATRIXSMITH_").MATRIXSMITH_TUNNEL_HOST?.trim();
  return {
    base: "./",
    plugins: [devCsp],
    server: host ? { allowedHosts: [host] } : undefined,
    test: { environment: "node", include: ["tests/**/*.test.ts"] },
  };
});
