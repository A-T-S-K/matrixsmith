import { redactIdentifyingText } from "./shareable-text";
import type { Capability } from "../core/capabilities";
import type { DeviceFingerprint } from "../core/device";
import type { ManualObservation } from "../core/evidence";
import type { DriverMatch } from "../drivers/types";
import type { Investigation } from "../investigation/investigation";
import { sanitizeInvestigation } from "../investigation/serialization";
import type { ContentCompilationRecord } from "./content-evidence";
import type { TraceEvent } from "./trace";
import { serializeTraceEvent } from "./trace";
import type { ProtocolTransaction } from "./transactions";
import type { DiagnosticRun } from "./workflows";
import {
  assessDevice,
  type DeviceAssessment,
} from "../domain/device/assessment";
import { INPUT_LIMITS } from "../application/input-limits";
import { MATRIXSMITH_VERSION } from "../application/version";

export const BUNDLE_INPUT_LIMITS = INPUT_LIMITS;
export type BundlePrivacy = "shareable" | "full-local-archive";
export interface BundleValidationIssue {
  readonly path: string;
  readonly code:
    | "invalid_json"
    | "invalid_type"
    | "invalid_value"
    | "too_large"
    | "too_many"
    | "unsupported_version";
  readonly message: string;
}
export class BundleValidationError extends Error {
  constructor(readonly issues: readonly BundleValidationIssue[]) {
    super(issues[0]?.message ?? "Diagnostic bundle is invalid.");
    this.name = "BundleValidationError";
  }
}
export interface ImportedEvidenceSummary {
  readonly provenance: string;
  readonly transactionCount: number;
  readonly warnings: readonly string[];
}

/** The only supported portable format. V1/V2 are deliberately rejected. */
export interface DiagnosticBundle {
  readonly schemaVersion: 3;
  readonly privacy: BundlePrivacy;
  readonly matrixsmithVersion: string;
  readonly createdAt: string;
  readonly fingerprint: DeviceFingerprint;
  readonly driverMatches: readonly DriverMatch[];
  readonly selectedDriver: string | null;
  readonly selectedProfile: string | null;
  readonly capabilities: readonly Capability[];
  readonly assessment: DeviceAssessment;
  readonly trace: readonly Record<string, unknown>[];
  readonly observations: readonly ManualObservation[];
  readonly advertisementEvidence: Readonly<Record<string, unknown>> | null;
  readonly transactions: readonly ProtocolTransaction[];
  readonly diagnosticRuns: readonly DiagnosticRun[];
  readonly contentCompilations: readonly ContentCompilationRecord[];
  readonly importedEvidence: readonly ImportedEvidenceSummary[];
  readonly investigation: Investigation | null;
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
  readonly transactions?: readonly ProtocolTransaction[];
  readonly diagnosticRuns?: readonly DiagnosticRun[];
  readonly contentCompilations?: readonly ContentCompilationRecord[];
  readonly importedEvidence?: readonly ImportedEvidenceSummary[];
  readonly investigation?: Investigation | null;
  readonly privacy?: BundlePrivacy;
  readonly assessment?: DeviceAssessment;
}

