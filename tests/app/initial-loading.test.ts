import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync(
  new URL("../../src/main.tsx", import.meta.url),
  "utf8",
);
const home = readFileSync(
  new URL("../../src/ui/pages/Home.tsx", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../scripts/verify-static-output.mjs", import.meta.url),
  "utf8",
);
const worker = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);

describe("cold Home loading boundary", () => {
  it("keeps the hardware/application graph behind a user-driven import", () => {
    expect(main).toContain('import("./application-bootstrap")');
    expect(main).not.toMatch(
      /^import .*\/(?:application\/runtime|presentation\/store|transport\/web-bluetooth)/m,
    );
    expect(home).toContain('from "../../presentation/service-hints"');
  });

  it("enforces the 90 KiB static dependency closure", () => {
    expect(verifier).toContain("const INITIAL_ROUTE_JS_GZIP_LIMIT = 90 * 1024");
    expect(verifier).toContain("collectInitialJavascript");
    expect(verifier).toContain("modulepreload");
  });

  it("pre-caches lazy build assets so the boundary remains offline-capable", () => {
    expect(worker).toContain("__MATRIXSMITH_ASSETS__");
    expect(worker).toContain("ASSETS.map");
    expect(worker).toContain("assets.addAll");
  });
});
