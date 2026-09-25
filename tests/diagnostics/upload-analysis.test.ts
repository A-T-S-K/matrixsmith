import { describe, expect, it } from "vitest";
import {
  analyzeStoredProgramUpload,
  describeUploadAnalysis,
} from "../../src/diagnostics/upload-analysis";
import { decodeCoolLedUxNotification } from "../../src/drivers/coolledux/notifications";
import { encodeEnvelope } from "../../src/drivers/coolled/common/envelope";
import { packetHex } from "../../src/core/transmission";
import type {
  ProtocolTransaction,
  TransactionPacket,
} from "../../src/diagnostics/transactions";

const ENDPOINT = {
  serviceUuid: "0000fff0-0000-1000-8000-00805f9b34fb",
  characteristicUuid: "0000fff1-0000-1000-8000-00805f9b34fb",
};

function announceReceiptHex(statusRaw = 0x00): string {
  return packetHex(encodeEnvelope(Uint8Array.of(0x02, statusRaw)));
}
function chunkReceiptHex(index: number, statusRaw = 0x00): string {
  return packetHex(
    encodeEnvelope(
      Uint8Array.of(0x03, 0x00, (index >> 8) & 0xff, index & 0xff, statusRaw),
    ),
  );
}

function txPacket(
  index: number,
  baseMs: number,
  gapMs = 60,
): TransactionPacket {
  const at = baseMs + index * gapMs;
  return {
    timestamp: new Date(at).toISOString(),
    direction: "TX",
    hex: "01 00 02 05 1F 03",
    endpoint: ENDPOINT,
    hostAcceptedAt: new Date(at + 5).toISOString(),
    scheduledDelayMs: 60,
    ...(index > 0 ? { gapSincePreviousTxMs: gapMs } : {}),
  };
}

function rxPacket(hex: string, atMs: number): TransactionPacket {
  return {
    timestamp: new Date(atMs).toISOString(),
    direction: "RX",
    hex,
    endpoint: ENDPOINT,
  };
}

function makeTransaction(
  packets: readonly TransactionPacket[],
): ProtocolTransaction {
  return {
    id: "transaction:test",
    startedAt: packets[0]?.timestamp ?? new Date(0).toISOString(),
    completedAt: new Date(10_000).toISOString(),
    durationMs: 1000,
    sessionSource: "live",
    source: "operation",
    driverId: "coolledux",
    profileId: "iledhat-31ae-32x16",
    operation: "ShowFrame",
    safety: {
      risk: "persistent",
      persistence: "persistent",
      validation: "experimental",
    },
    endpoint: ENDPOINT,
    packets,
    decodedResponse: null,
    hostAccepted: true,
    protocolAcknowledged: null,
    deviceStateVerified: false,
    responseTimedOut: false,
    error: null,
    findings: [],
    observationIds: [],
    diagnosticRunId: null,
  };
}

describe("CoolLEDUX stored-program receipt decoding", () => {
  it("decodes the announce-style receipt structurally without success semantics", () => {
    const decoded = decodeCoolLedUxNotification(
      encodeEnvelope(Uint8Array.of(0x02, 0x00)),
    );
    expect(decoded?.kind).toBe("program-announce-receipt");
    expect(decoded?.fields.statusRaw).toBe(0);
    expect(decoded?.summary).toContain("semantics unmapped");
    expect(decoded?.summary).not.toMatch(/success/i);
  });

  it("decodes chunk-style receipts with a structural chunk index and raw status", () => {
    const decoded = decodeCoolLedUxNotification(
      encodeEnvelope(Uint8Array.of(0x03, 0x00, 0x00, 0x02, 0x00)),
    );
    expect(decoded?.kind).toBe("program-chunk-receipt");
    expect(decoded?.fields.chunkIndex).toBe(2);
    expect(decoded?.fields.statusRaw).toBe(0);
    expect(decoded?.summary).toContain(
      "not a reliable per-chunk acknowledgement",
    );
  });

  it("decodes the physically observed announce receipt bytes 01 00 02 06 02 06 00 03", () => {
    const decoded = decodeCoolLedUxNotification(
      Uint8Array.of(0x01, 0x00, 0x02, 0x06, 0x02, 0x06, 0x00, 0x03),
    );
    expect(decoded?.kind).toBe("program-announce-receipt");
    expect(decoded?.payloadHex).toBe("02 00");
  });

  it("still decodes brightness echoes and device info normally", () => {
    const brightness = decodeCoolLedUxNotification(
      encodeEnvelope(Uint8Array.of(0x04, 0x40)),
    );
    expect(brightness?.kind).toBe("command-echo");
    const info = decodeCoolLedUxNotification(
      encodeEnvelope(Uint8Array.of(0x1f, 0x01, 0xcc)),
    );
    expect(info?.kind).toBe("device-info");
  });
});