export function createDiagnosticBundle(
  input: CreateBundleInput,
): DiagnosticBundle {
  const fallbackAssessment = assessDevice({
    target: {
      kind: "unresolved",
      fingerprint: input.fingerprint,
      candidates: input.driverMatches,
    },
    evidence: [],
    capabilities: input.capabilities,
    live: false,
  });
  const bundle: DiagnosticBundle = {
    schemaVersion: 3,
    privacy: input.privacy ?? "full-local-archive",
    matrixsmithVersion: MATRIXSMITH_VERSION,
    createdAt: new Date().toISOString(),
    fingerprint: structuredClone(input.fingerprint),
    driverMatches: structuredClone(input.driverMatches),
    selectedDriver: input.selectedDriver,
    selectedProfile: input.selectedProfile,
    capabilities: structuredClone(input.capabilities),
    assessment: structuredClone(input.assessment ?? fallbackAssessment),
    trace: input.trace.map(serializeTraceEvent),
    observations: structuredClone(input.observations),
    advertisementEvidence: input.advertisementEvidence
      ? structuredClone(input.advertisementEvidence)
      : null,
    transactions: structuredClone(input.transactions ?? []),
    diagnosticRuns: structuredClone(input.diagnosticRuns ?? []),
    contentCompilations: structuredClone(input.contentCompilations ?? []),
    importedEvidence: structuredClone(input.importedEvidence ?? []),
    investigation: input.investigation
      ? structuredClone(input.investigation)
      : null,
  };
  return bundle.privacy === "shareable" ? redactBundle(bundle) : bundle;
}
export function createShareableBundle(
  bundle: DiagnosticBundle,
): DiagnosticBundle {
  return redactBundle(bundle);
}
export function createFullLocalArchive(
  bundle: DiagnosticBundle,
): DiagnosticBundle {
  return { ...structuredClone(bundle), privacy: "full-local-archive" };
}
export function serializeDiagnosticBundle(bundle: DiagnosticBundle): string {
  const json = JSON.stringify(bundle, null, 2);
  enforceBudget(json);
  return json;
}
export type ParseBundleResult =
  | { readonly success: true; readonly data: DiagnosticBundle }
  | {
      readonly success: false;
      readonly errors: readonly BundleValidationIssue[];
    };

/** Fully parses and validates without effects, so callers can mutate only after success. */
export function safeParseDiagnosticBundle(json: string): ParseBundleResult {
  if (bytes(json) > BUNDLE_INPUT_LIMITS.diagnosticBundleBytes)
    return failure(
      "$",
      "too_large",
      `Diagnostic bundle exceeds the ${BUNDLE_INPUT_LIMITS.diagnosticBundleBytes}-byte limit.`,
    );
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return failure("$", "invalid_json", "Diagnostic bundle is not valid JSON.");
  }
  const errors: BundleValidationIssue[] = [];
  validateBundle(value, errors);
  if (errors.length || !obj(value)) return { success: false, errors };
  const investigation =
    value.investigation === null
      ? null
      : sanitizeInvestigation(
          value.investigation,
          "This investigation was imported from a bundle; the display it describes was never connected to this session.",
        );
  return {
    success: true,
    data: { ...(value as unknown as DiagnosticBundle), investigation },
  };
}
export function parseDiagnosticBundle(json: string): DiagnosticBundle {
  const result = safeParseDiagnosticBundle(json);
  if (!result.success) throw new BundleValidationError(result.errors);
  return result.data;
}
export function notificationPacketsFromBundle(
  bundle: DiagnosticBundle,
): readonly Uint8Array[] {
  return bundle.trace.flatMap((event) =>
    event.type === "notification.raw" && typeof event.rawHex === "string"
      ? [
          Uint8Array.from(event.rawHex.match(/../g) ?? [], (pair) =>
            Number.parseInt(pair, 16),
          ),
        ]
      : [],
  );
}

function redactBundle(source: DiagnosticBundle): DiagnosticBundle {
  const bundle = structuredClone(source);
  const fingerprint = { ...bundle.fingerprint };
  delete fingerprint.browserDeviceId;
  delete fingerprint.name;
  delete fingerprint.rawAdvertisementHex;
  delete fingerprint.manufacturerDataHex;
  delete fingerprint.advertisementObservation;
  const investigation = bundle.investigation
    ? {
        ...bundle.investigation,
        deviceName: null,
        deviceBinding: bundle.investigation.deviceBinding
          ? {
              profileId: bundle.investigation.deviceBinding.profileId,
              fingerprintKey: "[redacted]",
            }
          : null,
      }
    : null;
  return redactIdentifyingText(
    {
      ...bundle,
      privacy: "shareable",
      fingerprint,
      investigation,
      trace: [],
      advertisementEvidence: null,
    },
    [
      source.fingerprint.browserDeviceId ?? "",
      source.fingerprint.name ?? "",
      source.investigation?.deviceName ?? "",
    ],
  );
}

