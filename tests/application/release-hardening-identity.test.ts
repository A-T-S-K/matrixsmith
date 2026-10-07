import { describe, expect, it } from "vitest";
import type {
  AdvertisementObservation,
  DeviceFingerprint,
} from "../../src/core/device";
import type { NotificationRouter } from "../../src/app/notifications";
import { ApplicationRuntime } from "../../src/application/runtime";
import { DriverRegistry } from "../../src/drivers/registry";
import { FakeTransport } from "../../src/transport/fake";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { COOLLEDX_ENDPOINT } from "../../src/drivers/coolledx/gatt";
import info from "../fixtures/iledhat/coolledux-device-info-cc.json";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import {
  syntheticDriver,
  syntheticFingerprint,
  SYNTHETIC_SERVICE,
  SYNTHETIC_NOTIFY,
  lumenFrame,
} from "../helpers/synthetic-driver";

function observed(companyId = 0x31ae): AdvertisementObservation {
  return {
    capturedAt: "2026-10-06T12:00:00Z",
    source: "web-bluetooth-watch",
    advertisedServiceUuids: [],
    manufacturerData: [{ companyId, dataHex: "FFFF" }],
    serviceData: [],
  };
}
class AdvertisementTransport extends FakeTransport {
  observations: ((value: AdvertisementObservation | null) => void)[] = [];
  async observeAdvertisements(): Promise<AdvertisementObservation | null> {
    return new Promise((resolve) => this.observations.push(resolve));
  }
  async deliver(
    observation: AdvertisementObservation,
    index = this.observations.length - 1,
  ) {
    this.fingerprint = {
      ...this.fingerprint!,
      advertisementObservation: observation,
    };
    this.observations[index]!(observation);
    await Promise.resolve();
    await Promise.resolve();
  }
}
function setup(
  fingerprint: DeviceFingerprint = knownIledHatFingerprint(),
  registry?: DriverRegistry,
) {
  const transport = new AdvertisementTransport(fingerprint);
  const runtime = new ApplicationRuntime(transport, undefined, registry);
  return { transport, runtime };
}

