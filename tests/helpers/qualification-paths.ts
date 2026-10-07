import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const markerName = ".matrixsmith-qualification.json";
const runRootVariable = "MATRIXSMITH_QUALIFICATION_RUN_ROOT";
const runIdVariable = "MATRIXSMITH_QUALIFICATION_RUN_ID";

function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
  );
}

function validateRoot(root: string, evidenceRoot?: string): void {
  if (!isAbsolute(root))
    throw new Error("Qualification run root must be absolute");
  const repository = realpathSync(process.cwd());
  if (within(root, repository) || within(root, homedir()))
    throw new Error(
      "Qualification run root cannot contain the repository or HOME",
    );
  for (const temporary of [tmpdir(), "/tmp", "/private/tmp"])
    if (within(resolve(temporary), root))
      throw new Error(
        "Qualification evidence must not be stored in a temporary directory",
      );
  if (evidenceRoot) {
    if (
      !isAbsolute(evidenceRoot) ||
      root === resolve(evidenceRoot) ||
      !within(resolve(evidenceRoot), root)
    )
      throw new Error(
        "Qualification run must be a job-specific child of the evidence root",
      );
  }
  let ancestor = root;
  while (true) {
    if (lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error("Qualification path must not contain symlinks");
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
}

export interface QualificationRun {
  root: string;
  id: string;
  coverage: string;
  unit: string;
  browser: string;
  playwright: string;
  offline: string;
  reporter: string;
}

function paths(root: string, id: string): QualificationRun {
  const run = {
    root,
    id,
    coverage: join(root, "coverage"),
    unit: join(root, "coverage", "unit"),
    browser: join(root, "coverage", "browser"),
    playwright: join(root, "playwright"),
    offline: join(root, "playwright-offline"),
    reporter: join(root, "reporter"),
  };
  for (const directory of [
    run.coverage,
    run.unit,
    run.browser,
    run.playwright,
    run.offline,
    run.reporter,
  ])
    validateRoot(directory);
  return run;
}

/** Fresh directories only; this helper never recursively deletes an environment path. */
export function prepareQualificationRun(
  options: {
    runRoot?: string;
    evidenceRoot?: string;
  } = {},
): QualificationRun {
  const evidenceRoot =
    options.evidenceRoot ?? process.env.MATRIXSMITH_QUALIFICATION_EVIDENCE_ROOT;
  let root = options.runRoot ?? process.env[runRootVariable];
  if (root) {
    validateRoot(root, evidenceRoot);
    root = resolve(root);
    if (existsSync(root)) {
      // Only children of the initiating process may reuse its owned run.
      return qualificationPaths(root);
    }
    mkdirSync(dirname(root), { recursive: true });
    mkdirSync(root);
  } else {
    const parent = evidenceRoot ?? resolve("coverage", "runs");
    validateRoot(join(parent, "run-pending"), evidenceRoot);
    mkdirSync(parent, { recursive: true });
    root = mkdtempSync(join(parent, "run-"));
  }
  const id = randomUUID();
  writeFileSync(
    join(root, markerName),
    JSON.stringify({ version: 1, id, repository: realpathSync(process.cwd()) }),
    { flag: "wx" },
  );
  process.env[runRootVariable] = root;
  process.env[runIdVariable] = id;
  return paths(root, id);
}

export function qualificationPaths(
  root = process.env[runRootVariable],
): QualificationRun {
  if (!root)
    throw new Error(
      "Missing qualification run root; start with prepareQualificationRun",
    );
  validateRoot(root, process.env.MATRIXSMITH_QUALIFICATION_EVIDENCE_ROOT);
  const markerPath = join(root, markerName);
  if (!lstatSync(markerPath).isFile() || lstatSync(markerPath).isSymbolicLink())
    throw new Error("Qualification ownership marker must be a regular file");
  const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
    version?: number;
    id?: string;
    repository?: string;
  };
  if (
    marker.version !== 1 ||
    !marker.id ||
    marker.id !== process.env[runIdVariable] ||
    marker.repository !== realpathSync(process.cwd())
  )
    throw new Error("Refusing existing foreign qualification directory");
  return paths(resolve(root), marker.id);
}

/** Call inside a Playwright test; outputPath gives every project/test its own directory. */
export function qualificationArtifactPath(
  testInfo: { outputPath: (...parts: string[]) => string },
  name: string,
): string {
  if (basename(name) !== name || name === "." || name === "..")
    throw new Error("Artifact name must be a filename");
  const run = qualificationPaths();
  const output = testInfo.outputPath(name);
  if (
    !isAbsolute(output) ||
    (!within(run.playwright, output) && !within(run.offline, output))
  )
    throw new Error(
      "Artifact destination must belong to this qualification run",
    );
  validateRoot(output);
  mkdirSync(dirname(output), { recursive: true });
  return output;
}

export function writeQualificationCoverage(
  stage: "unit" | "browser",
  coverage: unknown,
): void {
  const run = qualificationPaths();
  mkdirSync(run[stage], { recursive: true });
  writeFileSync(
    join(run[stage], `${randomUUID()}.json`),
    JSON.stringify(coverage),
    { flag: "wx" },
  );
}

export function mergeQualificationCoverage(
  map: { merge: (coverage: object) => void },
  run = qualificationPaths(),
): void {
  const owned = qualificationPaths(run.root);
  if (
    owned.id !== run.id ||
    owned.unit !== run.unit ||
    owned.browser !== run.browser
  )
    throw new Error(
      "Coverage stages must belong to the inherited qualification run",
    );
  // Check both stages before merging anything, so inventory alone cannot pass.
  const stages = [owned.unit, owned.browser].map((directory) => {
    validateRoot(directory);
    const files = existsSync(directory)
      ? readdirSync(directory).filter((file) => file.endsWith(".json"))
      : [];
    if (!files.length)
      throw new Error(`Missing ${basename(directory)} coverage stage`);
    return files.map((file) => {
      const path = join(directory, file);
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
        throw new Error("Coverage input must be a regular file");
      const coverage: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (
        !coverage ||
        typeof coverage !== "object" ||
        Array.isArray(coverage) ||
        !Object.keys(coverage).length
      )
        throw new Error(`Empty or invalid coverage stage: ${path}`);
      return coverage;
    });
  });
  for (const stage of stages) for (const coverage of stage) map.merge(coverage);
}
