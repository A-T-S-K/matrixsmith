import { expect, it } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { createPresentationStore } from "../helpers/presentation-fixture";

it("separates profile match, receipt, live probe and imported timestamps across connections", async () => {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport, new TraceRecorder());
  const store = createPresentationStore(runtime, transport);
  await store.connect();
  expect(store.getSnapshot().deviceInfoEvidence).toMatchObject({
    basis: "unread",
    label: "No device information received",
    timestamp: null,
  });
  expect(
    store.getSnapshot().candidates.find((c) => c.id === "coolledux")?.evidence,
  ).toMatchObject({ basis: "profile-match", tone: "neutral" });
  await store.refreshInfo();
  const timestamp = runtime.session.latestDeviceInfoRecord!.timestamp;
  expect(store.getSnapshot().deviceInfoEvidence).toMatchObject({
    basis: "received",
    label: "Device information received",
    timestamp,
  });
  // A device-info query receipt alone does not change protocol-resolution basis.
  expect(
    store.getSnapshot().candidates.find((c) => c.id === "coolledux")?.evidence
      .basis,
  ).toBe("profile-match");
  await store.identify();
  expect(
    store.getSnapshot().candidates.find((c) => c.id === "coolledux")?.evidence
      .basis,
  ).toBe("live-probe");
  const archive = runtime.exportBundle();
  store.importBundle(archive);
  expect(
    store.getSnapshot().candidates.find((c) => c.id === "coolledux")?.evidence,
  ).toMatchObject({ basis: "historical", tone: "neutral" });
  expect(store.getSnapshot().deviceInfoEvidence).toMatchObject({
    basis: "historical",
    timestamp: JSON.parse(archive)
      .trace.filter(
        (event: { type: string }) => event.type === "notification.raw",
      )
      .at(-1).timestamp,
  });
  expect(store.markdown()).not.toContain("VERIFIED ON THIS SESSION");
  store.returnToLiveWorkspace();
  await store.disconnect();
  expect(store.getSnapshot().deviceInfoEvidence.basis).toBe("unread");
  await store.connect();
  expect(store.getSnapshot().deviceInfoEvidence.basis).toBe("unread");
  expect(runtime.session.experimentalTxEnabled).toBe(false);
  await store.dispose();
});
