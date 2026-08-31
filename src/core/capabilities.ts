import type { EvidenceConfidence, ValidationStatus } from "./evidence";
import type { Persistence, RiskClass } from "./risk";

export type CapabilityId =
  | "device-info"
  | "brightness"
  | "scroll-speed"
  | "display-mode"
  | "power"
  | "static-frame"
  | "animation"
  | "text";

export interface Capability {
  readonly id: CapabilityId;
  readonly label: string;
  readonly supported: boolean;
  readonly live: boolean;
  readonly risk: RiskClass;
  readonly persistence: Persistence;
  readonly evidenceConfidence: EvidenceConfidence;
  readonly validation: ValidationStatus;
  readonly evidenceRefs: readonly string[];
}
