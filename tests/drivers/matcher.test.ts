import { describe, expect, it } from "vitest";
import {
  emptyFingerprint,
  type DeviceFingerprint,
} from "../../src/core/device";
import { builtInDrivers, DriverRegistry } from "../../src/drivers/registry";
import { coolLedXDriver } from "../../src/drivers/coolledx";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { knownIledHatFingerprint } from "../helpers/fixtures";

/**
 * CoolLEDX and CoolLEDUX share the FFF0/FFF1 transport, so the shape alone
 * never decides the family. For an UNKNOWN display that is still true, and the
 * active 0x1F probe remains the discriminator. For the one display whose
 * physical behaviour is already recorded in a built-in profile — including the
 * measurement that ruled classic CoolLEDX out — the question is already
 * answered, and asking the user to answer it again is not caution.
 */

/** The same shared transport on a display MatrixSmith knows nothing about. */
function unknownSharedTransport(): DeviceFingerprint {
  const known = knownIledHatFingerprint();
  const stripped: DeviceFingerprint = {
    ...known,
    name: "LED Display",
    services: known.services.map((service) => ({ ...service })),
  };
  delete (stripped as { manufacturerDataHex?: string }).manufacturerDataHex;
  delete (stripped as { manuallyConfirmedGeometry?: unknown })
    .manuallyConfirmedGeometry;
  delete (stripped as { rawAdvertisementHex?: string }).rawAdvertisementHex;
  return stripped;
}

describe("known-profile driver matching", () => {
  it("selects CoolLEDUX for the characterized iLedHat without any probe", () => {
    const selection = new DriverRegistry(builtInDrivers).match(
      knownIledHatFingerprint(),
    );
    expect(selection.ambiguous).toBe(false);
    expect(selection.selected?.id).toBe("coolledux");
    const coolledux = selection.matches.find(
      ({ driverId }) => driverId === "coolledux",
    )!;
    expect(coolledux.confidence).toBe("exact");
    expect(coolledux.reasons.join(" ")).toContain("iledhat-31ae-32x16");
  });

  it("records the physical reason CoolLEDX is ruled out for that profile", () => {
    const selection = new DriverRegistry(builtInDrivers).match(
      knownIledHatFingerprint(),
    );
    const coolledx = selection.matches.find(
      ({ driverId }) => driverId === "coolledx",
    )!;
    expect(coolledx.score).toBe(0);
    expect(coolledx.confidence).toBe("none");
    expect(coolledx.contradictions.join(" ")).toMatch(
      /0x08 returned 0x08 0xFE/,
    );
  });

  it("recognizes the profile without live manufacturer data", () => {
    // Web Bluetooth frequently exposes no advertisement bytes at all. Name
    // plus the exact granted GATT shape is the strongest evidence available
    // in that case, and it is enough.
    const fingerprint = knownIledHatFingerprint();
    delete (fingerprint as { manufacturerDataHex?: string })
      .manufacturerDataHex;
    delete (fingerprint as { rawAdvertisementHex?: string })
      .rawAdvertisementHex;
    const selection = new DriverRegistry(builtInDrivers).match(fingerprint);
    expect(selection.selected?.id).toBe("coolledux");
    expect(selection.ambiguous).toBe(false);
  });
});

describe("unknown devices keep the conservative treatment", () => {
  it("stays ambiguous for the same GATT on an unrecognized display", () => {
    const selection = new DriverRegistry(builtInDrivers).match(
      unknownSharedTransport(),
    );
    expect(selection.selected).toBeNull();
    expect(selection.ambiguous).toBe(true);
    expect(selection.matches.map(({ driverId }) => driverId).sort()).toEqual([
      "coolledux",
      "coolledx",
    ]);
  });

  it("gives an unrecognized display no iLedHat profile", () => {
    expect(coolLedUxDriver.resolveProfile(unknownSharedTransport())).toBeNull();
    expect(coolLedXDriver.resolveProfile(unknownSharedTransport())).toBeNull();
  });

  it("withdraws recognition when the confirmed geometry contradicts the profile", () => {
    const fingerprint: DeviceFingerprint = {
      ...knownIledHatFingerprint(),
      manuallyConfirmedGeometry: { width: 64, height: 16 },
    };
    const selection = new DriverRegistry(builtInDrivers).match(fingerprint);
    expect(selection.selected).toBeNull();
    expect(coolLedUxDriver.resolveProfile(fingerprint)).toBeNull();
    expect(
      selection.matches
        .flatMap(({ contradictions }) => contradictions)
        .join(" "),
    ).toMatch(/64×16 geometry contradicts/);
  });

  it("withdraws recognition when the manufacturer field contradicts the profile", () => {
    const fingerprint: DeviceFingerprint = {
      ...knownIledHatFingerprint(),
      manufacturerDataHex: "FFFF5EEA07000001100020031E",
    };
    const selection = new DriverRegistry(builtInDrivers).match(fingerprint);
    expect(selection.selected).toBeNull();
    expect(coolLedUxDriver.resolveProfile(fingerprint)).toBeNull();
  });

  it("withdraws recognition when the FFF1 properties contradict the profile", () => {
    const known = knownIledHatFingerprint();
    const fingerprint: DeviceFingerprint = {
      ...known,
      services: [
        {
          ...known.services[0]!,
          characteristics: [
            {
              ...known.services[0]!.characteristics[0]!,
              properties: {
                read: false,
                notify: false,
                indicate: false,
                write: true,
                writeWithoutResponse: false,
              },
            },
          ],
        },
      ],
    };
    expect(coolLedUxDriver.resolveProfile(fingerprint)).toBeNull();
    expect(
      new DriverRegistry(builtInDrivers).match(fingerprint).selected,
    ).toBeNull();
    const match = coolLedXDriver.match(fingerprint);
    expect(match.contradictions.length).toBeGreaterThan(0);
    expect(match.confidence).not.toMatch(/strong|exact/);
  });

  it("does not select on name or FFF0 alone", () => {
    expect(
      new DriverRegistry([coolLedXDriver]).match({
        ...emptyFingerprint("web-bluetooth", "iLedHat"),
      }).selected,
    ).toBeNull();
    expect(
      new DriverRegistry([coolLedXDriver]).match({
        ...emptyFingerprint("web-bluetooth"),
        advertisedServices: ["FFF0"],
      }).selected,
    ).toBeNull();
  });

  it("blocks equally plausible drivers as ambiguous", () => {
    const clone = {
      ...coolLedXDriver,
      id: "coolledx-clone",
      match: (fingerprint: DeviceFingerprint) => ({
        ...coolLedXDriver.match(fingerprint),
        driverId: "coolledx-clone",
      }),
    };
    const selection = new DriverRegistry([coolLedXDriver, clone]).match(
      unknownSharedTransport(),
    );
    expect(selection.ambiguous).toBe(true);
    expect(selection.selected).toBeNull();
  });
});

describe("the active probe still resolves an unknown display", () => {
  it("resolves CoolLEDUX after verified probe evidence", () => {
    const registry = new DriverRegistry(builtInDrivers);
    const selection = registry.resolve(
      "coolledux",
      unknownSharedTransport(),
      "valid structured 0x1F response",
    );
    expect(selection.selected?.id).toBe("coolledux");
    expect(selection.ambiguous).toBe(false);
    expect(selection.matches[0]?.confidence).toBe("exact");
  });
});
