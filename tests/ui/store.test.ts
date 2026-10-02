import { createPresentationStore } from "../helpers/presentation-fixture";
import { describe, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import {
  PresentationStore,
  parseServiceHints,
} from "../../src/presentation/store";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import type { DeviceFingerprint } from "../../src/core/device";

function writeOnlyFingerprint(): DeviceFingerprint {
  const base = knownIledHatFingerprint();
  return {
    ...base,
    services: [
      {
        uuid: "0000fff0-0000-1000-8000-00805f9b34fb",
        isPrimary: true,
        characteristics: [
          {
            uuid: "0000fff1-0000-1000-8000-00805f9b34fb",
            properties: {
              read: true,
              notify: true,
              indicate: false,
              write: false,
              writeWithoutResponse: true,
            },
          },
          {
            uuid: "0000fff2-0000-1000-8000-00805f9b34fb",
            properties: {
              read: false,
              notify: false,
              indicate: false,
              write: true,
              writeWithoutResponse: false,
            },
          },
        ],
      },
    ],
  };
}

async function connectedStore(
  fingerprint = knownIledHatFingerprint(),
): Promise<{ transport: ScriptedCoolLedUxDevice; store: PresentationStore }> {
  const transport = new ScriptedCoolLedUxDevice(fingerprint);
  const store = createPresentationStore(
    new ApplicationRuntime(transport, new TraceRecorder()),
    transport,
  );
  await store.connect();
  return { transport, store };
}

describe("service hint parsing", () => {
  it("expands 16-bit shorthand, keeps full UUIDs, and drops empties and duplicates", () => {
    expect(
      parseServiceHints(
        " FFF0, a950;\nFFF0  0000fff0-0000-1000-8000-00805f9b34fb",
      ),
    ).toEqual([
      "0000fff0-0000-1000-8000-00805f9b34fb",
      "0000a950-0000-1000-8000-00805f9b34fb",
    ]);
    expect(parseServiceHints("")).toEqual([]);
  });
});

describe("workspace snapshot", () => {
  it("opens a known display ready to use, with the probe still available", async () => {
    const { store } = await connectedStore();
    let snapshot = store.getSnapshot();
    expect(snapshot.page).toBe("workspace");
    // No identification step: the profile already answers the question the
    // probe exists to answer.
    expect(snapshot.recommended).toMatchObject({
      title: "Create content",
      action: "none",
    });
    expect(snapshot.device?.support).toMatch(/ready for normal use/i);
    expect(snapshot.device?.protocol).toBe("CoolLEDUX");
    await store.identify();
    snapshot = store.getSnapshot();
    expect(snapshot.error).toBeNull();
    expect(snapshot.candidates.find((c) => c.id === "coolledux")?.state).toBe(
      "Identified by current live probe",
    );
    expect(snapshot.deviceState.brightness).toBe(0xcc);
  });

  it("exposes read only for READ and subscribe only for notify/indicate, with no write action", async () => {
    const { store } = await connectedStore(writeOnlyFingerprint());
    const characteristics = store
      .getSnapshot()
      .gatt.flatMap((service) => service.characteristics);
    const fff1 = characteristics.find((c) => c.uuid.includes("fff1"));
    const fff2 = characteristics.find((c) => c.uuid.includes("fff2"));
    expect(fff1?.canRead).toBe(true);
    expect(fff1?.canSubscribe).toBe(true);
    expect(fff2?.canRead).toBe(false);
    expect(fff2?.canSubscribe).toBe(false);
    for (const characteristic of characteristics)
      expect(Object.keys(characteristic)).not.toContain("canWrite");
  });

  it("filters and searches transactions without losing raw evidence", async () => {
    const { store } = await connectedStore();
    await store.identify();
    await store.refreshInfo();
    store.setTransactionFilter("diagnostics");
    expect(
      store.getSnapshot().transactions.every((t) => t.source === "diagnostic"),
    ).toBe(true);
    store.setTransactionFilter("all");
    store.setTransactionSearch("1F");
    expect(store.getSnapshot().transactions.length).toBeGreaterThan(0);
    store.setTransactionSearch("no-such-term-zzz");
    expect(store.getSnapshot().transactions.length).toBe(0);
  });

  it("keeps share-sensitive identifiers out of the default report", async () => {
    const { store } = await connectedStore();
    await store.identify();
    expect(store.getSnapshot().reportOptions.includeIdentifiers).toBe(false);
    expect(store.getSnapshot().reportOptions.includeRawTrace).toBe(false);
    expect(store.markdown()).not.toContain("fixture-device");
  });
});

it("derives automatic/manual subscriptions from the live owner across disconnect and report workspaces", async () => {
  const { store, transport } = await connectedStore();
  const subscribed = () =>
    store
      .getSnapshot()
      .gatt.flatMap((service) => service.characteristics)
      .filter((c) => c.subscribed);
  expect(subscribed()).toHaveLength(1);
  await store.subscribeNotifications({
    serviceUuid: subscribed()[0]!.serviceUuid,
    characteristicUuid: subscribed()[0]!.uuid,
  });
  expect(transport.notificationListenerCount).toBe(1);
  const bundle = store.controller.exportBundle();
  transport.unexpectedDisconnect();
  expect(subscribed()).toHaveLength(0);
  await store.connect();
  expect(subscribed()).toHaveLength(1);
  store.importBundle(bundle);
  expect(subscribed()).toHaveLength(0);
});
it("rejects oversized programmatic text, blocks unsafe scroll sending, and accepts valid recovery", async () => {
  const { store, transport } = await connectedStore();
  store.updateContentSettings({ text: "HI" });
  store.updateContentSettings({ text: "X".repeat(513) });
  expect(store.getSnapshot().content.settings.text).toBe("HI");
  expect(store.getSnapshot().error).toMatch(/512/);
  store.updateContentSettings({
    text: "X".repeat(512),
    textDisplayMode: "scroll",
  });
  expect(store.getSnapshot().content.textScrollPlan?.safe).toBe(false);
  store.requestSendText();
  await Promise.resolve();
  await Promise.resolve();
  expect(transport.writes).toHaveLength(0);
  store.updateContentSettings({ text: "HI", textDisplayMode: "still" });
  store.requestSendText();
  await vi.waitFor(() => expect(transport.writes.length).toBeGreaterThan(0));
});
