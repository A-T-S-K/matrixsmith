import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { cpus, freemem, loadavg, platform, release, totalmem } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import type {
  QualificationCase,
  QualificationCounters,
} from "../tests/helpers/runtime-qualification-fixtures";

export interface QualificationOptions {
  output: string;
  warmups: number;
  samples: number;
  contamination: string;
}
export interface RawSample {
  case: string;
  index: number;
  warmup: boolean;
  durationMs: number;
  queuedDelayMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  counters: QualificationCounters;
}

export function parseQualificationOptions(
  args: string[],
): QualificationOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!;
    const value = args[i + 1];
    if (
      !["--output", "--warmups", "--samples", "--contamination"].includes(
        key,
      ) ||
      value === undefined ||
      values.has(key)
    )
      throw new Error(
        "Expected unique --output, --warmups, --samples and --contamination options.",
      );
    values.set(key, value);
  }
  const output = values.get("--output");
  if (!output || !isAbsolute(output))
    throw new Error("--output requires a unique absolute external directory.");
  const count = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(values.get(key) ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${key} must be an integer in ${min}..${max}.`);
    return value;
  };
  const contamination = values.get("--contamination");
  if (!contamination?.trim())
    throw new Error(
      "--contamination must record quiet lease/process observations, or known contamination.",
    );
  return {
    output,
    warmups: count("--warmups", 3, 0, 10),
    samples: count("--samples", 20, 1, 50),
    contamination,
  };
}

export function distribution(values: number[]) {
  if (
    !values.length ||
    values.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error("Invalid distribution.");
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[
      Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
    ]!,
  };
}

function inside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

/** Resolve parent symlinks before any run; mkdir is exclusive, never overwrite. */
export async function reserveOutput(
  output: string,
  sourceRoot: string,
): Promise<string> {
  if (!isAbsolute(output)) throw new Error("Output must be absolute.");
  const root = await realpath(sourceRoot);
  const parent = await realpath(dirname(output));
  const destination = resolve(parent, relative(dirname(output), output));
  if (inside(root, destination))
    throw new Error(
      "Qualification output must be outside the source checkout.",
    );
  // Also reject another Git checkout, including a nested linked worktree.
  try {
    execFileSync("git", ["-C", parent, "rev-parse", "--git-dir"], {
      stdio: "pipe",
    });
  } catch {
    await mkdir(destination);
    return destination;
  }
  throw new Error(
    "Qualification output must not be inside any source checkout.",
  );
}

export async function measureCase(
  job: QualificationCase,
  index: number,
  warmup: boolean,
): Promise<RawSample> {
  const prepared = await job.prepare();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const start = performance.now();
    const queued = new Promise<number>((resolveDelay) => {
      timer = setTimeout(() => resolveDelay(performance.now() - start), 0);
    });
    const cpuStart = process.cpuUsage();
    const counters = await prepared.run();
    const durationMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    const queuedDelayMs = await queued;
    return {
      case: job.name,
      index,
      warmup,
      durationMs,
      queuedDelayMs,
      cpuUserMs: cpu.user / 1000,
      cpuSystemMs: cpu.system / 1000,
      counters,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await prepared.dispose();
  }
}

export function sourceIdentity(root: string) {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  const status = git("status", "--porcelain=v1", "--untracked-files=all");
  const patch = git("diff", "HEAD", "--binary");
  const paths = [
    ...new Set(
      [
        ...git("diff", "HEAD", "--name-only", "-z").split("\0"),
        ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
      ].filter(Boolean),
    ),
  ].sort();
  const dirtyFiles = paths.map((path) => {
    try {
      return {
        path,
        sha256: createHash("sha256")
          .update(readFileSync(resolve(root, path)))
          .digest("hex"),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { path, deleted: true };
      throw error;
    }
  });
  return {
    commit: git("rev-parse", "HEAD").trim(),
    status,
    dirtyFiles,
    trackedPatchSha256: createHash("sha256").update(patch).digest("hex"),
  };
}

export async function runQualification(options: QualificationOptions) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = await reserveOutput(options.output, root);
  const before = sourceIdentity(root);
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: false,
    root,
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
    define: {
      __MATRIXSMITH_VERSION__: JSON.stringify("qualification-software"),
    },
    cacheDir: resolve(output, "vite-cache"),
  });
  const raw: RawSample[] = [];
  try {
    const fixtures = await server.ssrLoadModule(
      "/tests/helpers/runtime-qualification-fixtures.ts",
    );
    const animation = fixtures.noisyAnimation();
    const report = fixtures.qualificationReport();
    const normalReport = fixtures.qualificationReport(100);
    const hash = createHash("sha256");
    for (const frame of animation.frames) hash.update(frame.data);
    hash.update(JSON.stringify(animation.timing));
    const metadata = {
      schemaVersion: 1,
      source: before,
      options,
      lockfileSha256: createHash("sha256")
        .update(readFileSync(resolve(root, "package-lock.json")))
        .digest("hex"),
      environment: {
        node: process.version,
        npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
        platform: platform(),
        release: release(),
        arch: process.arch,
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        totalMemoryBytes: totalmem(),
        freeMemoryBytes: freemem(),
        loadAverage: loadavg(),
      },
      fixtures: {
        seed: fixtures.QUALIFICATION_SEED,
        animationSha256: hash.digest("hex"),
        frameCount: 48,
        width: 32,
        height: 16,
        rgbBytes: 48 * 32 * 16 * 3,
        reportSha256: createHash("sha256").update(report).digest("hex"),
        reportBytes: Buffer.byteLength(report),
        reportEvents: 10_000,
        normalReportSha256: createHash("sha256")
          .update(normalReport)
          .digest("hex"),
        normalReportBytes: Buffer.byteLength(normalReport),
        normalReportEvents: 100,
        traceCap: 50_000,
        subscribedBurst: 100,
      },
      instrumentation:
        "Harness wall/process-CPU boundaries; real TransactionReview.work counters; feature-detected actual ExecutionResult.evidence and PresentationStore publication counts. No production source patch. Per-sample availability flags distinguish absent baseline seams from measured zeros.",
      method:
        "performance.now; setup/disposal outside measurement; timer queued immediately before operation; upper median sorted[floor(n/2)]; p95 nearest-rank sorted[ceil(.95*n)-1]. Raw warmups retained and excluded from summaries. Stage quantiles do not add. Timer delay is not INP.",
      counterAvailability:
        "executorCountersAvailable/snapshotCountersAvailable are 0 when seams are absent, with unavailable values omitted; 1 means actual returned counters. Final unavailableStages records missing seams. Workspace samples include one matched zero-delay task boundary after import, including queued publications; the queued-delay probe alone may run before that work.",
      authority:
        "Reports remain offline/imported. Synthetic software plans use FakeTransport, actual SafetyPolicy, fresh target-bound digest and exact experimental confirmation under coordinator decision I-executor-contract-002. No forged authorization, real Bluetooth, physical evidence or capture input.",
    };
    await writeFile(
      resolve(output, "metadata.json"),
      JSON.stringify(metadata, null, 2) + "\n",
      { flag: "wx" },
    );
    await writeFile(resolve(output, "report-fixture.json"), report, {
      flag: "wx",
    });
    await writeFile(
      resolve(output, "normal-report-fixture.json"),
      normalReport,
      { flag: "wx" },
    );
    for (const job of fixtures.qualificationCases() as QualificationCase[]) {
      const sampling = job.sampling ?? options;
      for (let i = 0; i < sampling.warmups + sampling.samples; i++) {
        const sample = await measureCase(job, i, i < sampling.warmups);
        raw.push(sample);
        // Preserve progress if a later stage fails; one immutable file per sample.
        await writeFile(
          resolve(output, `${job.name}-${i}.json`),
          JSON.stringify(sample) + "\n",
          { flag: "wx" },
        );
      }
    }
    const after = sourceIdentity(root);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error(
        "Source changed during qualification; raw evidence retained, comparison invalid.",
      );
    const summary = [...new Set(raw.map((sample) => sample.case))].map(
      (name) => {
        const samples = raw.filter(
          (sample) => sample.case === name && !sample.warmup,
        );
        return {
          case: name,
          quantileInterpretation:
            samples.length === 1
              ? "Single observation; median/p95 equal that observation and do not estimate a tail."
              : "Empirical sample quantiles; descriptive, not a CI speed threshold.",
          measuredSamples: samples.length,
          warmups: raw.filter((sample) => sample.case === name && sample.warmup)
            .length,
          durationMs: distribution(samples.map((sample) => sample.durationMs)),
          queuedDelayMs: distribution(
            samples.map((sample) => sample.queuedDelayMs),
          ),
          cpuUserMs: distribution(samples.map((sample) => sample.cpuUserMs)),
          cpuSystemMs: distribution(
            samples.map((sample) => sample.cpuSystemMs),
          ),
          counters: samples.map((sample) => sample.counters),
        };
      },
    );
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          source: after,
          unavailableStages: [
            ...(raw.some(
              (sample) => sample.counters.executorCountersAvailable === 0,
            )
              ? ["executor.internal-stage-counters"]
              : []),
            ...(raw.some(
              (sample) => sample.counters.snapshotCountersAvailable === 0,
            )
              ? ["snapshot.rebuilds"]
              : []),
          ],
          endEnvironment: {
            loadAverage: loadavg(),
            freeMemoryBytes: freemem(),
          },
          raw,
          summary,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    return { output, cases: summary.length, samples: raw.length };
  } finally {
    await server.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  Promise.resolve()
    .then(() =>
      runQualification(parseQualificationOptions(process.argv.slice(2))),
    )
    .then((result) => process.stdout.write(JSON.stringify(result) + "\n"))
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
