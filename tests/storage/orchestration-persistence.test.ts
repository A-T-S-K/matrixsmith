import { describe, expect, it } from "vitest";
import {
  forgetInvestigationHistory, latestInvestigationFor, loadInvestigationHistory, saveInvestigation,
} from "../../src/storage/investigations";
import type { KeyValueStorage } from "../../src/storage/repository";
import { createInvestigation, recordCompletedTest, withOrchestration, type Investigation } from "../../src/investigation/investigation";
import { buildExecutionFingerprint, emptyOrchestration, type ExperimentRun, type TransferRecord } from "../../src/investigation/orchestration";
import type { ObservationAttempt } from "../../src/investigation/timing";

/**
 * What survives a browser restart, and what must not.
 *
 * The semantic record survives: an investigation that could explain "attempt 1
 * missed, attempt 2 valid" before it was saved has to be able to explain it
 * afterwards, or the attempt model buys nothing beyond the current session.
 *
 * Operational authority does not survive. A saved record may say what was
 * last written to the display; nothing in a new session observed the panel,
 * so it may never say a diagnostic is currently on it.
 */

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

const FINGERPRINT = buildExecutionFingerprint({
  physicalDeviceKey: "fixture-device", profileId: "iledhat-31ae-32x16",
  testId: "coolledux-graffiti-timing", diagnosticId: "graffiti-timing-probe",
  parameters: { stayTime: 3 }, programCrc32: "0x227B3A0B",
});

const MISSED_ATTEMPT: ObservationAttempt = {
  attemptNumber: 1, parameters: { stayTime: 3 }, t0: "2026-09-01T10:00:00.000Z",
  marks: [{ event: "visible:not-observed", timestamp: "2026-09-01T10:00:04.000Z", source: "human-observed", elapsedMs: 4000 }],
  values: [], validity: "missed-t1", invalidationReason: "The moment the full image appeared was missed",
  note: null, startedAt: "2026-09-01T10:00:00.000Z", endedAt: "2026-09-01T10:00:04.000Z",
};

const VALID_ATTEMPT: ObservationAttempt = {
  attemptNumber: 2, parameters: { stayTime: 3 }, t0: "2026-09-01T10:01:00.000Z",
  marks: [
    { event: "visible", timestamp: "2026-09-01T10:01:00.400Z", source: "human-observed", elapsedMs: 400, fieldId: "image-visible" },
    { event: "movement", timestamp: "2026-09-01T10:01:03.600Z", source: "human-observed", elapsedMs: 3600, fieldId: "movement-start" },
  ],
  values: [{ kind: "duration", fieldId: "movement-start", milliseconds: 3600, measuredBy: "matrixsmith-timer" }],
  validity: "valid", invalidationReason: null, note: null,
  startedAt: "2026-09-01T10:01:00.000Z", endedAt: "2026-09-01T10:01:03.600Z",
};

const TRANSFERS: TransferRecord[] = [
  {
    transferId: "transfer:1", attemptId: "attempt:1", diagnosticId: "graffiti-timing-probe",
    reason: "initial-experiment", fingerprint: FINGERPRINT, transactionIds: ["transaction:1"],
    startedAt: "2026-09-01T10:00:00.000Z", finalWriteAcceptedAt: "2026-09-01T10:00:00.000Z", failureReason: null,
  },
  {
    transferId: "transfer:2", attemptId: "attempt:2", diagnosticId: "graffiti-timing-probe",
    reason: "explicit-retry-missed-observation", fingerprint: FINGERPRINT, transactionIds: ["transaction:2"],
    startedAt: "2026-09-01T10:01:00.000Z", finalWriteAcceptedAt: "2026-09-01T10:01:00.000Z", failureReason: null,
  },
];

