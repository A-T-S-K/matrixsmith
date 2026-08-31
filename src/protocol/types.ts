export type EvidenceLevel = "VERIFIED" | "STRONGLY_INFERRED" | "SPECULATIVE" | "UNKNOWN";

export interface ProtocolCapability {
  readonly name: string;
  readonly evidence: EvidenceLevel;
  readonly available: boolean;
}
