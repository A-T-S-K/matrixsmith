import { Framebuffer } from "../../src/render/framebuffer";
import { FrameSequence } from "../../src/render/frame-sequence";
import { compileAnimation } from "../../src/drivers/coolledux/content";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { emptyFingerprint } from "../../src/core/device";
import {
  packetHex,
  prepareTransmission,
  type TransmissionPlan,
} from "../../src/core/transmission";
import { TransmissionExecutor } from "../../src/app/executor";
import { FakeTransport } from "../../src/transport/fake";
import { fingerprintIdentityKey } from "../../src/investigation/device-identity";
import { SafetyPolicy } from "../../src/app/safety";
import {
  createDiagnosticBundle,
  parseDiagnosticBundle,
  prepareDiagnosticBundleImport,
} from "../../src/diagnostics/bundle";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { ApplicationRuntime } from "../../src/application/runtime";
import { ReplayTransport } from "../../src/transport/replay";
import type { PresentationStore } from "../../src/presentation/store";
import { INPUT_LIMITS } from "../../src/application/input-limits";
import type { PresentationEnvironment } from "../../src/presentation/environment";

export const QUALIFICATION_SEED = 0x51a7c0de;
export const QUALIFICATION_TIME = "2026-10-06T12:00:00.000Z";
export type QualificationCounters = Record<string, number>;
export interface QualificationCase {
  name: string;
  sampling?: { warmups: number; samples: number };
  prepare(): Promise<{
    run(): QualificationCounters | Promise<QualificationCounters>;
    dispose(): void | Promise<void>;
  }>;
}

/** Read actual optional instrumentation; never substitute packet-count formulas. */
export function executionWork(result: unknown): QualificationCounters {
  const evidence = (result as { evidence?: Record<string, unknown> }).evidence;
  if (evidence === undefined) return { executorCountersAvailable: 0 };
  const { wholePlanDigestCount, targetCheckCount } = evidence;
  if (
    !Number.isInteger(wholePlanDigestCount) ||
    !Number.isInteger(targetCheckCount) ||
    (wholePlanDigestCount as number) < 0 ||
    (targetCheckCount as number) < 0
  )
    throw new Error("Executor returned invalid actual work counters.");
  return {
    executorCountersAvailable: 1,
    wholePlanDigestCount: wholePlanDigestCount as number,
    targetCheckCount: targetCheckCount as number,
  };
}

interface PublicationCounts {
  traceRequests: number;
  rebuilds: number;
  publications: number;
  observerCalls: number;
}
function publicationCounts(store: PresentationStore): PublicationCounts | null {
  const seam = store as PresentationStore & {
    getPublicationCounts?: () => PublicationCounts;
  };
  if (!seam.getPublicationCounts) return null;
  const counts = seam.getPublicationCounts();
  for (const key of [
    "traceRequests",
    "rebuilds",
    "publications",
    "observerCalls",
  ] as const)
    if (!Number.isInteger(counts[key]) || counts[key] < 0)
      throw new Error("Presentation returned invalid actual work counters.");
  return counts;
}
function publicationFailures(store: PresentationStore): number | null {
  const seam = store as PresentationStore & {
    getPublicationFailures?: () => readonly unknown[];
  };
  return seam.getPublicationFailures?.().length ?? null;
}
function publicationWork(
  store: PresentationStore,
  before: PublicationCounts | null,
  beforeFailures: number | null,
): QualificationCounters {
  const after = publicationCounts(store);
  const afterFailures = publicationFailures(store);
  if (afterFailures !== null && afterFailures !== beforeFailures)
    throw new Error("Workspace publication failure during qualification.");
  if (!before || !after) return { snapshotCountersAvailable: 0 };
  return {
    snapshotCountersAvailable: 1,
    traceRequests: after.traceRequests - before.traceRequests,
    snapshotRebuilds: after.rebuilds - before.rebuilds,
    snapshotPublications: after.publications - before.publications,
    snapshotObserverCalls: after.observerCalls - before.observerCalls,
  };
}

/** Same task boundary on both algorithms; includes queued publication work. */
function settlePublicationTask(): Promise<void> {
  return new Promise((resolveTask) => setTimeout(resolveTask, 0));
}

