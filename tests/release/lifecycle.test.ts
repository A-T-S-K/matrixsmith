import { expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { FakeTransport } from "../../src/transport/fake";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { createPresentationStore } from "../helpers/presentation-fixture";

it("disposes transport subscriptions once and disconnects an owned runtime", async () => {
  const transport = new FakeTransport(knownIledHatFingerprint());
  const unsubscribe = vi.fn();
  const original = transport.subscribeState.bind(transport);
  vi.spyOn(transport, "subscribeState").mockImplementation((listener) => {
    const stop = original(listener);
    return () => {
      unsubscribe();
      stop();
    };
  });
  const runtime = new ApplicationRuntime(transport);
  await runtime.connect();
  await runtime.dispose();
  await runtime.dispose();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(transport.state).toBe("idle");
});
it("retains a live connection across offline reports and retires replaced workspaces", async () => {
  const transport = new FakeTransport(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport);
  await runtime.connect();
  const store = createPresentationStore(runtime, transport);
  const json = runtime.exportBundle("shareable");
  store.importBundle(json);
  const offline = store.controller;
  const dispose = vi.spyOn(offline, "dispose");
  store.importBundle(json);
  expect(dispose).toHaveBeenCalledOnce();
  expect(transport.state).toBe("connected");
  const second = store.controller;
  const disposeSecond = vi.spyOn(second, "dispose");
  store.returnToLiveWorkspace();
  expect(store.controller).toBe(runtime);
  expect(disposeSecond).toHaveBeenCalledOnce();
  expect(transport.state).toBe("connected");
  const changed = vi.fn();
  store.subscribe(changed);
  await store.dispose();
  changed.mockClear();
  runtime.trace.record("app.started", {});
  expect(changed).not.toHaveBeenCalled();
});
it("keeps a malformed import in its existing workspace and publishes an error", () => {
  const transport = new FakeTransport();
  const runtime = new ApplicationRuntime(transport);
  const store = createPresentationStore(runtime, transport);
  store.importBundle("{");
  expect(store.controller).toBe(runtime);
  expect(store.getSnapshot().error).toBeTruthy();
});

it("an unprepared experimental plan cannot leave authorization enabled", async () => {
  const transport = new FakeTransport(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport);
  await runtime.connect();
  const plan = runtime.planGuidedTest("coolledux-graffiti-timing");
  const unprepared = {
    ...plan,
    digest: undefined,
    targetBinding: undefined,
    validation: "experimental",
  } as unknown as import("../../src/core/transmission").TransmissionPlan;
  await expect(
    runtime.sendPersistentContent(unprepared, { confirmedConsequence: true }),
  ).rejects.toThrow(/prepared/i);
  expect(runtime.session.experimentalTxEnabled).toBe(false);
  expect(runtime.session.confirmedPlanDigest).toBeNull();
});

it("all disposal callers wait for the same in-flight cleanup", async () => {
  const transport = new FakeTransport(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport);
  await runtime.connect();
  const original = transport.disconnect.bind(transport);
  let finish!: () => void;
  vi.spyOn(transport, "disconnect").mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await original();
  });
  const first = runtime.dispose();
  await Promise.resolve();
  await Promise.resolve();
  let secondFinished = false;
  const second = runtime.dispose().then(() => {
    secondFinished = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(secondFinished).toBe(false);
  finish();
  await Promise.all([first, second]);
  expect(transport.state).toBe("idle");
});
