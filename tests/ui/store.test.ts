import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { MatrixStore, recommendedAction } from "../../src/ui/store";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import type { DeviceFingerprint } from "../../src/core/device";

function writeOnlyFingerprint(): DeviceFingerprint {
  const base = knownIledHatFingerprint();
  return {
    ...base,
    services: [{
      uuid: "0000fff0-0000-1000-8000-00805f9b34fb",
      isPrimary: true,
      characteristics: [
        { uuid: "0000fff1-0000-1000-8000-00805f9b34fb", properties: { read: true, notify: true, indicate: false, write: false, writeWithoutResponse: true } },
        { uuid: "0000fff2-0000-1000-8000-00805f9b34fb", properties: { read: false, notify: false, indicate: false, write: true, writeWithoutResponse: false } },
      ],
    }],
  };
}

async function connectedStore(fingerprint = knownIledHatFingerprint()): Promise<{ transport: ScriptedCoolLedUxDevice; store: MatrixStore }> {
  const transport = new ScriptedCoolLedUxDevice(fingerprint);
  const store = new MatrixStore(new MatrixController(transport, new TraceRecorder()), transport);
  await store.connect();
  return { transport, store };
}

describe("recommended next action", () => {
  it("asks for a connection when disconnected", () => {
    expect(recommendedAction(false, false, false).action).toBe("connect");
  });
  it("asks for safe identification when the protocol is ambiguous", () => {
    expect(recommendedAction(true, false, true).action).toBe("identify");
  });
  it("offers safe device checks once identified", () => {
    expect(recommendedAction(true, true, false).action).toBe("checks");
  });
  it("falls back to evidence collection when no safe probe exists", () => {
    expect(recommendedAction(true, false, false).action).toBe("none");
  });
  it("recommends offline review, not live actions, for imported reports", () => {
    const recommended = recommendedAction(true, true, false, false);
    expect(recommended.action).toBe("none");
    expect(recommended.title).toBe("Review imported evidence");
  });
});

describe("workspace snapshot", () => {
  it("moves through ambiguous connection to a resolved CoolLEDUX session", async () => {
    const { store } = await connectedStore();
    let snapshot = store.getSnapshot();
    expect(snapshot.page).toBe("workspace");
    expect(snapshot.recommended.action).toBe("identify");
    expect(snapshot.candidates.some((c) => c.canIdentify)).toBe(true);
    await store.identify();
    snapshot = store.getSnapshot();
    expect(snapshot.recommended.action).toBe("checks");
    expect(snapshot.candidates.find((c) => c.id === "coolledux")?.state).toBe("VERIFIED ON THIS SESSION");
    expect(snapshot.support.find((row) => row.label === "Protocol identity")?.status).toBe("Verified live");
    expect(snapshot.deviceState.brightness).toBe(0xcc);
  });

  it("exposes read only for READ and subscribe only for notify/indicate, with no write action", async () => {
    const { store } = await connectedStore(writeOnlyFingerprint());
    const characteristics = store.getSnapshot().gatt.flatMap((service) => service.characteristics);
    const fff1 = characteristics.find((c) => c.uuid.includes("fff1"));
    const fff2 = characteristics.find((c) => c.uuid.includes("fff2"));
    expect(fff1?.canRead).toBe(true);
    expect(fff1?.canSubscribe).toBe(true);
    expect(fff2?.canRead).toBe(false);
    expect(fff2?.canSubscribe).toBe(false);
    for (const characteristic of characteristics) expect(Object.keys(characteristic)).not.toContain("canWrite");
  });

  it("filters and searches transactions without losing raw evidence", async () => {
    const { store } = await connectedStore();
    await store.identify();
    await store.refreshInfo();
    store.setTransactionFilter("diagnostics");
    expect(store.getSnapshot().transactions.every((t) => t.source === "diagnostic")).toBe(true);
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
