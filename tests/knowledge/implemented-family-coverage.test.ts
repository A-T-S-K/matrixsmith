import { describe, expect, it } from "vitest";
import data from "../../public/knowledge-v1.json";
import validate from "../../src/knowledge/generated/knowledge-validator.js";
import { emptyFingerprint, normalizeUuid } from "../../src/core/device";
import {
  resolveKnowledge,
  searchKnowledge,
} from "../../src/knowledge/resolver";
import {
  independentOrigins,
  validateKnowledgeReferences,
} from "../../src/knowledge/validation";
import type { KnowledgeCorpus } from "../../src/knowledge/types";
import { knownIledHatFingerprint } from "../helpers/fixtures";

const corpus = data as KnowledgeCorpus;
const ledService = "e95dd91d-251d-470a-a062-fa1922dfa9a8";
const matrix = "e95d7b77-251d-470a-a062-fa1922dfa9a8";
const properties = {
  read: false,
  write: true,
  writeWithoutResponse: false,
  notify: false,
  indicate: false,
};
function fingerprint(
  service: string,
  characteristics: readonly string[] = [],
  overrides = {},
) {
  return {
    ...emptyFingerprint("web-bluetooth"),
    services: [
      {
        uuid: service,
        isPrimary: true,
        characteristics: characteristics.map((uuid) => ({
          uuid,
          properties: { ...properties, ...overrides },
        })),
      },
    ],
  };
}
function family(service: string, id: string) {
  return resolveKnowledge(corpus, fingerprint(service)).families.find(
    (f) => f.id === id,
  )!;
}

