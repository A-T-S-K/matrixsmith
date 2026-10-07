import { describe, expect, it } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { DriverRegistry } from "../../src/drivers/registry";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseDiagnosticBundle } from "../../src/diagnostics/bundle";
import { FakeTransport } from "../../src/transport/fake";
import { operationalTrust } from "../../src/investigation/claims";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import data from "../../src/profiles/data/authored-ux-banner.json";
import { parseProfileDocument } from "../../src/profiles/document";
import { registryWithLocalProfile } from "../../src/profiles/local-catalog";
import {
  secondFingerprint,
  secondProfile,
  secondProfileDriver,
  secondProfileEvidence,
} from "../helpers/second-coolledux-profile";

describe("local second-profile contribution", () => {
  it.each(["local", "provisional-banner", "protocol-candidate-banner"])(
    "loads and reloads namespace %s as a profile-resolved target with valid diagnostic exports",
    async (namespace) => {
      const document = parseProfileDocument(
        JSON.stringify({ ...data, namespace }),
      );
      const registry = registryWithLocalProfile(
        document,
        new DriverRegistry([coolLedUxDriver]),
      );
      const runtime = new ApplicationRuntime(
        new FakeTransport(secondFingerprint()),
        undefined,
        registry,
      );
      const reloadedRegistry = registryWithLocalProfile(
        parseProfileDocument(
          JSON.stringify(registry.acceptedProfiles[0]!.document),
        ),
        new DriverRegistry([coolLedUxDriver]),
      );
      const imported = new ApplicationRuntime(
        new FakeTransport(secondFingerprint()),
        undefined,
        reloadedRegistry,
      );
      try {
        await runtime.connect();
        const profile = registry.acceptedProfiles[0]!.profile;
        expect(runtime.deviceTarget()).toMatchObject({
          kind: "profile-resolved",
          profile,
        });
        expect(runtime.guidedTestDefinitions()).toEqual([]);
        expect(
          runtime
            .baselineClaimEvidence()
            .some(({ scope }) => scope === "built-in-profile"),
        ).toBe(false);
        const plan = runtime.plan({ type: "GetDeviceInfo" });
        for (const privacy of ["full-local-archive", "shareable"] as const) {
          const exported = runtime.exportBundle(privacy);
          const bundle = parseDiagnosticBundle(exported);
          expect(bundle.selectedProfile).toBe(`${namespace}:${data.id}`);
          expect(bundle.provisionalProfile).toBeUndefined();
          imported.importBundle(exported);
          expect(imported.deviceTarget()?.kind).toBe(
            privacy === "full-local-archive"
              ? "profile-resolved"
              : "unresolved",
          );
          expect(imported.session.source).toBe("imported");
          expect(imported.assessment().readiness).toBe("offline");
          expect(imported.session.experimentalTxEnabled).toBe(false);
          expect(imported.contentGates().every((gate) => !gate.allowed)).toBe(
            true,
          );
          expect(imported.authorize(plan).allowed).toBe(false);
          expect(() => imported.plan({ type: "GetDeviceInfo" })).toThrow();
        }
      } finally {
        await runtime.dispose();
        await imported.dispose();
      }
    },
  );
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
