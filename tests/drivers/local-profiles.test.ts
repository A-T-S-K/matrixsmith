import { describe, expect, it } from "vitest";
import data from "../../src/profiles/data/authored-ux-banner.json";
import {
  parseProfileDocument,
  profileCompatibility,
} from "../../src/profiles/document";
import { acceptLocalProfile } from "../../src/profiles/registration";
import { registryWithLocalProfile } from "../../src/profiles/local-catalog";
import { builtInDrivers, DriverRegistry } from "../../src/drivers/registry";
import {
  iledHat31aeProfile,
  ILEDHAT_DOCUMENT,
} from "../../src/profiles/iledhat-31ae-32x16";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import {
  definitionDigest,
  prepareTransmission,
  transmissionDigest,
} from "../../src/core/transmission";

describe("bounded local profile registration", () => {
  const parse = (value: unknown) => parseProfileDocument(JSON.stringify(value));
  it("rejects malformed, oversized, deep, unsupported and forged documents", () => {
    for (const text of [
      "{",
      " ".repeat(16385),
      "[".repeat(9) + "0" + "]".repeat(9),
    ])
      expect(() => parseProfileDocument(text)).toThrow();
    for (const extra of [
      { opcode: 4 },
      { validation: "verified" },
      { trustedScopes: ["built-in-profile"] },
      { callback: "()=>true" },
      { origin: "built-in" },
    ])
      expect(() => parse({ ...data, ...extra })).toThrow();
    expect(
      profileCompatibility(parse({ ...data, implementation: "unknown" })),
    ).toContain("Implementation unknown is not installed.");
    expect(() => acceptLocalProfile(parse(ILEDHAT_DOCUMENT))).toThrow(
      "reserved",
    );
  });
  it("copies, freezes and exports accepted source-only definitions", () => {
    const input = parse(data),
      accepted = acceptLocalProfile(input);
    expect(Object.isFrozen(accepted.profile.quirks?.channelMap)).toBe(true);
    expect(accepted.document).not.toBe(input);
    expect(
      acceptLocalProfile(parse(accepted.document)).definitionIdentity,
    ).toBe(accepted.definitionIdentity);
    expect(coolLedUxDriver.guidedTests?.(accepted.profile)).toEqual([]);
    expect(
      coolLedUxDriver
        .claimEvidence?.(accepted.profile)
        .some((e) => e.scope === "built-in-profile"),
    ).toBe(false);
  });
  it("rejects duplicates atomically and preserves the original registry", () => {
    const registry = new DriverRegistry(builtInDrivers);
    expect(
      () => new DriverRegistry([coolLedUxDriver, coolLedUxDriver]),
    ).toThrow("Duplicate");
    const next = registryWithLocalProfile(parse(data), registry);
    expect(registry.drivers[1]!.profiles()).toEqual([iledHat31aeProfile]);
    expect(() => registryWithLocalProfile(parse(data), next)).toThrow(
      "Duplicate",
    );
    expect(() =>
      registryWithLocalProfile(
        parse({ ...data, implementation: "unknown" }),
        registry,
      ),
    ).toThrow("not installed");
    expect(Object.isFrozen(next.drivers)).toBe(true);
  });
  it("copied built-in identity cannot inherit assessment, tests or plan assurance", () => {
    const forged = { ...iledHat31aeProfile };
    expect(
      coolLedUxDriver
        .claimEvidence?.(forged)
        .some((e) => e.scope === "built-in-profile"),
    ).toBe(false);
    expect(coolLedUxDriver.guidedTests?.(forged)).toEqual([]);
    expect(
      coolLedUxDriver.capabilities(forged).find((c) => c.id === "brightness")
        ?.validation,
    ).toBe("experimental");
    const plan = coolLedUxDriver.plan(
      { type: "SetBrightness", raw: 64 },
      {
        profile: forged,
        fingerprint: knownIledHatFingerprint(),
        source: "live",
      },
    );
    expect(plan.validation).toBe("experimental");
  });
  it("definition provenance is part of the protected digest", () => {
    const raw = coolLedUxDriver.plan(
      { type: "GetDeviceInfo" },
      {
        profile: iledHat31aeProfile,
        fingerprint: knownIledHatFingerprint(),
        source: "live",
      },
    );
    const binding = {
      connectionId: "test",
      fingerprintKey: "test",
      browserDeviceId: null,
    };
    const prepared = prepareTransmission(
      {
        ...raw,
        metadata: {
          ...raw.metadata,
          definitionIdentity: definitionDigest(ILEDHAT_DOCUMENT),
        },
      },
      binding,
    );
    expect(
      transmissionDigest(
        {
          ...prepared,
          metadata: { ...prepared.metadata, definitionIdentity: "replaced" },
        },
        binding,
      ),
    ).not.toBe(prepared.digest);
  });
});
