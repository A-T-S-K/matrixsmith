export type EvidenceConfidence = "observed" | "corroborated" | "inferred" | "speculative" | "unknown";

export type ValidationStatus = "unverified" | "experimental" | "verified" | "rejected";

export interface EvidenceReference {
  readonly id: string;
  readonly summary: string;
  readonly confidence: EvidenceConfidence;
  readonly source?: string;
}

export interface ManualObservation {
  readonly id: string;
  readonly recordedAt: string;
  readonly summary: string;
  readonly confidence: EvidenceConfidence;
}
