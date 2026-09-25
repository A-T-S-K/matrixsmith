import { describe, expect, it } from "vitest";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { decodeCoolLedUxNotification } from "../../src/drivers/coolledux/notifications";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";

describe("profile-free driver identification", () => {
  it("provides a read-only family probe without a reviewed profile", () => {
    const fingerprint = {
      ...knownIledHatFingerprint(),
      name: "Unreviewed panel",
      manuallyConfirmedGeometry: undefined,
    };
    const context = { fingerprint, endpoints: [], source: "live" as const };
    const probe = coolLedUxDriver.familyProbes?.(context)[0];
    expect(probe).toBeDefined();
    const plan = probe!.plan(context);
    expect(plan).toMatchObject({
      purpose: "probe",
      risk: "read-only",
      persistence: "none",
      profileId: "protocol-candidate:coolledux",
    });

    const response = decodeCoolLedUxNotification(
      parseHexBytes(infoFixture.rxHex),
    );
    expect(
      probe!.identify({ response, responseTimedOut: false }, context),
    ).toMatchObject({ matched: true, confidence: "exact" });
  });
});
