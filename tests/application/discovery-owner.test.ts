import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { DriverRegistry } from "../../src/drivers/registry";
import { FakeTransport } from "../../src/transport/fake";
import { discoveryDriver } from "../helpers/discovery-driver";
import {
  syntheticDriver,
  syntheticFingerprint,
  lumenFrame,
  SYNTHETIC_SERVICE,
  SYNTHETIC_NOTIFY,
} from "../helpers/synthetic-driver";
import type { MatrixDriver } from "../../src/drivers/types";
import { DISCOVERY_LIMITS } from "../../src/application/services/discovery-service";

const rx = {
  serviceUuid: SYNTHETIC_SERVICE,
  characteristicUuid: SYNTHETIC_NOTIFY,
};
const response = (opcode: number) => lumenFrame(opcode, [0x4c, 0x4d, 24, 8, 7]);
const runtimes: ApplicationRuntime[] = [];
async function setup(drivers: MatrixDriver[], opcode: number | null = null) {
  const transport = new FakeTransport(syntheticFingerprint());
  transport.notificationOnWriteEndpoint = rx;
  transport.notificationOnWrite = opcode === null ? null : response(opcode);
  const runtime = new ApplicationRuntime(
    transport,
    undefined,
    new DriverRegistry(drivers),
  );
  runtimes.push(runtime);
  await runtime.connect();
  return { runtime, transport };
}
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  vi.useRealTimers();
});

