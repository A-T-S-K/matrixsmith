import { describe, expect, it } from "vitest";
import { coolLedUxGuidedTests, ILEDHAT_GUIDED_TESTS } from "../../src/drivers/coolledux/guided-tests";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import type { DeviceProfile } from "../../src/core/device";
import { COOLLEDUX_DEFAULT_QUIRKS } from "../../src/core/quirks";

/**
 * The iLedHat characterization suite bakes in 32x16 geometry, four 8-column
 * tiles, and this exact device's observed history. A future unrelated
 * CoolLEDUX profile must never see it unchanged.
 */

const otherCoolLedUxProfile: DeviceProfile = {
  id: "synthetic-coolledux-64x32",
  name: "Synthetic CoolLEDUX 64x32",
  driverId: "coolledux",
  width: 64, height: 32,
  validation: "experimental",
  evidence: [],
  metadata: {},
  quirks: COOLLEDUX_DEFAULT_QUIRKS,
};

describe("guided test applicability", () => {
  it("exposes the iLedHat suite to the iLedHat profile", () => {
    const tests = coolLedUxGuidedTests(iledHat31aeProfile);
    expect(tests.map((test) => test.id)).toEqual(ILEDHAT_GUIDED_TESTS.map((test) => test.id));
  });

  it("does not expose iLedHat-specific tests to another CoolLEDUX profile", () => {
    const tests = coolLedUxGuidedTests(otherCoolLedUxProfile);
    for (const test of tests) expect(ILEDHAT_GUIDED_TESTS.map((entry) => entry.id)).not.toContain(test.id);
    expect(tests).toHaveLength(0);
  });

  it("exposes nothing to a non-CoolLEDUX profile", () => {
    expect(coolLedUxGuidedTests({ ...otherCoolLedUxProfile, driverId: "coolledx" })).toHaveLength(0);
  });
});
