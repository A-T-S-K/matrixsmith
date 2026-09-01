import { BrowserStorageRepository, type KeyValueStorage } from "./repository";
import { isValidObservationValue } from "../investigation/observations";
import type { Investigation } from "../investigation/investigation";

/**
 * Lightweight local persistence for hardware investigations, so testing can
 * span browser sessions. Only structured evidence persists — never
 * experimental unlocks, persistent-send confirmation tokens, safety
 * bypasses, or raw image/GIF binaries. On load, session-scoped claim
 * evidence is demoted to "previous-local-session": historical evidence never
 * bypasses current-session safety requirements.
 */

const KEY = "matrixsmith:v1:investigations";
const MAX_STORED = 8;

export interface StoredInvestigation {
  readonly savedAt: string;
  readonly investigation: Investigation;
}

interface StoreShape {
  readonly schemaVersion: 1;
  readonly investigations: readonly StoredInvestigation[];
}

export function saveInvestigation(investigation: Investigation, storage?: KeyValueStorage, now = new Date().toISOString()): void {
  try {
    const existing = loadStore(storage);
    const others = existing.investigations.filter((entry) => entry.investigation.id !== investigation.id);
    const next: StoreShape = {
      schemaVersion: 1,
      investigations: [{ savedAt: now, investigation: sanitizeForStorage(investigation) }, ...others].slice(0, MAX_STORED),
    };
    new BrowserStorageRepository(storage).set(KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable (private mode); history simply doesn't persist.
  }
}

export function loadInvestigationHistory(storage?: KeyValueStorage): readonly StoredInvestigation[] {
  return loadStore(storage).investigations;
}

/** The most recent stored investigation for a profile (or any, when profileId is null). */
export function latestInvestigationFor(profileId: string | null, storage?: KeyValueStorage): StoredInvestigation | null {
  const history = loadInvestigationHistory(storage);
  return history.find((entry) => profileId === null || entry.investigation.profileId === profileId) ?? null;
}

/** Demote session evidence to historical scope for resuming in a NEW session. */
export function toHistoricalInvestigation(investigation: Investigation): Investigation {
  return {
    ...investigation,
    claimEvidence: investigation.claimEvidence.map((entry) => entry.scope === "current-session" ? { ...entry, scope: "previous-local-session" as const } : entry),
  };
}

export function forgetInvestigationHistory(storage?: KeyValueStorage): void {
  try { new BrowserStorageRepository(storage).remove(KEY); } catch { /* nothing to forget */ }
}

function sanitizeForStorage(investigation: Investigation): Investigation {
  // Structural whitelist: only known fields are persisted, and observation
  // values must be valid structured observations.
  return {
    id: investigation.id, createdAt: investigation.createdAt, updatedAt: investigation.updatedAt,
    profileId: investigation.profileId, deviceName: investigation.deviceName,
    goal: { kind: investigation.goal.kind, description: investigation.goal.description, ...(investigation.goal.symptomId ? { symptomId: investigation.goal.symptomId } : {}) },
    status: investigation.status,
    completedTests: investigation.completedTests.map((test) => ({
      testId: test.testId, title: test.title, startedAt: test.startedAt, completedAt: test.completedAt,
      status: test.status, observations: test.observations.filter((value) => isValidObservationValue(value)),
      established: [...test.established], rejected: [...test.rejected], unknowns: [...test.unknowns],
      summary: test.summary, transactionIds: [...test.transactionIds],
      ...(test.parameters ? { parameters: { ...test.parameters } } : {}),
    })),
    claimEvidence: [...investigation.claimEvidence],
    notes: [...investigation.notes],
  };
}

function loadStore(storage?: KeyValueStorage): StoreShape {
  try {
    const raw = new BrowserStorageRepository(storage).get(KEY);
    if (!raw) return { schemaVersion: 1, investigations: [] };
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || (value as { schemaVersion?: unknown }).schemaVersion !== 1) return { schemaVersion: 1, investigations: [] };
    const entries = (value as { investigations?: unknown }).investigations;
    if (!Array.isArray(entries)) return { schemaVersion: 1, investigations: [] };
    return { schemaVersion: 1, investigations: entries.filter(isStoredInvestigation) };
  } catch {
    return { schemaVersion: 1, investigations: [] };
  }
}

function isStoredInvestigation(value: unknown): value is StoredInvestigation {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as { savedAt?: unknown; investigation?: unknown };
  if (typeof entry.savedAt !== "string" || typeof entry.investigation !== "object" || entry.investigation === null) return false;
  const investigation = entry.investigation as Record<string, unknown>;
  return typeof investigation.id === "string" && typeof investigation.goal === "object"
    && Array.isArray(investigation.completedTests) && Array.isArray(investigation.claimEvidence)
    && (investigation.status === "active" || investigation.status === "stopped");
}
