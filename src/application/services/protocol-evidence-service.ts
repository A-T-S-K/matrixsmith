import type { GattEndpoint } from "../../core/device";
import type { TransmissionPlan } from "../../core/transmission";
import type { DecodedNotification } from "../../drivers/types";
import { type ExecutionResult } from "../../app/executor";
import { type NotificationRecord } from "../../app/notifications";
import { packetHex } from "../../core/transmission";
import type { TransactionSource } from "../../diagnostics/transactions";
import { transactionId } from "../../diagnostics/transactions";
import {
  candidateEndpoints,
  decodePriority,
  duration,
} from "./runtime-support";

import type { ManualObservation } from "../../core/evidence";
import { type ImportedEvidenceSummary } from "../../diagnostics/bundle";
import type { ContentCompilationRecord } from "../../diagnostics/content-evidence";
import { TraceRecorder } from "../../diagnostics/trace";

import { NotificationRouter } from "../../app/notifications";
import type { ProtocolTransaction } from "../../diagnostics/transactions";

import { INPUT_LIMITS } from "../input-limits";

import { contentCompilationId } from "../../diagnostics/content-evidence";

import type { ConnectionService } from "./connection-service";
import type { IdentificationService } from "./identification-service";
interface Ports {
  connection(): Pick<ConnectionService, "getSession">;
  identification(): Pick<
    IdentificationService,
    "getRegistry" | "_resolveProtocol"
  >;
}
export class ProtocolEvidenceService {
  private readonly trace: TraceRecorder;
  private readonly _notificationRouter = new NotificationRouter();
  private readonly _observations: ManualObservation[] = [];
  private readonly _transactions: ProtocolTransaction[] = [];
  private readonly _contentCompilations: ContentCompilationRecord[] = [];
  private readonly _importedEvidence: ImportedEvidenceSummary[] = [];
  constructor(
    private readonly ports: Ports,
    trace = new TraceRecorder(),
  ) {
    this.trace = trace;
  }
  getNotificationRouter() {
    return this._notificationRouter;
  }
  editTransactions(
    edit: (value: ProtocolEvidenceService["_transactions"]) => unknown,
  ): void {
    edit(this._transactions);
  }
  getTrace() {
    return this.trace;
  }
  getTransactions(): Readonly<ProtocolEvidenceService["_transactions"]> {
    return this._transactions;
  }
  getContentCompilations(): Readonly<
    ProtocolEvidenceService["_contentCompilations"]
  > {
    return this._contentCompilations;
  }
  getObservations(): Readonly<ProtocolEvidenceService["_observations"]> {
    return this._observations;
  }
  editObservations(
    edit: (value: ProtocolEvidenceService["_observations"]) => unknown,
  ): void {
    edit(this._observations);
  }
  getImportedEvidence(): Readonly<
    ProtocolEvidenceService["_importedEvidence"]
  > {
    return this._importedEvidence;
  }
  editContentCompilations(
    edit: (value: ProtocolEvidenceService["_contentCompilations"]) => unknown,
  ): void {
    edit(this._contentCompilations);
  }
  editImportedEvidence(
    edit: (value: ProtocolEvidenceService["_importedEvidence"]) => unknown,
  ): void {
    edit(this._importedEvidence);
  }
  _recordTransaction(
    plan: TransmissionPlan,
    result: ExecutionResult | null,
    startedAt: string,
    notificationStart: number,
    source: TransactionSource,
    diagnosticRunIdValue: string | null,
    error: string | null,
  ): void {
    const session = this.ports.connection().getSession();
    const completedAt = result?.completedAt ?? new Date().toISOString();
    const endpoint = plan.packets[0]?.endpoint ?? null;
    const timingByIndex = new Map(
      (result?.packetTimings ?? []).map((timing) => [timing.index, timing]),
    );
    // Real per-write timestamps: every packet keeps its measured write time,
    // never the transaction's start time or the plan's requested pacing.
    const tx = plan.packets.map((packet) => {
      const timing = timingByIndex.get(packet.index);
      return {
        timestamp: timing?.writeStartedAt ?? startedAt,
        direction: "TX" as const,
        hex: packet.hex,
        endpoint: packet.endpoint,
        ...(timing
          ? {
              hostAcceptedAt: timing.hostAcceptedAt,
              scheduledDelayMs: timing.scheduledDelayMs,
            }
          : {}),
        ...(timing?.gapSincePreviousTxMs !== null &&
        timing?.gapSincePreviousTxMs !== undefined
          ? { gapSincePreviousTxMs: timing.gapSincePreviousTxMs }
          : {}),
      };
    });
    const rx = session.notifications.slice(notificationStart).map((record) => ({
      timestamp: record.timestamp,
      direction: "RX" as const,
      hex: record.rawHex,
      ...(record.endpoint ? { endpoint: record.endpoint } : {}),
      relation:
        result?.response === record.decoded
          ? ("matched-response" as const)
          : record.decoded?.kind.includes("receipt")
            ? ("related-receipt" as const)
            : ("unrelated-concurrent" as const),
    }));
    this._transactions.push({
      id: transactionId(),
      startedAt,
      completedAt,
      durationMs: duration(startedAt, completedAt),
      sessionSource: session.source,
      source,
      driverId: plan.driverId,
      profileId: plan.profileId,
      operation: plan.operation.type,
      safety: {
        risk: plan.risk,
        persistence: plan.persistence,
        validation: plan.validation,
      },
      endpoint,
      packets: [...tx, ...rx],
      decodedResponse: result?.response ?? null,
      hostAccepted: result?.hostAccepted ?? false,
      protocolAcknowledged: result?.protocolAcknowledged ?? null,
      deviceStateVerified: result?.deviceStateVerified ?? false,
      responseTimedOut: result?.responseTimedOut ?? false,
      error,
      findings: result?.response ? [result.response.summary] : [],
      observationIds: [],
      diagnosticRunId: diagnosticRunIdValue,
    });
    this._trimTransactions();
  }
  _recordIncoming(
    packet: Uint8Array,
    recordTrace: boolean,
    endpoint: GattEndpoint | null,
  ): NotificationRecord {
    const session = this.ports.connection().getSession();
    const raw = packet.slice();
    if (recordTrace)
      this.trace.record("notification.raw", { byteLength: raw.length }, raw);
    const fingerprint = session.fingerprint;
    const candidates: DecodedNotification[] = [];
    if (fingerprint)
      for (const driver of this.ports.identification().getRegistry().drivers) {
        if (!driver.decodeNotification || driver.match(fingerprint).score <= 0)
          continue;
        const decoded = driver.decodeNotification(raw, {
          profile: driver.resolveProfile(fingerprint),
          fingerprint,
          source: session.source,
        });
        if (decoded) candidates.push(decoded);
      }
    const decoded =
      candidates.sort((a, b) => decodePriority(b) - decodePriority(a))[0] ??
      null;
    const record = {
      timestamp: new Date().toISOString(),
      raw,
      rawHex: packetHex(raw),
      decoded,
      ...(endpoint ? { endpoint } : {}),
    };
    session.recordNotification(record);
    if (decoded)
      this.trace.record("notification.decoded", {
        family: decoded.family,
        kind: decoded.kind,
        opcode: decoded.opcode ?? null,
        summary: decoded.summary,
        payloadHex: decoded.payloadHex,
        success: decoded.success ?? null,
        status: decoded.status ?? null,
      });
    this._notificationRouter.publish(record);
    if (decoded) this._resolveReplayEvidence(decoded);
    return record;
  }
  _resolveReplayEvidence(notification: DecodedNotification): void {
    const session = this.ports.connection().getSession();
    if (session.source === "live" || session.protocolResolution) return;
    const fingerprint = session.fingerprint;
    if (!fingerprint) return;
    for (const driver of this.ports.identification().getRegistry().drivers) {
      const context = {
        fingerprint,
        endpoints: candidateEndpoints(fingerprint),
        source: session.source,
      } as const;
      for (const probe of driver.familyProbes?.(context) ?? []) {
        const interpreted = probe.identify(
          { response: notification, responseTimedOut: false },
          context,
        );
        if (interpreted.matched) {
          this.ports
            .identification()
            ._resolveProtocol(
              driver,
              driver.resolveProfile(fingerprint),
              probe.id,
              interpreted.summary,
              "replay",
            );
          return;
        }
      }
    }
  }
  _notificationDecoder():
    ((bytes: Uint8Array) => DecodedNotification | null) | null {
    const session = this.ports.connection().getSession();
    const driver = session.selection?.selected;
    const fingerprint = session.fingerprint;
    if (!driver?.decodeNotification || !fingerprint) return null;
    return (bytes) =>
      driver.decodeNotification!(bytes, {
        profile: session.profile,
        fingerprint,
        source: session.source,
      });
  }
  _recordCompilation(
    plan: TransmissionPlan,
    extras: Partial<ContentCompilationRecord> | undefined,
    transactionId: string | null,
  ): void {
    const metadata = plan.metadata;
    const number = (key: string): number =>
      typeof metadata[key] === "number" ? (metadata[key] as number) : 0;
    const record: ContentCompilationRecord = {
      id: contentCompilationId(),
      createdAt: new Date().toISOString(),
      operation: plan.operation.type,
      contentType:
        (metadata.contentType as ContentCompilationRecord["contentType"]) ??
        "graffiti",
      profileId: plan.profileId,
      width: number("width"),
      height: number("height"),
      tileWidth: number("tileWidth"),
      tileCount: number("tileCount"),
      programBytes: number("programBytes"),
      crc32:
        typeof metadata.crc32 === "string"
          ? Number.parseInt(metadata.crc32, 16)
          : 0,
      compressedBytes: number("compressedBytes"),
      compression: metadata.compression === "lzss" ? "lzss" : "lzss-safe",
      chunkCount: number("chunkCount"),
      pacingMs: number("pacingMs"),
      ...(typeof metadata.frameCount === "number"
        ? { frameCount: metadata.frameCount }
        : {}),
      ...(transactionId ? { transactionId } : {}),
      ...extras,
    };
    this._contentCompilations.push(record);
    this.trace.record("content.compiled", {
      operation: plan.operation.type,
      programBytes: record.programBytes,
      chunkCount: record.chunkCount,
      crc32: metadata.crc32 ?? null,
    });
  }
  get observations(): readonly ManualObservation[] {
    return this._observations;
  }
  get transactions(): readonly ProtocolTransaction[] {
    return this._transactions;
  }
  get contentCompilations(): readonly ContentCompilationRecord[] {
    return this._contentCompilations;
  }
  get importedEvidence(): readonly ImportedEvidenceSummary[] {
    return this._importedEvidence;
  }
  _trimTransactions(): void {
    const overflow = this._transactions.length - INPUT_LIMITS.transactions;
    if (overflow > 0) this._transactions.splice(0, overflow);
  }
}
