import type { DecodedNotification } from "../drivers/types";
import type { ProtocolTransaction, TransactionPacket } from "./transactions";

/**
 * Stored-program upload analysis: correlates transmitted chunk packets with
 * the receipt notifications the device happened to emit, and summarizes real
 * measured write timing. Upstream evidence (coolledux-ble@4f5656d) is
 * explicit that these notifications are NOT reliable per-chunk
 * acknowledgements, so a missing receipt is reported as an observation —
 * never as a transmission failure, and never as a reason to retry a
 * persistent write.
 */

export interface UploadReceiptSummary {
  /** Data chunks the plan transmitted (excluding the announce packet). */
  readonly expectedChunks: number;
  readonly announceReceiptsObserved: number;
  readonly chunkReceiptsObserved: number;
  readonly observedChunkIndices: readonly number[];
  readonly missingChunkIndices: readonly number[];
  /** Receipts whose structurally-read chunk index is outside the transmitted range. */
  readonly unexpectedChunkIndices: readonly number[];
  /** Distinct raw status bytes seen, reported verbatim without success/failure judgement. */
  readonly rawStatuses: readonly number[];
  readonly otherReceipts: number;
}

export interface UploadTimingSummary {
  readonly packetCount: number;
  /** First write start to last host acceptance, in ms. */
  readonly totalUploadMs: number | null;
  readonly minTxGapMs: number | null;
  readonly averageTxGapMs: number | null;
  readonly maxTxGapMs: number | null;
  readonly requestedPacingMs: number | null;
  readonly receiptCount: number;
  /** Final TX host acceptance to first subsequent RX, in ms. */
  readonly firstReceiptLatencyMs: number | null;
  readonly lastReceiptAt: string | null;
}

export interface StoredProgramUploadAnalysis {
  readonly receipts: UploadReceiptSummary;
  readonly timing: UploadTimingSummary;
}

export type NotificationDecoder = (bytes: Uint8Array) => DecodedNotification | null;

export function analyzeStoredProgramUpload(
  transaction: ProtocolTransaction,
  chunkCount: number,
  decode: NotificationDecoder,
): StoredProgramUploadAnalysis {
  const txPackets = transaction.packets.filter((packet) => packet.direction === "TX");
  const rxPackets = transaction.packets.filter((packet) => packet.direction === "RX");
  const decoded = rxPackets.map((packet) => ({ packet, notification: decodeHex(packet.hex, decode) }));

  let announceReceiptsObserved = 0;
  let otherReceipts = 0;
  const observedChunkIndices: number[] = [];
  const unexpectedChunkIndices: number[] = [];
  const rawStatuses = new Set<number>();
  for (const { notification } of decoded) {
    if (!notification) { otherReceipts += 1; continue; }
    if (notification.kind === "program-announce-receipt") {
      announceReceiptsObserved += 1;
      if (typeof notification.status === "number") rawStatuses.add(notification.status);
    } else if (notification.kind === "program-chunk-receipt") {
      const index = typeof notification.fields.chunkIndex === "number" ? notification.fields.chunkIndex : null;
      if (index !== null) (index >= 0 && index < chunkCount ? observedChunkIndices : unexpectedChunkIndices).push(index);
      if (typeof notification.status === "number") rawStatuses.add(notification.status);
    } else {
      otherReceipts += 1;
    }
  }
  const observedSet = new Set(observedChunkIndices);
  const missingChunkIndices: number[] = [];
  for (let index = 0; index < chunkCount; index += 1) if (!observedSet.has(index)) missingChunkIndices.push(index);

  return {
    receipts: {
      expectedChunks: chunkCount,
      announceReceiptsObserved,
      chunkReceiptsObserved: observedChunkIndices.length + unexpectedChunkIndices.length,
      observedChunkIndices, missingChunkIndices, unexpectedChunkIndices,
      rawStatuses: [...rawStatuses].sort((a, b) => a - b),
      otherReceipts,
    },
    timing: timingSummary(txPackets, rxPackets),
  };
}

