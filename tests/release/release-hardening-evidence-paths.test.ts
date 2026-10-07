import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  mergeQualificationCoverage,
  prepareQualificationRun,
  qualificationArtifactPath,
  qualificationPaths,
  writeQualificationCoverage,
} from "../helpers/qualification-paths";

// Regression scratch data stays inside this run's approved evidence directory.
const parentRun = process.env.MATRIXSMITH_QUALIFICATION_RUN_ROOT;
const scratchParent = parentRun ?? resolve("coverage", "path-regressions");
let scratch: string;
beforeEach(() => {
  mkdirSync(scratchParent, { recursive: true });
  scratch = mkdtempSync(join(scratchParent, "case-"));
  vi.stubEnv("MATRIXSMITH_QUALIFICATION_RUN_ROOT", "");
  vi.stubEnv("MATRIXSMITH_QUALIFICATION_RUN_ID", "");
  vi.stubEnv("MATRIXSMITH_QUALIFICATION_EVIDENCE_ROOT", scratch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  // This exact path was exclusively created by mkdtemp, never supplied by env.
  rmSync(scratch, { recursive: true });
});

describe("durable qualification evidence", () => {
  it("isolates fresh jobs and passes the same owned run to child processes", () => {
    const first = prepareQualificationRun();
    const firstFile = join(first.root, "retained.txt");
    writeFileSync(firstFile, "prior evidence");
    expect(qualificationPaths()).toEqual(first);
    const child = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { qualificationPaths, writeQualificationCoverage } from ${JSON.stringify(new URL("../helpers/qualification-paths.ts", import.meta.url).href)};
      writeQualificationCoverage("unit", { inherited: {} });
      process.stdout.write(JSON.stringify(qualificationPaths()));
    `,
      ],
      { env: process.env, encoding: "utf8" },
    );
    expect(JSON.parse(child)).toEqual(first);
    expect(existsSync(first.unit)).toBe(true);
    vi.stubEnv("MATRIXSMITH_QUALIFICATION_RUN_ROOT", "");
    const second = prepareQualificationRun();
    expect(second.root).not.toBe(first.root);
    expect(readFileSync(firstFile, "utf8")).toBe("prior evidence");
    expect(second.unit.startsWith(scratch)).toBe(true);
    expect(second.browser.startsWith(scratch)).toBe(true);
    expect(prepareQualificationRun({ runRoot: second.root })).toEqual(second);
  });

  it("refuses unsafe or foreign directories without touching their contents", () => {
    for (const path of [
      "relative/job",
      process.cwd(),
      homedir(),
      "/",
      scratch,
      join(tmpdir(), "unsafe-evidence"),
    ])
      expect(() => prepareQualificationRun({ runRoot: path })).toThrow();
    const foreign = join(scratch, "foreign");
    mkdirSync(foreign);
    const retained = join(foreign, "retained.txt");
    writeFileSync(retained, "do not delete");
    expect(() => prepareQualificationRun({ runRoot: foreign })).toThrow();
    expect(readFileSync(retained, "utf8")).toBe("do not delete");
    const symlink = join(scratch, "linked");
    symlinkSync(foreign, symlink);
    expect(() =>
      prepareQualificationRun({ runRoot: join(symlink, "child") }),
    ).toThrow(/symlink/);
    expect(existsSync(join(foreign, "child"))).toBe(false);
    const run = prepareQualificationRun();
    mkdirSync(run.coverage);
    symlinkSync(foreign, run.browser);
    expect(() => writeQualificationCoverage("browser", { source: {} })).toThrow(
      /symlink/,
    );
    expect(readFileSync(retained, "utf8")).toBe("do not delete");
  });

  it("requires the initiating run ID even when a directory has a marker", () => {
    const run = prepareQualificationRun();
    writeFileSync(join(run.root, "retained.txt"), "old run");
    vi.stubEnv("MATRIXSMITH_QUALIFICATION_RUN_ID", "wrong-id");
    expect(() => prepareQualificationRun({ runRoot: run.root })).toThrow(
      /foreign/,
    );
    expect(readFileSync(join(run.root, "retained.txt"), "utf8")).toBe(
      "old run",
    );
  });

  it("requires both nonempty coverage stages before merging the source inventory", () => {
    const run = prepareQualificationRun();
    const merge = vi.fn();
    expect(() => mergeQualificationCoverage({ merge }, run)).toThrow(
      /unit coverage/,
    );
    writeQualificationCoverage("unit", { source: {} });
    expect(() => mergeQualificationCoverage({ merge }, run)).toThrow(
      /browser coverage/,
    );
    writeQualificationCoverage("browser", {});
    expect(() => mergeQualificationCoverage({ merge }, run)).toThrow(
      /Empty or invalid/,
    );
    expect(merge).not.toHaveBeenCalled();
  });

  it("adds unit and browser hits while retaining unvisited source inventory", () => {
    prepareQualificationRun();
    const require = createRequire(import.meta.url);
    const { createCoverageMap } = require("istanbul-lib-coverage");
    const coverage = (path: string, hits: number) => ({
      path,
      statementMap: {
        "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      },
      fnMap: {},
      branchMap: {},
      s: { "0": hits },
      f: {},
      b: {},
    });
    const visited = resolve("src/visited.ts");
    const unvisited = resolve("src/unvisited.ts");
    const map = createCoverageMap({
      [visited]: coverage(visited, 0),
      [unvisited]: coverage(unvisited, 0),
    });
    writeQualificationCoverage("unit", { [visited]: coverage(visited, 2) });
    writeQualificationCoverage("browser", { [visited]: coverage(visited, 3) });
    mergeQualificationCoverage(map);
    expect(map.fileCoverageFor(visited).s["0"]).toBe(5);
    expect(map.fileCoverageFor(unvisited).s["0"]).toBe(0);
    expect(map.getCoverageSummary().statements.pct).toBe(50);
  });

  it("routes artifacts into project/test directories and rejects escaping output", () => {
    const run = prepareQualificationRun();
    const chromium = {
      outputPath: (name: string) => join(run.playwright, "chromium-case", name),
    };
    const mobile = {
      outputPath: (name: string) => join(run.playwright, "mobile-case", name),
    };
    const first = qualificationArtifactPath(chromium, "review.png");
    const second = qualificationArtifactPath(mobile, "review.png");
    expect(first).not.toBe(second);
    expect(existsSync(join(run.playwright, "chromium-case"))).toBe(true);
    expect(() =>
      qualificationArtifactPath(chromium, "../outside.png"),
    ).toThrow();
    expect(() =>
      qualificationArtifactPath(
        { outputPath: () => join(scratch, "foreign.png") },
        "review.png",
      ),
    ).toThrow(/destination/);
  });
});
