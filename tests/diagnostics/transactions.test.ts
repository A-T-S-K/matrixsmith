import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import infoCc from "../fixtures/iledhat/coolledux-device-info-cc.json";

async function connectedController(): Promise<{ transport: ScriptedCoolLedUxDevice; controller: MatrixController }> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new MatrixController(transport, new TraceRecorder());
  await controller.connect();
  await controller.probe();
  return { transport, controller };
}

describe("protocol transaction recording", () => {
  it("correlates a request with its matching response and preserves exact bytes", async () => {
    const { controller } = await connectedController();
    const result = await controller.send(controller.plan({ type: "GetDeviceInfo" }));
    expect(result.protocolAcknowledged).toBe(true);
    const transaction = controller.transactions.at(-1);
    expect(transaction?.operation).toBe("GetDeviceInfo");
    expect(transaction?.hostAccepted).toBe(true);
    expect(transaction?.protocolAcknowledged).toBe(true);
    expect(transaction?.deviceStateVerified).toBe(true);
    expect(transaction?.packets.filter((p) => p.direction === "TX").map((p) => p.hex.replaceAll(" ", ""))).toEqual([infoCc.txHex]);
    expect(transaction?.packets.filter((p) => p.direction === "RX").map((p) => p.hex.replaceAll(" ", ""))).toEqual([infoCc.rxHex]);
    expect(transaction?.decodedResponse?.kind).toBe("device-info");
    expect(transaction?.durationMs).toBeGreaterThanOrEqual(0);
    expect(transaction?.safety.risk).toBe("read-only");
  });

  it("records a timed-out request as a failed transaction while preserving unrelated raw RX", async () => {
    const { transport, controller } = await connectedController();
    transport.unrelatedResponse = Uint8Array.from([0xff, 0xaa, 0x55]);
    const result = await controller.send(controller.plan({ type: "SetBrightness", raw: 0x40 }));
    expect(result.responseTimedOut).toBe(true);
    const transaction = controller.transactions.at(-1);
    expect(transaction?.operation).toBe("SetBrightness");
    expect(transaction?.protocolAcknowledged).toBe(false);
    expect(transaction?.responseTimedOut).toBe(true);
    expect(transaction?.packets.filter((p) => p.direction === "RX").map((p) => p.hex.replaceAll(" ", ""))).toEqual(["FFAA55"]);
  }, 10_000);

  it("represents a characteristic read as a read-only transaction", async () => {
    const { controller } = await connectedController();
    const before = controller.transactions.length;
    await controller.read({ serviceUuid: "0000fff0-0000-1000-8000-00805f9b34fb", characteristicUuid: "0000fff1-0000-1000-8000-00805f9b34fb" });
    const transaction = controller.transactions[before];
    expect(transaction?.source).toBe("gatt-read");
    expect(transaction?.safety.risk).toBe("read-only");
    expect(transaction?.hostAccepted).toBe(true);
    expect(transaction?.packets.every((p) => p.direction === "RX")).toBe(true);
  });

  it("marks device verification only when the response fulfills the operation", async () => {
    const { controller } = await connectedController();
    await controller.send(controller.plan({ type: "SetBrightness", raw: 0x40 }));
    const echo = controller.transactions.at(-1);
    expect(echo?.protocolAcknowledged).toBe(true);
    expect(echo?.deviceStateVerified).toBe(false);
    await controller.send(controller.plan({ type: "GetDeviceInfo" }));
    expect(controller.transactions.at(-1)?.deviceStateVerified).toBe(true);
  });

  it("survives export/import so transactions remain reviewable offline", async () => {
    const { controller } = await connectedController();
    await controller.send(controller.plan({ type: "GetDeviceInfo" }));
    const original = controller.transactions.map((t) => t.id);
    const imported = new MatrixController(new ScriptedCoolLedUxDevice(), new TraceRecorder());
    imported.importBundle(controller.exportBundle());
    expect(imported.transactions.map((t) => t.id)).toEqual(original);
    expect(imported.transactions.at(-1)?.packets.some((p) => p.hex.replaceAll(" ", "") === infoCc.rxHex)).toBe(true);
  });
});
