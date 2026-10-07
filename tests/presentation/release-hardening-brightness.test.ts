import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TransmissionService } from "../../src/application/services/transmission-service";
import { NoticeStore } from "../../src/presentation/state/notice-store";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { createPresentationStore } from "../helpers/presentation-fixture";

afterEach(() => vi.restoreAllMocks());
async function setup() {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport);
  const store = createPresentationStore(runtime, transport);
  await store.connect();
  await runtime.probe();
  return { runtime, transport, store };
}
function holdSend(runtime: ApplicationRuntime, step: number, reject = false) {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  const send = runtime.send;
  let count = 0;
  const spy = vi.spyOn(runtime, "send").mockImplementation(async (...args) => {
    const result = await send(...args);
    if (++count === step) {
      enter();
      await held;
      if (reject) throw new Error("old brightness failure");
    }
    return result;
  });
  return { entered, release, spy };
}

it.each([1, 2])(
  "suppresses readback or success after same-device reconnect during brightness step %i",
  async (phase) => {
    const { runtime, transport, store } = await setup();
    const gate = holdSend(runtime, phase);
    const pending = store.applyBrightness(0x40);
    await gate.entered;
    const attempts = transport.writeAttempts.length;
    await runtime.disconnect();
    await runtime.connect();
    gate.release();
    await pending;
    expect(gate.spy).toHaveBeenCalledTimes(phase);
    expect(transport.writeAttempts).toHaveLength(attempts);
    expect(store.getSnapshot().info ?? "").not.toMatch(
      /Brightness .* verified/,
    );
    expect(store.getSnapshot().error).toBeNull();
    await store.dispose();
  },
);

it("does not publish a stale error to a replacement connection", async () => {
  const { runtime, transport, store } = await setup();
  const gate = holdSend(runtime, 1, true);
  const pending = store.applyBrightness(0x40);
  await gate.entered;
  await runtime.disconnect();
  transport.fingerprint = {
    ...knownIledHatFingerprint(),
    browserDeviceId: "replacement-B",
  };
  await runtime.connect();
  gate.release();
  await pending;
  expect(store.getSnapshot().error).toBeNull();
  expect(gate.spy).toHaveBeenCalledTimes(1);
  await store.dispose();
});

it("does not send a follow-up or overwrite notices in a replacement workspace", async () => {
  const { runtime, store } = await setup();
  const report = runtime.exportBundle();
  const gate = holdSend(runtime, 1);
  const pending = store.applyBrightness(0x40);
  await gate.entered;
  // Busy is only a UI projection. Exercise the lifetime safety check directly.
  vi.spyOn(NoticeStore.prototype, "getBusy").mockReturnValue(null);
  store.importBundle(report);
  const replacement = store.controller;
  expect(replacement).not.toBe(runtime);
  const notice = store.getSnapshot().info;
  const replacementSend = vi.spyOn(replacement, "send");
  gate.release();
  await pending;
  expect(replacementSend).not.toHaveBeenCalled();
  expect(gate.spy).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().info).toBe(notice);
  expect(store.getSnapshot().error).toBeNull();
  await store.dispose();
});

it("verifies brightness in the same workspace and connection", async () => {
  const { store, transport } = await setup();
  await store.applyBrightness(0x40);
  expect(store.getSnapshot().info).toBe(
    "Brightness 64 verified by device-info readback.",
  );
  expect(transport.brightness).toBe(0x40);
  await store.dispose();
});

it("retains a same-context brightness readback failure", async () => {
  const { store, transport } = await setup();
  transport.ignoreBrightnessState = true;
  await store.applyBrightness(0x40);
  expect(store.getSnapshot().error).toMatch(/Brightness readback mismatch/);
  await store.dispose();
});

it("keeps a retired diagnostic result historical without publishing its notice to B", async () => {
  const { runtime, transport, store } = await setup();
  const execute = TransmissionService.prototype._execute;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  vi.spyOn(TransmissionService.prototype, "_execute").mockImplementationOnce(
    async function (this: TransmissionService, ...args) {
      const result = await execute.apply(this, args);
      enter();
      await held;
      return result;
    },
  );
  const pending = store.runDiagnostic("coolledux-brightness-round-trip");
  await entered;
  await runtime.disconnect();
  transport.fingerprint = {
    ...knownIledHatFingerprint(),
    browserDeviceId: "replacement-B",
  };
  await runtime.connect();
  release();
  await pending;
  expect(runtime.diagnosticRuns.at(-1)?.status).toBe("failed");
  expect(store.getSnapshot().info).toBeNull();
  expect(store.getSnapshot().error).toBeNull();
  await store.dispose();
});

it("retires brightness across a workspace switch even if the original live runtime is resumed", async () => {
  const { runtime, store } = await setup();
  const report = runtime.exportBundle();
  const gate = holdSend(runtime, 1);
  const pending = store.applyBrightness(0x40);
  await gate.entered;
  vi.spyOn(NoticeStore.prototype, "getBusy").mockReturnValue(null);
  store.importBundle(report);
  expect(store.controller).not.toBe(runtime);
  await store.returnToLiveWorkspace();
  expect(store.controller).toBe(runtime);
  const notice = store.getSnapshot().info;
  gate.release();
  await pending;
  expect(gate.spy).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().info).toBe(notice);
  await store.dispose();
});
