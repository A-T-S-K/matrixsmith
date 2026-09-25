import { useSyncExternalStore } from "preact/compat";
import { rawWordHex, SYMPTOM_LABELS } from "./dependencies";
import type {
  GattEndpoint,
  ImportedEvidence,
  Recommendation,
  DiagnosticRegion,
  DeviceAssessment,
  ProtocolTransaction,
  AttemptFailureKind,
  ClaimState,
  SymptomId,
  ObservationFieldSpec,
  AttemptValidity,
} from "./dependencies";
import type {
  AppSnapshot,
  ImportSummary,
  DiagnosticRegionView,
  RecommendationView,
  SupportArea,
  TransactionFilter,
  ObservationPresentation,
  SupportState,
} from "./types";

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16) || 0,
    g: Number.parseInt(value.slice(2, 4), 16) || 0,
    b: Number.parseInt(value.slice(4, 6), 16) || 0,
  };
}

export function summarizeImport(evidence: ImportedEvidence): ImportSummary {
  return {
    deviceName: evidence.deviceName,
    bleAddress: evidence.bleAddress,
    serviceCount: evidence.fingerprint?.services.length ?? 0,
    characteristicCount:
      evidence.fingerprint?.services.reduce(
        (total, service) => total + service.characteristics.length,
        0,
      ) ?? 0,
    transactionCount: evidence.transactions.length,
    decodedCount: evidence.transactions.filter(
      (t) => t.decodedResponse !== null,
    ).length,
    warnings: evidence.warnings,
    unparsedLineCount: evidence.unparsedLineCount,
    provenance: evidence.provenance,
  };
}

export const SCOPE_LABELS: Readonly<
  Record<ClaimState["evidence"][number]["scope"], string>
> = {
  "current-session": "this session",
  "previous-local-session": "previous local session",
  "imported-external": "imported evidence",
  "built-in-profile": "built-in profile",
  "source-reference": "source reference",
};

export const SYMPTOM_ROWS: readonly {
  readonly id: SymptomId;
  readonly label: string;
}[] = (Object.entries(SYMPTOM_LABELS) as [SymptomId, string][]).map(
  ([id, label]) => ({ id, label }),
);

export function recommendationView(
  recommendation: Recommendation | null,
): RecommendationView | null {
  if (!recommendation) return null;
  return {
    testId: recommendation.testId,
    title: recommendation.title,
    description: recommendation.description,
    why: recommendation.why,
    estimatedObservationTime: recommendation.estimatedObservationTime,
    risk: recommendation.risk,
    category: recommendation.category,
  };
}

/**
 * How a test should be presented. Derived from what the test actually
 * declares rather than hand-tagged, so a new test cannot drift out of sync
 * with its own content: questions about places get the spatial framework,
 * a measured timeline gets the timed one, everything else stays a short
 * plain list.
 */
export function presentationFor(test: {
  readonly observation: readonly ObservationFieldSpec[];
  readonly timer?: unknown;
}): ObservationPresentation {
  // A measured timeline dominates: the physical event happens once and cannot
  // wait for a question to be answered first. Region-linked follow-up
  // questions still get the spatial treatment once the timing is captured.
  if (test.timer) return "timed";
  if (test.observation.some((spec) => spec.regionId !== undefined))
    return "spatial";
  return "simple";
}

/** The declared parameter set of the resolved operation, for attempt records. */
export function operationParameters(
  operation: import("../../core/operations").MatrixOperation,
): Record<string, number> {
  if (operation.type !== "ShowDiagnostic" || !operation.parameters) return {};
  return { ...operation.parameters };
}

export function regionView(region: DiagnosticRegion): DiagnosticRegionView {
  return {
    id: region.id,
    shortLabel: region.shortLabel,
    displayLabel: region.displayLabel,
    description: region.description,
    groupId: region.groupId ?? null,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    rawWordHex:
      region.technical.rawWord === undefined
        ? null
        : rawWordHex(region.technical.rawWord),
    expected: region.technical.expectedUnderHypothesis ?? null,
    technicalNotes: region.technical.notes ?? [],
  };
}

