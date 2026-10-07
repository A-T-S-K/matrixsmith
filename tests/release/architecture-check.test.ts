import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function check(files: Record<string, string>) {
  const directory = join(tmpdir(), `matrixsmith-architecture-${randomUUID()}`);
  directories.push(directory);
  mkdirSync(directory);
  writeFileSync(
    join(directory, "tsconfig.app.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
      },
      include: ["src"],
    }),
  );
  for (const [file, source] of Object.entries(files)) {
    const path = join(directory, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/verify-architecture.mjs")],
    { cwd: directory, encoding: "utf8", timeout: 10_000 },
  );
  expect(result.error).toBeUndefined();
  return { status: result.status, output: result.stdout + result.stderr };
}

it("does not mistake a computed import's local alias for a module self-edge", () => {
  const result = check({
    "src/entry.ts":
      'const alias = "matrixsmith/application/1"; export const load = () => import(alias);',
  });
  expect(result.status).toBe(0);
  expect(result.output).toContain("Resolved architecture boundaries");
});

it.each(['"./entry"', "`./entry`"])(
  "rejects a real literal dynamic self-import using %s",
  (specifier) => {
    const result = check({
      "src/entry.ts": `export const value = 1; void import(${specifier});`,
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("src/entry.ts -> src/entry.ts");
  },
);

it("rejects a runtime cycle through a re-export and a static import", () => {
  const result = check({
    "src/entry.ts": 'export { value } from "./dependency";',
    "src/dependency.ts": 'import "./entry"; export const value = 1;',
  });
  expect(result.status).toBe(1);
  expect(result.output).toContain("Runtime import cycle:");
  expect(result.output).toContain("src/dependency.ts");
  expect(result.output).toContain("src/entry.ts");
});

it("retains the browser-adapter boundary for literal dynamic imports", () => {
  const result = check({
    "src/application/service.ts":
      'export const load = () => import("../adapters/browser");',
    "src/adapters/browser.ts": "export const browser = true;",
  });
  expect(result.status).toBe(1);
  expect(result.output).toContain("Inject browser adapters at bootstrap");
});

it("retains the concrete-driver boundary for generic UI code", () => {
  const result = check({
    "src/ui/view.ts":
      'import { driver } from "../drivers/coolled-fixture"; export const view = driver;',
    "src/drivers/coolled-fixture.ts": "export const driver = true;",
  });
  expect(result.status).toBe(1);
  expect(result.output).toContain(
    "Generic layers must not import concrete drivers",
  );
});

it("keeps type-only contracts outside the runtime cycle graph", () => {
  const result = check({
    "src/entry.ts":
      'import type { Other } from "./other"; export type Owner = { other: Other };',
    "src/other.ts":
      'import type { Owner } from "./entry"; export type Other = { owner: Owner };',
  });
  expect(result.status).toBe(0);
});