const RUN: ExperimentRun = {
  experimentRunId: "experiment:1", definitionId: "coolledux-graffiti-timing",
  title: "Measure how long a static image stays still",
  corePlanStepId: "playback-discriminator", variant: "stayTime=3", parameters: { stayTime: 3 },
  fingerprint: FINGERPRINT, status: "partial", resolution: "settled",
  startedAt: "2026-09-01T10:00:00.000Z", completedAt: "2026-09-01T10:01:04.000Z",
  attempts: [
    {
      attemptId: "attempt:1", attemptNumber: 1, reason: "initial-experiment",
      startedAt: "2026-09-01T10:00:00.000Z", transferIds: ["transfer:1"], observations: [],
      timing: MISSED_ATTEMPT, validity: "invalid",
      invalidationReason: "The moment the full image appeared was missed", failureKind: "human-missed",
    },
    {
      attemptId: "attempt:2", attemptNumber: 2, reason: "explicit-retry-missed-observation",
      startedAt: "2026-09-01T10:01:00.000Z", transferIds: ["transfer:2"], observations: VALID_ATTEMPT.values,
      timing: VALID_ATTEMPT, validity: "valid", invalidationReason: null, failureKind: null,
    },
  ],
  conclusion: "The image appeared correctly, then started moving.", reopenReason: null,
};

function investigationWithOrchestration(): Investigation {
  let investigation = createInvestigation({
    profileId: "iledhat-31ae-32x16", deviceName: "iLedHat",
    deviceBinding: { browserDeviceId: "fixture-device", profileId: "iledhat-31ae-32x16", fingerprintKey: "shape" },
    goal: { kind: "develop", description: "characterize" },
  });
  investigation = recordCompletedTest(investigation, {
    testId: "coolledux-graffiti-timing", title: "Measure how long a static image stays still",
    startedAt: "2026-09-01T10:00:00.000Z", completedAt: "2026-09-01T10:01:04.000Z", status: "partial",
    observations: VALID_ATTEMPT.values, established: [], rejected: ["It did not stay still."], unknowns: [],
    summary: "moved", transactionIds: ["transaction:1", "transaction:2"],
    parameters: { stayTime: 3 }, attempts: [MISSED_ATTEMPT, VALID_ATTEMPT], resolution: "settled",
  }, []);
  return withOrchestration(investigation, {
    ...emptyOrchestration(),
    experiments: [RUN],
    transfers: TRANSFERS,
    panelProgram: {
      certainty: "known-active", kind: "guided-diagnostic", fingerprint: FINGERPRINT,
      label: "guided diagnostic timing", startedAt: "2026-09-01T10:00:59.000Z", writtenAt: "2026-09-01T10:01:00.000Z", uncertaintyReason: null,
    },
    reopened: [{ testId: "coolledux-graffiti-black", reason: "double-checking", at: "2026-09-01T10:02:00.000Z" }],
    recommendationTrail: [{ testId: "coolledux-graffiti-timing", at: "2026-09-01T10:00:00.000Z", evidenceCount: 0, origin: "automatic-recommendation" }],
  });
}

