export type EvidenceConfidence =
  "observed" | "corroborated" | "inferred" | "speculative" | "unknown";

export type ValidationStatus =
  "unverified" | "experimental" | "verified" | "rejected";

export interface EvidenceReference {
  readonly id: string;
  readonly summary: string;
  readonly confidence: EvidenceConfidence;
  readonly source?: string;
  /**
   * Whether this evidence supports the profile's current model or records a
   * rejected hypothesis. Rejected evidence must keep flowing into reports as
   * "rejected hypotheses", never as verified facts.
   */
  readonly disposition?: "supports" | "rejects";
}

export interface ManualObservation {
  readonly id: string;
  readonly recordedAt: string;
  readonly summary: string;
  readonly confidence: EvidenceConfidence;
}
