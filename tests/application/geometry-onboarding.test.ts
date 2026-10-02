import { describe, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { DriverRegistry } from "../../src/drivers/registry";
import { FakeTransport } from "../../src/transport/fake";
import { validateGeometry } from "../../src/domain/device/geometry";
import { parseDiagnosticBundle } from "../../src/diagnostics/bundle";
import {
  lumenFrame,
  syntheticDriver,
  syntheticFingerprint,
  syntheticProfile,
} from "../helpers/synthetic-driver";

function setup(driver = syntheticDriver, known = false) {
  const transport = new FakeTransport(syntheticFingerprint(known));
  transport.notificationOnWrite = lumenFrame(0x91, [0x4c, 0x4d, 24, 8, 7]);
  const runtime = new ApplicationRuntime(
    transport,
    undefined,
    new DriverRegistry([driver]),
  );
  return { transport, runtime };
}
async function identify(runtime: ApplicationRuntime) {
  await runtime.connect();
  runtime.session.enableExperimentalTx();
  await runtime.probe("test-lumen", "lumen-info");
}

describe("sourced provisional geometry", () => {
  it("validates exact dimensions and pixel-budget boundaries before profile creation", async () => {
    for (const [width, height] of [
      [1, 1],
      [512, 1],
      [1, 512],
      [256, 256],
      [512, 128],
    ])
      expect(validateGeometry(width!, height!)).toEqual({ width, height });
    const { runtime } = setup();
    try {
      await identify(runtime);
      for (const [width, height] of [
        [0, 8],
        [-1, 8],
        [24.5, 8],
        [NaN, 8],
        [Infinity, 8],
        [513, 1],
        [1, 513],
        [512, 129],
        [257, 256],
      ]) {
        expect(() =>
          runtime.confirmProvisionalGeometry(width!, height!),
        ).toThrow(/geometry/);
        expect(runtime.session.profile).toBeNull();
        expect(
          runtime.session.fingerprint?.manuallyConfirmedGeometry,
        ).toBeUndefined();
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("requires explicit adoption, preserves actual source, and does not grant operation permissions", async () => {
    const { runtime } = setup();
    const imported = setup().runtime;
    try {
      await identify(runtime);
      const proposal = runtime.geometryProposal()!;
      expect(proposal).toMatchObject({
        width: 24,
        height: 8,
        driverId: "test-lumen",
        transactionId: runtime.transactions[0]!.id,
      });
      expect(runtime.session.profile).toBeNull();
      expect(runtime.deviceTarget()?.kind).toBe("protocol-identified");
      runtime.session.disableExperimentalTx();
      const profile = runtime.useReportedGeometry(proposal.id);
      expect(profile.metadata.geometrySource).toBe("device-info");
      expect(
        runtime.session.fingerprint?.manuallyConfirmedGeometry,
      ).toBeUndefined();
      expect(runtime.deviceTarget()).toMatchObject({
        kind: "provisional",
        geometrySource: "device-info",
      });
      expect(runtime.session.experimentalTxEnabled).toBe(false);
      expect(runtime.assessment().capabilities.brightness.availability).toBe(
        "unsupported",
      );
      expect(runtime.contentGates().every((gate) => !gate.allowed)).toBe(true);
      expect(
        runtime.evaluate(runtime.plan({ type: "GetDeviceInfo" })).allowed,
      ).toBe(false);
      expect(runtime.investigationReportMarkdown()).toContain(
        "device-info (provisional",
      );
      for (const privacy of ["full-local-archive", "shareable"] as const) {
        const json = runtime.exportBundle(privacy);
        expect(
          parseDiagnosticBundle(json).provisionalProfile?.metadata
            .geometryTransactionId,
        ).toBe(proposal.transactionId);
        imported.importBundle(json);
        expect(imported.session.profile?.metadata).toMatchObject({
          geometrySource: "device-info",
          historical: true,
        });
        expect(imported.geometryProposal()).toBeNull();
        expect(() => imported.useReportedGeometry(proposal.id)).toThrow(
          /expired/,
        );
        expect(() => imported.confirmProvisionalGeometry(24, 8)).toThrow(
          /current live/,
        );
        expect(imported.assessment().readiness).toBe("offline");
        expect(imported.session.experimentalTxEnabled).toBe(false);
      }
      runtime.confirmProvisionalGeometry(16, 8);
      expect(runtime.deviceTarget()).toMatchObject({
        geometrySource: "user-confirmed",
      });
      expect(runtime.session.fingerprint?.manuallyConfirmedGeometry).toEqual({
        width: 16,
        height: 8,
      });
    } finally {
      await runtime.dispose();
      await imported.dispose();
    }
  });

  it("expires prepared work and confirmations, including changing back to old dimensions", async () => {
    const { runtime } = setup();
    try {
      await identify(runtime);
      runtime.confirmProvisionalGeometry(24, 8);
      const old = runtime.plan({ type: "GetDeviceInfo" });
      runtime.session.confirmPlanDigest(old.digest);
      runtime.confirmProvisionalGeometry(16, 8);
      expect(runtime.session.confirmedPlanDigest).toBeNull();
      expect(runtime.evaluate(old).allowed).toBe(false);
      runtime.confirmProvisionalGeometry(24, 8);
      expect(runtime.evaluate(old).allowed).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it("retains reviewed geometry and inspectable conflicting response", async () => {
    const { runtime, transport } = setup(syntheticDriver, true);
    try {
      transport.notificationOnWrite = lumenFrame(0x91, [0x4c, 0x4d, 16, 8, 7]);
      await identify(runtime);
      expect(runtime.session.profile).toBe(syntheticProfile);
      expect(runtime.geometryProposal()).toMatchObject({
        width: 16,
        height: 8,
      });
      expect(() =>
        runtime.useReportedGeometry(runtime.geometryProposal()!.id),
      ).toThrow(/Reviewed profile/);
      expect(() => runtime.confirmProvisionalGeometry(16, 8)).toThrow(
        /Reviewed profile/,
      );
      expect(runtime.session.profile).toBe(syntheticProfile);
      expect(runtime.transactions[0]!.decodedResponse?.fields.width).toBe(16);
    } finally {
      await runtime.dispose();
    }
  });

  it("does not infer geometry from invalid dimensions, rejected, unrelated, malformed or timed-out responses", async () => {
    const rejecting = {
      ...syntheticDriver,
      familyProbes: (
        context: Parameters<
          NonNullable<typeof syntheticDriver.familyProbes>
        >[0],
      ) =>
        syntheticDriver.familyProbes!(context).map((probe) => ({
          ...probe,
          identify: () => ({ matched: false as const, reason: "Rejected" }),
        })),
    };
    for (const scenario of [
      "invalid",
      "rejected",
      "unrelated",
      "malformed",
      "timeout",
    ] as const) {
      const { runtime, transport } = setup(
        scenario === "rejected" ? rejecting : syntheticDriver,
      );
      try {
        transport.notificationOnWrite =
          scenario === "invalid"
            ? lumenFrame(0x91, [0x4c, 0x4d, 0, 8, 7])
            : scenario === "unrelated"
              ? lumenFrame(0x92, [0x4c, 0x4d, 24, 8, 7])
              : scenario === "malformed"
                ? Uint8Array.of(1, 2, 3)
                : scenario === "timeout"
                  ? null
                  : transport.notificationOnWrite;
        await identify(runtime);
        expect(runtime.geometryProposal()).toBeNull();
        expect(runtime.session.profile).toBeNull();
      } finally {
        await runtime.dispose();
      }
    }
    for (const width of [0.5, NaN, Infinity, -1, 513, 512]) {
      const { runtime } = setup({
        ...syntheticDriver,
        interpretGeometry: () => ({ width, height: 129 }),
      });
      try {
        await identify(runtime);
        expect(runtime.geometryProposal()).toBeNull();
      } finally {
        await runtime.dispose();
      }
    }
  });

  it("cannot reuse a proposal after reconnect, family replacement, or late replacement-device completion", async () => {
    const { runtime, transport } = setup();
    try {
      await identify(runtime);
      const proposal = runtime.geometryProposal()!;
      await runtime.disconnect();
      await runtime.connect();
      expect(runtime.geometryProposal()).toBeNull();
      expect(() => runtime.useReportedGeometry(proposal.id)).toThrow(/expired/);
      runtime.session.enableExperimentalTx();
      await runtime.probe("test-lumen", "lumen-info");
      const second = runtime.geometryProposal()!;
      const selection = runtime.session.selection;
      runtime.session.selection = null;
      expect(runtime.geometryProposal()).toBeNull();
      expect(() => runtime.useReportedGeometry(second.id)).toThrow(/expired/);
      runtime.session.selection = selection;
      transport.writeDelayMs = 200;
      const pending = runtime
        .probe("test-lumen", "lumen-info")
        .catch((error) => error);
      await vi.waitFor(() => expect(transport.writeAttempts).toHaveLength(3));
      await runtime.disconnect();
      await runtime.connect();
      expect(await pending).toBeInstanceOf(Error);
      expect(runtime.geometryProposal()).toBeNull();
      expect(runtime.session.profile).toBeNull();
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects forged or over-budget exported geometry metadata during import validation", async () => {
    const { runtime } = setup();
    try {
      await identify(runtime);
      runtime.useReportedGeometry(runtime.geometryProposal()!.id);
      const bundle = JSON.parse(runtime.exportBundle());
      bundle.provisionalProfile.metadata.geometryTransactionId = "unrelated";
      expect(() => parseDiagnosticBundle(JSON.stringify(bundle))).toThrow(
        /original successful/,
      );
      bundle.provisionalProfile.width = 512;
      bundle.provisionalProfile.height = 512;
      expect(() => parseDiagnosticBundle(JSON.stringify(bundle))).toThrow(
        /budget/,
      );
    } finally {
      await runtime.dispose();
    }
  });
});
