import { normalizeUuid } from "../core/device";
import {
  transmissionDigest,
  copyPreparedTransmission,
  packetHex,
  responseContractProblem,
  type AuthorizedTransmission,
  type TargetBinding,
} from "../core/transmission";
import type { TraceRecorder } from "../diagnostics/trace";
import type {
  MatrixTransport,
  TransportReceipt,
} from "../application/ports/transport";
import type { DecodedNotification, MatrixDriver } from "../drivers/types";
import {
  ResponseAmbiguityError,
  ResponseCancelledError,
  ResponseTimeoutError,
  type NotificationRecord,
  type NotificationRouter,
} from "./notifications";
import { fingerprintIdentityKey } from "../investigation/device-identity";
import type {
  ExecutionEvidence,
  PacketExecutionAttempt,
} from "./execution-evidence";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type ExecutionRecorder = Mutable<ExecutionEvidence> & {
  attempts: Mutable<PacketExecutionAttempt>[];
  receipts: TransportReceipt[];
  packetTimings: PacketTiming[];
};
const failureEvidence = new WeakMap<object, ExecutionEvidence>();

/** Returns an independent copy only for failures actually observed by execution. */
export function executionEvidence(error: unknown): ExecutionEvidence | null {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  )
    return null;
  const evidence = failureEvidence.get(error);
  return evidence ? structuredClone(evidence) : null;
}

export class IndeterminateWriteError extends Error {
  readonly indeterminate = true;
  constructor(
    readonly planId: string,
    readonly packetIndex: number,
    readonly timeoutMs: number,
  ) {
    super(
      `Transmission timed out after ${timeoutMs} ms; the write may still complete. Disconnect and reconnect before sending again.`,
    );
    this.name = "IndeterminateWriteError";
  }
}

/**
 * Real measured timing for one written packet. Reports must never replace
 * these with the plan's requested pacing: the scheduled delay is recorded
 * alongside the actual timestamps so both are inspectable.
 */
export interface PacketTiming {
  readonly index: number;
  /** Wall-clock timestamp when the write call actually started. */
  readonly writeStartedAt: string;
  /** Wall-clock timestamp when the host accepted the write. */
  readonly hostAcceptedAt: string;
  /** The pacing the plan requested after this packet, if any. */
  readonly scheduledDelayMs: number;
  /** Measured gap since the previous packet's write start (null for the first packet). */
  readonly gapSincePreviousTxMs: number | null;
}

export interface ExecutionResult {
  readonly planId: string;
  readonly receipts: readonly TransportReceipt[];
  readonly packetTimings: readonly PacketTiming[];
  readonly completedAt: string;
  readonly hostAccepted: boolean;
  readonly protocolAcknowledged: boolean | null;
  readonly deviceStateVerified: boolean;
  readonly response: DecodedNotification | null;
  readonly responseTimedOut: boolean;
  readonly responseRecord: NotificationRecord | null;
  readonly responseAmbiguous: boolean;
  /** Wall-clock timestamp of the final packet's host acceptance. */
  readonly finalWriteAcceptedAt: string | null;
  /** Present on live executor results; older stored or synthetic results may omit it. */
  readonly evidence?: ExecutionEvidence;
}

export interface ExecutionProgress {
  readonly completedPackets: number;
  readonly totalPackets: number;
  readonly elapsedMs: number;
  readonly estimatedRemainingMs: number | null;
}

export class TransmissionExecutor {
  #running = false;
  #indeterminateConnectionId: string | null = null;
  get busy(): boolean {
    return this.#running;
  }
  constructor(
    private readonly transport: MatrixTransport,
    private readonly trace: TraceRecorder,
    private readonly notifications?: NotificationRouter,
    private readonly targetBinding: () => TargetBinding | null = () =>
      currentTargetBinding(transport),
  ) {}

