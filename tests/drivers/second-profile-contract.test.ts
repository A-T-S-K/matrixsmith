import { describe, expect, it } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { DriverRegistry } from "../../src/drivers/registry";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseDiagnosticBundle } from "../../src/diagnostics/bundle";
import { FakeTransport } from "../../src/transport/fake";
import { operationalTrust } from "../../src/investigation/claims";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import {
  secondFingerprint,
  secondProfile,
  secondProfileDriver,
  secondProfileEvidence,
} from "../helpers/second-coolledux-profile";

describe("local second-profile contribution", () => {
  it("recognizes its own geometry while explicit geometry, manufacturer and GATT contradictions withdraw recognition", () => {
    const fingerprint = secondFingerprint();
    expect(secondProfileDriver.resolveProfile(fingerprint)).toBe(secondProfile);
    expect(
      secondProfileDriver.resolveProfile(knownIledHatFingerprint())?.width,
    ).toBe(32);
    const service = fingerprint.services[0]!;
    const characteristic = service.characteristics[0]!;
    for (const input of [
      { ...fingerprint, manuallyConfirmedGeometry: { width: 32, height: 16 } },
      { ...fingerprint, manufacturerDataHex: "FFFF" },
      {
        ...fingerprint,
        services: [
          {
            ...service,
            characteristics: [
              {
                ...characteristic,
                properties: { ...characteristic.properties, notify: false },
              },
            ],
          },
        ],
      },
    ]) {
      expect(secondProfileDriver.resolveProfile(input)).toBeNull();
      expect(
        secondProfileDriver.match(input).contradictions.length,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps capabilities, baseline evidence, tests and reports scoped to the new profile", async () => {
    const transport = new FakeTransport(secondFingerprint());
    const runtime = new ApplicationRuntime(
      transport,
      new TraceRecorder(),
      new DriverRegistry([secondProfileDriver]),
    );
    try {
      await runtime.connect();
      expect(runtime.deviceTarget()).toMatchObject({
        kind: "profile-resolved",
        profile: secondProfile,
      });
      expect(runtime.baselineClaimEvidence()).toEqual(secondProfileEvidence);
      expect(
        runtime
          .baselineClaimEvidence()
          .some(({ scope }) => scope === "built-in-profile"),
      ).toBe(false);
      expect(
        operationalTrust(
          "stored-program.upload",
          runtime.baselineClaimEvidence(),
        ).trusted,
      ).toBe(false);
      expect(
        secondProfileDriver
          .capabilities(secondProfile)
          .find(({ id }) => id === "static-frame")?.validation,
      ).toBe("experimental");
      expect(
        coolLedUxDriver
          .claimEvidence?.(secondProfile)
          .some(({ scope }) => scope === "built-in-profile"),
      ).toBe(false);
      expect(runtime.guidedTestDefinitions()).toEqual([]);
      expect(runtime.assessment().capabilities.text.availability).toBe(
        "blocked",
      );
      const plan = runtime.plan({ type: "GetDeviceInfo" });
      expect(plan.profileId).toBe(secondProfile.id);
      const bundle = parseDiagnosticBundle(runtime.exportBundle());
      expect(bundle.selectedProfile).toBe(secondProfile.id);
      expect(bundle.fingerprint.manuallyConfirmedGeometry).toEqual({
        width: 48,
        height: 8,
      });
      expect(bundle.assessment.capabilities.text.availability).toBe("blocked");
    } finally {
      await runtime.dispose();
    }
  });
});
