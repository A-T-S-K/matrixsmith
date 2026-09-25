import type { Capability, CapabilityId } from "../../core/capabilities";
import type { Persistence, RiskClass } from "../../core/risk";
import {
  allContentGates,
  type ContentPathId,
} from "../../investigation/gating";
import {
  claimConflicts,
  operationalTrust,
  resolveClaims,
  type ClaimEvidence,
  type ClaimId,
  type ClaimState,
} from "../../investigation/claims";
import {
  evaluateStaticViability,
  type StaticViabilityAssessment,
} from "../../investigation/static-viability";
import type { DeviceTarget } from "./target";
import { targetCanPlanContent } from "./target";
import type {
  OperationDefinition,
  OperationalContext,
} from "../../drivers/types";

export interface OperationSafety {
  readonly hazard: "routine" | "experimental" | "destructive" | "firmware";
  readonly persistence: "none" | "volatile" | "device-stored" | "unknown";
  readonly assurance: "verified" | "experimental" | "unknown" | "rejected";
}

export interface EvidenceSummary {
  readonly scope: ClaimEvidence["scope"];
  readonly status: ClaimEvidence["status"];
  readonly summary: string;
}

export interface CapabilityAssessment {
  readonly id: CapabilityId;
  readonly label: string;
  readonly availability: "available" | "blocked" | "unsupported";
  readonly confidence: "verified" | "experimental" | "unknown" | "conflicted";
  readonly reason: string;
  readonly evidence: readonly EvidenceSummary[];
  readonly missingClaims: readonly ClaimId[];
  readonly safety: OperationSafety;
}

export interface DeviceAction {
  readonly id: string;
  readonly operationId:
    import("../../core/operations").MatrixOperation["type"] | null;
  readonly label: string;
  readonly capabilityId: CapabilityId | null;
  readonly availability: CapabilityAssessment["availability"];
  readonly confidence: CapabilityAssessment["confidence"];
  readonly reason: string;
  readonly evidence: readonly EvidenceSummary[];
  readonly missingClaims: readonly ClaimId[];
  readonly safety: OperationSafety;
}

export interface DeviceAssessment {
  readonly readiness:
    | "no-device"
    | "inspecting"
    | "needs-identification"
    | "needs-geometry"
    | "ready"
    | "limited"
    | "offline";
  readonly summary: string;
  readonly capabilities: Readonly<Record<CapabilityId, CapabilityAssessment>>;
  readonly strategies: StaticViabilityAssessment;
  readonly actions: readonly DeviceAction[];
  readonly recommendedActionId: string | null;
  readonly unresolvedClaims: readonly ClaimState[];
  readonly conflicts: readonly ClaimState[];
}

export interface AssessmentInput {
  readonly target: DeviceTarget | null;
  readonly evidence: readonly ClaimEvidence[];
  readonly capabilities: readonly Capability[];
  readonly live: boolean;
  readonly inspecting?: boolean;
  /** Selected driver's operation contribution for operational targets. */
  readonly operations?: (
    context: OperationalContext,
  ) => readonly OperationDefinition[];
}

const CAPABILITY_LABELS: Readonly<Record<CapabilityId, string>> = {
  "device-info": "Device information",
  brightness: "Brightness",
  "scroll-speed": "Scroll speed",
  "display-mode": "Display mode",
  power: "Power",
  "static-frame": "Static image",
  animation: "Animation",
  text: "Text",
  gif: "GIF",
};

const REQUIREMENTS: Readonly<
  Partial<Record<CapabilityId, readonly ClaimId[]>>
> = {
  "device-info": ["protocol.coolledux", "device-info.query"],
  brightness: ["protocol.coolledux", "brightness.control"],
  power: ["protocol.coolledux", "power.control"],
  "static-frame": ["stored-program.upload", "static.strategy"],
  text: ["stored-program.upload", "static.strategy"],
  animation: [
    "stored-program.upload",
    "animation.frames",
    "animation.timing",
    "animation.tile-sync",
  ],
  gif: ["stored-program.upload", "gif.playback"],
};

const CONTENT_PATH: Readonly<Partial<Record<CapabilityId, ContentPathId>>> = {
  "static-frame": "image",
  text: "text",
  animation: "animation",
  gif: "gif",
};

const ALL_CAPABILITIES = Object.keys(CAPABILITY_LABELS) as CapabilityId[];

