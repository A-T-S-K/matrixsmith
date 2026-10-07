import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  distribution,
  measureCase,
  parseQualificationOptions,
  reserveOutput,
  sourceIdentity,
} from "../../scripts/qualify-runtime-costs";
import {
  animationPlan,
  executionWork,
  noisyAnimation,
  offlineRuntime,
  qualificationCases,
  qualificationReport,
  softwareExecutionFixture,
} from "../helpers/runtime-qualification-fixtures";
import { parseDiagnosticBundle } from "../../src/diagnostics/bundle";
import { compileAnimation } from "../../src/drivers/coolledux/content";
import { SafetyPolicy } from "../../src/app/safety";
import { prepareTransmission } from "../../src/core/transmission";
import { INPUT_LIMITS } from "../../src/application/input-limits";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function scratch() {
  const parent =
    process.env.MATRIXSMITH_QUALIFICATION_TEST_ROOT ??
    process.env.EVIDENCE_ROOT ??
    tmpdir();
  const path = await realpath(
    await mkdtemp(resolve(parent, "qualification-test-")),
  );
  directories.push(path);
  return path;
}

describe("runtime qualification fixtures", () => {
  it("independently generates deterministic bounded noisy animation and packets", () => {
    const a = noisyAnimation();
    const b = noisyAnimation();
    expect(a.frames).toHaveLength(48);
    expect(a.width).toBe(32);
    expect(a.height).toBe(16);
    for (let i = 0; i < 48; i++)
      expect(a.frames[i]!.data).toEqual(b.frames[i]!.data);
    expect(noisyAnimation(1).frames[0]!.data).not.toEqual(a.frames[0]!.data);
    const first = compileAnimation(a);
    const second = compileAnimation(b);
    expect(first.programBytes).toEqual(second.programBytes);
    expect(first.packets).toEqual(second.packets);
    expect(
      first.packets.every(
        (packet) => packet.length > 0 && packet.length <= 512,
      ),
    ).toBe(true);
    expect(first.pacingMs).toBe(60);
    expect(
      first.packets.reduce((sum, packet) => sum + packet.length, 0),
    ).toBeLessThan(16 * 1024 * 1024);
  });

  it("validates byte-identical historical reports within original limits", () => {
    const json = qualificationReport();
    expect(json).toBe(qualificationReport());
    expect(Buffer.byteLength(json)).toBeLessThan(
      INPUT_LIMITS.diagnosticBundleBytes,
    );
    const bundle = parseDiagnosticBundle(json);
    expect(bundle.trace).toHaveLength(10_000);
    expect(bundle.fingerprint.browserDeviceId).toBeUndefined();
    expect(bundle.fingerprint.transportKind).toBe("replay");
    expect(bundle.selectedDriver).toBeNull();
    expect(bundle.capabilities).toEqual([]);
    expect(bundle.observations).toEqual([]);
    expect(() => qualificationReport(INPUT_LIMITS.traceEvents + 1)).toThrow();
    expect(() => qualificationReport(-1)).toThrow();
  });

  it("imports with no reads, writes, connection, or notification subscriptions", async () => {
    const { runtime, transport } = offlineRuntime();
    const connect = vi.spyOn(transport, "selectAndConnect");
    const read = vi.spyOn(transport, "read");
    const write = vi.spyOn(transport, "write");
    const subscribe = vi.spyOn(transport, "subscribe");
    try {
      runtime.importBundle(qualificationReport(100));
      expect(runtime.session.source).toBe("imported");
      expect(runtime.session.confirmedPlanDigest).toBeNull();
      expect(runtime.session.experimentalTxEnabled).toBe(false);
      expect(
        runtime.trace.events.filter(
          (event) => event.metadata.fixture === "software-only",
        ),
      ).toHaveLength(100);
      expect(connect).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(subscribe).not.toHaveBeenCalled();
      const binding = {
        connectionId: "offline",
        fingerprintKey: "offline",
        browserDeviceId: null,
      };
      const plan = prepareTransmission(animationPlan(), binding);
      const decision = new SafetyPolicy().authorize(plan, {
        source: "imported",
        fingerprint: runtime.session.fingerprint,
        selectedDriverId: null,
        selectedProfileId: null,
        driverMatch: null,
        ambiguous: false,
        experimentalSessionEnabled: false,
        targetBinding: binding,
        confirmedPlanDigest: null,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.authorized).toBeUndefined();
    } finally {
      await runtime.dispose();
    }
  });

  it("independently prepares paced and zero-delay software variants through real policy", async () => {
    const paced = await softwareExecutionFixture(true);
    const zero = await softwareExecutionFixture(false);
    try {
      expect(paced.transport.kind).toBe("fake");
      expect(zero.transport.kind).toBe("fake");
      expect(
        paced.prepared.packets.every((packet) => packet.delayAfterMs === 60),
      ).toBe(true);
      expect(
        zero.prepared.packets.every((packet) => packet.delayAfterMs === 0),
      ).toBe(true);
      expect(paced.prepared.digest).not.toBe(zero.prepared.digest);
      const sameTargetZero = prepareTransmission(
        { ...zero.prepared, id: paced.prepared.id },
        paced.prepared.targetBinding,
      );
      expect(sameTargetZero.digest).not.toBe(paced.prepared.digest);
      expect(paced.prepared.packets[0]!.bytes).not.toBe(
        zero.prepared.packets[0]!.bytes,
      );
      expect(paced.prepared.packets[0]!.bytes).toEqual(
        zero.prepared.packets[0]!.bytes,
      );
      expect(zero.policy.authorize(zero.prepared, zero.context).allowed).toBe(
        true,
      );
      expect(
        zero.policy.authorize(zero.prepared, {
          ...zero.context,
          confirmedPlanDigest: null,
        }).allowed,
      ).toBe(false);
      expect(
        zero.policy.authorize(zero.prepared, {
          ...zero.context,
          source: "imported",
        }).allowed,
      ).toBe(false);
      expect(
        zero.policy.authorize(zero.prepared, {
          ...zero.context,
          experimentalSessionEnabled: false,
        }).allowed,
      ).toBe(false);
      const authorized = zero.policy.authorize(
        zero.prepared,
        zero.context,
      ).authorized!;
      expect(
        authorized.plan.packets.every(
          (packet, index) =>
            packet.bytes !== zero.prepared.packets[index]!.bytes,
        ),
      ).toBe(true);
      const result = await zero.executor.execute(authorized);
      const work = executionWork(result);
      if (work.executorCountersAvailable) {
        expect(work.wholePlanDigestCount).toBe(1);
        expect(work.targetCheckCount).toBeGreaterThan(
          zero.prepared.packets.length,
        );
      } else {
        expect(work).toEqual({ executorCountersAvailable: 0 });
      }
      expect(zero.transport.writes).toHaveLength(zero.prepared.packets.length);
      expect(result.packetTimings).toHaveLength(zero.prepared.packets.length);
      expect(result.deviceStateVerified).toBe(false);
      expect(result.protocolAcknowledged).toBeNull();
      expect(paced.transport.writes).toHaveLength(0);
      expect(
        paced.prepared.packets.every((packet) => packet.delayAfterMs === 60),
      ).toBe(true);
    } finally {
      await paced.transport.disconnect();
      await zero.transport.disconnect();
    }
  }, 60_000);

  it("accounts for unchanged versus relevant projection work independently of timing", async () => {
    const jobs = qualificationCases();
    for (const relevant of [false, true]) {
      const job = jobs.find(
        (job) =>
          job.name ===
          (relevant
            ? "projection.relevant-edits"
            : "projection.unrelated-publications"),
      )!;
      const sample = await measureCase(job, 0, false);
      expect(sample.counters).toMatchObject({
        projections: 40,
        rawRebuilds: relevant ? 40 : 0,
        filterRebuilds: relevant ? 40 : 0,
        transactionRebuilds: 0,
        compilationRebuilds: 0,
      });
    }
  });

  it("retains the subscribed sequential trace contract at the real cap", async () => {
    const job = qualificationCases().find(
      (job) => job.name === "import.subscribed-review-burst",
    )!;
    const prepared = await job.prepare();
    try {
      expect(await prepared.run()).toMatchObject({
        inputEvents: 100,
        retainedEvents: INPUT_LIMITS.traceEvents,
        callbacks: 100,
        rawRebuilds: 100,
        transactionRebuilds: 0,
        compilationRebuilds: 0,
      });
    } finally {
      await prepared.dispose();
    }
  });

  it("settles actual workspace publications and distinguishes absent counter seams", async () => {
    const job = qualificationCases().find(
      (job) => job.name === "import.fresh-workspace-100",
    )!;
    const prepared = await job.prepare();
    try {
      const counters = await prepared.run();
      expect(counters.inputEvents).toBe(100);
      expect(counters.retainedEvents).toBeGreaterThanOrEqual(100);
      expect(counters.publications).toBeGreaterThan(0);
      if (counters.snapshotCountersAvailable) {
        expect(counters.traceRequests).toBeGreaterThanOrEqual(0);
        expect(counters.snapshotRebuilds).toBeGreaterThan(0);
        expect(counters.snapshotPublications).toBeGreaterThan(0);
        expect(counters.snapshotObserverCalls).toBe(counters.publications);
      } else {
        expect(counters.snapshotCountersAvailable).toBe(0);
        expect(counters).not.toHaveProperty("snapshotRebuilds");
        expect(counters).not.toHaveProperty("traceRequests");
      }
    } finally {
      await prepared.dispose();
    }
  });
  it("preserves every recorder callback while settling subscribed workspace publication", async () => {
    const job = qualificationCases().find(
      (job) => job.name === "publication.subscribed-workspace-burst",
    )!;
    const prepared = await job.prepare();
    try {
      const counters = await prepared.run();
      expect(counters).toMatchObject({
        inputEvents: 100,
        acceptedEvents: 100,
        retainedEvents: INPUT_LIMITS.traceEvents,
        traceCallbacks: 100,
      });
      expect(counters.publications).toBeGreaterThan(0);
      if (counters.snapshotCountersAvailable) {
        expect(counters.traceRequests).toBe(100);
        expect(counters.snapshotObserverCalls).toBe(counters.publications);
        expect(counters.snapshotRebuilds).toBeGreaterThan(0);
      } else {
        expect(counters.snapshotCountersAvailable).toBe(0);
        expect(counters).not.toHaveProperty("snapshotRebuilds");
      }
    } finally {
      await prepared.dispose();
    }
  }, 60_000);
});

describe("qualification accounting and output isolation", () => {
  it("requires a bounded explicit command and preserves empirical quantile methodology", () => {
    expect(() => parseQualificationOptions([])).toThrow();
    expect(() =>
      parseQualificationOptions([
        "--output",
        "relative",
        "--contamination",
        "quiet",
      ]),
    ).toThrow();
    expect(() =>
      parseQualificationOptions([
        "--output",
        "/outside/run",
        "--contamination",
        "quiet",
        "--samples",
        "51",
      ]),
    ).toThrow();
    expect(() =>
      parseQualificationOptions([
        "--output",
        "/outside/run",
        "--output",
        "/outside/other",
      ]),
    ).toThrow();
    expect(
      parseQualificationOptions([
        "--output",
        "/outside/run",
        "--contamination",
        "quiet lease",
      ]),
    ).toMatchObject({ warmups: 3, samples: 20 });
    expect(distribution(Array.from({ length: 20 }, (_, i) => i))).toEqual({
      median: 10,
      p95: 18,
    });
    expect(() => distribution([])).toThrow();
  });

  it("excludes setup/disposal, records work counters, and always disposes after failure", async () => {
    let disposed = 0;
    const sample = await measureCase(
      {
        name: "stage",
        prepare: async () => ({
          run: () => ({ packets: 7 }),
          dispose: () => {
            disposed++;
          },
        }),
      },
      2,
      true,
    );
    expect(sample).toMatchObject({
      case: "stage",
      index: 2,
      warmup: true,
      counters: { packets: 7 },
    });
    expect(disposed).toBe(1);
    await expect(
      measureCase(
        {
          name: "failure",
          prepare: async () => ({
            run: () => {
              throw new Error("failed");
            },
            dispose: () => {
              disposed++;
            },
          }),
        },
        0,
        false,
      ),
    ).rejects.toThrow("failed");
    expect(disposed).toBe(2);
  });

  it("exclusively reserves external output and rejects checkout and symlink aliases", async () => {
    const parent = await scratch();
    const source = resolve(parent, "source");
    await mkdir(source);
    const output = resolve(parent, "result");
    expect(await reserveOutput(output, source)).toBe(output);
    await expect(reserveOutput(output, source)).rejects.toThrow();
    await expect(
      reserveOutput(resolve(source, "result"), source),
    ).rejects.toThrow("outside");
    await symlink(source, resolve(parent, "alias"));
    await expect(
      reserveOutput(resolve(parent, "alias", "result"), source),
    ).rejects.toThrow("outside");
    const repository = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    await expect(
      reserveOutput(
        resolve(repository, "node_modules", "qualification-output"),
        source,
      ),
    ).rejects.toThrow("source checkout");
  });

  it("binds current dirty source files by contents, including new tooling", async () => {
    const source = sourceIdentity(
      resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
    );
    expect(source.commit).toMatch(/^[a-f0-9]{40}$/);
    const path = "scripts/qualify-runtime-costs.ts";
    const record = source.dirtyFiles.find((file) => file.path === path);
    if (record)
      expect(record).toMatchObject({
        sha256: createHash("sha256")
          .update(
            await readFile(
              resolve(dirname(fileURLToPath(import.meta.url)), "../..", path),
            ),
          )
          .digest("hex"),
      });
  });
});