  async execute(
    input: AuthorizedTransmission,
    driver?: MatrixDriver,
    onProgress?: (progress: ExecutionProgress) => void,
  ): Promise<ExecutionResult> {
    if (this.#running)
      throw new Error("A transmission is already in progress.");
    this.#running = true;
    let evidence: ExecutionRecorder | null = null;
    try {
      // Own and validate the complete command before calling observers, the
      // target provider, the notification router, or transport. Caller mutations
      // after entry cannot replace the confirmed command's bytes or consequences.
      const authorized: AuthorizedTransmission = {
        plan: copyPreparedTransmission(input.plan),
        targetBinding: { ...input.targetBinding },
        digest: input.digest,
        authorizedAt: input.authorizedAt,
        policyDecision: input.policyDecision,
      };
      if (
        authorized.policyDecision !== "allow" ||
        !sameBinding(authorized.plan.targetBinding, authorized.targetBinding) ||
        authorized.digest !== authorized.plan.digest ||
        transmissionDigest(authorized.plan, authorized.targetBinding) !==
          authorized.digest
      )
        throw new Error("Authorized transmission changed after confirmation.");
      evidence = {
        planId: authorized.plan.id,
        digest: authorized.digest,
        targetBinding: { ...authorized.targetBinding },
        authorizedAt: authorized.authorizedAt,
        driverId: authorized.plan.driverId,
        profileId: authorized.plan.profileId,
        totalPackets: authorized.plan.packets.length,
        startedAt: new Date().toISOString(),
        settledAt: "",
        outcome: "completed",
        attempts: [],
        receipts: [],
        packetTimings: [],
        finalWriteAcceptedAt: null,
        failedPacketIndex: null,
        failedStage: "authorization",
        responseStatus:
          authorized.plan.responseExpectation.type === "none"
            ? "none"
            : "armed",
        responseRecord: null,
        responseTimedOut: false,
        responseAmbiguous: false,
        wholePlanDigestCount: 1,
        targetCheckCount: 0,
      };
      return await this.#executeOwned(authorized, evidence, driver, onProgress);
    } catch (error) {
      if (!evidence) throw error;
      const failure =
        (typeof error === "object" && error !== null) ||
        typeof error === "function"
          ? error
          : new Error(errorMessage(error), { cause: error });
      evidence.outcome =
        error instanceof IndeterminateWriteError ? "indeterminate" : "failed";
      evidence.settledAt = new Date().toISOString();
      failureEvidence.set(failure, structuredClone(evidence));
      throw failure;
    } finally {
      this.#running = false;
    }
  }

  async #executeOwned(
    authorized: AuthorizedTransmission,
    evidence: ExecutionRecorder,
    driver?: MatrixDriver,
    onProgress?: (progress: ExecutionProgress) => void,
  ): Promise<ExecutionResult> {
    evidence.failedStage = "response";
    const responseProblem = responseContractProblem(authorized.plan);
    if (responseProblem) throw new Error(responseProblem);
    const expectation = authorized.plan.responseExpectation;
    const responseMatches = driver?.responseMatches?.bind(driver);
    if (
      expectation.type === "notification" &&
      (!this.notifications ||
        !responseMatches ||
        driver?.id !== authorized.plan.driverId)
    )
      throw new Error("The response contract has no reviewed driver context.");
    evidence.failedStage = "authorization";
    this.#verifyCurrentTarget(authorized.targetBinding, evidence);
    const transportConnectionId = this.transport.connectionId;
    const receipts = evidence.receipts;
    const packetTimings = evidence.packetTimings;
    let previousWriteStartMs: number | null = null;
    const executionStartedMs = Date.now();
    const armed =
      expectation.type === "notification" && this.notifications && driver
        ? this.notifications.arm(
            expectation,
            (notification, expected) =>
              responseMatches?.(
                structuredClone(notification),
                structuredClone(expected),
              ) ?? false,
            authorized.targetBinding.connectionId,
          )
        : null;
    // Observe both outcomes before any write can remain pending.
    const responseOutcome = armed?.promise.then(
      (response) => {
        evidence.responseStatus = "matched";
        evidence.responseRecord = structuredClone(response);
        return { ok: true as const, response };
      },
      (error: unknown) => {
        evidence.responseTimedOut = error instanceof ResponseTimeoutError;
        evidence.responseAmbiguous = error instanceof ResponseAmbiguityError;
        evidence.responseStatus = evidence.responseTimedOut
          ? "timeout"
          : evidence.responseAmbiguous
            ? "ambiguous"
            : error instanceof ResponseCancelledError
              ? "cancelled"
              : "failed";
        if (error instanceof ResponseAmbiguityError)
          evidence.responseRecord = error.record
            ? structuredClone(error.record)
            : null;
        return { ok: false as const, error };
      },
    );
    try {
      for (const packet of authorized.plan.packets) {
        evidence.failedPacketIndex = packet.index;
        evidence.failedStage = "authorization";
        this.#verifyCurrentTarget(authorized.targetBinding, evidence);
        evidence.failedStage = "endpoint";
        if (
          !endpointAvailable(this.transport, packet.endpoint, packet.writeMode)
        )
          throw new Error(
            "Transmission endpoint is absent or has incompatible properties.",
          );
        {
          const attempt = 1;
          evidence.failedStage = "observer";
          this.trace.record(
            "tx.packet.started",
            { planId: authorized.plan.id, packetIndex: packet.index, attempt },
            packet.bytes.slice(),
          );
          let writeAttempt: Mutable<PacketExecutionAttempt> | null = null;
          try {
            const writeStartMs = Date.now();
            // An observer may synchronously disconnect or replace the target.
            evidence.failedStage = "authorization";
            this.#verifyCurrentTarget(authorized.targetBinding, evidence);
            if (
              expectation.type === "notification" &&
              packet.index === expectation.dispatchPacketIndex
            ) {
              evidence.responseStatus = "pending";
              armed?.dispatch();
            }
            evidence.failedStage = "write";
            const writeBytes = packet.bytes.slice();
            writeAttempt = {
              index: packet.index,
              attempt,
              writeStartedAt: new Date(writeStartMs).toISOString(),
              endpoint: { ...packet.endpoint },
              writeMode: packet.writeMode,
              bytes: writeBytes.slice(),
              hex: packetHex(writeBytes),
              settledAt: "",
              settlement: "failed",
              receipt: null,
              lateReceipt: null,
              timing: null,
            };
            evidence.attempts.push(writeAttempt);
            const pendingWrite = this.transport.write(
              { ...packet.endpoint },
              writeBytes,
              packet.writeMode,
            );
            const receipt = await withWriteTimeout(
              pendingWrite,
              authorized.plan.timeoutMs,
              () => {
                const error = new IndeterminateWriteError(
                  authorized.plan.id,
                  packet.index,
                  authorized.plan.timeoutMs,
                );
                writeAttempt!.settlement = "indeterminate";
                writeAttempt!.settledAt = new Date().toISOString();
                this.#indeterminateConnectionId = transportConnectionId;
                // Quarantine/trace observers must not replace the timeout error.
                try {
                  // Revoking geometry/definition authority does not retire the
                  // physical write. Quarantine its unbroken transport generation.
                  if (
                    transportConnectionId &&
                    this.transport.connectionId === transportConnectionId
                  )
                    this.transport.quarantine(error.message);
                } catch {
                  // The original indeterminate write remains the primary error.
                }
                this.#recordSecondary("tx.packet.indeterminate", {
                  planId: authorized.plan.id,
                  packetIndex: packet.index,
                  timeoutMs: authorized.plan.timeoutMs,
                });
                void pendingWrite.then(
                  (lateReceipt) =>
                    this.#recordSecondary("tx.packet.lateHostAccepted", {
                      planId: authorized.plan.id,
                      packetIndex: packet.index,
                      acceptedAt: lateReceipt.acceptedAt,
                    }),
                  (lateError: unknown) => {
                    const lateReceipt = (
                      lateError as { lateReceipt?: TransportReceipt } | null
                    )?.lateReceipt;
                    if (lateReceipt)
                      this.#recordSecondary("tx.packet.lateHostAccepted", {
                        planId: authorized.plan.id,
                        packetIndex: packet.index,
                        acceptedAt: lateReceipt.acceptedAt,
                      });
                    else
                      this.#recordSecondary("tx.packet.lateRejected", {
                        planId: authorized.plan.id,
                        packetIndex: packet.index,
                        message: errorMessage(lateError),
                      });
                  },
                );
                return error;
              },
            );
            // Record actual acceptance before any target check or observer can
            // fail. Retain receipt data independently of the transport's objects.
            const accepted = { ...receipt, endpoint: { ...receipt.endpoint } };
            receipts.push(accepted);
            const timing: PacketTiming = {
              index: packet.index,
              writeStartedAt: new Date(writeStartMs).toISOString(),
              hostAcceptedAt: accepted.acceptedAt,
              scheduledDelayMs: packet.delayAfterMs ?? 0,
              gapSincePreviousTxMs:
                previousWriteStartMs === null
                  ? null
                  : writeStartMs - previousWriteStartMs,
            };
            packetTimings.push(timing);
            writeAttempt.settlement = "accepted";
            writeAttempt.settledAt = new Date().toISOString();
            writeAttempt.receipt = accepted;
            writeAttempt.timing = timing;
            evidence.finalWriteAcceptedAt = accepted.acceptedAt;
            previousWriteStartMs = writeStartMs;
            evidence.failedStage = "authorization";
            this.#verifyCurrentTarget(authorized.targetBinding, evidence);
            evidence.failedStage = "observer";
            this.trace.record("tx.packet.hostAccepted", {
              planId: authorized.plan.id,
              packetIndex: packet.index,
              byteLength: receipt.byteLength,
              attempt,
            });
            const completedPackets = packetTimings.length;
            const elapsedMs = Date.now() - executionStartedMs;
            evidence.failedStage = "progress";
            onProgress?.({
              completedPackets,
              totalPackets: authorized.plan.packets.length,
              elapsedMs,
              estimatedRemainingMs:
                completedPackets > 0
                  ? Math.max(
                      0,
                      Math.round(
                        (elapsedMs / completedPackets) *
                          (authorized.plan.packets.length - completedPackets),
                      ),
                    )
                  : null,
            });
            // Executor-owned pacing: honor the packet's declared inter-write
            // delay (skipped after the final packet).
            if (
              packet.delayAfterMs &&
              packet.index < authorized.plan.packets.length - 1
            )
              await sleep(packet.delayAfterMs);
          } catch (error) {
            if (writeAttempt && !writeAttempt.settledAt)
              writeAttempt.settledAt = new Date().toISOString();
            if (writeAttempt && writeAttempt.settlement === "failed") {
              const lateReceipt = (
                error as { lateReceipt?: TransportReceipt } | null
              )?.lateReceipt;
              if (lateReceipt) {
                writeAttempt.lateReceipt = {
                  ...lateReceipt,
                  endpoint: { ...lateReceipt.endpoint },
                };
                this.#recordSecondary("tx.packet.lateHostAccepted", {
                  planId: authorized.plan.id,
                  packetIndex: packet.index,
                  acceptedAt: lateReceipt.acceptedAt,
                });
              }
            }
            const message = errorMessage(error);
            this.#recordSecondary("tx.packet.failed", {
              planId: authorized.plan.id,
              packetIndex: packet.index,
              message,
              attempt,
            });
            throw error;
          }
        }
      }
      let response: DecodedNotification | null = null;
      let responseTimedOut = false;
      let responseAmbiguous = false;
      let responseRecord: NotificationRecord | null = null;
      evidence.failedPacketIndex = null;
      evidence.failedStage = "authorization";
      this.#verifyCurrentTarget(authorized.targetBinding, evidence);
      evidence.failedStage = "response";
      if (responseOutcome) {
        const outcome = await responseOutcome;
        if (outcome.ok) {
          responseRecord = outcome.response;
          response = responseRecord.decoded;
        } else if (outcome.error instanceof ResponseTimeoutError) {
          responseTimedOut = true;
          this.trace.record("tx.response.timeout", {
            planId: authorized.plan.id,
            message: errorMessage(outcome.error),
          });
        } else if (outcome.error instanceof ResponseAmbiguityError) {
          responseAmbiguous = true;
          responseRecord = outcome.error.record;
          this.trace.record("tx.response.ambiguous", {
            planId: authorized.plan.id,
            message: errorMessage(outcome.error),
          });
        } else throw outcome.error;
      }
      evidence.failedStage = "authorization";
      this.#verifyCurrentTarget(authorized.targetBinding, evidence);
      evidence.failedStage = "observer";
      if (response)
        this.trace.record("tx.response.matched", {
          planId: authorized.plan.id,
          kind: response.kind,
          opcode: response.opcode ?? null,
        });
      const completedAt = new Date().toISOString();
      const protocolAcknowledged =
        expectation.type === "none" ? null : response !== null;
      const deviceStateVerified =
        response !== null &&
        expectation.type === "notification" &&
        expectation.fulfillsOperation;
      this.trace.record("tx.completed", {
        planId: authorized.plan.id,
        hostAccepted: true,
        protocolAcknowledged,
        deviceStateVerified,
      });
      evidence.settledAt = completedAt;
      evidence.failedStage = null;
      return {
        planId: authorized.plan.id,
        receipts,
        packetTimings,
        completedAt,
        hostAccepted: true,
        protocolAcknowledged,
        deviceStateVerified,
        response,
        responseTimedOut,
        responseRecord,
        responseAmbiguous,
        finalWriteAcceptedAt:
          packetTimings[packetTimings.length - 1]?.hostAcceptedAt ?? null,
        evidence: structuredClone(evidence),
      };
    } finally {
      armed?.cancel();
    }
  }

  #verifyCurrentTarget(
    binding: TargetBinding,
    evidence: ExecutionRecorder,
  ): void {
    evidence.targetCheckCount++;
    if (this.transport.state !== "connected")
      throw new Error("Cannot transmit while disconnected.");
    if (
      this.#indeterminateConnectionId &&
      this.transport.connectionId === this.#indeterminateConnectionId
    )
      throw new Error(
        "A write may still complete. Disconnect and reconnect before sending again.",
      );
    const current = this.targetBinding();
    if (!current || !sameBinding(current, binding))
      throw new Error(
        "Authorization belongs to a different connection or physical target.",
      );
  }

  #recordSecondary(
    type: Parameters<TraceRecorder["record"]>[0],
    metadata: Parameters<TraceRecorder["record"]>[1],
  ): void {
    try {
      this.trace.record(type, metadata);
    } catch {
      // An observer failure during failure reporting cannot erase the primary
      // execution error or create an unhandled late-settlement rejection.
    }
  }
}

