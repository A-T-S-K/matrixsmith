import { describe, expect, it } from "vitest";
import { findRegion, rawWordHex, regionPeers, validateRegionReferences, validateRegions, type DiagnosticRegion } from "../../src/investigation/regions";
import { diagnosticContent, PIXEL_CHANNEL_PROBE_WORDS } from "../../src/drivers/coolledux/diagnostics";
import { ILEDHAT_GUIDED_TESTS } from "../../src/drivers/coolledux/guided-tests";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";

const PROFILE = { width: iledHat31aeProfile.width, height: iledHat31aeProfile.height };

function region(overrides: Partial<DiagnosticRegion> = {}): DiagnosticRegion {
  return {
    id: "zone", shortLabel: "1", displayLabel: "Zone 1 · Test", description: "why",
    x: 0, y: 0, width: 2, height: 2, technical: {}, ...overrides,
  };
}

describe("diagnostic region validation", () => {
  it("rejects duplicate region ids", () => {
    const errors = validateRegions([region({ id: "a" }), region({ id: "a" })]);
    expect(errors.join(" ")).toContain('Duplicate diagnostic region id "a"');
  });

  it("requires a human-readable label and a map label", () => {
    expect(validateRegions([region({ displayLabel: "" })]).join(" ")).toContain("no human-readable displayLabel");
    expect(validateRegions([region({ shortLabel: " " })]).join(" ")).toContain("no shortLabel");
  });

  it("rejects regions that fall outside the panel", () => {
    expect(validateRegions([region({ x: 30, width: 8 })], PROFILE).join(" ")).toContain("extends past the 32×16 panel");
  });

  it("rejects a question referencing an unknown region", () => {
    expect(validateRegionReferences(["nope"], [region({ id: "a" })]).join(" ")).toContain('unknown region "nope"');
    expect(validateRegionReferences([undefined, "a"], [region({ id: "a" })])).toEqual([]);
  });

  it("resolves group peers so a grouped question can highlight every member", () => {
    const regions = [region({ id: "a", groupId: "g" }), region({ id: "b", groupId: "g" }), region({ id: "c" })];
    expect(regionPeers(regions, "a").map((entry) => entry.id)).toEqual(["b"]);
    expect(regionPeers(regions, "c")).toEqual([]);
    expect(findRegion(regions, "b")?.id).toBe("b");
  });
});

describe("CoolLEDUX diagnostic regions", () => {
  const built = [...new Set(ILEDHAT_GUIDED_TESTS.map((test) => test.operation))]
    .filter((operation) => operation.type === "ShowDiagnostic")
    .map((operation) => ({ operation, content: diagnosticContent(operation.diagnosticId).build(PROFILE, operation.parameters) }));

  it("declares structurally valid, uniquely identified regions for every diagnostic", () => {
    for (const { operation, content } of built) {
      expect(validateRegions(content.regions, PROFILE), `regions for ${operation.diagnosticId}`).toEqual([]);
    }
  });

  it("resolves every regionId a guided test question references, under some allowed parameter set", () => {
    for (const test of ILEDHAT_GUIDED_TESTS) {
      if (test.operation.type !== "ShowDiagnostic") continue;
      const definition = diagnosticContent(test.operation.diagnosticId);
      // A diagnostic may include extra zones only under certain parameters
      // (e.g. the high-nibble bands), so a reference is valid if ANY allowed
      // variant produces it. The store separately drops questions whose zone
      // is absent from the run actually being observed.
      const variants: Readonly<Record<string, number>>[] = definition.parameters.length === 0
        ? [{}]
        : definition.parameters.flatMap((parameter) => parameter.allowed.map((value) => ({ [parameter.id]: value })));
      const available = new Set(variants.flatMap((parameters) => definition.build(PROFILE, parameters).regions.map((entry) => entry.id)));
      const referenced = test.observation.map((spec) => spec.regionId).filter((id): id is string => id !== undefined);
      for (const id of referenced) expect(available, `${test.id} references ${id}`).toContain(id);
    }
  });

  it("names channel zones for people and keeps the raw word as technical metadata", () => {
    const regions = diagnosticContent("pixel-channel-probe").build(PROFILE).regions;
    expect(regions).toHaveLength(PIXEL_CHANNEL_PROBE_WORDS.length);
    for (const entry of regions) {
      // The human label must never be the hex value.
      expect(entry.displayLabel).not.toContain("0x");
      expect(entry.displayLabel).toMatch(/^Zone \d+ · /u);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.technical.rawWord).toBe("number");
    }
    expect(regions.map((entry) => entry.displayLabel)).toContain("Zone 2 · Red test");
    expect(regions.find((entry) => entry.id === "channel-red")?.technical.rawWord).toBe(0x0f00);
  });

  it("never gives an unknown high-nibble probe an assumed colour name", () => {
    const regions = diagnosticContent("pixel-channel-probe").build(PROFILE).regions;
    const highNibble = regions.filter((entry) => [0x1000, 0x2000, 0x4000, 0x8000, 0xf000].includes(entry.technical.rawWord ?? -1));
    expect(highNibble).toHaveLength(5);
    for (const entry of highNibble) {
      expect(entry.displayLabel).toMatch(/Extra channel/u);
      expect(entry.displayLabel.toLowerCase()).not.toMatch(/white|red|green|blue|amber/u);
      // No expectation may be claimed for a word whose behaviour is unknown.
      expect(entry.technical.expectedUnderHypothesis).toBeUndefined();
    }
  });

  it("keeps the exact raw word available for reports", () => {
    const regions = diagnosticContent("graffiti-black-probe").build(PROFILE).regions;
    const black = regions.find((entry) => entry.groupId === "black-candidate");
    const workaround = regions.find((entry) => entry.groupId === "workaround");
    expect(black?.technical.rawWord).toBe(0x0000);
    expect(workaround?.technical.rawWord).toBe(0x0004);
    expect(rawWordHex(0x0004)).toBe("0x0004");
    expect(black?.technical.notes?.join(" ")).toContain("0x0000");
  });
});
