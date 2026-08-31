import type { Capability } from "../core/capabilities";
import type { DeviceFingerprint } from "../core/device";
import type { ManualObservation } from "../core/evidence";
import type { DriverMatch } from "../drivers/types";
import type { TraceEvent } from "./trace";
import { serializeTraceEvent } from "./trace";

export interface DiagnosticBundleV1 {
  readonly schemaVersion: 1;
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
}

export interface CreateBundleInput {
  readonly fingerprint: DeviceFingerprint;
  readonly driverMatches: readonly DriverMatch[];
  readonly selectedDriver: string | null;
  readonly selectedProfile: string | null;
  readonly capabilities: readonly Capability[];
  readonly trace: readonly TraceEvent[];
  readonly observations: readonly ManualObservation[];
  readonly advertisementEvidence?: Readonly<Record<string, unknown>> | null;
}

export function createDiagnosticBundle(input: CreateBundleInput): DiagnosticBundleV1 {
  return {
    schemaVersion: 1,
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
  };
}

export function serializeDiagnosticBundle(bundle: DiagnosticBundleV1): string {
  return JSON.stringify(bundle, null, 2);
}

export function parseDiagnosticBundle(json: string): DiagnosticBundleV1 {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("Diagnostic bundle is not valid JSON."); }
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error("Unsupported diagnostic bundle schemaVersion.");
  if (typeof value.matrixsmithVersion !== "string" || !validIso(value.createdAt)) throw new Error("Diagnostic bundle metadata is invalid.");
  if (!validFingerprint(value.fingerprint)) throw new Error("Diagnostic bundle fingerprint is invalid.");
  if (!Array.isArray(value.driverMatches) || !value.driverMatches.every(validMatch)) throw new Error("Diagnostic bundle driver matches are invalid.");
  if (!nullableString(value.selectedDriver) || !nullableString(value.selectedProfile)) throw new Error("Diagnostic bundle selection is invalid.");
  if (!Array.isArray(value.capabilities) || !Array.isArray(value.trace) || !Array.isArray(value.observations)) throw new Error("Diagnostic bundle collections are invalid.");
  if (value.trace.some((event) => !isObject(event) || typeof event.timestamp !== "string" || typeof event.type !== "string")) throw new Error("Diagnostic trace is invalid.");
  if (value.observations.some((observation) => !isObject(observation) || typeof observation.id !== "string" || typeof observation.summary !== "string")) throw new Error("Diagnostic observations are invalid.");
  if (value.advertisementEvidence !== null && !isObject(value.advertisementEvidence)) throw new Error("Advertisement evidence is invalid.");
  return value as unknown as DiagnosticBundleV1;
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