function safetyFor(capability: Capability | undefined): OperationSafety {
  const risk = capability?.risk;
  const assurance =
    capability?.validation === "verified"
      ? "verified"
      : capability?.validation === "experimental"
        ? "experimental"
        : capability?.validation === "rejected"
          ? "rejected"
          : "unknown";
  return {
    hazard:
      risk === "destructive"
        ? "destructive"
        : risk === "firmware"
          ? "firmware"
          : assurance === "verified"
            ? "routine"
            : "experimental",
    persistence: persistenceFor(capability?.persistence),
    assurance,
  };
}

function persistenceFor(
  value: Persistence | undefined,
): OperationSafety["persistence"] {
  if (value === "persistent") return "device-stored";
  if (value === "none" || value === "volatile" || value === "unknown")
    return value;
  return "unknown";
}

function missingClaims(
  id: CapabilityId,
  evidence: readonly ClaimEvidence[],
): readonly ClaimId[] {
  return (REQUIREMENTS[id] ?? []).filter(
    (claimId) => !operationalTrust(claimId, evidence).trusted,
  );
}

function confidenceFor(
  capability: Capability | undefined,
  claims: readonly ClaimId[],
  evidence: readonly ClaimEvidence[],
): CapabilityAssessment["confidence"] {
  if (
    claims.some(
      (claimId) => operationalTrust(claimId, evidence).historicalConflict,
    )
  )
    return "conflicted";
  if (!capability) return "unknown";
  if (
    capability.validation === "verified" &&
    claims.every((claimId) => operationalTrust(claimId, evidence).trusted)
  )
    return "verified";
  if (
    capability.validation === "experimental" ||
    capability.validation === "verified"
  )
    return "experimental";
  return "unknown";
}

function capabilityAssessment(
  id: CapabilityId,
  capability: Capability | undefined,
  input: AssessmentInput,
): CapabilityAssessment {
  const claims = REQUIREMENTS[id] ?? [];
  const missing = missingClaims(id, input.evidence);
  const safety = safetyFor(capability);
  const gate = CONTENT_PATH[id]
    ? allContentGates(input.evidence).find(
        ({ path }) => path === CONTENT_PATH[id],
      )
    : null;
  let availability: CapabilityAssessment["availability"] = "blocked";
  let reason = "Connect and identify a display first.";
  if (capability && !capability.supported) {
    availability = "unsupported";
    reason = "This driver does not support the capability.";
  } else if (safety.hazard === "destructive" || safety.hazard === "firmware") {
    availability = "blocked";
    reason = "MatrixSmith blocks destructive and firmware operations.";
  } else if (!capability) {
    reason =
      input.target && input.target.kind !== "unresolved"
        ? "This driver does not provide this operation."
        : reason;
  } else if (!input.live) {
    reason = "Reconnect the physical display to use this operation.";
  } else if (!input.target || input.target.kind === "unresolved") {
    reason = "Identify the protocol family before using this operation.";
  } else if (CONTENT_PATH[id] && !targetCanPlanContent(input.target)) {
    reason = "Confirm the display geometry before sending content.";
  } else if (gate && !gate.allowed) {
    reason = gate.reason;
  } else if (missing.length > 0) {
    reason = `Missing trusted evidence for ${missing.join(", ")}.`;
  } else {
    availability = "available";
    reason =
      safety.assurance === "verified"
        ? "Available with trusted device evidence."
        : "Available as an experimental operation.";
  }
  const evidence = claims
    .flatMap((claimId) =>
      input.evidence.filter((entry) => entry.claimId === claimId),
    )
    .map(({ scope, status, summary }) => ({ scope, status, summary }));
  return {
    id,
    label: capability?.label ?? CAPABILITY_LABELS[id],
    availability,
    confidence: confidenceFor(capability, claims, input.evidence),
    reason,
    evidence,
    missingClaims: missing,
    safety,
  };
}

function actionFor(operation: OperationDefinition): DeviceAction {
  return {
    id: operation.id,
    operationId: operation.operationId,
    label: operation.label,
    capabilityId: operation.capabilityId,
    availability: operation.availability,
    confidence: operation.confidence,
    reason: operation.reason,
    evidence: operation.evidence,
    missingClaims: operation.missingClaims,
    safety: operation.safety,
  };
}

