import type { GattEndpoint } from "./device";
import type { ValidationStatus } from "./evidence";
import type { MatrixOperation } from "./operations";
import type { Persistence, RiskClass } from "./risk";

export type WriteMode = "with-response" | "without-response";
export type AckPolicy = "none" | "per-packet" | "final";

export type ResponseExpectation =
  | { readonly type: "none" }
  | {
    readonly type: "notification";
    readonly required: boolean;
    readonly timeoutMs: number;
    readonly opcode?: number;
    readonly kind?: string;
    readonly fulfillsOperation: boolean;
  };

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly retryOn: readonly string[];
}

export interface TransmissionPacket {
  readonly index: number;
  readonly endpoint: GattEndpoint;
  readonly writeMode: WriteMode;
  readonly bytes: Uint8Array;
  readonly hex: string;
  /**
   * Pause after this packet before the next write, in milliseconds. Pacing is
   * generic plan metadata: codecs never sleep, the executor owns timing.
   */
  readonly delayAfterMs?: number;
}

export interface TransmissionPlan {
  readonly id: string;
  readonly driverId: string;
  readonly profileId: string;
  readonly operation: MatrixOperation;
  readonly risk: RiskClass;
  readonly persistence: Persistence;
  readonly validation: ValidationStatus;
  readonly evidenceRefs: readonly string[];
  readonly packets: readonly TransmissionPacket[];
  readonly ackPolicy: AckPolicy;
  readonly responseExpectation: ResponseExpectation;
  /** Explicit driver intent. Validation alone never makes a plan executable. */
  readonly execution: "live" | "dry-run-only";
  readonly purpose: "operation" | "probe";
  readonly retryPolicy: RetryPolicy;
  readonly timeoutMs: number;
  readonly recoveryNotes: readonly string[];
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface AuthorizedTransmission {
  readonly plan: TransmissionPlan;
  readonly authorizedAt: string;
  readonly policyDecision: "allow";
}

export function createPlanId(prefix = "plan"): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

export function packetHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ").toUpperCase();
}
