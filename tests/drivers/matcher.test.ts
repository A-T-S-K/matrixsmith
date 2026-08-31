import { describe, expect, it } from "vitest";
import { emptyFingerprint } from "../../src/core/device";
import { DriverRegistry } from "../../src/drivers/registry";
import { coolLedXDriver } from "../../src/drivers/coolledx";
import { knownIledHatFingerprint } from "../helpers/fixtures";

describe("driver matching", () => {
  it("selects the complete known iLedHat fingerprint strongly", () => {
    const selection = new DriverRegistry([coolLedXDriver]).match(knownIledHatFingerprint());
    expect(selection.selected?.id).toBe("coolledx");
    expect(selection.matches[0]?.confidence).toMatch(/strong|exact/);
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