describe("live advertisement identity reconciliation", () => {
  it("withdraws an initially conflicting structured company and cannot authorize a persistent send", async () => {
    const { runtime } = setup({
      ...knownIledHatFingerprint(),
      advertisementObservation: observed(0xffff),
    });
    try {
      await runtime.connect();
      expect(runtime.session.profile).toBeNull();
      expect(runtime.session.selection?.selected).toBeNull();
      expect(runtime.session.identityTrustWithdrawn).toBe(true);
      expect(runtime.contentGates().every((gate) => !gate.allowed)).toBe(true);
      expect(() => runtime.plan({ type: "ShowText", text: "No" })).toThrow();
    } finally {
      await runtime.dispose();
    }
  });
  it("keeps a prepared plan valid across harmless observation enrichment on the same trusted target", async () => {
    const { runtime, transport } = setup();
    try {
      await runtime.connect();
      const plan = runtime.plan({ type: "GetDeviceInfo" });
      expect(runtime.authorize(plan).allowed).toBe(true);
      const profile = runtime.session.profile;
      const revision = runtime.session.identityAuthorityRevision;
      await transport.deliver(observed());
      expect(runtime.session.profile).toBe(profile);
      expect(runtime.session.identityAuthorityRevision).toBe(revision);
      expect(runtime.authorize(plan).allowed).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });
  it("late contradictions clear authority, selected response, prepared work and current evidence; disappearance does not restore trust", async () => {
    const { runtime, transport } = setup();
    try {
      await runtime.connect();
      const plan = runtime.plan({ type: "GetDeviceInfo" });
      const revision = runtime.session.identityAuthorityRevision;
      runtime.session.enableExperimentalTx();
      runtime.session.confirmPlanDigest(plan.digest!);
      const investigation = runtime.startInvestigation({
        kind: "develop",
        description: "Identity reconciliation",
      });
      await transport.deliver(observed(0xffff));
      expect(runtime.session.profile).toBeNull();
      expect(runtime.session.selection?.selected).toBeNull();
      expect(runtime.session.experimentalTxEnabled).toBe(false);
      expect(runtime.session.confirmedPlanDigest).toBeNull();
      expect(runtime.session.latestDeviceInfo).toBeNull();
      expect(runtime.session.geometryProposal).toBeNull();
      expect(runtime.session.identityAuthorityRevision).toBeGreaterThan(
        revision,
      );
      expect(runtime.authorize(plan).allowed).toBe(false);
      expect(runtime.investigation).not.toBe(investigation);
      expect(runtime.contentGates().every((gate) => !gate.allowed)).toBe(true);
      // Reobserve a valid field on this same connection; no automatic restoration.
      (
        runtime as unknown as {
          connection: { _enrichAdvertisementEvidence(): void };
        }
      ).connection._enrichAdvertisementEvidence();
      await transport.deliver({ ...observed(), manufacturerData: [] });
      expect(runtime.session.profile).toBeNull();
      expect(runtime.session.selection?.selected).toBeNull();
      expect(runtime.session.identityTrustWithdrawn).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });
  it("retires correlated response eligibility and decodes later packets only as history after withdrawal", async () => {
    const { runtime, transport } = setup();
    transport.notificationOnWriteEndpoint = COOLLEDX_ENDPOINT;
    transport.notificationOnWrite = parseHexBytes(info.rxHex);
    try {
      await runtime.connect();
      await runtime.enableDriverNotifications();
      await runtime.send(runtime.plan({ type: "GetDeviceInfo" }));
      expect(runtime.session.latestDeviceInfo).not.toBeNull();
      await transport.deliver(observed(0xffff));
      expect(runtime.session.latestDeviceInfo).toBeNull();
      transport.emitNotification(COOLLEDX_ENDPOINT, parseHexBytes(info.rxHex));
      expect(runtime.session.latestDeviceInfo).toBeNull();
      expect(runtime.session.notifications.at(-1)?.decoded?.kind).toBe(
        "device-info",
      );
      expect(runtime.session.protocolResolution).toBeNull();
    } finally {
      await runtime.dispose();
    }
  });
  it("detaches a profile-free investigation when observed identity contradicts its probed live target", async () => {
    const { runtime, transport } = setup({
      ...knownIledHatFingerprint(),
      name: "Generic LED Panel",
    });
    transport.notificationOnWriteEndpoint = COOLLEDX_ENDPOINT;
    transport.notificationOnWrite = parseHexBytes(info.rxHex);
    try {
      await runtime.connect();
      await runtime.probe("coolledux", "get-device-info");
      expect(runtime.session.profile).toBeNull();
      expect(runtime.session.protocolResolution?.driverId).toBe("coolledux");
      const investigation = runtime.startInvestigation({
        kind: "develop",
        description: "Profile-free live evidence",
      });
      await transport.deliver(observed(0xffff));
      expect(runtime.investigation).toBeNull();
      expect(runtime.takeDetachedInvestigation()?.id).toBe(investigation.id);
      expect(runtime.session.protocolResolution).toBeNull();
      expect(runtime.session.selection?.selected).toBeNull();
    } finally {
      await runtime.dispose();
    }
  });
  it("preserves expired response ambiguity across enrichment and withdrawal on the same connection", async () => {
    const { runtime, transport } = setup();
    try {
      await runtime.connect();
      const expectation = runtime.plan({
        type: "GetDeviceInfo",
      }).responseExpectation;
      if (expectation.type === "none")
        throw new Error("Expected reviewed response");
      const router = (
        runtime as unknown as {
          protocolEvidence: { getNotificationRouter(): NotificationRouter };
        }
      ).protocolEvidence.getNotificationRouter();
      const waiter = router.arm(
        expectation,
        () => true,
        transport.connectionId!,
      );
      waiter.dispatch();
      waiter.cancel();
      await expect(waiter.promise).rejects.toThrow("cancelled");
      expect(router.canSchedule(expectation)).toBe(false);
      await transport.deliver(observed(0xffff));
      expect(router.canSchedule(expectation)).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });
  it("copies of reviewed IDs and labels do not receive built-in physical evidence", async () => {
    const copied = structuredClone(coolLedUxDriver.profiles()[0]!);
    const registry = new DriverRegistry([
      {
        ...coolLedUxDriver,
        profiles: () => [copied],
        resolveProfile: () => copied,
      },
    ]);
    const { runtime } = setup(knownIledHatFingerprint(), registry);
    try {
      await runtime.connect();
      expect(
        runtime
          .baselineClaimEvidence()
          .every((entry) => entry.scope === "source-reference"),
      ).toBe(true);
      expect(registry.definitionIdentity(coolLedUxDriver.id, copied)).toContain(
        "unversioned",
      );
      expect(runtime.contentGates().every((gate) => !gate.allowed)).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });
  it.each(["manual", "reported"] as const)(
    "retains application-owned %s geometry, provenance and investigation during harmless enrichment",
    async (source) => {
      const { runtime, transport } = setup(
        syntheticFingerprint(false),
        new DriverRegistry([syntheticDriver]),
      );
      transport.notificationOnWriteEndpoint = {
        serviceUuid: SYNTHETIC_SERVICE,
        characteristicUuid: SYNTHETIC_NOTIFY,
      };
      transport.notificationOnWrite = lumenFrame(0x91, [0x4c, 0x4d, 24, 8, 7]);
      try {
        await runtime.connect();
        runtime.session.enableExperimentalTx();
        await runtime.probe("test-lumen", "lumen-info");
        if (source === "manual") runtime.confirmProvisionalGeometry(16, 8);
        else runtime.useReportedGeometry(runtime.geometryProposal()!.id);
        const profile = runtime.session.profile;
        const manual = runtime.session.fingerprint?.manuallyConfirmedGeometry;
        const investigation = runtime.startInvestigation({
          kind: "develop",
          description: "Identity reconciliation",
        });
        const revision = runtime.session.identityAuthorityRevision;
        await transport.deliver(observed());
        expect(runtime.session.profile).toBe(profile);
        expect(runtime.session.fingerprint?.manuallyConfirmedGeometry).toEqual(
          manual,
        );
        expect(runtime.session.profile?.metadata.geometrySource).toBe(
          source === "manual" ? "user-confirmed" : "device-info",
        );
        expect(runtime.investigation).toBe(investigation);
        expect(runtime.session.identityAuthorityRevision).toBe(revision);
        expect(runtime.deviceTarget()?.kind).toBe("provisional");
      } finally {
        await runtime.dispose();
      }
    },
  );
  it("rejects an observation from a retired generation even if the browser identity is reused", async () => {
    const { runtime, transport } = setup();
    try {
      await runtime.connect();
      await runtime.disconnect();
      transport.fingerprint = knownIledHatFingerprint();
      await runtime.connect();
      const fingerprint = runtime.session.fingerprint;
      await transport.deliver(observed(0xffff), 0);
      expect(runtime.session.fingerprint).toBe(fingerprint);
      expect(runtime.session.profile).not.toBeNull();
      expect(runtime.session.identityTrustWithdrawn).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });
  it("keeps imported observations historical and refuses late live enrichment", async () => {
    const { runtime, transport } = setup();
    try {
      await runtime.connect();
      runtime.importBundle(runtime.exportBundle("full-local-archive"));
      const fingerprint = runtime.session.fingerprint;
      await transport.deliver(observed(0xffff));
      expect(runtime.session.fingerprint).toBe(fingerprint);
      expect(runtime.session.source).toBe("imported");
      expect(runtime.assessment().readiness).toBe("offline");
      expect(runtime.session.experimentalTxEnabled).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });
});
