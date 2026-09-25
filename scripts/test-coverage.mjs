import { execFileSync } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import coverageLibrary from "istanbul-lib-coverage";
import reportLibrary from "istanbul-lib-report";
import reports from "istanbul-reports";
import { createSourceInstrumenter } from "./source-coverage.mjs";

const { createCoverageMap } = coverageLibrary;
const { createContext } = reportLibrary;
rmSync("coverage", { recursive: true, force: true });
mkdirSync("coverage", { recursive: true });
const map = createCoverageMap({});
function inventory(directory) {
  for (const name of readdirSync(directory)) {
    const path = `${directory}/${name}`;
    if (statSync(path).isDirectory()) inventory(path);
    else if (/\.(ts|tsx)$/.test(path) && !path.endsWith(".d.ts")) {
      const instrumenter = createSourceInstrumenter();
      instrumenter.instrumentSync(readFileSync(path, "utf8"), resolve(path));
      map.addFileCoverage(instrumenter.lastFileCoverage());
    }
  }
}
inventory("src");
const workerInstrumenter = createSourceInstrumenter();
workerInstrumenter.instrumentSync(
  readFileSync("public/sw.js", "utf8"),
  resolve("public/sw.js"),
);
map.addFileCoverage(workerInstrumenter.lastFileCoverage());
const environment = { ...process.env, VITE_COVERAGE: "true" };
execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run"], {
  stdio: "inherit",
  env: environment,
});
execFileSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test"],
  { stdio: "inherit", env: environment },
);
for (const directory of ["unit", "browser"])
  for (const file of readdirSync(`coverage/${directory}`))
    map.merge(
      JSON.parse(readFileSync(`coverage/${directory}/${file}`, "utf8")),
    );
const context = createContext({ dir: "coverage", coverageMap: map });
for (const name of ["text-summary", "html", "json", "lcovonly"])
  reports.create(name).execute(context);
const summary = map.getCoverageSummary().toJSON();
writeFileSync("coverage/summary.json", JSON.stringify(summary, null, 2));
for (const [metric, minimum] of Object.entries({
  statements: 80,
  branches: 70,
  functions: 80,
  lines: 80,
})) {
  if (summary[metric].pct < minimum) {
    console.error(`${metric}: ${summary[metric].pct}% is below ${minimum}%`);
    process.exitCode = 1;
  }
}
