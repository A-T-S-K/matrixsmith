import { describe, expect, it } from "vitest";
import { emptyFingerprint } from "../../src/core/device";
import { builtInDrivers, DriverRegistry } from "../../src/drivers/registry";
import { coolLedXDriver } from "../../src/drivers/coolledx";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { knownIledHatFingerprint } from "../helpers/fixtures";

describe("driver matching", () => {
  it("represents same-GATT CoolLEDX/CoolLEDUX evidence as ambiguous", () => {
    const selection = new DriverRegistry(builtInDrivers).match(knownIledHatFingerprint());
    expect(selection.selected).toBeNull();
    expect(selection.ambiguous).toBe(true);
    expect(selection.matches.map(({ driverId }) => driverId).sort()).toEqual(["coolledux", "coolledx"]);
  });

  it("does not let CoolLEDX own the iLedHat profile", () => {
    expect(coolLedXDriver.resolveProfile(knownIledHatFingerprint())).toBeNull();
    expect(coolLedUxDriver.resolveProfile(knownIledHatFingerprint())?.driverId).toBe("coolledux");
  });

  it("resolves CoolLEDUX after verified probe evidence", () => {
    const registry = new DriverRegistry(builtInDrivers);
    const selection = registry.resolve("coolledux", knownIledHatFingerprint(), "valid structured 0x1F response");
    expect(selection.selected?.id).toBe("coolledux");
    expect(selection.ambiguous).toBe(false);
    expect(selection.matches[0]?.confidence).toBe("exact");
  });

  it("does not select on name or FFF0 alone", () => {
    expect(new DriverRegistry([coolLedXDriver]).match({ ...emptyFingerprint("web-bluetooth", "iLedHat") }).selected).toBeNull();
    expect(new DriverRegistry([coolLedXDriver]).match({ ...emptyFingerprint("web-bluetooth"), advertisedServices: ["FFF0"] }).selected).toBeNull();
  });

  it("lowers confidence when FFF1 properties contradict the profile", () => {
    const fingerprint = knownIledHatFingerprint();
    const wrong = { ...fingerprint, services: [{ ...fingerprint.services[0]!, characteristics: [{ ...fingerprint.services[0]!.characteristics[0]!, properties: { read: false, notify: false, indicate: false, write: true, writeWithoutResponse: false } }] }] };
    const match = coolLedXDriver.match(wrong);
    expect(match.contradictions.length).toBeGreaterThan(0);
    expect(match.confidence).not.toMatch(/strong|exact/);
  });

  it("blocks equally plausible drivers as ambiguous", () => {
    const clone = { ...coolLedXDriver, id: "coolledx-clone", match: (fingerprint: ReturnType<typeof knownIledHatFingerprint>) => ({ ...coolLedXDriver.match(fingerprint), driverId: "coolledx-clone" }) };
    const selection = new DriverRegistry([coolLedXDriver, clone]).match(knownIledHatFingerprint());
    expect(selection.ambiguous).toBe(true);
    expect(selection.selected).toBeNull();
  });
});
