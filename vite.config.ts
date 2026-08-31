import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const host = loadEnv(mode, ".", "MATRIXSMITH_").MATRIXSMITH_TUNNEL_HOST?.trim();
  return {
    base: "./",
    server: host ? { allowedHosts: [host] } : undefined,
    test: { environment: "node", include: ["tests/**/*.test.ts"] },
  };
});
