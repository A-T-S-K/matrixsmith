import type { ProtocolTransaction } from "../../src/diagnostics/transactions";
export function reviewTransaction(index: number): ProtocolTransaction {
  return {
    id: `review:${index}`,
    startedAt: "2026-10-02T00:00:00.000Z",
    completedAt: "2026-10-02T00:00:01.000Z",
    durationMs: 1000,
    sessionSource: "imported",
    source: index % 2 ? "probe" : "operation",
    driverId: "review-driver",
    profileId: null,
    operation: index % 2 ? "Probe" : "Get status",
    safety: { risk: "read-only", persistence: "none", validation: "verified" },
    endpoint: null,
    packets: [
      {
        timestamp: "2026-10-02T00:00:00.000Z",
        direction: "RX",
        hex: "00 aB FF",
        relation: "matched-response",
      },
    ],
    decodedResponse: null,
    hostAccepted: true,
    protocolAcknowledged: true,
    deviceStateVerified: true,
    responseTimedOut: false,
    error: null,
    findings: [],
    observationIds: [],
    diagnosticRunId: null,
  };
}
