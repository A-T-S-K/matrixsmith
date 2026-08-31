import type { AuthorizedTransmission } from "../core/transmission";
import type { TraceRecorder } from "../diagnostics/trace";
import type { MatrixTransport, TransportReceipt } from "../transport/types";

export interface ExecutionResult {
  readonly planId: string;
  readonly receipts: readonly TransportReceipt[];
  readonly completedAt: string;
  readonly deviceVerified: false;
}

export class TransmissionExecutor {
  #running = false;
  constructor(private readonly transport: MatrixTransport, private readonly trace: TraceRecorder) {}

  async execute(authorized: AuthorizedTransmission): Promise<ExecutionResult> {
    if (this.#running) throw new Error("A transmission is already in progress.");
    if (this.transport.state !== "connected") throw new Error("Cannot transmit while disconnected.");
    this.#running = true;
    const receipts: TransportReceipt[] = [];
    try {
      for (const packet of authorized.plan.packets) {
        this.trace.record("tx.packet.started", { planId: authorized.plan.id, packetIndex: packet.index }, packet.bytes);
        try {
          const receipt = await withTimeout(
            this.transport.write(packet.endpoint, packet.bytes, packet.writeMode),
            authorized.plan.timeoutMs,
          );
          receipts.push(receipt);
          this.trace.record("tx.packet.hostAccepted", { planId: authorized.plan.id, packetIndex: packet.index, byteLength: receipt.byteLength });
        } catch (error) {
          this.trace.record("tx.packet.failed", { planId: authorized.plan.id, packetIndex: packet.index, message: errorMessage(error) });
          throw error;
        }
      }
      const completedAt = new Date().toISOString();
      this.trace.record("tx.completed", { planId: authorized.plan.id, hostAccepted: true, deviceVerified: false });
      return { planId: authorized.plan.id, receipts, completedAt, deviceVerified: false };
    } finally {
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
