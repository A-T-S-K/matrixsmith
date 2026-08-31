import type { GattEndpoint } from "../core/device";
import type { Persistence, RiskClass } from "../core/risk";
import type { ValidationStatus } from "../core/evidence";
import type { DecodedNotification } from "../drivers/types";

export type TransactionSource = "operation" | "probe" | "diagnostic" | "gatt-read";

export interface TransactionPacket {
  readonly timestamp: string;
  readonly direction: "TX" | "RX";
  readonly hex: string;
  readonly endpoint?: GattEndpoint;
}

export interface ProtocolTransaction {
  readonly id: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly sessionSource: "live" | "imported" | "fake" | "replay";
  readonly source: TransactionSource;
  readonly driverId: string | null;
  readonly profileId: string | null;
  readonly operation: string;
  readonly safety: { readonly risk: RiskClass; readonly persistence: Persistence; readonly validation: ValidationStatus };
  readonly endpoint: GattEndpoint | null;
  readonly packets: readonly TransactionPacket[];
  readonly decodedResponse: DecodedNotification | null;
  readonly hostAccepted: boolean;
  readonly protocolAcknowledged: boolean | null;
  readonly deviceStateVerified: boolean;
  readonly responseTimedOut: boolean;
  readonly error: string | null;
  readonly findings: readonly string[];
  readonly observationIds: readonly string[];
  readonly diagnosticRunId: string | null;
}

export function transactionId(prefix = "transaction"): string {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${value}`;
}
