import type { Persistence, RiskClass } from "../core/risk";
import type { ValidationStatus } from "../core/evidence";

export type DiagnosticKind = "identify" | "inspect" | "validate";
export type DiagnosticRunStatus =
  "running" | "passed" | "failed" | "restore-failed";

export interface DiagnosticTool {
  readonly id: string;
  readonly driverId: string;
  readonly kind: DiagnosticKind;
  readonly label: string;
  readonly purpose: string;
  readonly explanation: string;
  readonly risk: RiskClass;
  readonly persistence: Persistence;
  readonly validation: ValidationStatus;
  readonly available: boolean;
  readonly unavailableReason?: string;
  readonly workflow:
    "family-identification" | "refresh-device-info" | "brightness-round-trip";
  readonly probeId?: string;
}

export interface DiagnosticStepResult {
  readonly id: string;
  readonly label: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly summary: string;
  readonly transactionIds: readonly string[];
}

export interface DiagnosticRun {
  readonly id: string;
  readonly toolId: string;
  readonly driverId: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly purpose: string;
  readonly safety: {
    readonly risk: RiskClass;
    readonly persistence: Persistence;
    readonly validation: ValidationStatus;
    readonly explanation: string;
  };
  readonly status: DiagnosticRunStatus;
  readonly steps: readonly DiagnosticStepResult[];
  readonly findings: readonly string[];
  readonly error: string | null;
  readonly restorationAttempted: boolean;
  readonly restorationVerified: boolean;
  readonly observationIds: readonly string[];
}

export const COOLLEDUX_DIAGNOSTIC_TOOLS: readonly DiagnosticTool[] =
  Object.freeze([
    {
      id: "coolledux-identify",
      driverId: "coolledux",
      kind: "identify",
      label: "Get Device Info",
      purpose: "Identify the protocol using a structured 0x1F response.",
      explanation: "Sends the verified read-only device-info query.",
      risk: "read-only",
      persistence: "none",
      validation: "verified",
      available: true,
      workflow: "family-identification",
      probeId: "get-device-info",
    },
    {
      id: "coolledux-refresh-info",
      driverId: "coolledux",
      kind: "inspect",
      label: "Refresh Device Info",
      purpose: "Read the current power and brightness fields.",
      explanation: "Sends the verified read-only device-info query.",
      risk: "read-only",
      persistence: "none",
      validation: "verified",
      available: true,
      workflow: "refresh-device-info",
    },
    {
      id: "coolledux-brightness-round-trip",
      driverId: "coolledux",
      kind: "validate",
      label: "Brightness round-trip",
      purpose:
        "Validate command response and readback while restoring the original brightness.",
      explanation:
        "This temporarily changes brightness and automatically restores it.",
      risk: "transient",
      persistence: "unknown",
      validation: "verified",
      available: true,
      workflow: "brightness-round-trip",
    },
  ]);

export function diagnosticRunId(): string {
  const value =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `diagnostic:${value}`;
}

export function chooseTestBrightness(baseline: number): number {
  if (!Number.isInteger(baseline) || baseline < 0 || baseline > 255)
    throw new RangeError("Baseline brightness must be an unsigned byte.");
  return baseline >= 0x80 ? 0x40 : 0xc0;
}
