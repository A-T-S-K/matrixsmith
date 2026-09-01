import type { AuthorizedTransmission } from "../core/transmission";
import type { TraceRecorder } from "../diagnostics/trace";
import type { MatrixTransport, TransportReceipt } from "../transport/types";
import type { DecodedNotification, MatrixDriver } from "../drivers/types";
import type { NotificationRouter } from "./notifications";

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
  /** Wall-clock timestamp of the final packet's host acceptance. */
  readonly finalWriteAcceptedAt: string | null;
}

export interface ExecutionProgress { readonly completedPackets: number; readonly totalPackets: number; readonly elapsedMs: number; readonly estimatedRemainingMs: number | null }

export class TransmissionExecutor {
  #running = false;
  constructor(private readonly transport: MatrixTransport, private readonly trace: TraceRecorder, private readonly notifications?: NotificationRouter) {}

  async execute(authorized: AuthorizedTransmission, driver?: MatrixDriver, onProgress?: (progress: ExecutionProgress) => void): Promise<ExecutionResult> {
    if (this.#running) throw new Error("A transmission is already in progress.");
    if (this.transport.state !== "connected") throw new Error("Cannot transmit while disconnected.");
    this.#running = true;
    const receipts: TransportReceipt[] = [];
    const packetTimings: PacketTiming[] = [];
    let previousWriteStartMs: number | null = null;
    const expectation = authorized.plan.responseExpectation;
    const executionStartedMs = Date.now();
    const armed = expectation.type === "notification" && this.notifications && driver
      ? this.notifications.arm(expectation, (notification, expected) => driver.responseMatches?.(notification, expected) ?? false)
      : null;
    try {
      for (const packet of authorized.plan.packets) {
        if (!endpointAvailable(this.transport, packet.endpoint, packet.writeMode)) throw new Error("Transmission endpoint is absent or has incompatible properties.");
        const maxAttempts = Math.max(1, Math.min(5, authorized.plan.retryPolicy.maxAttempts));
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          this.trace.record("tx.packet.started", { planId: authorized.plan.id, packetIndex: packet.index, attempt }, packet.bytes);
          try {
            const writeStartMs = Date.now();
            const receipt = await withTimeout(this.transport.write(packet.endpoint, packet.bytes, packet.writeMode), authorized.plan.timeoutMs);
            receipts.push(receipt);
            packetTimings.push({
              index: packet.index,
              writeStartedAt: new Date(writeStartMs).toISOString(),
              hostAcceptedAt: receipt.acceptedAt,
              scheduledDelayMs: packet.delayAfterMs ?? 0,
              gapSincePreviousTxMs: previousWriteStartMs === null ? null : writeStartMs - previousWriteStartMs,
            });
            previousWriteStartMs = writeStartMs;
            this.trace.record("tx.packet.hostAccepted", { planId: authorized.plan.id, packetIndex: packet.index, byteLength: receipt.byteLength, attempt });
            const completedPackets = packetTimings.length; const elapsedMs = Date.now() - executionStartedMs;
            onProgress?.({ completedPackets, totalPackets: authorized.plan.packets.length, elapsedMs, estimatedRemainingMs: completedPackets > 0 ? Math.max(0, Math.round(elapsedMs / completedPackets * (authorized.plan.packets.length - completedPackets))) : null });
            // Executor-owned pacing: honor the packet's declared inter-write
            // delay (skipped after the final packet).
            if (packet.delayAfterMs && packet.index < authorized.plan.packets.length - 1) await sleep(packet.delayAfterMs);
            break;
          } catch (error) {
            const message = errorMessage(error);
            this.trace.record("tx.packet.failed", { planId: authorized.plan.id, packetIndex: packet.index, message, attempt });
            const retryable = attempt < maxAttempts && authorized.plan.retryPolicy.retryOn.some((condition) => message.includes(condition));
            if (!retryable) throw error;
          }
        }
      }
      let response: DecodedNotification | null = null;
      let responseTimedOut = false;
      if (armed) {
        try { response = await armed.promise; } catch (error) {
          responseTimedOut = true;
          this.trace.record("tx.response.timeout", { planId: authorized.plan.id, message: errorMessage(error) });
        }
      }
      if (response) this.trace.record("tx.response.matched", { planId: authorized.plan.id, kind: response.kind, opcode: response.opcode ?? null });
      const completedAt = new Date().toISOString();
      const protocolAcknowledged = expectation.type === "none" ? null : response !== null;
      const deviceStateVerified = response !== null && expectation.type === "notification" && expectation.fulfillsOperation;
      this.trace.record("tx.completed", { planId: authorized.plan.id, hostAccepted: true, protocolAcknowledged, deviceStateVerified });
      return {
        planId: authorized.plan.id, receipts, packetTimings, completedAt,
        hostAccepted: true, protocolAcknowledged, deviceStateVerified, response, responseTimedOut,
        finalWriteAcceptedAt: packetTimings[packetTimings.length - 1]?.hostAcceptedAt ?? null,
      };
    } finally {
      armed?.cancel();
      this.#running = false;
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(`Transmission timed out after ${timeoutMs} ms.`)), timeoutMs); }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

function endpointAvailable(transport: MatrixTransport, endpoint: import("../core/device").GattEndpoint, mode: import("../core/transmission").WriteMode): boolean {
  return transport.fingerprint?.services.some((service) => service.uuid.toLowerCase() === endpoint.serviceUuid.toLowerCase()
    && service.characteristics.some((characteristic) => characteristic.uuid.toLowerCase() === endpoint.characteristicUuid.toLowerCase()
      && (mode === "without-response" ? characteristic.properties.writeWithoutResponse : characteristic.properties.write))) ?? false;
}
