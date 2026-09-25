import { INVESTIGATIONS_KEY, INVESTIGATION_HISTORY_BYTE_LIMIT } from "./keys";
export { INVESTIGATIONS_KEY, INVESTIGATION_HISTORY_BYTE_LIMIT } from "./keys";
import {
  BrowserStorageRepository,
  storageFailure,
  type KeyValueStorage,
  type PersistenceResult,
} from "./repository";
import {
  demoteInvestigationEvidence,
  type Investigation,
} from "../investigation/investigation";
import { sanitizeInvestigation } from "../investigation/serialization";

/**
 * Lightweight local persistence for hardware investigations, so testing can
 * span browser sessions. Only structured evidence persists — never
 * experimental unlocks, persistent-send confirmation tokens, safety
 * bypasses, or raw image/GIF binaries. LocalStorage is user-controlled,
 * untrusted application storage: on load, EVERY piece of investigation claim
 * evidence is structurally demoted to "previous-local-session" regardless of
 * its serialized scope field, so a corrupt or malicious record claiming
 * "built-in-profile" or "current-session" authority can never bypass
 * operational gates.
 *
 * Semantic orchestration — experiments, their attempts (valid AND invalid),
 * transfers and their reasons — persists too. Without it, a report that had
 * just explained "attempt 1 missed, attempt 2 valid" lost that distinction
 * the moment the investigation was saved and resumed, which is the one thing
 * the attempt model exists to preserve.
 *
 * What deliberately does NOT survive is operational authority. Restored
 * orchestration is historical metadata: in particular, the belief that a
 * diagnostic is physically on the panel is always reloaded as UNKNOWN. A
 * saved session can honestly say "this was the last program sent"; only a
 * live observation can say "this is on the display now".
 *
 * The structural validation itself lives in investigation/serialization, so
 * that storage and diagnostic bundles cannot drift into two validators of
 * differing strictness for the same shape.
 */

const MAX_STORED = 8;
const SCHEMA_VERSION = 2;

const SAVED_PANEL_REASON =
  "Saved to local history; whether this program is still on the display was not observed.";
const LOADED_PANEL_REASON =
  "Restored from local history; what the display is showing now was not observed.";

export interface StoredInvestigation {
  readonly savedAt: string;
  readonly investigation: Investigation;
}

interface StoreShape {
  readonly schemaVersion: number;
  readonly investigations: readonly StoredInvestigation[];
}

export function saveInvestigation(
  investigation: Investigation,
  storage?: KeyValueStorage,
  now = new Date().toISOString(),
): PersistenceResult {
  try {
    const sanitized = sanitizeInvestigation(investigation, SAVED_PANEL_REASON);
    if (!sanitized)
      return {
        ok: false,
        reason: "invalid-data",
        message: "Investigation is invalid and was not saved.",
      };
    const existing = loadStore(storage);
    const others = existing.investigations.filter(
      (entry) => entry.investigation.id !== investigation.id,
    );
    const next: StoreShape = {
      schemaVersion: SCHEMA_VERSION,
      investigations: [
        { savedAt: now, investigation: sanitized },
        ...others,
      ].slice(0, MAX_STORED),
    };
    const json = JSON.stringify(next);
    if (
      new TextEncoder().encode(json).byteLength >
      INVESTIGATION_HISTORY_BYTE_LIMIT
    )
      return {
        ok: false,
        reason: "too-large",
        message: "Investigation history exceeds the local 2 MiB limit.",
      };
    new BrowserStorageRepository(storage).set(INVESTIGATIONS_KEY, json);
    return { ok: true };
  } catch (error) {
    return storageFailure(error);
  }
}

export function loadInvestigationHistory(
  storage?: KeyValueStorage,
): readonly StoredInvestigation[] {
  return loadStore(storage).investigations;
}

/** The most recent stored investigation for a profile (or any, when profileId is null). */
export function latestInvestigationFor(
  profileId: string | null,
  storage?: KeyValueStorage,
): StoredInvestigation | null {
  const history = loadInvestigationHistory(storage);
  return (
    history.find(
      (entry) =>
        profileId === null || entry.investigation.profileId === profileId,
    ) ?? null
  );
}

/**
 * Demote ALL stored evidence to the historical local scope for resuming in a
 * new session. The serialized scope field is never trusted — see the module
 * comment.
 */
export function toHistoricalInvestigation(
  investigation: Investigation,
): Investigation {
  return demoteInvestigationEvidence(investigation, "previous-local-session");
}

export function forgetInvestigationHistory(
  storage?: KeyValueStorage,
): PersistenceResult {
  try {
    new BrowserStorageRepository(storage).remove(INVESTIGATIONS_KEY);
    return { ok: true };
  } catch (error) {
    return storageFailure(error);
  }
}

function loadStore(storage?: KeyValueStorage): StoreShape {
  const empty: StoreShape = {
    schemaVersion: SCHEMA_VERSION,
    investigations: [],
  };
  try {
    const raw = new BrowserStorageRepository(storage).get(INVESTIGATIONS_KEY);
    if (!raw) return empty;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return empty;
    const version = (value as { schemaVersion?: unknown }).schemaVersion;
    if (version !== SCHEMA_VERSION) return empty;
    const entries = (value as { investigations?: unknown }).investigations;
    if (!Array.isArray(entries)) return empty;
    const restored: StoredInvestigation[] = [];
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as { savedAt?: unknown; investigation?: unknown };
      if (typeof record.savedAt !== "string") continue;
      const investigation = sanitizeInvestigation(
        record.investigation,
        LOADED_PANEL_REASON,
      );
      if (investigation)
        restored.push({ savedAt: record.savedAt, investigation });
    }
    return { schemaVersion: SCHEMA_VERSION, investigations: restored };
  } catch {
    return empty;
  }
}
