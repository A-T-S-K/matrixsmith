import type { GattEndpoint } from "../../core/device";
import type { TransmissionPlan } from "../../core/transmission";
import type { DecodedNotification } from "../../drivers/types";
import { type ExecutionResult } from "../../app/executor";
import type { ExecutionEvidence } from "../../app/execution-evidence";
import {
  endpointKey,
  RESPONSE_AMBIGUITY_MESSAGE,
  type ResponseContext,
  type NotificationRecord,
} from "../../app/notifications";
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
  private transactionRevision = 0;
  private compilationRevision = 0;
  get revisions() {
    return {
      transactions: this.transactionRevision,
      compilations: this.compilationRevision,
    };
  }
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
    try {
      edit(this._transactions);
    } finally {
      this.transactionRevision++;
    }
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
    try {
      edit(this._contentCompilations);
    } finally {
      this.compilationRevision++;
    }
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
    sessionSource: ProtocolTransaction["sessionSource"] = this.ports
      .connection()
      .getSession().source,
    failureEvidence: ExecutionEvidence | null = null,
  ): ProtocolTransaction {
    const session = this.ports.connection().getSession();
    const evidence = result?.evidence ?? failureEvidence;
    const completedAt =
      evidence?.settledAt ?? result?.completedAt ?? new Date().toISOString();
    const endpoint =
      evidence?.attempts[0]?.endpoint ?? plan.packets[0]?.endpoint ?? null;
    // Planned bytes never establish TX. These are private dispatch snapshots,
    // including rejected/indeterminate calls, preserved independently of plans.
    const tx = (evidence?.attempts ?? []).map((attempt, index, attempts) => {
      const timing = attempt.timing;
      const acceptedAt =
        timing?.hostAcceptedAt ?? attempt.lateReceipt?.acceptedAt;
      const previous = attempts[index - 1];
      const gap = previous
        ? Math.max(
            0,
            Date.parse(attempt.writeStartedAt) -
              Date.parse(previous.writeStartedAt),
          )
        : null;
      return {
        timestamp: attempt.writeStartedAt,
        direction: "TX" as const,
        hex: attempt.hex,
        endpoint: { ...attempt.endpoint },
        ...(acceptedAt ? { hostAcceptedAt: acceptedAt } : {}),
        ...(timing ? { scheduledDelayMs: timing.scheduledDelayMs } : {}),
        ...(gap !== null ? { gapSincePreviousTxMs: gap } : {}),
      };
    });
    const records = session.notifications.filter(
      (record) =>
        record.receiveSequence !== undefined &&
        record.receiveSequence > notificationStart,
    );
    // The selected record stays attributable even if the bounded UI collection evicts it.
    const responseRecord = result?.responseRecord ?? evidence?.responseRecord;
    const responseAmbiguous =
      evidence?.responseAmbiguous ?? result?.responseAmbiguous ?? false;
    const retainedResponse =
      responseRecord &&
      records.find(
        (record) =>
          record === responseRecord ||
          (record.receiveSequence !== undefined &&
            record.receiveSequence === responseRecord.receiveSequence &&
            record.connectionGeneration ===
              responseRecord.connectionGeneration &&
            record.timestamp === responseRecord.timestamp &&
            record.rawHex === responseRecord.rawHex &&
            record.endpoint &&
            responseRecord.endpoint &&
            endpointKey(record.endpoint) ===
              endpointKey(responseRecord.endpoint)),
      );
    if (responseRecord && !retainedResponse) records.push(responseRecord);
    const correlatedRecord = retainedResponse ?? responseRecord;
    records.sort((a, b) => (a.receiveSequence ?? 0) - (b.receiveSequence ?? 0));
    const receiptEndpoints =
      plan.responseExpectation.type === "notification"
        ? plan.responseExpectation.endpoints
        : plan.packets.map((packet) => packet.endpoint);
    const rx = records.map((record) => ({
      timestamp: record.timestamp,
      direction: "RX" as const,
      hex: record.rawHex,
      ...(record.endpoint ? { endpoint: record.endpoint } : {}),
      relation:
        correlatedRecord === record && !responseAmbiguous
          ? ("matched-response" as const)
          : record.decoded?.kind.includes("receipt") &&
              record.endpoint &&
              receiptEndpoints.some(
                (endpoint) =>
                  endpointKey(endpoint) === endpointKey(record.endpoint!),
              )
            ? ("related-receipt" as const)
            : ("unrelated-concurrent" as const),
    }));
    const matchedResponse =
      responseRecord?.decoded && !responseAmbiguous
        ? responseRecord.decoded
        : null;
    const hostAccepted = Boolean(
      evidence &&
      evidence.totalPackets > 0 &&
      evidence.attempts.length === evidence.totalPackets &&
      evidence.attempts.every(({ settlement }) => settlement === "accepted"),
    );
    const executionFindings = (evidence?.attempts ?? []).flatMap((attempt) =>
      attempt.lateReceipt
        ? [
            `Packet ${attempt.index} received late host acceptance in a retired execution; this is historical evidence only.`,
          ]
        : attempt.settlement === "indeterminate"
          ? [
              `Packet ${attempt.index} dispatch is indeterminate. Disconnect, reconnect and review before any new send; do not automatically retry.`,
            ]
          : attempt.settlement === "failed"
            ? [
                `Packet ${attempt.index} dispatch failed; host acceptance was not observed.`,
              ]
            : [],
    );
    const transaction: ProtocolTransaction = {
      id: transactionId(),
      startedAt,
      completedAt,
      durationMs: duration(startedAt, completedAt),
      sessionSource,
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
      decodedResponse: responseAmbiguous
        ? null
        : (matchedResponse ?? result?.response ?? null),
      hostAccepted,
      protocolAcknowledged:
        plan.responseExpectation.type === "none"
          ? null
          : Boolean(matchedResponse),
      deviceStateVerified: Boolean(
        matchedResponse &&
        plan.responseExpectation.type === "notification" &&
        plan.responseExpectation.fulfillsOperation,
      ),
      responseTimedOut:
        evidence?.responseTimedOut ?? result?.responseTimedOut ?? false,
      error,
      findings: [
        ...(responseAmbiguous
          ? [RESPONSE_AMBIGUITY_MESSAGE]
          : matchedResponse
            ? [matchedResponse.summary]
            : []),
        ...executionFindings,
      ],
      observationIds: [],
      diagnosticRunId: diagnosticRunIdValue,
    };
    this._transactions.push(transaction);
    this.transactionRevision++;
    this._trimTransactions();
    return transaction;
  }
  _recordIncoming(
    packet: Uint8Array,
    recordTrace: boolean,
    endpoint: GattEndpoint | null,
    recordedAt?: string,
    liveContext?: ResponseContext,
  ): NotificationRecord {
    const session = this.ports.connection().getSession();
    const raw = packet.slice();
    const timestamp = recordedAt ?? new Date().toISOString();
    const fingerprint = session.fingerprint;
    const candidates: DecodedNotification[] = [];
    const familyInterpretations: DecodedNotification[] = [];
    if (fingerprint)
      for (const driver of this.ports.identification().getRegistry().drivers) {
        if (!driver.decodeNotification || driver.match(fingerprint).score <= 0)
          continue;
        const decoded = driver.decodeNotification(raw, {
          profile: driver.resolveProfile(fingerprint),
          fingerprint,
          source: session.source,
        });
        if (decoded) {
          candidates.push(decoded);
          if (
            !decoded.envelopeError &&
            (
              driver.familyProbes?.({
                fingerprint,
                endpoints: candidateEndpoints(fingerprint),
                source: session.source,
              }) ?? []
            ).some((probe) => {
              const meaning = probe.identify(
                { response: decoded, responseTimedOut: false },
                {
                  fingerprint,
                  endpoints: candidateEndpoints(fingerprint),
                  source: session.source,
                },
              );
              return meaning.matched || !!meaning.rejection;
            })
          )
            familyInterpretations.push(decoded);
        }
      }
    // Only reviewed family interpretations compete for identity. A generic
    // unmapped envelope decoder is not an alternative family interpretation.
    // Preserve ordinary control decoding; no global priority may choose between
    // contradictory reviewed identity interpretations.
    const distinct = new Map(
      familyInterpretations.map((candidate) => [
        JSON.stringify(candidate),
        candidate,
      ]),
    );
    const interpretationAmbiguous = distinct.size > 1;
    const decoded = interpretationAmbiguous
      ? null
      : ([...distinct.values()][0] ??
        candidates.sort((a, b) => decodePriority(b) - decodePriority(a))[0] ??
        null);
    const incoming = {
      timestamp,
      raw,
      rawHex: packetHex(raw),
      decoded,
      interpretationAmbiguous,
      ...(interpretationAmbiguous
        ? { competingInterpretations: [...distinct.values()] }
        : {}),
      ...(endpoint ? { endpoint: { ...endpoint } } : {}),
    };
    const record =
      liveContext && session.source === "live"
        ? this._notificationRouter.recordLive(incoming, liveContext)
        : incoming;
    session.recordNotification(record);
    // Receive ownership and response settlement must precede observer callbacks.
    // A slow/throwing presentation observer cannot erase or delay attribution.
    this._notificationRouter.publish(record);
    if (decoded) this._resolveReplayEvidence(decoded);
    if (recordTrace)
      this.trace.record("notification.raw", { byteLength: raw.length }, raw);
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
      ...extras,
      // Caller-authored compilation metadata cannot replace execution ownership.
      ...(transactionId ? { transactionId } : {}),
    };
    this._contentCompilations.push(record);
    this.compilationRevision++;
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
    if (overflow > 0) {
      this._transactions.splice(0, overflow);
      this.transactionRevision++;
    }
  }
}