async function withWriteTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function currentTargetBinding(
  transport: MatrixTransport,
): TargetBinding | null {
  if (!transport.connectionId || !transport.fingerprint) return null;
  return {
    connectionId: transport.connectionId,
    fingerprintKey: fingerprintIdentityKey(transport.fingerprint),
    browserDeviceId: transport.fingerprint.browserDeviceId ?? null,
  };
}

function sameBinding(a: TargetBinding, b: TargetBinding): boolean {
  return (
    a.connectionId === b.connectionId &&
    a.fingerprintKey === b.fingerprintKey &&
    a.browserDeviceId === b.browserDeviceId
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function endpointAvailable(
  transport: MatrixTransport,
  endpoint: import("../core/device").GattEndpoint,
  mode: import("../core/transmission").WriteMode,
): boolean {
  return (
    transport.fingerprint?.services.some(
      (service) =>
        normalizeUuid(service.uuid) === normalizeUuid(endpoint.serviceUuid) &&
        service.characteristics.some(
          (characteristic) =>
            normalizeUuid(characteristic.uuid) ===
              normalizeUuid(endpoint.characteristicUuid) &&
            (mode === "without-response"
              ? characteristic.properties.writeWithoutResponse
              : characteristic.properties.write),
        ),
    ) ?? false
  );
}
