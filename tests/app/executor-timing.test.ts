import { describe, expect, it } from "vitest";
import { TransmissionExecutor } from "../../src/app/executor";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { SafetyPolicy } from "../../src/app/safety";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { orientationPattern } from "../../src/render/patterns";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import type { TransmissionPlan } from "../../src/core/transmission";

async function executeContentPlan(): Promise<{ plan: TransmissionPlan; result: Awaited<ReturnType<TransmissionExecutor["execute"]>> }> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  await transport.selectAndConnect({ mode: "registered", hints: { filters: [], optionalServices: [] } });
  const executor = new TransmissionExecutor(transport, new TraceRecorder());
  const plan = coolLedUxDriver.plan({ type: "ShowFrame", frame: orientationPattern(32, 16) }, { profile: iledHat31aeProfile, fingerprint: knownIledHatFingerprint(), source: "live" });
  const decision = new SafetyPolicy().authorize(plan, {
    source: "live", fingerprint: transport.fingerprint, selectedDriverId: "coolledux", selectedProfileId: iledHat31aeProfile.id,
    driverMatch: { driverId: "coolledux", score: 100, confidence: "exact", reasons: [], contradictions: [] },
    ambiguous: false, experimentalSessionEnabled: true, confirmedPersistentPlanId: plan.id,
  });
  expect(decision.allowed).toBe(true);
  const result = await executor.execute(decision.authorized!, coolLedUxDriver);
  return { plan, result };
}

describe("executor timing instrumentation", () => {
  it("records real per-packet write timestamps, not one shared plan timestamp", async () => {
    const { plan, result } = await executeContentPlan();
    expect(result.packetTimings).toHaveLength(plan.packets.length);
    const startTimes = result.packetTimings.map((timing) => Date.parse(timing.writeStartedAt));
    // Paced at 60 ms: the write timestamps must actually advance.
    expect(new Set(startTimes).size).toBeGreaterThan(1);
    for (let index = 1; index < startTimes.length; index += 1) expect(startTimes[index]!).toBeGreaterThanOrEqual(startTimes[index - 1]!);
  }, 30000);

  it("measures per-packet gaps and preserves the scheduled pacing separately", async () => {
    const { result } = await executeContentPlan();
    const first = result.packetTimings[0]!;
    expect(first.gapSincePreviousTxMs).toBeNull();
    const laterGaps = result.packetTimings.slice(1).map((timing) => timing.gapSincePreviousTxMs);
    for (const gap of laterGaps) { expect(gap).not.toBeNull(); expect(gap!).toBeGreaterThanOrEqual(0); }
    // The 60 ms pacing should show up in most measured gaps.
    expect(laterGaps.filter((gap) => (gap ?? 0) >= 45).length).toBeGreaterThanOrEqual(laterGaps.length - 1);
    for (const timing of result.packetTimings) expect(timing.scheduledDelayMs).toBe(60);
  }, 30000);

  it("reports the final host-accepted write timestamp for observation timers", async () => {
    const { result } = await executeContentPlan();
    expect(result.finalWriteAcceptedAt).toBe(result.packetTimings[result.packetTimings.length - 1]!.hostAcceptedAt);
  }, 30000);
});