describe("source-scoped implemented family coverage", () => {
  it("keeps the complete research index and validates suggestions and citations", () => {
    expect(validate(corpus), JSON.stringify(validate.errors)).toBe(true);
    validateKnowledgeReferences(corpus);
    expect(corpus.records).toHaveLength(66);
    expect(corpus.sheets).toHaveLength(21);
    expect(corpus.families).toHaveLength(44);
    expect(corpus.assertions).toHaveLength(109);
    expect(corpus.families.filter((f) => f.match)).toHaveLength(9);
    for (const f of corpus.families) {
      if (!f.match) continue;
      const assertion = corpus.assertions.find(
        (a) => a.id === f.match!.assertionId,
      )!;
      expect(assertion.familyId).toBe(f.id);
      expect(assertion.field).toBe("gatt");
      expect(assertion.evidence.length).toBeGreaterThan(0);
      expect(f.sheetId).not.toBeNull();
      expect(corpus.sheets.find((s) => s.id === f.sheetId)!.familyId).toBe(
        f.id,
      );
      for (const ref of assertion.evidence) {
        const source = corpus.sources.find((s) => s.id === ref.sourceId)!;
        expect(source.url).toMatch(/^https:\/\//);
        expect(ref.locator.length).toBeGreaterThan(0);
      }
    }
  });
  it("preserves shared CoolLED ties and the current reviewed query boundary", () => {
    const supplied = knownIledHatFingerprint();
    const result = resolveKnowledge(corpus, supplied, [
      "coolledux:get-device-info",
    ]);
    expect(result.families.map((f) => f.id)).toEqual([
      "coolledux-advanced",
      "coolledx-simple",
    ]);
    expect(result.families[0]!.reviewedActions).toEqual([
      "coolledux:get-device-info",
    ]);
    expect(result.families[1]!.reviewedActions).toEqual([]);
    expect(
      result.families[0]!.facts.find((f) => f.field === "transport")!.text,
    ).toContain("power and brightness");
    expect(
      result.families[0]!.sources.some((s) => s.id === "seed-ux:PROTOCOL.md"),
    ).toBe(true);
    const contradicted = resolveKnowledge(corpus, {
      ...supplied,
      manuallyConfirmedGeometry: { width: 48, height: 8 },
    });
    expect(contradicted.families).toHaveLength(2);
    expect(contradicted.families[0]!.contradictions.length).toBeGreaterThan(0);
    expect(contradicted.families[0]!.unknowns.join(" ")).toContain(
      "family remains plausible",
    );
  });
  it("explains both legacy firmware shapes without treating properties as identity", () => {
    for (const shape of [
      { read: true, notify: true },
      { read: false, notify: false },
    ]) {
      const result = resolveKnowledge(
        corpus,
        fingerprint("fee0", ["fee1"], shape),
      );
      expect(result.families.map((f) => f.id)).toEqual(["lsled-legacy"]);
      const legacy = result.families[0]!;
      expect(legacy.facts[0]!.text).toContain("Read/Notify semantics unknown");
      expect(legacy.facts[0]!.text).toContain("write-only");
      expect(legacy.facts[0]!.basis).toBe("implemented");
      expect(legacy.contradictions).toEqual([]);
      expect(legacy.reviewedActions).toEqual([]);
    }
    const nextgen = resolveKnowledge(
      corpus,
      fingerprint("f055", ["f056", "f057"]),
    );
    expect(nextgen.families.map((f) => f.id)).toEqual(["badgemagic-nextgen"]);
    expect(nextgen.families[0]!.facts[0]!.text).toContain(
      "Read is listed as pending",
    );
    expect(nextgen.families[0]!.sources.map((s) => s.id)).toContain(
      "file-fossasia-badgemagic-firmware-BadgeBLE-md",
    );
    const both = resolveKnowledge(corpus, {
      ...fingerprint("fee0", ["fee1"]),
      advertisedServices: ["f055"],
    });
    expect(both.families.map((f) => f.id)).toEqual([
      "badgemagic-nextgen",
      "lsled-legacy",
    ]);
  });
  it("keeps optional micro:bit service access separate from firmware and security", () => {
    const optional = resolveKnowledge(corpus, {
      ...emptyFingerprint("web-bluetooth"),
      advertisedServices: [ledService],
    });
    expect(optional.families.map((f) => f.id)).toEqual(["microbit-led"]);
    expect(optional.families[0]!.contradictions).toEqual([]);
    expect(optional.families[0]!.unknowns.join(" ")).toContain("optional");
    expect(optional.families[0]!.unknowns.join(" ")).toContain("security");
    expect(optional.families[0]!.unknowns.join(" ")).toContain(
      "not inspectable",
    );
    const supplied = resolveKnowledge(
      corpus,
      fingerprint(ledService, [matrix], { read: true }),
    );
    expect(supplied.families[0]!.facts[0]!.text).toContain("without Notify");
    expect(
      supplied.families[0]!.facts.find((f) => f.field === "pixels")!.text,
    ).toContain("writes accept 1–5 rows");
    expect(
      supplied.families[0]!.sources.some(
        (s) =>
          s.id === "microbit-dal-led-cpp" &&
          s.revision === "318c6abbb3d952d3f49a595a726486230e82fb5b",
      ),
    ).toBe(true);
    expect(supplied.families[0]!.reviewedActions).toEqual([]);
    expect(
      resolveKnowledge(
        corpus,
        emptyFingerprint("web-bluetooth", "BBC micro:bit v2"),
      ).families,
    ).toEqual([]);
    expect(
      resolveKnowledge(corpus, {
        ...emptyFingerprint("web-bluetooth"),
        requestedServices: [ledService],
        browserGrantedServices: [ledService],
      }).families,
    ).toEqual([]);
  });
  it("retrieves Merkury block evidence with unresolved receipt and persistence semantics", () => {
    const result = family("ffd0", "merkury-bc55");
    expect(result.facts[0]!.text).toContain(
      "response mode and persistence remain unknown",
    );
    expect(result.facts.find((f) => f.field === "framing")!.text).toContain(
      "100-byte values",
    );
    expect(result.facts.find((f) => f.field === "pixels")!.text).toContain(
      "eight blocks of 32 pixels",
    );
    expect(
      result.sources.some(
        (s) =>
          s.id === "file-offe-mi-led-display-draw_file-py" &&
          s.revision === "97a1be8b4edefc7eccdd2f3943997b4416d44771",
      ),
    ).toBe(true);
    expect(result.unknowns.join(" ")).toContain("persistence contract");
    expect(result.reviewedActions).toEqual([]);
  });
  it("normalizes aliases while keeping unresolved research searchable and unpromoted", () => {
    for (const [alias, id] of [
      ["micro:bit", "microbit-led"],
      ["microbit-led-service", "microbit-led"],
      ["mi-lnl62-999w", "merkury-bc55"],
      ["lsled", "lsled-legacy"],
      ["badge magic next-gen", "badgemagic-nextgen"],
    ]) {
      expect(
        searchKnowledge(corpus, alias!).some((r) => r.families.includes(id!)),
      ).toBe(true);
    }
    expect(searchKnowledge(corpus, "badge-nilhcem")[0]!.families).toEqual([
      "lsled-like-unresolved",
    ]);
    expect(
      corpus.families.find((f) => f.id === "lsled-like-unresolved")!.match,
    ).toBeNull();
    const unknown = resolveKnowledge(corpus, fingerprint("abcd"));
    expect(unknown.families).toEqual([]);
    expect(unknown.summary).toContain("unresolved lines remain searchable");
    const sourceIds = [
      "file-offe-mi-led-display-draw_file-py",
      "file-offe-mi-led-display-protocol-txt",
      "src-offe-mi-led-display",
    ];
    expect(independentOrigins(corpus, sourceIds)).toBe(1);
    expect(
      independentOrigins(corpus, [
        "microbit-dal-led-cpp",
        "microbit-dal-led-header",
      ]),
    ).toBe(1);
    for (const f of corpus.families.filter((f) => f.match)) {
      const resolved = resolveKnowledge(
        corpus,
        fingerprint(f.match!.serviceUuid ?? normalizeUuid("abcd")),
        ["unregistered:write"],
      );
      expect(
        resolved.families.every(
          (candidate) => candidate.reviewedActions.length === 0,
        ),
      ).toBe(true);
      expect(resolved).not.toHaveProperty("authorized");
      expect(resolved).not.toHaveProperty("selected");
    }
  });
});
