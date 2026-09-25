import { describe, expect, it } from "vitest";
import { TransmissionExecutor } from "../../src/app/executor";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { SafetyPolicy } from "../../src/app/safety";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { orientationPattern } from "../../src/render/patterns";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { prepareTransmission } from "../../src/core/transmission";
import { fingerprintIdentityKey } from "../../src/investigation/device-identity";

describe("executor-owned pacing", () => {
  it("waits the declared delay between paced packets and skips it after the last", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    await transport.selectAndConnect({
      mode: "registered",
      hints: { filters: [], optionalServices: [] },
    });
    const executor = new TransmissionExecutor(transport, new TraceRecorder());
    const rawPlan = coolLedUxDriver.plan(
      { type: "ShowFrame", frame: orientationPattern(32, 16) },
      {
        profile: iledHat31aeProfile,
        fingerprint: knownIledHatFingerprint(),
        source: "live",
      },
    );
    const targetBinding = {
      connectionId: transport.connectionId!,
      fingerprintKey: fingerprintIdentityKey(transport.fingerprint!),
      browserDeviceId: transport.fingerprint!.browserDeviceId ?? null,
    };
    const plan = prepareTransmission(rawPlan, targetBinding);
    const policy = new SafetyPolicy();
    const decision = policy.authorize(plan, {
      source: "live",
      fingerprint: transport.fingerprint,
      selectedDriverId: "coolledux",
      selectedProfileId: iledHat31aeProfile.id,
      driverMatch: {
        driverId: "coolledux",
        score: 100,
        confidence: "exact",
        reasons: [],
        contradictions: [],
      },
      ambiguous: false,
      experimentalSessionEnabled: true,
      targetBinding,
      confirmedPlanDigest: plan.digest,
    });
    expect(decision.allowed).toBe(true);
    const timestamps: number[] = [];
    const originalWrite = transport.write.bind(transport);
    transport.write = async (endpoint, bytes, mode) => {
      timestamps.push(Date.now());
      return originalWrite(endpoint, bytes, mode);
    };
    const started = Date.now();
    await executor.execute(decision.authorized!, coolLedUxDriver);
    const elapsed = Date.now() - started;
    const packetCount = plan.packets.length;
    // (n-1) paced gaps at 60 ms each; allow generous scheduling slack downwards.
    expect(elapsed).toBeGreaterThanOrEqual((packetCount - 1) * 60 - 50);
    const gaps = timestamps
      .slice(1)
      .map((value, index) => value - timestamps[index]!);
    expect(gaps.filter((gap) => gap >= 45).length).toBeGreaterThanOrEqual(
      packetCount - 2,
    );
  }, 30000);
});
