import type { Capability } from "../core/capabilities";
import type { DeviceFingerprint } from "../core/device";
import type { ManualObservation } from "../core/evidence";
import type { DriverMatch } from "../drivers/types";
import type { TraceEvent } from "./trace";
import { serializeTraceEvent } from "./trace";
import type { DiagnosticRun } from "./workflows";
import type { ProtocolTransaction } from "./transactions";
import type { SessionValidationResult } from "./validation";
import type { ContentCompilationRecord } from "./content-evidence";
import type { Investigation } from "../investigation/investigation";
import { sanitizeInvestigation } from "../investigation/serialization";

export interface ImportedEvidenceSummary {
  readonly provenance: string;
  readonly transactionCount: number;
  readonly warnings: readonly string[];
}

/**
 * Schema v2 adds structured hardware-validation results, content-compiler
 * metadata, and imported-external-evidence summaries. v1 bundles remain
 * readable: parseDiagnosticBundle migrates them by defaulting the new
 * collections to empty.
 */
export interface DiagnosticBundle {
  readonly schemaVersion: 2;
  readonly matrixsmithVersion: string;
  readonly createdAt: string;
  readonly fingerprint: DeviceFingerprint;
  readonly driverMatches: readonly DriverMatch[];
  readonly selectedDriver: string | null;
  readonly selectedProfile: string | null;
  readonly capabilities: readonly Capability[];
  readonly trace: readonly Record<string, unknown>[];
  readonly observations: readonly ManualObservation[];
  readonly advertisementEvidence: Readonly<Record<string, unknown>> | null;
  readonly transactions?: readonly ProtocolTransaction[];
  readonly diagnosticRuns?: readonly DiagnosticRun[];
  readonly validations?: readonly SessionValidationResult[];
  readonly contentCompilations?: readonly ContentCompilationRecord[];
  readonly importedEvidence?: readonly ImportedEvidenceSummary[];
  /** The active guided investigation, when one exists (added post-v2; optional and migration-safe). */
  readonly investigation?: Investigation | null;
}

/** The historical v1 shape, kept as a named type for fixtures and tests. */
export type DiagnosticBundleV1 = Omit<DiagnosticBundle, "schemaVersion" | "validations" | "contentCompilations" | "importedEvidence"> & { readonly schemaVersion: 1 };

export interface CreateBundleInput {
  readonly fingerprint: DeviceFingerprint;
  readonly driverMatches: readonly DriverMatch[];
  readonly selectedDriver: string | null;
  readonly selectedProfile: string | null;
  readonly capabilities: readonly Capability[];
  readonly trace: readonly TraceEvent[];
  readonly observations: readonly ManualObservation[];
  readonly advertisementEvidence?: Readonly<Record<string, unknown>> | null;
  readonly transactions?: readonly ProtocolTransaction[];
  readonly diagnosticRuns?: readonly DiagnosticRun[];
  readonly validations?: readonly SessionValidationResult[];
  readonly contentCompilations?: readonly ContentCompilationRecord[];
  readonly importedEvidence?: readonly ImportedEvidenceSummary[];
  readonly investigation?: Investigation | null;
}

export function createDiagnosticBundle(input: CreateBundleInput): DiagnosticBundle {
  return {
    schemaVersion: 2,
    matrixsmithVersion: "0.1.0",
    createdAt: new Date().toISOString(),
    fingerprint: structuredClone(input.fingerprint),
    driverMatches: structuredClone(input.driverMatches),
    selectedDriver: input.selectedDriver,
    selectedProfile: input.selectedProfile,
    capabilities: structuredClone(input.capabilities),
    trace: input.trace.map(serializeTraceEvent),
    observations: structuredClone(input.observations),
    advertisementEvidence: input.advertisementEvidence ? structuredClone(input.advertisementEvidence) : null,
    transactions: structuredClone(input.transactions ?? []),
    diagnosticRuns: structuredClone(input.diagnosticRuns ?? []),
    validations: structuredClone(input.validations ?? []),
    contentCompilations: structuredClone(input.contentCompilations ?? []),
    importedEvidence: structuredClone(input.importedEvidence ?? []),
    investigation: input.investigation ? structuredClone(input.investigation) : null,
  };
}

