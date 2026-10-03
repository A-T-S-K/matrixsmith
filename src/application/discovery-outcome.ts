import type { IdentificationResult } from "../drivers/types";
import type { ExecutionResult } from "../app/executor";

export type MachineOutcomeKind =
  | "identified"
  | "rejected"
  | "inconclusive"
  | "timeout"
  | "ambiguous"
  | "access"
  | "blocked"
  | "transport"
  | "retired";

/** Failure semantics come from the failing stage, never an error-message parser. */
export class ProbeStageError extends Error {
  constructor(
    readonly kind: MachineOutcomeKind,
    message: string,
    readonly transactionId: string | null = null,
  ) {
    super(message);
  }
}

export function machineOutcome(
  result: ExecutionResult,
  interpretation: IdentificationResult,
): MachineOutcomeKind {
  if (
    result.responseAmbiguous ||
    result.responseRecord?.interpretationAmbiguous
  )
    return "ambiguous";
  if (result.responseTimedOut) return "timeout";
  if (
    !result.responseRecord ||
    !result.response ||
    result.response.envelopeError ||
    !result.protocolAcknowledged
  )
    return "inconclusive";
  return interpretation.matched
    ? "identified"
    : interpretation.rejection
      ? "rejected"
      : "inconclusive";
}
