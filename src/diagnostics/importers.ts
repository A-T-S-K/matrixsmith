import type { DeviceFingerprint } from "../core/device";
import type { ManualObservation } from "../core/evidence";
import type { ProtocolTransaction } from "./transactions";

/**
 * Contract for future external-capture importers (for example nRF Connect
 * text logs, and later PCAP-derived exports). An importer turns a foreign
 * capture into MatrixSmith's own evidence model without ever replaying
 * traffic: imported sessions stay read-only.
 *
 * This branch ships the interface and a UI placeholder only; the first
 * implementation (nRF Connect text-log import) lands in a follow-up branch.
 */
export interface EvidenceImporter {
  readonly id: string;
  readonly label: string;
  /** Human-readable source format, e.g. "nRF Connect text log". */
  readonly format: string;
  /** Cheap sniff so the UI can route a pasted/opened file to an importer. */
  canImport(content: string): boolean;
  parse(content: string): ImportedEvidence;
}

export interface ImportedEvidence {
  readonly fingerprint: DeviceFingerprint | null;
  readonly transactions: readonly ProtocolTransaction[];
  readonly observations: readonly ManualObservation[];
  /** Provenance note shown wherever this evidence is surfaced. */
  readonly provenance: string;
}

/** No importers ship in this branch; the registry exists so the UI can enumerate them. */
export const EVIDENCE_IMPORTERS: readonly EvidenceImporter[] = Object.freeze([]);
