import type { TransportReceipt } from "../application/ports/transport";
import type { GattEndpoint } from "../core/device";
import type { TargetBinding, WriteMode } from "../core/transmission";
import type { PacketTiming } from "./executor";
import type { NotificationRecord } from "./notifications";

/** Produced at actual executor boundaries, never inferred from plan packets. */
export interface PacketExecutionAttempt {
  readonly index: number;
  readonly attempt: 1;
  readonly writeStartedAt: string;
  /** Dispatch-owned data, captured before transport access; getter copies bytes. */
  readonly endpoint: GattEndpoint;
  readonly writeMode: WriteMode;
  readonly bytes: Uint8Array;
  readonly hex: string;
  readonly settledAt: string;
  readonly settlement: "accepted" | "failed" | "indeterminate";
  readonly receipt: TransportReceipt | null;
  /** Host acceptance belonging to a retired connection, never current success. */
  readonly lateReceipt: TransportReceipt | null;
  readonly timing: PacketTiming | null;
}

export type ExecutionFailureStage =
  "authorization" | "endpoint" | "observer" | "write" | "progress" | "response";

export interface ExecutionEvidence {
  readonly planId: string;
  readonly digest: string;
  readonly targetBinding: TargetBinding;
  readonly authorizedAt: string;
  readonly driverId: string;
  readonly profileId: string;
  readonly totalPackets: number;
  readonly startedAt: string;
  readonly settledAt: string;
  readonly outcome: "completed" | "failed" | "indeterminate";
  readonly attempts: readonly PacketExecutionAttempt[];
  readonly receipts: readonly TransportReceipt[];
  readonly packetTimings: readonly PacketTiming[];
  readonly finalWriteAcceptedAt: string | null;
  readonly failedPacketIndex: number | null;
  readonly failedStage: ExecutionFailureStage | null;
  readonly responseStatus:
    | "none"
    | "armed"
    | "pending"
    | "matched"
    | "timeout"
    | "ambiguous"
    | "cancelled"
    | "failed";
  readonly responseRecord: NotificationRecord | null;
  readonly responseTimedOut: boolean;
  readonly responseAmbiguous: boolean;
  readonly wholePlanDigestCount: number;
  readonly targetCheckCount: number;
}

// The recorder and failure association live privately in the executor. There
// is no public setter accepting caller-provided evidence.
export { executionEvidence } from "./executor";