type O = Record<string, unknown>;
function validateBundle(value: unknown, e: BundleValidationIssue[]): void {
  if (!object(value, "$", e)) return;
  if (value.schemaVersion !== 3)
    add(
      e,
      "$.schemaVersion",
      "unsupported_version",
      "Unsupported diagnostic bundle schemaVersion; expected Bundle V3.",
    );
  one(value.privacy, ["shareable", "full-local-archive"], "$.privacy", e);
  str(value.matrixsmithVersion, "$.matrixsmithVersion", e);
  iso(value.createdAt, "$.createdAt", e);
  fingerprint(value.fingerprint, "$.fingerprint", e);
  array(value.driverMatches, "$.driverMatches", e, match);
  nullableStr(value.selectedDriver, "$.selectedDriver", e);
  nullableStr(value.selectedProfile, "$.selectedProfile", e);
  array(value.capabilities, "$.capabilities", e, capability);
  assessment(value.assessment, "$.assessment", e);
  const trace = array(value.trace, "$.trace", e, traceEvent);
  if (trace && trace.length > BUNDLE_INPUT_LIMITS.traceEvents)
    add(
      e,
      "$.trace",
      "too_many",
      `Trace exceeds ${BUNDLE_INPUT_LIMITS.traceEvents} events.`,
    );
  array(value.observations, "$.observations", e, observation);
  if (value.advertisementEvidence !== null)
    jsonObject(value.advertisementEvidence, "$.advertisementEvidence", e);
  const tx = array(value.transactions, "$.transactions", e, transaction);
  if (tx && tx.length > BUNDLE_INPUT_LIMITS.transactions)
    add(
      e,
      "$.transactions",
      "too_many",
      `Transactions exceed ${BUNDLE_INPUT_LIMITS.transactions} entries.`,
    );
  array(value.diagnosticRuns, "$.diagnosticRuns", e, diagnosticRun);
  array(value.contentCompilations, "$.contentCompilations", e, compilation);
  array(value.importedEvidence, "$.importedEvidence", e, importedEvidence);
  if (value.investigation !== null)
    investigation(value.investigation, "$.investigation", e);
}
function fingerprint(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  if (v.schemaVersion !== 1)
    add(
      e,
      `${p}.schemaVersion`,
      "invalid_value",
      "Expected fingerprint schemaVersion 1.",
    );
  one(
    v.transportKind,
    ["web-bluetooth", "web-serial", "web-usb", "network", "fake", "replay"],
    `${p}.transportKind`,
    e,
  );
  optStr(v.browserDeviceId, `${p}.browserDeviceId`, e);
  optStr(v.name, `${p}.name`, e);
  strings(v.advertisedServices, `${p}.advertisedServices`, e);
  optStrings(v.requestedServices, `${p}.requestedServices`, e);
  optStrings(v.browserGrantedServices, `${p}.browserGrantedServices`, e);
  optHex(v.rawAdvertisementHex, `${p}.rawAdvertisementHex`, e);
  optHex(v.manufacturerDataHex, `${p}.manufacturerDataHex`, e);
  array(v.services, `${p}.services`, e, (s, sp, x) => {
    if (!object(s, sp, x)) return;
    str(s.uuid, `${sp}.uuid`, x);
    bool(s.isPrimary, `${sp}.isPrimary`, x);
    array(s.characteristics, `${sp}.characteristics`, x, (c, cp, y) => {
      if (!object(c, cp, y)) return;
      str(c.uuid, `${cp}.uuid`, y);
      if (!object(c.properties, `${cp}.properties`, y)) return;
      for (const k of [
        "read",
        "notify",
        "indicate",
        "write",
        "writeWithoutResponse",
      ])
        bool(c.properties[k], `${cp}.properties.${k}`, y);
    });
  });
  strings(v.evidenceRefs, `${p}.evidenceRefs`, e);
  strings(v.notes, `${p}.notes`, e);
  if (
    v.manuallyConfirmedGeometry !== undefined &&
    object(v.manuallyConfirmedGeometry, `${p}.manuallyConfirmedGeometry`, e)
  ) {
    positive(
      v.manuallyConfirmedGeometry.width,
      `${p}.manuallyConfirmedGeometry.width`,
      e,
    );
    positive(
      v.manuallyConfirmedGeometry.height,
      `${p}.manuallyConfirmedGeometry.height`,
      e,
    );
  }
  if (v.advertisementObservation !== undefined)
    jsonObject(v.advertisementObservation, `${p}.advertisementObservation`, e);
}
function match(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  str(v.driverId, `${p}.driverId`, e);
  num(v.score, `${p}.score`, e);
  one(
    v.confidence,
    ["none", "weak", "candidate", "strong", "exact"],
    `${p}.confidence`,
    e,
  );
  strings(v.reasons, `${p}.reasons`, e);
  strings(v.contradictions, `${p}.contradictions`, e);
}
function capability(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  str(v.id, `${p}.id`, e);
  str(v.label, `${p}.label`, e);
  bool(v.supported, `${p}.supported`, e);
  bool(v.live, `${p}.live`, e);
  one(
    v.risk,
    ["read-only", "transient", "persistent", "unknown"],
    `${p}.risk`,
    e,
  );
  one(
    v.persistence,
    ["none", "volatile", "persistent", "unknown"],
    `${p}.persistence`,
    e,
  );
  one(
    v.evidenceConfidence,
    ["observed", "corroborated", "inferred", "speculative", "unknown"],
    `${p}.evidenceConfidence`,
    e,
  );
  one(
    v.validation,
    ["unverified", "experimental", "verified", "rejected"],
    `${p}.validation`,
    e,
  );
  strings(v.evidenceRefs, `${p}.evidenceRefs`, e);
}
function assessment(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  one(
    v.readiness,
    [
      "no-device",
      "inspecting",
      "needs-identification",
      "needs-geometry",
      "ready",
      "limited",
      "offline",
    ],
    `${p}.readiness`,
    e,
  );
  str(v.summary, `${p}.summary`, e);
  if (object(v.capabilities, `${p}.capabilities`, e)) {
    for (const id of [
      "device-info",
      "brightness",
      "scroll-speed",
      "display-mode",
      "power",
      "static-frame",
      "animation",
      "text",
      "gif",
    ]) {
      capabilityAssessment(v.capabilities[id], `${p}.capabilities.${id}`, e);
    }
  }
  staticAssessment(v.strategies, `${p}.strategies`, e);
  array(v.actions, `${p}.actions`, e, deviceAction);
  nullableStr(v.recommendedActionId, `${p}.recommendedActionId`, e);
  array(v.unresolvedClaims, `${p}.unresolvedClaims`, e, claimState);
  array(v.conflicts, `${p}.conflicts`, e, claimState);
}
function capabilityAssessment(
  v: unknown,
  p: string,
  e: BundleValidationIssue[],
): void {
  if (!object(v, p, e)) return;
  str(v.id, `${p}.id`, e);
  str(v.label, `${p}.label`, e);
  one(
    v.availability,
    ["available", "blocked", "unsupported"],
    `${p}.availability`,
    e,
  );
  one(
    v.confidence,
    ["verified", "experimental", "unknown", "conflicted"],
    `${p}.confidence`,
    e,
  );
  str(v.reason, `${p}.reason`, e);
  array(v.evidence, `${p}.evidence`, e, (x, xp, y) => {
    if (!object(x, xp, y)) return;
    one(
      x.scope,
      [
        "source-reference",
        "built-in-profile",
        "current-session",
        "previous-local-session",
        "imported-external",
      ],
      `${xp}.scope`,
      y,
    );
    one(
      x.status,
      ["verified", "source-supported", "unresolved", "rejected", "unknown"],
      `${xp}.status`,
      y,
    );
    str(x.summary, `${xp}.summary`, y);
  });
  strings(v.missingClaims, `${p}.missingClaims`, e);
  operationSafety(v.safety, `${p}.safety`, e);
}
function operationSafety(
  v: unknown,
  p: string,
  e: BundleValidationIssue[],
): void {
  if (!object(v, p, e)) return;
  one(
    v.hazard,
    ["routine", "experimental", "destructive", "firmware"],
    `${p}.hazard`,
    e,
  );
  one(
    v.persistence,
    ["none", "volatile", "device-stored", "unknown"],
    `${p}.persistence`,
    e,
  );
  one(
    v.assurance,
    ["verified", "experimental", "unknown", "rejected"],
    `${p}.assurance`,
    e,
  );
}
function deviceAction(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  str(v.id, `${p}.id`, e);
  nullableStr(v.operationId, `${p}.operationId`, e);
  str(v.label, `${p}.label`, e);
  nullableStr(v.capabilityId, `${p}.capabilityId`, e);
  one(
    v.availability,
    ["available", "blocked", "unsupported"],
    `${p}.availability`,
    e,
  );
  one(
    v.confidence,
    ["verified", "experimental", "unknown", "conflicted"],
    `${p}.confidence`,
    e,
  );
  str(v.reason, `${p}.reason`, e);
  array(v.evidence, `${p}.evidence`, e, (x, xp, y) => {
    if (!object(x, xp, y)) return;
    one(
      x.scope,
      [
        "source-reference",
        "built-in-profile",
        "current-session",
        "previous-local-session",
        "imported-external",
      ],
      `${xp}.scope`,
      y,
    );
    one(
      x.status,
      ["verified", "source-supported", "unresolved", "rejected", "unknown"],
      `${xp}.status`,
      y,
    );
    str(x.summary, `${xp}.summary`, y);
  });
  strings(v.missingClaims, `${p}.missingClaims`, e);
  operationSafety(v.safety, `${p}.safety`, e);
}
function staticAssessment(
  v: unknown,
  p: string,
  e: BundleValidationIssue[],
): void {
  if (!object(v, p, e)) return;
  array(v.strategies, `${p}.strategies`, e, (x, xp, y) => {
    if (!object(x, xp, y)) return;
    one(
      x.strategy,
      ["graffiti", "animation-single-frame", "animation-identical-frames"],
      `${xp}.strategy`,
      y,
    );
    one(x.verdict, ["viable", "not-viable", "open"], `${xp}.verdict`, y);
    str(x.summary, `${xp}.summary`, y);
    array(x.requirements, `${xp}.requirements`, y, (r, rp, z) => {
      if (!object(r, rp, z)) return;
      str(r.claimId, `${rp}.claimId`, z);
      str(r.label, `${rp}.label`, z);
      one(r.state, ["met", "failed", "open"], `${rp}.state`, z);
      one(
        r.trustedStatus,
        ["verified", "source-supported", "unresolved", "rejected", "unknown"],
        `${rp}.trustedStatus`,
        z,
      );
      str(r.detail, `${rp}.detail`, z);
    });
  });
  nullableStr(v.selected, `${p}.selected`, e);
  nullableStr(v.pursued, `${p}.pursued`, e);
  nullableStr(v.nextOpenRequirement, `${p}.nextOpenRequirement`, e);
  one(v.overall, ["viable", "not-viable", "open"], `${p}.overall`, e);
}
function claimState(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  str(v.id, `${p}.id`, e);
  str(v.label, `${p}.label`, e);
  one(v.category, ["core", "content", "optional"], `${p}.category`, e);
  one(
    v.status,
    ["verified", "source-supported", "unresolved", "rejected", "unknown"],
    `${p}.status`,
    e,
  );
  array(v.evidence, `${p}.evidence`, e, (x, xp, y) => {
    if (!object(x, xp, y)) return;
    str(x.claimId, `${xp}.claimId`, y);
    one(
      x.status,
      ["verified", "source-supported", "unresolved", "rejected", "unknown"],
      `${xp}.status`,
      y,
    );
    one(
      x.scope,
      [
        "source-reference",
        "built-in-profile",
        "current-session",
        "previous-local-session",
        "imported-external",
      ],
      `${xp}.scope`,
      y,
    );
    one(
      x.provenance,
      ["observed", "corroborated", "source-derived", "inferred", "speculative"],
      `${xp}.provenance`,
      y,
    );
    str(x.summary, `${xp}.summary`, y);
  });
  nullableStr(v.blockedByPrerequisite, `${p}.blockedByPrerequisite`, e);
  if (v.derivedSummary !== undefined)
    str(v.derivedSummary, `${p}.derivedSummary`, e);
}
function traceEvent(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  iso(v.timestamp, `${p}.timestamp`, e);
  str(v.type, `${p}.type`, e);
  scalars(v.metadata, `${p}.metadata`, e);
  optHex(v.rawHex, `${p}.rawHex`, e);
}
function observation(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  str(v.id, `${p}.id`, e);
  iso(v.recordedAt, `${p}.recordedAt`, e);
  str(v.summary, `${p}.summary`, e);
  one(
    v.confidence,
    ["observed", "corroborated", "inferred", "speculative", "unknown"],
    `${p}.confidence`,
    e,
  );
}
function transaction(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  for (const k of ["id", "startedAt", "completedAt", "operation"])
    str(v[k], `${p}.${k}`, e);
  num(v.durationMs, `${p}.durationMs`, e);
  one(
    v.sessionSource,
    ["live", "imported", "fake", "replay"],
    `${p}.sessionSource`,
    e,
  );
  one(
    v.source,
    ["operation", "probe", "diagnostic", "gatt-read", "external-import"],
    `${p}.source`,
    e,
  );
  nullableStr(v.driverId, `${p}.driverId`, e);
  nullableStr(v.profileId, `${p}.profileId`, e);
  safety(v.safety, `${p}.safety`, e);
  if (v.endpoint !== null) endpoint(v.endpoint, `${p}.endpoint`, e);
  array(v.packets, `${p}.packets`, e, (x, xp, y) => {
    if (!object(x, xp, y)) return;
    iso(x.timestamp, `${xp}.timestamp`, y);
    one(x.direction, ["TX", "RX"], `${xp}.direction`, y);
    spacedHex(x.hex, `${xp}.hex`, y);
    if (x.endpoint !== undefined) endpoint(x.endpoint, `${xp}.endpoint`, y);
    optStr(x.hostAcceptedAt, `${xp}.hostAcceptedAt`, y);
    optNum(x.scheduledDelayMs, `${xp}.scheduledDelayMs`, y);
    optNum(x.gapSincePreviousTxMs, `${xp}.gapSincePreviousTxMs`, y);
    if (x.relation !== undefined)
      one(
        x.relation,
        ["matched-response", "related-receipt", "unrelated-concurrent"],
        `${xp}.relation`,
        y,
      );
  });
  if (
    v.decodedResponse !== null &&
    object(v.decodedResponse, `${p}.decodedResponse`, e)
  ) {
    for (const k of ["family", "kind", "summary"])
      str(v.decodedResponse[k], `${p}.decodedResponse.${k}`, e);
    spacedHex(
      v.decodedResponse.payloadHex,
      `${p}.decodedResponse.payloadHex`,
      e,
    );
    scalars(v.decodedResponse.fields, `${p}.decodedResponse.fields`, e);
  }
  bool(v.hostAccepted, `${p}.hostAccepted`, e);
  if (v.protocolAcknowledged !== null)
    bool(v.protocolAcknowledged, `${p}.protocolAcknowledged`, e);
  bool(v.deviceStateVerified, `${p}.deviceStateVerified`, e);
  bool(v.responseTimedOut, `${p}.responseTimedOut`, e);
  nullableStr(v.error, `${p}.error`, e);
  strings(v.findings, `${p}.findings`, e);
  strings(v.observationIds, `${p}.observationIds`, e);
  nullableStr(v.diagnosticRunId, `${p}.diagnosticRunId`, e);
}
function diagnosticRun(
  v: unknown,
  p: string,
  e: BundleValidationIssue[],
): void {
  if (!object(v, p, e)) return;
  for (const k of ["id", "toolId", "driverId", "startedAt", "purpose"])
    str(v[k], `${p}.${k}`, e);
  nullableStr(v.completedAt, `${p}.completedAt`, e);
  safety(v.safety, `${p}.safety`, e);
  if (obj(v.safety)) str(v.safety.explanation, `${p}.safety.explanation`, e);
  one(
    v.status,
    ["running", "passed", "failed", "restore-failed"],
    `${p}.status`,
    e,
  );
  array(v.steps, `${p}.steps`, e, (s, sp, x) => {
    if (!object(s, sp, x)) return;
    str(s.id, `${sp}.id`, x);
    str(s.label, `${sp}.label`, x);
    one(s.status, ["passed", "failed", "skipped"], `${sp}.status`, x);
    str(s.summary, `${sp}.summary`, x);
    strings(s.transactionIds, `${sp}.transactionIds`, x);
  });
  strings(v.findings, `${p}.findings`, e);
  nullableStr(v.error, `${p}.error`, e);
  bool(v.restorationAttempted, `${p}.restorationAttempted`, e);
  bool(v.restorationVerified, `${p}.restorationVerified`, e);
  strings(v.observationIds, `${p}.observationIds`, e);
}
function compilation(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  for (const k of ["id", "createdAt", "operation", "profileId"])
    str(v[k], `${p}.${k}`, e);
  one(
    v.contentType,
    ["graffiti", "animation", "gif", "text", "frame-border"],
    `${p}.contentType`,
    e,
  );
  for (const k of [
    "width",
    "height",
    "tileWidth",
    "tileCount",
    "programBytes",
    "crc32",
    "compressedBytes",
    "chunkCount",
    "pacingMs",
  ])
    num(v[k], `${p}.${k}`, e);
  one(v.compression, ["lzss-safe", "lzss"], `${p}.compression`, e);
  optNum(v.frameCount, `${p}.frameCount`, e);
  if (v.frameDelaysMs !== undefined)
    numbers(v.frameDelaysMs, `${p}.frameDelaysMs`, e);
  for (const k of [
    "sourceDimensions",
    "fitMode",
    "textContent",
    "textRendering",
    "transactionId",
  ])
    optStr(v[k], `${p}.${k}`, e);
}
function importedEvidence(
  v: unknown,
  p: string,
  e: BundleValidationIssue[],
): void {
  if (!object(v, p, e)) return;
  str(v.provenance, `${p}.provenance`, e);
  num(v.transactionCount, `${p}.transactionCount`, e);
  strings(v.warnings, `${p}.warnings`, e);
}
function investigation(
  v: unknown,
  p: string,
  e: BundleValidationIssue[],
): void {
  if (!object(v, p, e)) return;
  const clean = sanitizeInvestigation(v, "Imported bundle");
  if (!clean) {
    add(e, p, "invalid_value", "Investigation is structurally invalid.");
    return;
  }
  for (const [key, actual] of [
    ["completedTests", clean.completedTests.length],
    ["claimEvidence", clean.claimEvidence.length],
  ] as const) {
    const source = v[key];
    if (!Array.isArray(source) || source.length !== actual)
      add(
        e,
        `${p}.${key}`,
        "invalid_value",
        `One or more ${key} entries are malformed.`,
      );
  }
  if (obj(v.orchestration))
    for (const key of [
      "experiments",
      "transfers",
      "reopened",
      "recommendationTrail",
    ] as const) {
      const source = v.orchestration[key];
      if (!Array.isArray(source))
        add(
          e,
          `${p}.orchestration.${key}`,
          "invalid_type",
          "Expected an array.",
        );
      else if (clean.orchestration[key].length !== source.length)
        add(
          e,
          `${p}.orchestration.${key}`,
          "invalid_value",
          "One or more nested entries are malformed.",
        );
    }
}
function safety(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  one(
    v.risk,
    ["read-only", "transient", "persistent", "unknown"],
    `${p}.risk`,
    e,
  );
  one(
    v.persistence,
    ["none", "volatile", "persistent", "unknown"],
    `${p}.persistence`,
    e,
  );
  one(
    v.validation,
    ["unverified", "experimental", "verified", "rejected"],
    `${p}.validation`,
    e,
  );
}
function endpoint(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  str(v.serviceUuid, `${p}.serviceUuid`, e);
  str(v.characteristicUuid, `${p}.characteristicUuid`, e);
}