/** Independently generated pixels; no capture, device identifier or evidence. */
export function noisyAnimation(seed = QUALIFICATION_SEED): FrameSequence {
  let state = seed >>> 0;
  const frames = Array.from({ length: 48 }, () => {
    const frame = new Framebuffer(32, 16);
    for (let i = 0; i < frame.data.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      frame.data[i] = state >>> 24;
    }
    return frame;
  });
  return new FrameSequence(
    frames,
    frames.map(() => ({ milliseconds: 100 })),
  );
}

/** Minimal valid historical report, deliberately without claims or send authority. */
export function qualificationReport(eventCount = 10_000): string {
  if (
    !Number.isInteger(eventCount) ||
    eventCount < 0 ||
    eventCount > INPUT_LIMITS.traceEvents
  )
    throw new RangeError("Trace fixture count exceeds the existing limit.");
  const bundle = createDiagnosticBundle({
    fingerprint: emptyFingerprint("replay"),
    driverMatches: [],
    selectedDriver: null,
    selectedProfile: null,
    capabilities: [],
    observations: [],
    trace: Array.from({ length: eventCount }, (_, index) => ({
      timestamp: QUALIFICATION_TIME,
      type: "app.started" as const,
      metadata: { fixture: "software-only", index, noise: "x".repeat(64) },
      rawBytes: Uint8Array.of(index & 255, (index >>> 8) & 255),
    })),
  });
  const json = JSON.stringify({
    ...bundle,
    createdAt: QUALIFICATION_TIME,
    matrixsmithVersion: "qualification-fixture-v1",
  });
  // Validate the independently authored fixture through the real boundary.
  parseDiagnosticBundle(json);
  return json;
}

export function qualificationEnvironment(): PresentationEnvironment {
  const workspace = () => {
    const transport = new ReplayTransport(emptyFingerprint("replay"));
    return { transport, controller: new ApplicationRuntime(transport) };
  };
  const memory = new Map<string, string>();
  return {
    createLiveWorkspace: () => {
      throw new Error("Qualification cannot create a live workspace.");
    },
    createOfflineWorkspace: workspace,
    storage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
      removeItem: (key) => {
        memory.delete(key);
      },
    },
    files: {
      copyText: async () => {
        throw new Error("Qualification cannot copy reports.");
      },
      download: () => {
        throw new Error("Qualification cannot download reports.");
      },
    },
    wakeLock: {
      supported: false,
      acquire: async () => false,
      release: async () => {},
    },
    router: null,
    bluetoothSupported: false,
    authorizedDevices: async () => [],
    signalTimingStart: () => {},
    onBack: () => () => {},
    pushOverlay: () => {},
    back: () => {},
  };
}

export function offlineRuntime() {
  const transport = new ReplayTransport(emptyFingerprint("replay"));
  return { transport, runtime: new ApplicationRuntime(transport) };
}

export async function offlineStore(
  workspace = offlineRuntime(),
): Promise<PresentationStore> {
  const { PresentationStore } = await import("../../src/presentation/store");
  const { runtime, transport } = workspace;
  return new PresentationStore(runtime, transport, qualificationEnvironment());
}

export function animationPlan(sequence = noisyAnimation()) {
  // Normalize random plan identity outside measurements for reproducible digests.
  return {
    ...coolLedUxDriver.plan(
      { type: "ShowAnimation", sequence },
      {
        profile: iledHat31aeProfile,
        fingerprint: emptyFingerprint("replay"),
        source: "imported",
      },
    ),
    id: "qualification:animation-v1",
    execution: "dry-run-only" as const,
  };
}