describe("analyzeStoredProgramUpload", () => {
  const base = Date.parse("2026-08-31T12:00:00.000Z");

  it("correlates observed chunk receipts and reports missing ones as observations, not failures", () => {
    const packets: TransactionPacket[] = [
      ...Array.from({ length: 5 }, (_, index) => txPacket(index, base)),
      rxPacket(announceReceiptHex(), base + 400),
      rxPacket(chunkReceiptHex(0), base + 450),
      rxPacket(chunkReceiptHex(2), base + 500),
      rxPacket(chunkReceiptHex(3), base + 550),
    ];
    const analysis = analyzeStoredProgramUpload(
      makeTransaction(packets),
      4,
      decodeCoolLedUxNotification,
    );
    expect(analysis.receipts.expectedChunks).toBe(4);
    expect(analysis.receipts.announceReceiptsObserved).toBe(1);
    expect(analysis.receipts.observedChunkIndices).toEqual([0, 2, 3]);
    expect(analysis.receipts.missingChunkIndices).toEqual([1]);
    expect(analysis.receipts.rawStatuses).toEqual([0]);
    const description = describeUploadAnalysis(analysis).join("\n");
    expect(description).toContain("not treated as a transmission failure");
    expect(description).not.toMatch(/\bfailed\b/i);
  });

  it("flags out-of-range chunk indices without inventing meaning", () => {
    const packets: TransactionPacket[] = [
      txPacket(0, base),
      rxPacket(chunkReceiptHex(9), base + 100),
    ];
    const analysis = analyzeStoredProgramUpload(
      makeTransaction(packets),
      2,
      decodeCoolLedUxNotification,
    );
    expect(analysis.receipts.unexpectedChunkIndices).toEqual([9]);
    expect(analysis.receipts.missingChunkIndices).toEqual([0, 1]);
  });

  it("summarizes measured timing from real per-packet timestamps", () => {
    const packets: TransactionPacket[] = [
      ...Array.from({ length: 4 }, (_, index) => txPacket(index, base)),
      rxPacket(announceReceiptHex(), base + 3 * 60 + 5 + 120),
    ];
    const analysis = analyzeStoredProgramUpload(
      makeTransaction(packets),
      3,
      decodeCoolLedUxNotification,
    );
    expect(analysis.timing.packetCount).toBe(4);
    expect(analysis.timing.minTxGapMs).toBe(60);
    expect(analysis.timing.maxTxGapMs).toBe(60);
    expect(analysis.timing.averageTxGapMs).toBe(60);
    expect(analysis.timing.requestedPacingMs).toBe(60);
    expect(analysis.timing.totalUploadMs).toBe(3 * 60 + 5);
    expect(analysis.timing.firstReceiptLatencyMs).toBe(120);
  });

  it("keeps raw non-zero status bytes verbatim", () => {
    const packets: TransactionPacket[] = [
      txPacket(0, base),
      rxPacket(chunkReceiptHex(0, 0x7f), base + 90),
    ];
    const analysis = analyzeStoredProgramUpload(
      makeTransaction(packets),
      1,
      decodeCoolLedUxNotification,
    );
    expect(analysis.receipts.rawStatuses).toEqual([0x7f]);
    expect(describeUploadAnalysis(analysis).join("\n")).toContain("0x7f");
  });
});
