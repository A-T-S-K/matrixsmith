import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("reproduces generated output and fails the stale-output check", () => {
  const directory = mkdtempSync(join(tmpdir(), "bundle-validator-"));
  const output = join(directory, "validator.js");
  const command = ["scripts/generate-bundle-validator.mjs", "--output", output];
  try {
    execFileSync(process.execPath, command);
    const first = readFileSync(output, "utf8");
    execFileSync(process.execPath, command);
    expect(readFileSync(output, "utf8")).toBe(first);
    expect(first).toBe(
      readFileSync("src/diagnostics/generated/bundle-validator.js", "utf8"),
    );
    execFileSync(process.execPath, [...command, "--check"]);
    writeFileSync(output, first + "\n// stale\n");
    const result = spawnSync(process.execPath, [...command, "--check"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Bundle validator is stale");
    expect(first).not.toMatch(/\/Users\/|new Function|\beval\(|\brequire\(/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 10000);
