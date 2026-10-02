import { describe, expect, it } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { DriverRegistry, builtInDrivers } from "../../src/drivers/registry";
import { FakeTransport } from "../../src/transport/fake";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseDiagnosticBundle } from "../../src/diagnostics/bundle";
import { operationalTrust } from "../../src/investigation/claims";
import {
  lumenFrame,
  syntheticDriver,
  syntheticFingerprint,
  syntheticProfile,
  SYNTHETIC_SERVICE,
  SYNTHETIC_NOTIFY,
} from "../helpers/synthetic-driver";

function harness(known = false) {
  const transport = new FakeTransport(syntheticFingerprint(known));
  const registry = new DriverRegistry([...builtInDrivers, syntheticDriver]);
  const runtime = new ApplicationRuntime(
    transport,
    new TraceRecorder(),
    registry,
  );
  // connect() deliberately exercises the live command path on a fake transport,
  // as other application contract tests do. This grants no hardware evidence.
  transport.notificationOnWrite = lumenFrame(0x91, [0x4c, 0x4d, 24, 8, 7]);
  return { runtime, transport, registry };
}

describe("test-only third-family contracts", () => {
  it("merges distinct discovery hints and refuses equal-score or contradicted candidates", () => {
    const { registry } = harness();
    expect(builtInDrivers.map(({ id }) => id)).not.toContain(
      syntheticDriver.id,
    );
    expect(registry.discoveryHints().optionalServices).toContain(
      SYNTHETIC_SERVICE,
    );
    const fingerprint = syntheticFingerprint();
    expect(registry.match(fingerprint)).toMatchObject({
      selected: null,
      ambiguous: false,
    });
    const rival = {
      ...syntheticDriver,
      id: "test-rival",
      match: (input: typeof fingerprint) => ({
        ...syntheticDriver.match(input),
        driverId: "test-rival",
      }),
    };
    expect(
      new DriverRegistry([syntheticDriver, rival]).match(fingerprint),
    ).toMatchObject({ selected: null, ambiguous: true });
    const service = fingerprint.services[0]!;
    const command = service.characteristics[0]!;
    const contradicted = {
      ...fingerprint,
      services: [
        {
          ...service,
          characteristics: [
            { ...command, properties: { ...command.properties, write: false } },
          ],
        },
      ],
    };
    expect(syntheticDriver.match(contradicted)).toMatchObject({
      score: 0,
      confidence: "none",
      contradictions: [expect.stringContaining("write-with-response")],
    });
  });

  it("narrows authored diagnostic availability without mutating contributions", async () => {
    const authored = syntheticDriver.diagnosticTools!();
    const tools = [
      {
        ...authored[0]!,
        id: "disabled",
        available: false,
        unavailableReason: "Authored restriction.",
      },
      { ...authored[0]!, id: "disabled-no-reason", available: false },
      authored[0]!,
    ];
    const before = structuredClone(tools);
    const transport = new FakeTransport(syntheticFingerprint());
    transport.notificationOnWrite = lumenFrame(0x91, [0x4c, 0x4d, 24, 8, 7]);
    const runtime = new ApplicationRuntime(
      transport,
      new TraceRecorder(),
      new DriverRegistry([
        { ...syntheticDriver, diagnosticTools: () => tools },
      ]),
    );
    try {
      await runtime.connect();
      runtime.session.enableExperimentalTx();
      expect(runtime.diagnosticTools()[0]).toMatchObject({
        available: false,
        unavailableReason: "Authored restriction.",
      });
      await expect(runtime.runDiagnostic("disabled")).rejects.toThrow(
        "Authored restriction.",
      );
      await expect(runtime.runDiagnostic("disabled-no-reason")).rejects.toThrow(
        "unavailable for this driver",
      );
      expect(transport.writeAttempts).toHaveLength(0);
      expect(runtime.diagnosticRuns).toHaveLength(0);
      expect((await runtime.runDiagnostic("lumen-identify")).status).toBe(
        "passed",
      );
      runtime.importBundle(runtime.exportBundle());
      expect(runtime.diagnosticTools().every((tool) => !tool.available)).toBe(
        true,
      );
      await expect(runtime.runDiagnostic("lumen-identify")).rejects.toThrow(
        "read-only",
      );
      expect(transport.writeAttempts).toHaveLength(1);
      expect(tools).toEqual(before);
    } finally {
      await runtime.dispose();
    }
  });

  it("decodes only intact distinct frames and matches the exact response expectation", () => {
    const fingerprint = syntheticFingerprint();
    const context = { fingerprint, profile: null, source: "fake" as const };
    expect(Array.from(lumenFrame(0x11))).toEqual([0xa7, 0x11, 0, 0xb6]);
    const bytes = lumenFrame(0x91, [0x4c, 0x4d, 24, 8, 7]);
    expect(Array.from(bytes)).toEqual([
      0xa7, 0x91, 5, 0x4c, 0x4d, 24, 8, 7, 0x25,
    ]);
    const decoded = syntheticDriver.decodeNotification!(bytes, context)!;
    expect(decoded.fields).toEqual({ width: 24, height: 8, brightnessRaw: 7 });
    const expectation = syntheticDriver.plan(
      { type: "GetDeviceInfo" },
      { ...context, profile: syntheticProfile },
    ).responseExpectation;
    expect(syntheticDriver.responseMatches!(decoded, expectation)).toBe(true);
    expect(
      syntheticDriver.responseMatches!(
        { ...decoded, opcode: 0x92 },
        expectation,
      ),
    ).toBe(false);
    bytes[8] = 0;
    expect(syntheticDriver.decodeNotification!(bytes, context)).toBeNull();
    expect(
      syntheticDriver.decodeNotification!(Uint8Array.of(1, 0, 3), context),
    ).toBeNull();
  });

  it("identifies without a profile, resolves explicit geometry, and binds plans to the connection", async () => {
    const { runtime, transport } = harness();
    try {
      await runtime.connect();
      expect(runtime.deviceTarget()?.kind).toBe("unresolved");
      await expect(runtime.probe("test-lumen", "lumen-info")).rejects.toThrow(
        /per-session unlock/,
      );
      expect(transport.writes).toHaveLength(0);
      runtime.session.enableExperimentalTx();
      const run = await runtime.runDiagnostic("lumen-identify");
      expect(run.status).toBe("passed");
      expect(runtime.deviceTarget()).toMatchObject({
        kind: "protocol-identified",
        geometry: null,
        driverId: "test-lumen",
      });
      expect(() => runtime.confirmProvisionalGeometry(0, 8)).toThrow(
        /geometry/,
      );
      const profile = runtime.confirmProvisionalGeometry(24, 8);
      expect(profile).toMatchObject({ width: 24, height: 8, evidence: [] });
      expect(runtime.deviceTarget()).toMatchObject({
        kind: "provisional",
        geometrySource: "user-confirmed",
      });
      const plan = runtime.plan({ type: "GetDeviceInfo" });
      expect(plan).toMatchObject({
        driverId: "test-lumen",
        profileId: profile.id,
        targetBinding: { connectionId: transport.connectionId },
        digest: expect.any(String),
      });
      expect(runtime.evaluate(plan).allowed).toBe(true);
      const result = await runtime.send(plan);
      expect(result).toMatchObject({
        hostAccepted: true,
        protocolAcknowledged: true,
        deviceStateVerified: true,
        responseTimedOut: false,
      });
      expect(
        runtime.transactions
          .at(-1)
          ?.packets.find(({ direction }) => direction === "RX")?.endpoint,
      ).toEqual({
        serviceUuid: SYNTHETIC_SERVICE,
        characteristicUuid: SYNTHETIC_NOTIFY,
      });
      plan.packets[0]!.bytes[0] = 0;
      expect(runtime.evaluate(plan)).toMatchObject({
        allowed: false,
        reasons: expect.arrayContaining([
          expect.stringContaining("changed after its digest"),
        ]),
      });
      expect(runtime.assessment().capabilities.brightness.availability).toBe(
        "unsupported",
      );
      expect(() => runtime.plan({ type: "SetBrightness", raw: 7 })).toThrow(
        /does not support/,
      );
      await runtime.disconnect();
      expect(runtime.session.experimentalTxEnabled).toBe(false);
      expect(runtime.evaluate(plan).allowed).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it("resolves a local profile after probing without inheriting another family's claims", async () => {
    const { runtime } = harness(true);
    try {
      await runtime.connect();
      runtime.session.enableExperimentalTx();
      await runtime.probe("test-lumen", "lumen-info");
      expect(runtime.deviceTarget()).toMatchObject({
        kind: "profile-resolved",
        profile: syntheticProfile,
      });
      expect(runtime.baselineClaimEvidence()).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("exports exact software evidence, demotes imported investigation claims, and blocks replay writes", async () => {
    const { runtime } = harness();
    const imported = harness().runtime;
    try {
      await runtime.connect();
      runtime.session.enableExperimentalTx();
      await runtime.probe("test-lumen", "lumen-info");
      runtime.confirmProvisionalGeometry(24, 8);
      const investigation = runtime.ensureInvestigation();
      // An authored scope-spoofing fixture tests the import boundary, not a
      // claim that this synthetic transport physically verified a display.
      runtime.adoptInvestigation({
        ...investigation,
        claimEvidence: [
          {
            claimId: "device-info.query",
            status: "verified",
            scope: "built-in-profile",
            provenance: "observed",
            summary: "AUTHORED scope-spoofing test only.",
          },
        ],
      });
      const exported = parseDiagnosticBundle(runtime.exportBundle());
      const archive = JSON.stringify({
        ...exported,
        investigation: {
          ...exported.investigation,
          claimEvidence: exported.investigation!.claimEvidence.map((entry) => ({
            ...entry,
            scope: "built-in-profile",
          })),
        },
      });
      expect(parseDiagnosticBundle(archive).transactions[0]?.driverId).toBe(
        "test-lumen",
      );
      expect(
        parseDiagnosticBundle(runtime.exportBundle("shareable")).fingerprint
          .browserDeviceId,
      ).toBeUndefined();
      imported.importBundle(archive);
      expect(imported.session.source).toBe("imported");
      expect(
        imported.investigation?.claimEvidence.map(({ scope }) => scope),
      ).toEqual(["imported-external"]);
      expect(
        operationalTrust(
          "device-info.query",
          imported.investigation?.claimEvidence ?? [],
        ).trusted,
      ).toBe(false);
      expect(imported.assessment().readiness).toBe("offline");
      await expect(imported.probe("test-lumen", "lumen-info")).rejects.toThrow(
        /cannot perform live probes/,
      );
      expect(() => imported.plan({ type: "GetDeviceInfo" })).toThrow(
        /non-ambiguous driver and profile/,
      );
    } finally {
      await runtime.dispose();
      await imported.dispose();
    }
  });

  it("preserves failed transfers and rejects timed-out identification without retry", async () => {
    const { runtime, transport } = harness();
    try {
      await runtime.connect();
      runtime.session.enableExperimentalTx();
      transport.notificationOnWrite = null;
      const result = await runtime.probe("test-lumen", "lumen-info");
      expect(result.responseTimedOut).toBe(true);
      expect(runtime.deviceTarget()?.kind).toBe("unresolved");
      expect(transport.writeAttempts).toHaveLength(1);
      transport.failWriteAt = transport.writes.length;
      await expect(runtime.probe("test-lumen", "lumen-info")).rejects.toThrow(
        /Injected write failure/,
      );
      expect(runtime.transactions.at(-1)?.error).toMatch(
        /Injected write failure/,
      );
      expect(transport.writeAttempts).toHaveLength(2);
    } finally {
      await runtime.dispose();
    }
  });
});
