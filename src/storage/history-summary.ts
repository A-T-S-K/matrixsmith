import type { StoredInvestigationView } from "../presentation/store";
import type { KeyValueStorage } from "../application/ports/persistence";
import { INVESTIGATIONS_KEY, INVESTIGATION_HISTORY_BYTE_LIMIT } from "./keys";
/** A bounded display-only projection; the full validator still gates resume. */
export function readStoredInvestigationSummary(
  storage: Pick<KeyValueStorage, "getItem">,
): StoredInvestigationView | null {
  try {
    const raw = storage.getItem(INVESTIGATIONS_KEY);
    if (
      !raw ||
      new TextEncoder().encode(raw).byteLength >
        INVESTIGATION_HISTORY_BYTE_LIMIT
    )
      return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.schemaVersion !== 2) return null;
    const entries = value.investigations;
    if (!Array.isArray(entries) || !isRecord(entries[0])) return null;
    const savedAt = entries[0].savedAt;
    const investigation = entries[0].investigation;
    if (typeof savedAt !== "string" || !isRecord(investigation)) return null;
    const goal = investigation.goal;
    const completedTests = investigation.completedTests;
    if (!isRecord(goal) || !Array.isArray(completedTests)) return null;
    const deviceName =
      typeof investigation.deviceName === "string"
        ? investigation.deviceName
        : null;
    const goalLabel =
      typeof goal.description === "string" && goal.description
        ? goal.description
        : typeof goal.kind === "string"
          ? goal.kind
          : "Saved investigation";
    const orchestration = investigation.orchestration;
    const experiments = isRecord(orchestration)
      ? orchestration.experiments
      : undefined;
    return {
      savedAt,
      deviceName,
      goalLabel,
      testCount: completedTests.length,
      matchesProfile: false,
      sameAuthorizedDevice: false,
      experimentCount: Array.isArray(experiments) ? experiments.length : 0,
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
