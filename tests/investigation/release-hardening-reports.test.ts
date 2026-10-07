import { describe, expect, it } from "vitest";
import type { ProtocolTransaction } from "../../src/diagnostics/transactions";
import { coolLedUxGuidedTests } from "../../src/drivers/coolledux/guided-tests";
import {
  generateTestReport,
  type TestReportInput,
} from "../../src/investigation/reports";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";

const startedAt = "2026-10-06T10:00:00.000Z";
const acceptedAt = "2026-10-06T10:00:00.100Z";
const test = coolLedUxGuidedTests(iledHat31aeProfile).find(
  (definition) => definition.id === "coolledux-graffiti-timing",
)!;

function transaction(
  id: string,
  options: { acceptedAt?: string; hostAccepted?: boolean } = {},
): ProtocolTransaction {
  return {
    id,
    startedAt,
    completedAt: "2026-10-06T10:00:00.200Z",
    durationMs: 200,
    sessionSource: "imported",
    source: "operation",
    driverId: "coolledux",
    profileId: iledHat31aeProfile.id,
    operation: "graffiti",
    safety: {
      risk: "persistent",
      persistence: "persistent",
      validation: "verified",
    },
    endpoint: null,
    packets: [
      {
        timestamp: startedAt,
        direction: "TX",
        hex: "01 00 02",
        ...(options.acceptedAt ? { hostAcceptedAt: options.acceptedAt } : {}),
      },
    ],
    decodedResponse: null,
    hostAccepted: options.hostAccepted ?? true,
    protocolAcknowledged: null,
    deviceStateVerified: false,
    responseTimedOut: false,
    error: options.hostAccepted === false ? "Later packet failed." : null,
    findings: [],
    observationIds: [],
    diagnosticRunId: null,
  };
}

function report(
  transactions: readonly ProtocolTransaction[],
  transactionIds = transactions.map(({ id }) => id),
): string {
  const input: TestReportInput = {
    device: {
      fingerprint: null,
      profile: iledHat31aeProfile,
      matrixsmithVersion: "test",
      liveConnected: false,
    },
    test,
    completed: {
      testId: test.id,
      title: test.title,
      startedAt,
      completedAt: "2026-10-06T10:00:02.000Z",
      status: "inconclusive",
      observations: [
        {
          kind: "duration",
          fieldId: "image-visible",
          milliseconds: 1400,
          measuredBy: "matrixsmith-timer",
        },
        {
          kind: "duration",
          fieldId: "movement-start",
          milliseconds: 4600,
          measuredBy: "matrixsmith-timer",
        },
      ],
      established: [],
      rejected: [],
      unknowns: ["Historical outcome remains unverified."],
      summary: "Historical timing observations.",
      transactionIds,
    },
    priorEvidence: [],
    why: "Inspect historical evidence without live authority.",
    transactions,
    compilation: null,
    decoder: null,
    nextRecommendation: null,
  };
  return generateTestReport(input);
}

describe("retained report evidence", () => {
  it("distinguishes no links from unavailable links and retained subsets", () => {
    expect(report([], [])).toContain("No transactions referenced.");
    const missing = report([], ["evicted", "evicted"]);
    expect(missing).toContain("1 referenced transaction(s) were evicted");
    expect(missing).not.toContain("No transactions referenced.");
    const partial = report([transaction("retained")], ["retained", "evicted"]);
    expect(partial).toContain("(id retained)");
    expect(partial).toContain("1 referenced transaction(s) were evicted");
    expect(partial).toContain("cannot be reconstructed");
  });

  it("does not promote a historical write-start timestamp to accepted T0", () => {
    const text = report([transaction("legacy")]);
    expect(text).toContain("Upload final write accepted (T0): not captured");
    expect(text).toContain("T0 is unavailable");
    expect(text).not.toContain("Render latency (T1 − T0):");
    expect(text).toContain("Visible static hold (T2 − T1):");
  });

  it("does not use an accepted prefix or earlier complete upload as T0", () => {
    const text = report([
      transaction("earlier", { acceptedAt }),
      transaction("partial", { acceptedAt, hostAccepted: false }),
    ]);
    expect(text).toContain("Upload final write accepted (T0): not captured");
    expect(text).not.toContain("Render latency (T1 − T0):");
    expect(text).toContain("accepted prefix does not establish");
  });

  it("retains measured acceptance and human timing for a complete upload", () => {
    const text = report([transaction("complete", { acceptedAt })]);
    expect(text).toContain(`Upload final write accepted (T0): ${acceptedAt}`);
    expect(text).toContain("Render latency (T1 − T0):");
    expect(text).toContain("human reaction delay");
  });

  it("leaves T0 unavailable when final packet timing or referenced history is missing", () => {
    const complete = transaction("complete", { acceptedAt });
    const finalTimingMissing = report([
      {
        ...complete,
        packets: [
          ...complete.packets,
          { timestamp: startedAt, direction: "TX", hex: "03" },
        ],
      },
    ]);
    expect(finalTimingMissing).toContain(
      "Upload final write accepted (T0): not captured",
    );
    const missingHistory = report([complete], ["complete", "evicted"]);
    expect(missingHistory).toContain(
      "Upload final write accepted (T0): not captured",
    );
    expect(missingHistory).not.toContain("Render latency (T1 − T0):");
  });
});