/** Coordinator-approved isolated software contract. Never exported to a runtime. */
export async function softwareExecutionFixture(paced: boolean) {
  const endpoint = {
    serviceUuid: "0000ff00-0000-1000-8000-00805f9b34fb",
    characteristicUuid: "0000ff01-0000-1000-8000-00805f9b34fb",
  };
  const fingerprint = {
    ...emptyFingerprint("fake"),
    services: [
      {
        uuid: endpoint.serviceUuid,
        isPrimary: true,
        characteristics: [
          {
            uuid: endpoint.characteristicUuid,
            properties: {
              read: false,
              notify: false,
              indicate: false,
              write: false,
              writeWithoutResponse: true,
            },
          },
        ],
      },
    ],
  };
  const transport = new FakeTransport(fingerprint);
  await transport.selectAndConnect({
    mode: "registered",
    hints: { filters: [], optionalServices: [] },
  });
  const binding = {
    connectionId: transport.connectionId!,
    fingerprintKey: fingerprintIdentityKey(fingerprint),
    browserDeviceId: null,
  };
  // Each variant compiles its own fixture and owns its own packet buffers.
  const sequence = noisyAnimation();
  const compiled = compileAnimation(sequence);
  const raw: TransmissionPlan = {
    id: paced
      ? "qualification:software-paced"
      : "qualification:software-zero-delay",
    driverId: "qualification:software-codec",
    profileId: "qualification:software-32x16",
    operation: { type: "ShowAnimation", sequence },
    risk: "persistent",
    persistence: "persistent",
    validation: "experimental",
    evidenceRefs: [],
    execution: "live",
    purpose: "operation",
    timeoutMs: 10_000,
    responseExpectation: { type: "none" },
    recoveryNotes: ["Software simulation; no physical authority."],
    metadata: { softwareOnly: true, seed: QUALIFICATION_SEED },
    packets: compiled.packets.map((bytes, index) => ({
      index,
      endpoint,
      writeMode: "without-response",
      bytes: bytes.slice(),
      hex: packetHex(bytes),
      delayAfterMs: paced ? compiled.pacingMs : 0,
    })),
  };
  const prepared = prepareTransmission(raw, binding);
  const context = {
    source: "live" as const,
    fingerprint,
    selectedDriverId: raw.driverId,
    selectedProfileId: raw.profileId,
    driverMatch: {
      driverId: raw.driverId,
      score: 100,
      confidence: "exact" as const,
      reasons: ["Isolated synthetic software contract"],
      contradictions: [],
    },
    ambiguous: false,
    experimentalSessionEnabled: true,
    targetBinding: binding,
    confirmedPlanDigest: prepared.digest,
  };
  const policy = new SafetyPolicy();
  const trace = new TraceRecorder();
  const executor = new TransmissionExecutor(transport, trace);
  return { transport, prepared, context, policy, trace, executor, compiled };
}