function readiness(
  input: AssessmentInput,
  available: readonly CapabilityAssessment[],
): Pick<DeviceAssessment, "readiness" | "summary"> {
  if (!input.target)
    return input.inspecting
      ? { readiness: "inspecting", summary: "Inspecting the selected display." }
      : {
          readiness: "no-device",
          summary: "Connect a display or open an offline report.",
        };
  if (!input.live)
    return {
      readiness: "offline",
      summary: "Reviewing offline evidence. Reconnect before transmitting.",
    };
  if (input.target.kind === "unresolved")
    return {
      readiness: "needs-identification",
      summary: "Run the available read-only identification step.",
    };
  if (
    input.target.kind === "protocol-identified" &&
    input.target.geometry === null
  )
    return {
      readiness: "needs-geometry",
      summary: "Protocol identified. Confirm the display geometry to continue.",
    };
  if (available.some(({ availability }) => availability === "available"))
    return {
      readiness: "ready",
      summary:
        input.target.kind === "profile-resolved"
          ? "This model is ready for normal use."
          : "This provisional display is ready for bounded testing.",
    };
  return {
    readiness: "limited",
    summary:
      "The display is identified, but more evidence is needed before normal use.",
  };
}

export function assessDevice(input: AssessmentInput): DeviceAssessment {
  const targetEvidence =
    input.target?.kind === "protocol-identified"
      ? [input.target.identificationEvidence]
      : input.target?.kind === "provisional"
        ? input.target.identificationEvidence
        : [];
  const assessedInput: AssessmentInput = {
    ...input,
    evidence: [...input.evidence, ...targetEvidence],
  };
  const byCapability = new Map(
    input.capabilities.map((capability) => [capability.id, capability]),
  );
  const assessed = ALL_CAPABILITIES.map((id) =>
    capabilityAssessment(id, byCapability.get(id), assessedInput),
  );
  const capabilities = Object.fromEntries(
    assessed.map((capability) => [capability.id, capability]),
  ) as Record<CapabilityId, CapabilityAssessment>;
  const state = readiness(assessedInput, assessed);
  const resolvedClaims = resolveClaims(assessedInput.evidence);
  const unresolvedClaims = resolvedClaims.filter(
    ({ status }) => status === "unknown" || status === "unresolved",
  );
  const conflictingIds = new Set(
    claimConflicts(assessedInput.evidence).map(({ claimId }) => claimId),
  );
  const conflicts = resolvedClaims.filter(({ id }) => conflictingIds.has(id));
  const identifySafety: OperationSafety = {
    hazard: "routine",
    persistence: "none",
    assurance: "verified",
  };
  const baseAssessment: DeviceAssessment = {
    ...state,
    capabilities,
    strategies: evaluateStaticViability(assessedInput.evidence),
    actions: [],
    recommendedActionId: null,
    unresolvedClaims,
    conflicts,
  };
  let actions: DeviceAction[] = [];
  if (input.target?.kind === "unresolved") {
    actions = [
      {
        id: "identify-family",
        operationId: null,
        label: "Identify this display",
        capabilityId: null,
        availability: input.live ? "available" : "blocked",
        confidence: "verified",
        reason: input.live
          ? "Runs a bounded read-only family probe."
          : "Reconnect to identify the display.",
        evidence: [],
        missingClaims: [],
        safety: identifySafety,
      },
    ];
  } else if (
    input.operations &&
    input.target &&
    targetCanPlanContent(input.target)
  ) {
    actions = input
      .operations({
        target: input.target,
        assessment: baseAssessment,
      })
      .map(actionFor);
  }
  const preferred =
    state.readiness === "ready"
      ? (actions.find(
          ({ id, availability }) =>
            id === "capability:text" && availability === "available",
        ) ??
        actions.find(
          ({ id, availability }) =>
            id === "capability:static-frame" && availability === "available",
        ))
      : undefined;
  const recommendedActionId =
    preferred?.id ??
    actions.find(({ availability }) => availability === "available")?.id ??
    null;
  return {
    ...baseAssessment,
    actions,
    recommendedActionId,
  };
}

export function operationSafety(
  risk: RiskClass,
  persistence: Persistence,
  assurance: OperationSafety["assurance"],
): OperationSafety {
  return safetyFor({
    risk,
    persistence,
    validation: assurance === "unknown" ? "unverified" : assurance,
    id: "device-info",
    label: "",
    supported: true,
    live: true,
    evidenceConfidence: "unknown",
    evidenceRefs: [],
  });
}