describe("bounded machine discovery owner (software fixtures only)", () => {
  it("executes multiple distinct correlated signatures and identifies the appropriate family regardless of order", async () => {
    for (const reverse of [false, true]) {
      const drivers = [
        discoveryDriver("a", 0x91),
        discoveryDriver("b", 0x92, { geometry: true }),
      ];
      const { runtime, transport } = await setup(
        reverse ? drivers.reverse() : drivers,
        0x92,
      );
      await runtime.startDiscovery();
      expect(
        runtime.discovery?.attempts.map((attempt) => [
          attempt.stepId,
          attempt.outcome,
        ]),
      ).toEqual([
        ["a/info", "timeout"],
        ["b/info", "identified"],
      ]);
      expect(transport.writeAttempts).toHaveLength(2);
      expect(runtime.session.protocolResolution?.driverId).toBe("b");
      expect(runtime.discovery?.hypotheses[0]?.contradictions).toEqual([]);
      expect(
        runtime.discovery?.hypotheses.map((hypothesis) => hypothesis.driverId),
      ).toEqual(["a", "b"]);
      expect(runtime.discovery?.terminal).toBe("geometry");
      const attempt = runtime.discovery!.attempts[1]!;
      expect(attempt.transactionId).toBe(runtime.transactions[1]!.id);
      expect(attempt.responseSequence).toBeGreaterThan(0);
      expect(attempt.connectionId).toBe(transport.connectionId);
      expect(attempt.definitionIdentity).toBe("b/unversioned:family-candidate");
      expect(attempt.sources).toEqual(["authored-lumen-vectors"]);
      expect(runtime.session.profile).toBeNull();
      expect(runtime.session.experimentalTxEnabled).toBe(false);
      const proposal = runtime.geometryProposal()!;
      expect(proposal).toMatchObject({
        width: 24,
        height: 8,
        transactionId: attempt.transactionId,
      });
      runtime.useReportedGeometry(proposal.id);
      expect(runtime.session.profile?.metadata.geometrySource).toBe(
        "device-info",
      );
      expect(runtime.session.profile?.validation).toBe("experimental");
      expect(runtime.contentGates().every((gate) => !gate.allowed)).toBe(true);
    }
  });
  it("competing positives across distinct checks remain in the ledger without selecting a family", async () => {
    const { runtime, transport } = await setup([
      discoveryDriver("a", 0x91, { metadata: { stopping: "continue" } }),
      discoveryDriver("b", 0x92, { geometry: true }),
    ]);
    const original = transport.write.bind(transport);
    vi.spyOn(transport, "write").mockImplementation(async (...args) => {
      transport.notificationOnWrite = response(
        transport.writeAttempts.length === 0 ? 0x91 : 0x92,
      );
      return original(...args);
    });
    await runtime.startDiscovery();
    expect(
      runtime.discovery?.attempts.map((attempt) => attempt.outcome),
    ).toEqual(["identified", "identified"]);
    expect(
      runtime.discovery?.hypotheses.every(
        (hypothesis) => hypothesis.support.length === 1,
      ),
    ).toBe(true);
    expect(runtime.discovery?.terminal).toBe("multiple");
    expect(runtime.session.protocolResolution).toBeNull();
    expect(runtime.geometryProposal()).toBeNull();
  });
  it("timeout preserves all competing hypotheses and offers a useful partial-result action", async () => {
    const { runtime } = await setup([
      discoveryDriver("a", 0x91),
      discoveryDriver("b", 0x92),
    ]);
    await runtime.startDiscovery();
    expect(runtime.discovery?.terminal).toBe("multiple");
    expect(
      runtime.discovery?.attempts.map((attempt) => attempt.outcome),
    ).toEqual(["timeout", "timeout"]);
    expect(
      runtime.discovery?.hypotheses.every(
        (hypothesis) =>
          !hypothesis.contradictions.length &&
          hypothesis.unanswered.length === 1,
      ),
    ).toBe(true);
    expect(runtime.discovery?.summary).toContain("Protocol workbench");
  });
  it("only a reviewed explicit rejection contradicts its declared configuration scope", async () => {
    const { runtime } = await setup(
      [
        discoveryDriver("a", 0x91, {
          interpretation: {
            matched: false,
            reason: "Reviewed vector rejects model X only",
            rejection: { driverId: "a", configurationId: "model-x" },
          },
        }),
        discoveryDriver("b", 0x92),
      ],
      0x91,
    );
    await runtime.startDiscovery();
    expect(runtime.discovery?.attempts[0]?.outcome).toBe("rejected");
    expect(runtime.discovery?.hypotheses[0]?.contradictions).toEqual([
      {
        stepId: "a/info",
        configurationId: "model-x",
        summary: "Reviewed vector rejects model X only",
      },
    ]);
    expect(runtime.discovery?.hypotheses[1]?.contradictions).toEqual([]);
    expect(runtime.session.protocolResolution).toBeNull();
  });
  it("cannot reject a different undeclared family", async () => {
    const { runtime } = await setup(
      [
        discoveryDriver("a", 0x91, {
          interpretation: {
            matched: false,
            reason: "Out of scope",
            rejection: { driverId: "b" },
          },
        }),
        discoveryDriver("b", 0x92),
      ],
      0x91,
    );
    await runtime.startDiscovery();
    expect(
      runtime.discovery?.hypotheses.every(
        (hypothesis) => !hypothesis.contradictions.length,
      ),
    ).toBe(true);
    expect(runtime.discovery?.attempts).toHaveLength(2);
    expect(runtime.discovery?.attempts[0]?.outcome).toBe("inconclusive");
  });
  it("does not dispatch an overlapping request after timeout, while distinct signatures remain usable", async () => {
    const { runtime, transport } = await setup([
      discoveryDriver("a", 0x91),
      discoveryDriver("b", 0x91),
      discoveryDriver("c", 0x93),
    ]);
    await runtime.startDiscovery();
    expect(
      runtime.discovery?.attempts.map((attempt) => attempt.outcome),
    ).toEqual(["timeout", "ambiguous", "timeout"]);
    expect(transport.writeAttempts).toHaveLength(2);
    expect(runtime.geometryProposal()).toBeNull();
  });
  it("contradictory valid decoders cannot manufacture identity through priority or order", async () => {
    for (const reverse of [false, true]) {
      const drivers = [discoveryDriver("a", 0x91), discoveryDriver("b", 0x91)];
      const { runtime } = await setup(
        reverse ? drivers.reverse() : drivers,
        0x91,
      );
      await runtime.startDiscovery();
      expect(
        runtime.discovery?.attempts.every(
          (attempt) => attempt.outcome === "ambiguous",
        ),
      ).toBe(true);
      expect(runtime.session.protocolResolution).toBeNull();
      expect(runtime.geometryProposal()).toBeNull();
      expect(runtime.session.notifications[0]?.interpretationAmbiguous).toBe(
        true,
      );
    }
  });
  it("malformed correlated interpretation cannot establish identity even if a fixture returns matched true", async () => {
    const driver = discoveryDriver("a", 0x91, { geometry: true });
    const { runtime } = await setup(
      [
        {
          ...driver,
          decodeNotification: (...args) => {
            const decoded = driver.decodeNotification!(...args);
            return decoded
              ? { ...decoded, envelopeError: "Authored malformed vector" }
              : null;
          },
        },
      ],
      0x91,
    );
    await runtime.startDiscovery();
    expect(runtime.discovery?.attempts[0]?.outcome).toBe("inconclusive");
    expect(runtime.session.protocolResolution).toBeNull();
    expect(runtime.geometryProposal()).toBeNull();
  });
  it.each([
    "dry-run",
    "unavailable",
    "control",
    "persistent",
    "firmware",
    "destructive",
  ])("cannot execute %s contributions", async (mode) => {
    const driver = discoveryDriver("a", 0x91, {
      metadata: mode === "unavailable" ? { available: false } : {},
      plan: (plan) =>
        mode === "dry-run"
          ? { ...plan, execution: "dry-run-only" }
          : mode === "control"
            ? { ...plan, operation: { type: "SetBrightness", raw: 1 } }
            : mode === "persistent"
              ? { ...plan, risk: "persistent", persistence: "persistent" }
              : mode === "firmware" || mode === "destructive"
                ? { ...plan, risk: mode }
                : plan,
    });
    const { runtime, transport } = await setup([driver], 0x91);
    await runtime.startDiscovery();
    expect(transport.writeAttempts).toHaveLength(0);
    expect(runtime.session.protocolResolution).toBeNull();
    expect(
      runtime.discovery?.attempts.every(
        (attempt) => attempt.outcome === "blocked",
      ),
    ).toBe(true);
  });
  it("stops at four attempts and replanning never replenishes finite budgets", async () => {
    const { runtime, transport } = await setup(
      Array.from({ length: 6 }, (_, index) =>
        discoveryDriver(`a${index}`, 0x91 + index),
      ),
    );
    await runtime.startDiscovery();
    expect(runtime.discovery?.attempts).toHaveLength(DISCOVERY_LIMITS.attempts);
    expect(runtime.discovery?.remaining).toEqual({
      attempts: 0,
      packets: 4,
      bytes: 2032,
      elapsedMs: 29480,
    });
    expect(runtime.discovery?.terminal).toBe("budget");
    expect(transport.writeAttempts).toHaveLength(4);
  });
  it.each(["packets", "bytes", "elapsedMs"] as const)(
    "reserves the %s limit before plan allocation",
    async (cost) => {
      const plan = vi.fn((plan) => plan);
      const driver = discoveryDriver("a", 0x91, {
        metadata: {
          cost: {
            packets: 1,
            bytes: 4,
            elapsedMs: 130,
            [cost]: DISCOVERY_LIMITS[cost] + 1,
          },
        },
        plan,
      });
      const { runtime, transport } = await setup([driver]);
      await runtime.startDiscovery();
      expect(plan).not.toHaveBeenCalled();
      expect(transport.writeAttempts).toHaveLength(0);
      expect(runtime.discovery?.terminal).toBe("budget");
    },
  );
  it("definition replacement between catalog pinning and compilation prevents dispatch", async () => {
    const { runtime, transport } = await setup([discoveryDriver("a", 0x91)]);
    vi.spyOn(runtime.registry, "definitionIdentity")
      .mockReturnValueOnce("pinned")
      .mockReturnValue("replacement");
    await runtime.startDiscovery();
    expect(runtime.discovery?.attempts[0]).toMatchObject({
      outcome: "retired",
      definitionIdentity: "pinned",
    });
    expect(transport.writeAttempts).toHaveLength(0);
    expect(runtime.geometryProposal()).toBeNull();
  });
  it("rejects a compiled plan exceeding its reviewed bounds before sending", async () => {
    const { runtime, transport } = await setup([
      discoveryDriver("a", 0x91, {
        metadata: { cost: { packets: 1, bytes: 1, elapsedMs: 130 } },
      }),
    ]);
    await runtime.startDiscovery();
    expect(runtime.discovery?.attempts[0]?.outcome).toBe("blocked");
    expect(transport.writeAttempts).toHaveLength(0);
  });
  it("Stop retains in-flight ownership, settles evidence, and prevents adoption and later checks", async () => {
    vi.useFakeTimers();
    const { runtime, transport } = await setup(
      [
        discoveryDriver("a", 0x91, { geometry: true }),
        discoveryDriver("b", 0x92),
      ],
      0x91,
    );
    transport.writeDelayMs = 20;
    const pending = runtime.startDiscovery();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.writeAttempts).toHaveLength(1);
    runtime.stopDiscovery();
    expect(runtime.discoveryBusy).toBe(true);
    expect(runtime.discovery?.status).toBe("stopping");
    expect(() => runtime.probe("b", "info")).toThrow(/owns execution/);
    expect(() => runtime.read(rx)).toThrow(/owns execution/);
    expect(() => runtime.importExternalLog("{}")).toThrow(/owns execution/);
    expect(() => runtime.confirmProvisionalGeometry(24, 8)).toThrow(
      /owns execution/,
    );
    await expect(runtime.startDiscovery()).rejects.toThrow(/owns/);
    await vi.advanceTimersByTimeAsync(20);
    await pending;
    expect(runtime.discoveryBusy).toBe(false);
    expect(runtime.transactions).toHaveLength(1);
    expect(runtime.discovery?.attempts).toHaveLength(1);
    expect(runtime.session.protocolResolution).toBeNull();
    expect(runtime.geometryProposal()).toBeNull();
    expect(transport.writeAttempts).toHaveLength(1);
  });
  it.each(["disconnect", "fingerprint", "profile", "geometry", "dispose"])(
    "%s replacement suppresses stale adoption",
    async (replacement) => {
      vi.useFakeTimers();
      const { runtime, transport } = await setup(
        [discoveryDriver("a", 0x91, { geometry: true })],
        0x91,
      );
      transport.writeDelayMs = 20;
      const pending = runtime.startDiscovery();
      await vi.advanceTimersByTimeAsync(0);
      if (replacement === "disconnect") await runtime.disconnect();
      if (replacement === "dispose") await runtime.dispose();
      if (replacement === "fingerprint")
        runtime.session.fingerprint = {
          ...syntheticFingerprint(),
          name: "replacement",
        };
      if (replacement === "profile")
        runtime.session.profile = {
          ...syntheticDriver.profiles()[0]!,
          id: "replacement",
        };
      if (replacement === "geometry") runtime.session.geometryRevision++;
      await vi.advanceTimersByTimeAsync(20);
      await pending;
      expect(runtime.discovery?.status).toBe("retired");
      expect(runtime.session.protocolResolution).toBeNull();
      expect(runtime.geometryProposal()).toBeNull();
      expect(runtime.transactions).toHaveLength(1);
    },
  );
  it("missing endpoint/setup and write failures are typed from their failing stages", async () => {
    const { runtime, transport } = await setup([discoveryDriver("a", 0x91)]);
    vi.spyOn(transport, "subscribe").mockRejectedValueOnce(
      new Error("same text"),
    );
    await runtime.startDiscovery();
    expect(runtime.discovery?.attempts[0]?.outcome).toBe("access");
    expect(transport.writeAttempts).toHaveLength(0);
    transport.failWriteAt = 0;
    await runtime.startDiscovery();
    expect(runtime.discovery?.attempts[0]?.outcome).toBe("transport");
    expect(runtime.discovery?.attempts[0]?.transactionId).toBe(
      runtime.transactions[0]!.id,
    );
  });
  it("missing response endpoint is access failure before any write", async () => {
    const { runtime, transport } = await setup([discoveryDriver("a", 0x91)]);
    const fingerprint = runtime.session.fingerprint!;
    runtime.session.fingerprint = {
      ...fingerprint,
      services: fingerprint.services.map((service) => ({
        ...service,
        characteristics: service.characteristics.map((characteristic) => ({
          ...characteristic,
          properties: {
            ...characteristic.properties,
            notify: false,
            indicate: false,
          },
        })),
      })),
    };
    await runtime.startDiscovery();
    expect(runtime.discovery?.attempts[0]?.outcome).toBe("access");
    expect(transport.writeAttempts).toHaveLength(0);
    expect(runtime.geometryProposal()).toBeNull();
  });
  it("elapsed deadline prevents dispatch while unresolved response setup remains owned", async () => {
    vi.useFakeTimers();
    const { runtime, transport } = await setup([discoveryDriver("a", 0x91)]);
    let release!: () => void;
    const original = transport.subscribe.bind(transport);
    vi.spyOn(transport, "subscribe").mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(...args);
    });
    const pending = runtime.startDiscovery();
    await vi.advanceTimersByTimeAsync(DISCOVERY_LIMITS.elapsedMs);
    expect(runtime.discoveryBusy).toBe(true);
    expect(runtime.discovery?.status).toBe("stopping");
    expect(runtime.discovery?.terminal).toBe("budget");
    expect(transport.writeAttempts).toHaveLength(0);
    release();
    await pending;
    expect(runtime.discoveryBusy).toBe(false);
    expect(runtime.discovery?.terminal).toBe("budget");
    expect(transport.writeAttempts).toHaveLength(0);
  });
  it("synchronous projections during adoption cannot retire their own originating interview", async () => {
    const { runtime } = await setup(
      [discoveryDriver("a", 0x91, { geometry: true })],
      0x91,
    );
    const unsubscribe = runtime.trace.subscribe(() => {
      void runtime.discovery;
    });
    await runtime.startDiscovery();
    unsubscribe();
    expect(runtime.discovery?.terminal).toBe("geometry");
    expect(runtime.discovery?.status).toBe("complete");
  });
  it("experimental definitions remain a review boundary even with a broad session unlock", async () => {
    const base = discoveryDriver("a", 0x91);
    const driver = {
      ...base,
      familyProbes: (
        context: Parameters<NonNullable<MatrixDriver["familyProbes"]>>[0],
      ) =>
        base.familyProbes!(context).map((probe) => ({
          ...probe,
          safety: {
            ...probe.safety,
            hazard: "experimental" as const,
            assurance: "experimental" as const,
          },
        })),
    };
    const { runtime, transport } = await setup([driver], 0x91);
    await runtime.startDiscovery();
    expect(runtime.discovery?.terminal).toBe("review");
    expect(runtime.session.experimentalTxEnabled).toBe(false);
    runtime.session.enableExperimentalTx();
    await runtime.startDiscovery();
    expect(runtime.discovery?.terminal).toBe("review");
    expect(transport.writeAttempts).toHaveLength(0);
  });
  it("no catalog and imported/history records cannot authorize execution", async () => {
    const { runtime, transport } = await setup([syntheticDriver]);
    await runtime.startDiscovery();
    expect(runtime.discovery?.terminal).toBe("no-check");
    expect(runtime.discovery?.summary).toContain(
      "does not mean the display is unsupported",
    );
    expect(transport.writeAttempts).toHaveLength(0);
    runtime.session.source = "imported";
    await expect(runtime.startDiscovery()).rejects.toThrow(
      /historical evidence/,
    );
    expect(runtime.session.experimentalTxEnabled).toBe(false);
  });
});