export function qualificationCases(): QualificationCase[] {
  const sequence = noisyAnimation();
  const report = qualificationReport();
  const normalReport = qualificationReport(100);
  const burst = JSON.parse(normalReport).trace as Record<string, unknown>[];
  const cases: QualificationCase[] = [
    {
      name: "animation.compile",
      prepare: async () => ({
        run: () => {
          const compiled = compileAnimation(sequence);
          return {
            frames: sequence.frames.length,
            frameBytes: sequence.frames.reduce(
              (sum, frame) => sum + frame.data.length,
              0,
            ),
            programBytes: compiled.programBytes.length,
            compressedBytes: compiled.compressedBytes.length,
            packets: compiled.packets.length,
            packetBytes: compiled.packets.reduce(
              (sum, bytes) => sum + bytes.length,
              0,
            ),
            scheduledPacingMs:
              (compiled.packets.length - 1) * compiled.pacingMs,
          };
        },
        dispose: () => {},
      }),
    },
    {
      name: "animation.prepare-and-denied-authorization",
      prepare: async () => {
        const raw = animationPlan(sequence);
        return {
          run: () => {
            const targetBinding = {
              connectionId: "qualification:offline",
              fingerprintKey: "qualification:offline",
              browserDeviceId: null,
            };
            const plan = prepareTransmission(raw, targetBinding);
            const decision = new SafetyPolicy().authorize(plan, {
              source: "replay",
              fingerprint: emptyFingerprint("replay"),
              selectedDriverId: null,
              selectedProfileId: null,
              driverMatch: null,
              ambiguous: false,
              experimentalSessionEnabled: false,
              targetBinding,
              confirmedPlanDigest: null,
            });
            if (decision.allowed || decision.authorized)
              throw new Error("Offline qualification gained authority.");
            return {
              packets: plan.packets.length,
              denied: 1,
              authorizedPacketBuffers: 0,
            };
          },
          dispose: () => {},
        };
      },
    },
  ];
  cases.push({
    name: "animation.authorization-software",
    prepare: async () => {
      const fixture = await softwareExecutionFixture(false);
      return {
        run: () => {
          const decision = fixture.policy.authorize(
            fixture.prepared,
            fixture.context,
          );
          if (!decision.allowed || !decision.authorized)
            throw new Error(decision.reasons.join("; "));
          return {
            packets: decision.authorized.plan.packets.length,
            authorizations: 1,
            authorizedPacketBuffers: decision.authorized.plan.packets.filter(
              (packet, index) =>
                packet.bytes !== fixture.prepared.packets[index]!.bytes,
            ).length,
            writes: fixture.transport.writes.length,
          };
        },
        dispose: () => fixture.transport.disconnect(),
      };
    },
  });
  for (const paced of [false, true])
    cases.push({
      name: paced
        ? "animation.executor-deliberate-pacing-software"
        : "animation.executor-zero-delay-software",
      ...(paced ? { sampling: { warmups: 0, samples: 1 } } : {}),
      prepare: async () => {
        const fixture = await softwareExecutionFixture(paced);
        const decision = fixture.policy.authorize(
          fixture.prepared,
          fixture.context,
        );
        if (!decision.allowed || !decision.authorized)
          throw new Error(decision.reasons.join("; "));
        return {
          run: async () => {
            const result = await fixture.executor.execute(decision.authorized!);
            if (!result.hostAccepted || result.deviceStateVerified)
              throw new Error(
                "Software receipt misrepresented device evidence.",
              );
            return {
              ...executionWork(result),
              packets: fixture.prepared.packets.length,
              writes: fixture.transport.writes.length,
              packetBytes: fixture.transport.writes.reduce(
                (sum, write) => sum + write.bytes.length,
                0,
              ),
              packetTimings: result.packetTimings.length,
              traceEvents: fixture.trace.events.length,
              scheduledPacingMs: fixture.prepared.packets
                .slice(0, -1)
                .reduce((sum, packet) => sum + (packet.delayAfterMs ?? 0), 0),
              pacingIntervals: paced ? fixture.prepared.packets.length - 1 : 0,
            };
          },
          dispose: () => fixture.transport.disconnect(),
        };
      },
    });
  cases.push(
    {
      name: "import.prepare-historical-report",
      prepare: async () => ({
        run: () => {
          prepareDiagnosticBundleImport(report);
          return { inputEvents: 10_000, preparationCalls: 1 };
        },
        dispose: () => {},
      }),
    },
    {
      name: "import.fresh-prepared-adoption",
      prepare: async () => {
        const { runtime } = offlineRuntime();
        const prepared = prepareDiagnosticBundleImport(report);
        return {
          run: () => {
            runtime.adoptPreparedBundle(prepared);
            if (
              runtime.session.source !== "imported" ||
              runtime.session.confirmedPlanDigest !== null
            )
              throw new Error("Prepared historical input gained authority.");
            return {
              inputEvents: 10_000,
              retainedEvents: runtime.trace.events.length,
              adoptionCalls: 1,
            };
          },
          dispose: () => runtime.dispose(),
        };
      },
    },
  );
  for (const { saturated, eventCount } of [
    { saturated: false, eventCount: 100 },
    { saturated: false, eventCount: 10_000 },
    { saturated: true, eventCount: 10_000 },
  ]) {
    const input = eventCount === 100 ? normalReport : report;
    cases.push({
      name: saturated
        ? "import.saturated-direct-no-listener"
        : `import.fresh-direct-${eventCount}`,
      prepare: async () => {
        const { runtime } = offlineRuntime();
        if (saturated) for (let i = 0; i < 5; i++) runtime.importBundle(report);
        const before = runtime.trace.revision;
        return {
          run: () => {
            runtime.importBundle(input);
            if (
              runtime.session.source !== "imported" ||
              runtime.session.confirmedPlanDigest !== null
            )
              throw new Error("Report gained current-session authority.");
            return {
              inputEvents: eventCount,
              retainedEvents: runtime.trace.events.length,
              acceptedEvents: runtime.trace.revision - before,
            };
          },
          dispose: () => runtime.dispose(),
        };
      },
    });
  }
  for (const eventCount of [100, 10_000])
    cases.push({
      name: `import.fresh-workspace-${eventCount}`,
      prepare: async () => {
        const store = await offlineStore();
        await settlePublicationTask();
        const before = publicationCounts(store);
        const beforeFailures = publicationFailures(store);
        let publications = 0;
        const unsubscribe = store.subscribe(() => {
          publications++;
        });
        return {
          run: async () => {
            store.importBundle(eventCount === 100 ? normalReport : report);
            if (
              store.controller.session.source !== "imported" ||
              store.getSnapshot().error
            )
              throw new Error(
                store.getSnapshot().error ??
                  "Workspace import did not remain historical.",
              );
            await settlePublicationTask();
            return {
              ...publicationWork(store, before, beforeFailures),
              inputEvents: eventCount,
              retainedEvents: store.controller.trace.events.length,
              publications,
            };
          },
          dispose: async () => {
            unsubscribe();
            await store.dispose();
          },
        };
      },
    });
  cases.push({
    name: "publication.subscribed-workspace-burst",
    prepare: async () => {
      const workspace = offlineRuntime();
      const serialized = JSON.parse(report).trace;
      // Saturate before presentation listeners attach, outside measurement.
      for (let i = 0; i < 5; i++)
        workspace.runtime.trace.importSerialized(serialized);
      const store = await offlineStore(workspace);
      store.setView("develop");
      store.setWorkbenchSection("raw");
      await settlePublicationTask();
      const before = publicationCounts(store);
      const beforeFailures = publicationFailures(store);
      const beforeRevision = store.controller.trace.revision;
      let publications = 0;
      let traceCallbacks = 0;
      const unsubscribe = store.subscribe(() => publications++);
      const unsubscribeTrace = store.controller.trace.subscribe(
        () => traceCallbacks++,
      );
      return {
        run: async () => {
          store.controller.trace.importSerialized(burst);
          await settlePublicationTask();
          return {
            ...publicationWork(store, before, beforeFailures),
            inputEvents: burst.length,
            acceptedEvents: store.controller.trace.revision - beforeRevision,
            retainedEvents: store.controller.trace.events.length,
            traceCallbacks,
            publications,
          };
        },
        dispose: async () => {
          unsubscribeTrace();
          unsubscribe();
          await store.dispose();
        },
      };
    },
  });
  cases.push({
    name: "import.subscribed-review-burst",
    prepare: async () => {
      const { TransactionReview } =
        await import("../../src/presentation/state/transaction-review");
      const trace = new TraceRecorder();
      const serialized = JSON.parse(report).trace;
      for (let i = 0; i < 5; i++) trace.importSerialized(serialized);
      const review = new TransactionReview();
      const project = () =>
        review.project({
          transactions: [],
          compilations: [],
          rawEvents: trace.events,
          revisions: { transactions: 0, compilations: 0, raw: trace.revision },
          search: "",
          filter: "all",
          section: "raw",
        });
      project();
      const before = { ...review.work };
      let callbacks = 0;
      const unsubscribe = trace.subscribe(() => {
        callbacks++;
        project();
      });
      return {
        run: () => {
          trace.importSerialized(burst);
          return {
            inputEvents: burst.length,
            retainedEvents: trace.events.length,
            callbacks,
            rawRebuilds: review.work.raw - before.raw,
            transactionRebuilds: review.work.transactions - before.transactions,
            compilationRebuilds: review.work.compilations - before.compilations,
          };
        },
        dispose: () => {
          unsubscribe();
          review.dispose();
        },
      };
    },
  });
  for (const relevant of [false, true])
    cases.push({
      name: relevant
        ? "projection.relevant-edits"
        : "projection.unrelated-publications",
      prepare: async () => {
        const { TransactionReview } =
          await import("../../src/presentation/state/transaction-review");
        const trace = new TraceRecorder();
        trace.importSerialized(burst);
        const review = new TransactionReview();
        const project = (search: string) =>
          review.project({
            transactions: [],
            compilations: [],
            rawEvents: trace.events,
            revisions: {
              transactions: 0,
              compilations: 0,
              raw: trace.revision,
            },
            search,
            filter: "all",
            section: "raw",
          });
        project("");
        const before = { ...review.work };
        return {
          run: () => {
            for (let i = 0; i < 40; i++) {
              if (relevant) trace.importSerialized(burst.slice(i, i + 1));
              project(relevant ? `query:${i}` : "");
            }
            return {
              projections: 40,
              rawRebuilds: review.work.raw - before.raw,
              filterRebuilds: review.work.filters - before.filters,
              transactionRebuilds:
                review.work.transactions - before.transactions,
              compilationRebuilds:
                review.work.compilations - before.compilations,
            };
          },
          dispose: () => review.dispose(),
        };
      },
    });
  return cases;
}