function add(
  e: BundleValidationIssue[],
  path: string,
  code: BundleValidationIssue["code"],
  message: string,
): void {
  e.push({ path, code, message });
}
function failure(
  path: string,
  code: BundleValidationIssue["code"],
  message: string,
): ParseBundleResult {
  return { success: false, errors: [{ path, code, message }] };
}
function obj(v: unknown): v is O {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function object(v: unknown, p: string, e: BundleValidationIssue[]): v is O {
  if (obj(v)) return true;
  add(e, p, "invalid_type", "Expected an object.");
  return false;
}
function str(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (typeof v !== "string") add(e, p, "invalid_type", "Expected a string.");
}
function optStr(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (v !== undefined) str(v, p, e);
}
function nullableStr(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (v !== null) str(v, p, e);
}
function bool(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (typeof v !== "boolean") add(e, p, "invalid_type", "Expected a boolean.");
}
function num(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (typeof v !== "number" || !Number.isFinite(v))
    add(e, p, "invalid_type", "Expected a finite number.");
}
function optNum(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (v !== undefined) num(v, p, e);
}
function positive(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0)
    add(e, p, "invalid_value", "Expected a positive integer.");
}
function one(
  v: unknown,
  a: readonly unknown[],
  p: string,
  e: BundleValidationIssue[],
): void {
  if (!a.includes(v))
    add(e, p, "invalid_value", `Expected one of: ${a.join(", ")}.`);
}
function iso(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (typeof v !== "string") str(v, p, e);
  else if (Number.isNaN(Date.parse(v)))
    add(e, p, "invalid_value", "Expected an ISO date/time string.");
}
function hex(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (typeof v !== "string") str(v, p, e);
  else if (v.length % 2 || !/^[0-9a-f]*$/i.test(v))
    add(e, p, "invalid_value", "Expected even-length hexadecimal data.");
}
function optHex(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (v !== undefined) hex(v, p, e);
}
function spacedHex(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (typeof v !== "string") str(v, p, e);
  else {
    const compact = v.replaceAll(" ", "");
    if (compact.length % 2 || !/^[0-9a-f]*$/i.test(compact))
      add(e, p, "invalid_value", "Expected hexadecimal bytes.");
  }
}
function array(
  v: unknown,
  p: string,
  e: BundleValidationIssue[],
  fn: (v: unknown, p: string, e: BundleValidationIssue[]) => void,
): unknown[] | null {
  if (!Array.isArray(v)) {
    add(e, p, "invalid_type", "Expected an array.");
    return null;
  }
  v.forEach((x, i) => fn(x, `${p}[${i}]`, e));
  return v;
}
function strings(v: unknown, p: string, e: BundleValidationIssue[]): void {
  array(v, p, e, str);
}
function optStrings(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (v !== undefined) strings(v, p, e);
}
function numbers(v: unknown, p: string, e: BundleValidationIssue[]): void {
  array(v, p, e, num);
}
function scalars(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  for (const [k, x] of Object.entries(v))
    if (
      x !== null &&
      !(
        ["string", "number", "boolean"].includes(typeof x) &&
        !(typeof x === "number" && !Number.isFinite(x))
      )
    )
      add(e, `${p}.${k}`, "invalid_type", "Expected a JSON scalar.");
}
function jsonObject(v: unknown, p: string, e: BundleValidationIssue[]): void {
  if (!object(v, p, e)) return;
  const visit = (x: unknown, xp: string): void => {
    if (
      x === null ||
      typeof x === "string" ||
      typeof x === "boolean" ||
      (typeof x === "number" && Number.isFinite(x))
    )
      return;
    if (Array.isArray(x)) {
      x.forEach((y, i) => visit(y, `${xp}[${i}]`));
      return;
    }
    if (obj(x)) {
      Object.entries(x).forEach(([k, y]) => visit(y, `${xp}.${k}`));
      return;
    }
    add(e, xp, "invalid_type", "Expected JSON-compatible data.");
  };
  Object.entries(v).forEach(([k, x]) => visit(x, `${p}.${k}`));
}
function bytes(v: string): number {
  return new TextEncoder().encode(v).byteLength;
}
function enforceBudget(v: string): void {
  if (bytes(v) > BUNDLE_INPUT_LIMITS.diagnosticBundleBytes)
    throw new BundleValidationError([
      {
        path: "$",
        code: "too_large",
        message: `Diagnostic bundle exceeds the ${BUNDLE_INPUT_LIMITS.diagnosticBundleBytes}-byte limit.`,
      },
    ]);
}