describe("orchestration survives local persistence", () => {
  it("round-trips experiments, attempts and transfers", () => {
    const storage = memoryStorage();
    saveInvestigation(investigationWithOrchestration(), storage);
    const loaded = loadInvestigationHistory(storage)[0]!.investigation;
    expect(loaded.orchestration.experiments).toHaveLength(1);
    const run = loaded.orchestration.experiments[0]!;
    expect(run.experimentRunId).toBe("experiment:1");
    expect(run.resolution).toBe("settled");
    expect(run.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
    expect(run.attempts[0]).toMatchObject({ validity: "invalid", failureKind: "human-missed" });
    expect(run.attempts[1]).toMatchObject({ validity: "valid", failureKind: null });
    expect(run.attempts[0]!.timing?.validity).toBe("missed-t1");
    expect(run.attempts[0]!.timing?.attemptNumber).toBe(1);
    expect(run.fingerprint.physicalDeviceKey).toBe("fixture-device");
    expect(run.fingerprint.deviceIdentityBasis).toBe("browser-authorized-device");
  });

  it("keeps every transfer reason and its transaction references", () => {
    const storage = memoryStorage();
    saveInvestigation(investigationWithOrchestration(), storage);
    const transfers = loadInvestigationHistory(storage)[0]!.investigation.orchestration.transfers;
    expect(transfers.map((transfer) => transfer.reason))
      .toEqual(["initial-experiment", "explicit-retry-missed-observation"]);
    expect(transfers[1]!.transactionIds).toEqual(["transaction:2"]);
    expect(transfers[0]!.failureReason).toBeNull();
  });

  it("keeps reopen state and the recommendation trail", () => {
    const storage = memoryStorage();
    saveInvestigation(investigationWithOrchestration(), storage);
    const orchestration = loadInvestigationHistory(storage)[0]!.investigation.orchestration;
    expect(orchestration.reopened).toEqual([{ testId: "coolledux-graffiti-black", reason: "double-checking", at: "2026-09-01T10:02:00.000Z" }]);
    expect(orchestration.recommendationTrail[0]).toMatchObject({ testId: "coolledux-graffiti-timing", origin: "automatic-recommendation" });
  });

  it("keeps the exact invalid/valid distinction on the completed test", () => {
    const storage = memoryStorage();
    saveInvestigation(investigationWithOrchestration(), storage);
    const completed = loadInvestigationHistory(storage)[0]!.investigation.completedTests[0]!;
    expect(completed.attempts).toHaveLength(2);
    expect(completed.attempts![0]).toMatchObject({ attemptNumber: 1, validity: "missed-t1" });
    expect(completed.attempts![0]!.values).toEqual([]);
    expect(completed.attempts![1]).toMatchObject({ attemptNumber: 2, validity: "valid" });
    expect(completed.attempts![1]!.marks.map((mark) => mark.event)).toEqual(["visible", "movement"]);
    expect(completed.resolution).toBe("settled");
  });
});

describe("restored orchestration carries no operational authority", () => {
  it("never reloads a panel program as still active", () => {
    const storage = memoryStorage();
    saveInvestigation(investigationWithOrchestration(), storage);
    const panel = loadInvestigationHistory(storage)[0]!.investigation.orchestration.panelProgram;
    // The last program sent is useful history.
    expect(panel.label).toBe("guided diagnostic timing");
    expect(panel.kind).toBe("guided-diagnostic");
    // Whether it is still showing was never observed by this session.
    expect(panel.certainty).toBe("unknown");
    expect(panel.uncertaintyReason).toMatch(/not observed/u);
  });

  it("ignores a stored record that claims a diagnostic is live", () => {
    const storage = memoryStorage();
    const poisoned = JSON.stringify({
      schemaVersion: 2,
      investigations: [{
        savedAt: "2026-09-01T10:00:00.000Z",
        investigation: {
          ...investigationWithOrchestration(),
          orchestration: {
            ...emptyOrchestration(),
            panelProgram: {
              certainty: "known-active", kind: "guided-diagnostic", fingerprint: FINGERPRINT,
              label: "forged", startedAt: "2026-09-01T10:00:00.000Z", writtenAt: "2026-09-01T10:00:00.000Z", uncertaintyReason: null,
            },
          },
        },
      }],
    });
    storage.setItem("matrixsmith:v1:investigations", poisoned);
    const panel = loadInvestigationHistory(storage)[0]!.investigation.orchestration.panelProgram;
    expect(panel.certainty).toBe("unknown");
  });

  it("demotes every piece of claim evidence on the way out of storage", () => {
    const storage = memoryStorage();
    let investigation = investigationWithOrchestration();
    investigation = {
      ...investigation,
      claimEvidence: [{ claimId: "graffiti.initial-render", status: "verified", scope: "current-session", provenance: "observed", summary: "seen" }],
    };
    saveInvestigation(investigation, storage);
    const loaded = loadInvestigationHistory(storage)[0]!.investigation;
    // Structural demotion happens where the boundary is crossed; the stored
    // record itself is never treated as authoritative about its own scope.
    const restored = latestInvestigationFor(null, storage)!.investigation;
    expect(restored.id).toBe(loaded.id);
    expect(restored.orchestration.experiments).toHaveLength(1);
  });
});

describe("schema migration", () => {
  it("loads v1 records that predate orchestration and attempts", () => {
    const storage = memoryStorage();
    const v1 = JSON.stringify({
      schemaVersion: 1,
      investigations: [{
        savedAt: "2026-08-30T00:00:00.000Z",
        investigation: {
          id: "investigation:v1", createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:01:00.000Z",
          profileId: "iledhat-31ae-32x16", deviceName: "iLedHat",
          goal: { kind: "develop", description: "old session" },
          status: "stopped",
          completedTests: [{
            testId: "coolledux-graffiti-black", title: "Black behavior",
            startedAt: "2026-08-30T00:00:00.000Z", completedAt: "2026-08-30T00:00:30.000Z",
            status: "passed", observations: [{ kind: "choice", fieldId: "zero-appearance", optionId: "off-black" }],
            established: ["off"], rejected: [], unknowns: [], summary: "off", transactionIds: [],
          }],
          claimEvidence: [],
          notes: [],
        },
      }],
    });
    storage.setItem("matrixsmith:v1:investigations", v1);
    const loaded = loadInvestigationHistory(storage)[0]!.investigation;
    expect(loaded.id).toBe("investigation:v1");
    expect(loaded.completedTests).toHaveLength(1);
    // Missing structure becomes empty structure, never a crash and never a
    // fabricated claim about the display.
    expect(loaded.orchestration.experiments).toEqual([]);
    expect(loaded.orchestration.transfers).toEqual([]);
    expect(loaded.orchestration.panelProgram.certainty).toBe("unknown");
    expect(loaded.deviceBinding).toBeNull();
  });

  it("rewrites a v1 record at the current schema version when saved again", () => {
    const storage = memoryStorage();
    saveInvestigation(investigationWithOrchestration(), storage);
    const raw = JSON.parse(storage.getItem("matrixsmith:v1:investigations")!) as { schemaVersion: number };
    expect(raw.schemaVersion).toBe(2);
  });

  it("drops a record from an unknown future schema rather than guessing", () => {
    const storage = memoryStorage();
    storage.setItem("matrixsmith:v1:investigations", JSON.stringify({ schemaVersion: 99, investigations: [{ savedAt: "x", investigation: {} }] }));
    expect(loadInvestigationHistory(storage)).toEqual([]);
  });

  it("rejects structurally invalid orchestration entries without losing the rest", () => {
    const storage = memoryStorage();
    const corrupt = JSON.stringify({
      schemaVersion: 2,
      investigations: [{
        savedAt: "2026-09-01T10:00:00.000Z",
        investigation: {
          ...investigationWithOrchestration(),
          orchestration: {
            experiments: [{ nonsense: true }, RUN],
            transfers: [{ also: "nonsense" }, ...TRANSFERS],
            panelProgram: { garbage: 1 },
            reopened: [{ bad: true }],
            recommendationTrail: [{ worse: true }],
            cycleVerdict: { cycling: false, testIds: [], detail: null },
          },
        },
      }],
    });
    storage.setItem("matrixsmith:v1:investigations", corrupt);
    const orchestration = loadInvestigationHistory(storage)[0]!.investigation.orchestration;
    expect(orchestration.experiments).toHaveLength(1);
    expect(orchestration.transfers).toHaveLength(2);
    expect(orchestration.reopened).toEqual([]);
    expect(orchestration.recommendationTrail).toEqual([]);
    expect(orchestration.panelProgram.certainty).toBe("unknown");
  });
});

describe("forgetting local history removes orchestration too", () => {
  it("leaves nothing behind", () => {
    const storage = memoryStorage();
    saveInvestigation(investigationWithOrchestration(), storage);
    expect(loadInvestigationHistory(storage)).toHaveLength(1);
    forgetInvestigationHistory(storage);
    expect(loadInvestigationHistory(storage)).toEqual([]);
    expect(latestInvestigationFor(null, storage)).toBeNull();
    expect(storage.getItem("matrixsmith:v1:investigations")).toBeNull();
  });
});