function timingSummary(txPackets: readonly TransactionPacket[], rxPackets: readonly TransactionPacket[]): UploadTimingSummary {
  const gaps = txPackets.map((packet) => packet.gapSincePreviousTxMs).filter((gap): gap is number => typeof gap === "number");
  const firstTx = txPackets[0];
  const lastTx = txPackets[txPackets.length - 1];
  const lastAccepted = lastTx?.hostAcceptedAt ?? lastTx?.timestamp ?? null;
  const totalUploadMs = firstTx && lastAccepted ? Math.max(0, Date.parse(lastAccepted) - Date.parse(firstTx.timestamp)) : null;
  const requestedPacing = txPackets.find((packet) => typeof packet.scheduledDelayMs === "number" && packet.scheduledDelayMs > 0)?.scheduledDelayMs ?? null;
  const firstRxAfterFinal = lastAccepted
    ? rxPackets.map((packet) => Date.parse(packet.timestamp)).filter((time) => Number.isFinite(time) && time >= Date.parse(lastAccepted)).sort((a, b) => a - b)[0] ?? null
    : null;
  const lastRx = rxPackets[rxPackets.length - 1]?.timestamp ?? null;
  return {
    packetCount: txPackets.length,
    totalUploadMs,
    minTxGapMs: gaps.length ? Math.min(...gaps) : null,
    averageTxGapMs: gaps.length ? Math.round(gaps.reduce((total, gap) => total + gap, 0) / gaps.length) : null,
    maxTxGapMs: gaps.length ? Math.max(...gaps) : null,
    requestedPacingMs: requestedPacing,
    receiptCount: rxPackets.length,
    firstReceiptLatencyMs: firstRxAfterFinal !== null && lastAccepted ? firstRxAfterFinal - Date.parse(lastAccepted) : null,
    lastReceiptAt: lastRx,
  };
}

export function describeUploadAnalysis(analysis: StoredProgramUploadAnalysis): readonly string[] {
  const { receipts, timing } = analysis;
  const lines = [
    `Receipts: ${receipts.announceReceiptsObserved} announce-style, ${receipts.chunkReceiptsObserved}/${receipts.expectedChunks} chunk-style observed.`,
  ];
  if (receipts.missingChunkIndices.length > 0) lines.push(`No receipt observed for chunk index(es) ${formatIndexList(receipts.missingChunkIndices)} — not treated as a transmission failure (receipts are not reliable acknowledgements).`);
  if (receipts.unexpectedChunkIndices.length > 0) lines.push(`Receipts referenced out-of-range chunk index(es) ${formatIndexList(receipts.unexpectedChunkIndices)}.`);
  if (receipts.rawStatuses.length > 0) lines.push(`Raw status byte(s) observed: ${receipts.rawStatuses.map((status) => `0x${status.toString(16).padStart(2, "0")}`).join(", ")} (semantics unmapped).`);
  if (timing.totalUploadMs !== null) lines.push(`Upload: ${timing.packetCount} packet(s) over ${timing.totalUploadMs} ms; TX gaps min/avg/max ${timing.minTxGapMs ?? "—"}/${timing.averageTxGapMs ?? "—"}/${timing.maxTxGapMs ?? "—"} ms (requested pacing ${timing.requestedPacingMs ?? "none"} ms).`);
  if (timing.firstReceiptLatencyMs !== null) lines.push(`First receipt arrived ${timing.firstReceiptLatencyMs} ms after the final host-accepted write.`);
  return lines;
}

function formatIndexList(indices: readonly number[]): string {
  if (indices.length <= 8) return indices.join(", ");
  return `${indices.slice(0, 8).join(", ")}, … (${indices.length} total)`;
}

function decodeHex(hex: string, decode: NotificationDecoder): DecodedNotification | null {
  const cleaned = hex.replace(/\s+/g, "");
  if (cleaned.length === 0 || cleaned.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(cleaned)) return null;
  return decode(Uint8Array.from(cleaned.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16)));
}
