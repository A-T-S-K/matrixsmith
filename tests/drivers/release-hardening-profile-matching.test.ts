import { describe, expect, it } from "vitest";
import type {
  AdvertisementObservation,
  DeviceFingerprint,
} from "../../src/core/device";
import {
  evaluateKnownProfile,
  ILEDHAT_SIGNATURE,
  observedManufacturerCompanies,
} from "../../src/profiles/known-profiles";
import { fingerprintIdentityKey } from "../../src/investigation/device-identity";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import {
  acceptLocalProfile,
  withLocalProfiles,
} from "../../src/profiles/registration";
import { parseProfileDocument } from "../../src/profiles/document";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { secondFingerprint } from "../helpers/second-coolledux-profile";
import data from "../../src/profiles/data/authored-ux-banner.json";

function observed(
  companies: readonly number[],
  dataHex = "FFFF",
): AdvertisementObservation {
  return {
    capturedAt: "2026-10-06T12:00:00Z",
    source: "web-bluetooth-watch",
    advertisedServiceUuids: [],
    manufacturerData: companies.map((companyId) => ({ companyId, dataHex })),
    serviceData: [],
  };
}
function fingerprint(
  companies: readonly number[],
  legacy?: string,
): DeviceFingerprint {
  const { manufacturerDataHex: _legacy, ...base } = knownIledHatFingerprint();
  return {
    ...base,
    ...(legacy ? { manufacturerDataHex: legacy } : {}),
    advertisementObservation: observed(companies),
  };
}

describe("observed profile identity", () => {
  it.each([
    [[], undefined, true],
    [[0x31ae], undefined, true],
    [[0x31ae, 0xffff], undefined, true],
    [[0x31ae, 0x31ae], undefined, true],
    [[0xffff], undefined, false],
    [[0xffff, 0x1234], undefined, false],
    [[], "AE31", true],
    [[0x31ae], "AE31FFFF", true],
    [[0x31ae], "FFFF", false],
    [[0xffff], "AE31", false],
  ] as const)(
    "evaluates structured %j and legacy %s consistently",
    (companies, legacy, matched) => {
      const input = fingerprint(companies, legacy);
      const verdict = evaluateKnownProfile(ILEDHAT_SIGNATURE, input);
      expect(verdict.matched).toBe(matched);
      expect(coolLedUxDriver.resolveProfile(input) !== null).toBe(matched);
      expect(coolLedUxDriver.match(input).confidence === "exact").toBe(matched);
    },
  );
  it("normalizes equivalent legacy and structured identity keys without volatile observation metadata", () => {
    const legacy = {
      ...knownIledHatFingerprint(),
      manufacturerDataHex: "AE31FFFF",
    };
    const structured = {
      ...fingerprint([0x31ae]),
      advertisementObservation: {
        ...observed([0x31ae]),
        capturedAt: "2026-10-06T13:00:00Z",
        rssi: -90,
      },
    };
    expect(fingerprintIdentityKey(legacy)).toBe(
      fingerprintIdentityKey(structured),
    );
    expect(
      fingerprintIdentityKey({
        ...legacy,
        advertisementObservation: observed([0xffff]),
      }),
    ).not.toBe(fingerprintIdentityKey(legacy));
  });
  it("does not interpret structured payload prefixes or requested access as company observations", () => {
    const input = {
      ...fingerprint([0xffff]),
      advertisementObservation: observed([0xffff], "AE31"),
      requestedServices: ["fff0"],
      browserGrantedServices: ["fff0"],
    };
    expect(observedManufacturerCompanies(input)).toEqual({
      legacy: null,
      structured: [0xffff],
    });
    expect(evaluateKnownProfile(ILEDHAT_SIGNATURE, input).matched).toBe(false);
    expect(
      evaluateKnownProfile(ILEDHAT_SIGNATURE, {
        ...fingerprint([]),
        services: [],
        requestedServices: ["fff0"],
      }).matched,
    ).toBe(false);
  });
  it("keeps explicit contradictions visible even without GATT access", () => {
    expect(
      evaluateKnownProfile(ILEDHAT_SIGNATURE, {
        ...fingerprint([0xffff]),
        services: [],
      }).contradictions,
    ).not.toEqual([]);
  });
  it("uses identical rules for registered local profiles without borrowing built-in evidence", () => {
    const accepted = acceptLocalProfile(
      parseProfileDocument(JSON.stringify(data)),
    );
    const driver = withLocalProfiles(coolLedUxDriver, [accepted]);
    const { manufacturerDataHex: _legacy, ...base } = secondFingerprint();
    const input = {
      ...base,
      advertisementObservation: observed([accepted.signature.companyId!]),
    };
    expect(driver.resolveProfile(input)).toBe(accepted.profile);
    expect(
      accepted.profile.evidence.every(
        (entry) => entry.confidence === "inferred",
      ),
    ).toBe(true);
    expect(
      driver.resolveProfile({
        ...input,
        advertisementObservation: observed([0xffff]),
      }),
    ).toBeNull();
    expect(
      evaluateKnownProfile(
        {
          ...accepted.signature,
          name: accepted.signature.name.toUpperCase(),
          serviceUuid: "fff0",
          characteristicUuid: "fff1",
        },
        input,
      ).matched,
    ).toBe(true);
  });
  it("does not elevate a name or UUID alone and rejects conflicting advertised names", () => {
    expect(
      coolLedUxDriver.resolveProfile({ ...fingerprint([]), services: [] }),
    ).toBeNull();
    expect(
      coolLedUxDriver.resolveProfile({ ...fingerprint([]), name: "unknown" }),
    ).toBeNull();
    expect(
      coolLedUxDriver.resolveProfile({
        ...fingerprint([]),
        advertisementObservation: { ...observed([0x31ae]), name: "different" },
      }),
    ).toBeNull();
  });
});
