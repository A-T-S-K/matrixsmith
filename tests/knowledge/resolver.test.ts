import { describe, expect, it } from "vitest";
import data from "../../public/knowledge-v1.json";
import validate from "../../src/knowledge/generated/knowledge-validator.js";
import {
  validateKnowledgeReferences,
  independentOrigins,
} from "../../src/knowledge/validation";
import {
  resolveKnowledge,
  searchKnowledge,
} from "../../src/knowledge/resolver";
import type { KnowledgeCorpus } from "../../src/knowledge/types";
import { emptyFingerprint } from "../../src/core/device";
import { knownIledHatFingerprint } from "../helpers/fixtures";
const corpus = data as KnowledgeCorpus;
describe("advisory knowledge", () => {
  it("validates complete census coverage and normalized aliases", () => {
    expect(validate(corpus)).toBe(true);
    validateKnowledgeReferences(corpus);
    expect(corpus.records).toHaveLength(66);
    expect(corpus.sheets).toHaveLength(21);
    expect(corpus.assertions).toHaveLength(109);
    expect(
      searchKnowledge(corpus, "microbit-led-service").length,
    ).toBeGreaterThan(0);
    expect(corpus.families.some((f) => f.resolution === "unresolved")).toBe(
      true,
    );
    expect(corpus.conflicts).toHaveLength(21);
  });
  it("rejects duplicates, dangling references, alias conflicts and lineage cycles", () => {
    for (const change of [
      { families: [...corpus.families, corpus.families[0]!] },
      { aliases: [{ from: "microbit-led", to: "missing" }] },
      {
        assertions: [
          {
            ...corpus.assertions[0]!,
            evidence: [{ sourceId: "missing", locator: "unknown" }],
          },
        ],
      },
      {
        sources: corpus.sources.map((s, i) =>
          i === 0 ? { ...s, derivedFrom: [s.id] } : s,
        ),
      },
    ])
      expect(() =>
        validateKnowledgeReferences({ ...corpus, ...change }),
      ).toThrow();
    expect(validate({ ...corpus, trustedScopes: ["current-session"] })).toBe(
      false,
    );
  });
  it("counts copied lineage and overlapping files as one origin", () => {
    const child = corpus.sources.find((s) => s.derivedFrom.length)!;
    expect(independentOrigins(corpus, [child.id, child.derivedFrom[0]!])).toBe(
      1,
    );
    const group = corpus.sources.filter(
      (s) => s.origin === "CharlesLennon/coolledux-ble",
    );
    expect(
      independentOrigins(
        corpus,
        group.map((s) => s.id),
      ),
    ).toBe(1);
  });
  it("preserves same-GATT ambiguity, profile contradiction and missing-access uncertainty", () => {
    const original = knownIledHatFingerprint();
    const copy = JSON.stringify(original);
    const result = resolveKnowledge(corpus, original, [
      "coolledux:get-device-info",
    ]);
    expect(result.families.map((f) => f.id)).toEqual([
      "coolledux-advanced",
      "coolledx-simple",
    ]);
    expect(JSON.stringify(original)).toBe(copy);
    const contradicted = resolveKnowledge(corpus, {
      ...original,
      manuallyConfirmedGeometry: { width: 48, height: 8 },
    });
    expect(contradicted.families[0]!.contradictions.length).toBeGreaterThan(0);
    expect(contradicted.families).toHaveLength(2);
    const sharedFa = resolveKnowledge(corpus, {
      ...emptyFingerprint("web-bluetooth"),
      services: [
        {
          ...original.services[0]!,
          uuid: "000000fa-0000-1000-8000-00805f9b34fb",
          characteristics: ["fa02", "fa03"].map((uuid) => ({
            ...original.services[0]!.characteristics[0]!,
            uuid,
          })),
        },
      ],
    });
    expect(sharedFa.families.map((family) => family.id)).toEqual([
      "bk-png",
      "idotmatrix-length16",
    ]);
    expect(sharedFa.families[0]!.unknowns).toContain(
      "Source does not establish a service UUID.",
    );
    const inaccessible = resolveKnowledge(corpus, {
      ...emptyFingerprint("web-bluetooth"),
      advertisedServices: ["fff0"],
    });
    expect(
      inaccessible.families.every((f) => f.contradictions.length === 0),
    ).toBe(true);
    expect(inaccessible.families[0]!.unknowns.join(" ")).toContain(
      "not inspectable",
    );
  });
  it("does not infer company/chip, select drivers, authorize or write", () => {
    const result = resolveKnowledge(corpus, knownIledHatFingerprint());
    expect(
      result.families.every((f) => f.unknowns.some((u) => u.includes("Chip"))),
    ).toBe(true);
    expect(result.families.every((f) => f.reviewedActions.length === 0)).toBe(
      true,
    );
    expect(result).not.toHaveProperty("selected");
    expect(result).not.toHaveProperty("claims");
    expect(result).not.toHaveProperty("authorized");
    expect(searchKnowledge(corpus, "")).toHaveLength(8);
  });
});
