import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INVESTIGATIONS_KEY,
  INVESTIGATION_HISTORY_BYTE_LIMIT,
  forgetInvestigationHistory,
  latestInvestigationFor,
  loadInvestigationHistory,
  saveInvestigation,
  toHistoricalInvestigation,
} from "../../src/storage/investigations";
import {
  createInvestigation,
  recordCompletedTest,
} from "../../src/investigation/investigation";
import * as serialization from "../../src/investigation/serialization";
import { readStoredInvestigationSummary } from "../../src/storage/history-summary";
import type { KeyValueStorage } from "../../src/storage/repository";

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function sampleInvestigation(profileId = "iledhat-31ae-32x16") {
  let investigation = createInvestigation({
    profileId,
    deviceName: "iLedHat",
    goal: { kind: "develop", description: "characterize" },
  });
  investigation = recordCompletedTest(
    investigation,
    {
      testId: "coolledux-graffiti-black",
      title: "Test static-image black behavior",
      startedAt: "2026-08-31T10:00:00.000Z",
      completedAt: "2026-08-31T10:01:00.000Z",
      status: "passed",
      observations: [
        { kind: "choice", fieldId: "zero-appearance", optionId: "off-black" },
      ],
      established: ["0x0000 off"],
      rejected: [],
      unknowns: [],
      summary: "off",
      transactionIds: ["transaction:1"],
    },
    [
      {
        claimId: "graffiti.black-semantics",
        status: "verified",
        scope: "current-session",
        provenance: "observed",
        summary: "off",
        testId: "coolledux-graffiti-black",
      },
    ],
  );
  return investigation;
}

afterEach(() => vi.restoreAllMocks());

describe("local investigation history", () => {
  it.each([0, 1])(
    "enforces the UTF-8 byte limit before parsing at limit + %i bytes",
    (excess) => {
      const storage = memoryStorage();
      const investigation = { ...sampleInvestigation(), deviceName: "Léd 😀" };
      expect(saveInvestigation(investigation, storage).ok).toBe(true);
      const original = storage.getItem(INVESTIGATIONS_KEY)!;
      const padded =
        original +
        " ".repeat(
          INVESTIGATION_HISTORY_BYTE_LIMIT -
            new TextEncoder().encode(original).byteLength +
            excess,
        );
      expect(new TextEncoder().encode(padded).byteLength).toBe(
        INVESTIGATION_HISTORY_BYTE_LIMIT + excess,
      );
      // Trailing whitespace is valid JSON; the Unicode name also distinguishes bytes from string length.
      expect(padded.length).toBeLessThanOrEqual(
        INVESTIGATION_HISTORY_BYTE_LIMIT,
      );
      expect(JSON.parse(padded).investigations[0].investigation.id).toBe(
        investigation.id,
      );
      storage.setItem(INVESTIGATIONS_KEY, padded);
      const parse = vi.spyOn(JSON, "parse");
      const sanitize = vi.spyOn(serialization, "sanitizeInvestigation");
      const history = loadInvestigationHistory(storage);
      expect(parse).toHaveBeenCalledTimes(excess ? 0 : 1);
      expect(sanitize).toHaveBeenCalledTimes(excess ? 0 : 1);
      if (excess) {
        expect(history).toEqual([]);
        expect(latestInvestigationFor(null, storage)).toBeNull();
        expect(readStoredInvestigationSummary(storage)).toBeNull();
        expect(parse.mock.calls.length).toBe(0);
        expect(sanitize.mock.calls.length).toBe(0);
      } else {
        expect(history).toHaveLength(1);
        const historical = toHistoricalInvestigation(history[0]!.investigation);
        expect(historical.claimEvidence).toHaveLength(1);
        expect(historical.claimEvidence[0]!.scope).toBe(
          "previous-local-session",
        );
      }
      expect(storage.getItem(INVESTIGATIONS_KEY)).toBe(padded);
    },
  );
  it("persists and reloads investigations", () => {
    const storage = memoryStorage();
    const investigation = sampleInvestigation();
    saveInvestigation(investigation, storage);
    const history = loadInvestigationHistory(storage);
    expect(history).toHaveLength(1);
    expect(history[0]!.investigation.id).toBe(investigation.id);
    expect(
      history[0]!.investigation.completedTests[0]!.observations[0],
    ).toEqual({
      kind: "choice",
      fieldId: "zero-appearance",
      optionId: "off-black",
    });
  });

  it("finds the latest investigation for a profile", () => {
    const storage = memoryStorage();
    saveInvestigation(
      sampleInvestigation("other-profile"),
      storage,
      "2026-08-30T00:00:00.000Z",
    );
    const target = sampleInvestigation();
    saveInvestigation(target, storage, "2026-08-31T00:00:00.000Z");
    expect(
      latestInvestigationFor("iledhat-31ae-32x16", storage)?.investigation.id,
    ).toBe(target.id);
    expect(latestInvestigationFor("missing-profile", storage)).toBeNull();
  });

  it("demotes current-session evidence to previous-local-session on historical resume", () => {
    const historical = toHistoricalInvestigation(sampleInvestigation());
    for (const entry of historical.claimEvidence)
      expect(entry.scope).toBe("previous-local-session");
  });

  it("never persists safety tokens or unlock state", () => {
    const storage = memoryStorage();
    const investigation = sampleInvestigation();
    // Simulate accidental extra fields sneaking into the object.
    const polluted = {
      ...investigation,
      experimentalTxEnabled: true,
      confirmedPersistentPlanId: "plan:x",
      gifBytes: new Uint8Array(4),
    } as never;
    saveInvestigation(polluted, storage);
    const raw = storage.getItem("matrixsmith:v2:investigations")!;
    expect(raw).not.toContain("experimentalTxEnabled");
    expect(raw).not.toContain("confirmedPersistentPlanId");
    expect(raw).not.toContain("gifBytes");
  });

  it("supports forgetting all local investigation history", () => {
    const storage = memoryStorage();
    saveInvestigation(sampleInvestigation(), storage);
    forgetInvestigationHistory(storage);
    expect(loadInvestigationHistory(storage)).toHaveLength(0);
  });

  it("survives corrupted storage", () => {
    const storage = memoryStorage();
    storage.setItem("matrixsmith:v2:investigations", "{not json");
    expect(loadInvestigationHistory(storage)).toHaveLength(0);
    storage.setItem(
      "matrixsmith:v2:investigations",
      JSON.stringify({ schemaVersion: 1, investigations: [{ bogus: true }] }),
    );
    expect(loadInvestigationHistory(storage)).toHaveLength(0);
  });

  it("caps stored history and keeps the newest first", () => {
    const storage = memoryStorage();
    for (let index = 0; index < 12; index += 1)
      saveInvestigation(sampleInvestigation(), storage);
    expect(loadInvestigationHistory(storage).length).toBeLessThanOrEqual(8);
  });

  it("truthfully reports a storage write failure", () => {
    const storage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => undefined,
    };
    expect(saveInvestigation(sampleInvestigation(), storage)).toEqual(
      expect.objectContaining({ ok: false, reason: "unavailable" }),
    );
  });
});
