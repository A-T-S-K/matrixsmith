import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicFile = (name: string): string =>
  readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");

describe("static hosting contract", () => {
  it("ships Cloudflare security and cache headers", () => {
    const headers = publicFile("_headers");
    expect(headers).toContain("frame-ancestors https://aivillage.org");
    expect(headers).not.toContain("X-Frame-Options");
    expect(headers).toContain("Permissions-Policy: bluetooth=(self)");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("max-age=31536000, immutable");
    expect(headers).toContain("/sw.js\n  Cache-Control: no-cache");
  });

  it("provides installable any-purpose and maskable PNG icons", () => {
    const manifest = JSON.parse(publicFile("manifest.webmanifest")) as {
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "./icon-192.png",
          sizes: "192x192",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "./icon-512.png",
          sizes: "512x512",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "./icon-maskable-512.png",
          sizes: "512x512",
          purpose: "maskable",
        }),
      ]),
    );
    for (const icon of [
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-512.png",
    ])
      expect(
        statSync(new URL(`../../public/${icon}`, import.meta.url)).size,
      ).toBeGreaterThan(100);
  });
});