export function useMatrixSnapshot(store: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => AppSnapshot;
}): AppSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
export function endpointKey(endpoint: GattEndpoint): string {
  return `${endpoint.serviceUuid.toLowerCase()}/${endpoint.characteristicUuid.toLowerCase()}`;
}
/** Turns user text like "FFF0, a950" into chooser-ready service UUIDs; 4-hex shorthand expands to the full base UUID. */
export function recommendedAction(
  connected: boolean,
  resolved: boolean,
  ambiguous: boolean,
  live = true,
  _unusedEvidence: readonly unknown[] = [],
  ready = false,
): AppSnapshot["recommended"] {
  if (!connected)
    return {
      title: "Connect display",
      description:
        "Connect a supported display or open an existing diagnostic report.",
      action: "connect",
    };
  if (!live)
    return {
      title: "Review imported evidence",
      description:
        "This is an offline report. Explore Diagnose and Develop; live operations remain blocked.",
      action: "none",
    };
  if (ambiguous && !resolved)
    return {
      title: "Run safe identification",
      description:
        "Use the verified read-only CoolLEDUX device-info query to resolve this shared GATT profile.",
      action: "identify",
    };
  if (resolved) {
    // A display whose profile already establishes a usable static substrate
    // is ready to use. Leading with "validate the static framebuffer" would
    // make characterization look mandatory for work that is already done.
    if (ready)
      return {
        title: "Create content",
        description:
          "This display is a known, characterized profile. Verified image, text, and animation operations update it directly with target-bound authorization.",
        action: "none",
      };
    return {
      title: "Run safe device checks",
      description:
        "Refresh device info, or explicitly validate brightness with automatic restoration.",
      action: "checks",
    };
  }
  return {
    title: "Collect GATT evidence",
    description:
      "No safe family probe is available. Inspect services without writing.",
    action: "none",
  };
}

export function supportRows(
  assessment: DeviceAssessment,
): readonly SupportArea[] {
  const rows: SupportArea[] = [
    {
      id: "bluetooth-transport",
      label: "Bluetooth transport",
      state:
        assessment.readiness === "no-device"
          ? "Unknown"
          : assessment.readiness === "offline"
            ? "Experimental"
            : "Verified",
      evidence: assessment.summary,
    },
    {
      id: "protocol-identity",
      label: "Protocol identity",
      state:
        assessment.readiness === "needs-identification"
          ? "Not tested"
          : assessment.readiness === "no-device"
            ? "Unknown"
            : "Verified",
      evidence: assessment.summary,
    },
  ];
  for (const capability of Object.values(assessment.capabilities)) {
    const state: SupportState =
      capability.availability === "unsupported"
        ? "Unsupported"
        : capability.confidence === "conflicted"
          ? "Rejected"
          : capability.confidence === "verified"
            ? "Verified"
            : capability.confidence === "experimental"
              ? "Experimental"
              : capability.availability === "blocked"
                ? "Not tested"
                : "Unknown";
    rows.push({
      id: capability.id,
      label: capability.label,
      state,
      evidence: capability.reason,
    });
  }
  return rows;
}

export function recommendedFromAssessment(
  assessment: DeviceAssessment,
): AppSnapshot["recommended"] {
  switch (assessment.readiness) {
    case "no-device":
      return {
        title: "Connect display",
        description: assessment.summary,
        action: "connect",
      };
    case "inspecting":
      return {
        title: "Inspecting display",
        description: assessment.summary,
        action: "none",
      };
    case "needs-identification":
      return {
        title: "Identify this display",
        description: assessment.summary,
        action: "identify",
      };
    case "needs-geometry":
      return {
        title: "Confirm display size",
        description: assessment.summary,
        action: "checks",
      };
    case "ready":
      return {
        title: "Create content",
        description: assessment.summary,
        action: "none",
      };
    case "limited":
      return {
        title: "Continue investigation",
        description: assessment.summary,
        action: "checks",
      };
    case "offline":
      return {
        title: "Review imported evidence",
        description: assessment.summary,
        action: "none",
      };
  }
}
export function filterTransactions(
  values: readonly ProtocolTransaction[],
  filter: TransactionFilter,
  search: string,
): ProtocolTransaction[] {
  const query = search.trim().toLowerCase();
  return values.filter((t) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "txrx" && t.packets.length > 0) ||
      (filter === "queries" && /get|read/i.test(t.operation)) ||
      (filter === "probes" && t.source === "probe") ||
      (filter === "diagnostics" && t.source === "diagnostic") ||
      (filter === "errors" && Boolean(t.error || t.responseTimedOut));
    if (!matchesFilter) return false;
    if (!query) return true;
    return [
      t.operation,
      t.driverId,
      t.decodedResponse?.summary,
      ...t.packets.map((p) => p.hex),
      t.decodedResponse?.opcode === undefined
        ? ""
        : `0x${t.decodedResponse.opcode.toString(16)}`,
    ].some((value) =>
      String(value ?? "")
        .toLowerCase()
        .includes(query),
    );
  });
}

/**
 * Why an attempt failed, from how its measurement ended.
 *
 * A transport failure and a mistimed tap both invalidate an attempt and mean
 * entirely different things; a report that cannot tell them apart blames the
 * person for the radio dropping out.
 */
export function attemptFailureKind(
  validity: AttemptValidity,
): AttemptFailureKind | null {
  switch (validity) {
    case "valid":
      return null;
    case "transfer-failed":
      return "transfer-failed";
    case "user-restarted":
      return "user-restarted";
    case "incomplete":
      return "observation-incomplete";
    case "missed-t1":
    case "missed-t2":
    case "accidental-tap":
      return "human-missed";
  }
}