export function serializeDiagnosticBundle(bundle: DiagnosticBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function parseDiagnosticBundle(json: string): DiagnosticBundle {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("Diagnostic bundle is not valid JSON."); }
  if (!isObject(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) throw new Error("Unsupported diagnostic bundle schemaVersion.");
  if (typeof value.matrixsmithVersion !== "string" || !validIso(value.createdAt)) throw new Error("Diagnostic bundle metadata is invalid.");
  if (!validFingerprint(value.fingerprint)) throw new Error("Diagnostic bundle fingerprint is invalid.");
  if (!Array.isArray(value.driverMatches) || !value.driverMatches.every(validMatch)) throw new Error("Diagnostic bundle driver matches are invalid.");
  if (!nullableString(value.selectedDriver) || !nullableString(value.selectedProfile)) throw new Error("Diagnostic bundle selection is invalid.");
  if (!Array.isArray(value.capabilities) || !Array.isArray(value.trace) || !Array.isArray(value.observations)) throw new Error("Diagnostic bundle collections are invalid.");
  if (value.trace.some((event) => !isObject(event) || typeof event.timestamp !== "string" || typeof event.type !== "string")) throw new Error("Diagnostic trace is invalid.");
  if (value.observations.some((observation) => !isObject(observation) || typeof observation.id !== "string" || typeof observation.summary !== "string")) throw new Error("Diagnostic observations are invalid.");
  if (value.advertisementEvidence !== null && value.advertisementEvidence !== undefined && !isObject(value.advertisementEvidence)) throw new Error("Advertisement evidence is invalid.");
  for (const key of ["transactions", "diagnosticRuns", "validations", "contentCompilations", "importedEvidence"] as const) {
    if (value[key] !== undefined && !Array.isArray(value[key])) throw new Error(`Diagnostic bundle ${key} are invalid.`);
  }
  // Migrate: v1 bundles simply lack the new collections; the rest of the
  // shape is identical, so stamping schemaVersion 2 with empty defaults is a
  // complete migration.
  const migrated = {
    ...(value as unknown as DiagnosticBundle),
    schemaVersion: 2 as const,
    advertisementEvidence: (value.advertisementEvidence ?? null) as DiagnosticBundle["advertisementEvidence"],
    transactions: (value.transactions ?? []) as DiagnosticBundle["transactions"],
    diagnosticRuns: (value.diagnosticRuns ?? []) as DiagnosticBundle["diagnosticRuns"],
    validations: (value.validations ?? []) as DiagnosticBundle["validations"],
    contentCompilations: (value.contentCompilations ?? []) as DiagnosticBundle["contentCompilations"],
    importedEvidence: (value.importedEvidence ?? []) as DiagnosticBundle["importedEvidence"],
    // Bundles are untrusted user-supplied files. The investigation goes
    // through the SAME structural validation local storage uses, rather than
    // being asserted into shape: malformed orchestration or attempt data is
    // dropped, and the panel-program belief is rebuilt as unknown, because a
    // file cannot testify about a display this session has never seen.
    investigation: sanitizeInvestigation(value.investigation, "This investigation was imported from a bundle; the display it describes was never connected to this session."),
  };
  return migrated;
}

export function notificationPacketsFromBundle(bundle: DiagnosticBundle): readonly Uint8Array[] {
  return bundle.trace.flatMap((event) => {
    if (event.type !== "notification.raw" || typeof event.rawHex !== "string" || event.rawHex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(event.rawHex)) return [];
    return [Uint8Array.from(event.rawHex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))];
  });
}

function validFingerprint(value: unknown): value is DeviceFingerprint {
  if (!isObject(value) || value.schemaVersion !== 1 || typeof value.transportKind !== "string") return false;
  if (!Array.isArray(value.advertisedServices) || !value.advertisedServices.every((item) => typeof item === "string")) return false;
  if (!Array.isArray(value.services) || !value.services.every((service) => isObject(service) && typeof service.uuid === "string" && Array.isArray(service.characteristics))) return false;
  return Array.isArray(value.evidenceRefs) && Array.isArray(value.notes);
}

function validMatch(value: unknown): boolean {
  return isObject(value) && typeof value.driverId === "string" && typeof value.score === "number"
    && typeof value.confidence === "string" && Array.isArray(value.reasons) && Array.isArray(value.contradictions);
}

function nullableString(value: unknown): boolean { return value === null || typeof value === "string"; }
function validIso(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
