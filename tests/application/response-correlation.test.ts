import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplayTransport } from "../../src/transport/replay";
import { deferred } from "../helpers/deferred-gatt";
import type { TransportReceipt } from "../../src/application/ports/transport";
import { ApplicationRuntime } from "../../src/application/runtime";
import { INPUT_LIMITS } from "../../src/application/input-limits";
import { DriverRegistry } from "../../src/drivers/registry";
import { FakeTransport } from "../../src/transport/fake";
import { parseDiagnosticBundle } from "../../src/diagnostics/bundle";
import type { MatrixDriver } from "../../src/drivers/types";
import {
  lumenFrame,
  syntheticDriver,
  syntheticFingerprint,
  SYNTHETIC_SERVICE,
  SYNTHETIC_NOTIFY,
  SYNTHETIC_COMMAND,
} from "../helpers/synthetic-driver";

const rx = {
  serviceUuid: SYNTHETIC_SERVICE,
  characteristicUuid: SYNTHETIC_NOTIFY,
};
const wrong = {
  serviceUuid: SYNTHETIC_SERVICE,
  characteristicUuid: SYNTHETIC_COMMAND,
};
const info = lumenFrame(0x91, [0x4c, 0x4d, 24, 8, 7]);
async function setup(driver: MatrixDriver = syntheticDriver) {
  const transport = new FakeTransport(syntheticFingerprint());
  transport.notificationOnWrite = info;
  transport.notificationOnWriteEndpoint = rx;
  const runtime = new ApplicationRuntime(
    transport,
    undefined,
    new DriverRegistry([driver]),
  );
  await runtime.connect();
  runtime.session.enableExperimentalTx();
  // Deliberately observe another endpoint too; ownership cannot come from opcode.
  await runtime.enableNotifications(wrong);
  return { runtime, transport };
}
afterEach(() => vi.useRealTimers());
describe("live response evidence", () => {
  it("attributes only the exact selected record despite shared decoded-object identity", async () => {
    const decoded = syntheticDriver.decodeNotification!(info, {
      fingerprint: syntheticFingerprint(),
      profile: null,
      source: "live",
    })!;
    const matches = vi.fn(syntheticDriver.responseMatches!);
    const driver = {
      ...syntheticDriver,
      responseMatches: matches,
      decodeNotification: (bytes: Uint8Array) =>
        bytes.length === info.length ? decoded : null,
    };
    const { runtime, transport } = await setup(driver);
    try {
      transport.notificationOnWrite = null;
      const original = transport.write.bind(transport);
      vi.spyOn(transport, "write").mockImplementationOnce(async (...args) => {
        transport.emitNotification(wrong, info);
        transport.emitNotification(rx, Uint8Array.of(0xff, 0xaa));
        transport.emitNotification(rx, info);
        transport.emitNotification(rx, info);
        return original(...args);
      });
      const result = await runtime.probe("test-lumen", "lumen-info");
      expect(result.responseRecord).toBe(runtime.session.notifications[2]);
      expect(result.response).toBe(decoded);
      expect(runtime.session.latestDeviceInfoRecord).toBe(
        result.responseRecord,
      );
      expect(runtime.session.notifications[0]!.decoded).toBe(decoded);
      expect(runtime.session.notifications[3]!.decoded).toBe(decoded);
      expect(matches).toHaveBeenCalledTimes(1);
      const transaction = runtime.transactions.at(-1)!;
      expect(
        transaction.packets
          .filter((packet) => packet.direction === "RX")
          .map((packet) => packet.relation),
      ).toEqual([
        "unrelated-concurrent",
        "unrelated-concurrent",
        "matched-response",
        "unrelated-concurrent",
      ]);
      expect(result.identification.matched).toBe(true);
      expect(runtime.geometryProposal()).toMatchObject({
        width: 24,
        height: 8,
        transactionId: transaction.id,
      });
      const archive = runtime.exportBundle();
      expect(archive).not.toMatch(
        /connectionGeneration|receiveSequence|responseRecord/,
      );
      const imported = new ApplicationRuntime(
        new FakeTransport(),
        undefined,
        new DriverRegistry([driver]),
      );
      try {
        imported.importBundle(archive);
        expect(parseDiagnosticBundle(archive).schemaVersion).toBe(3);
        expect(imported.geometryProposal()).toBeNull();
        expect(
          imported.session.notifications.every(
            (record) => record.receiveSequence === undefined,
          ),
        ).toBe(true);
        await expect(
          imported.probe("test-lumen", "lumen-info"),
        ).rejects.toThrow(/cannot perform live probes/);
      } finally {
        await imported.dispose();
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps useful receipts without labeling wrong-endpoint receipts as related", async () => {
    const receipt = {
      family: "Synthetic Lumen",
      kind: "upload-receipt",
      summary: "receipt",
      payloadHex: "55",
      fields: {},
    };
    const driver = {
      ...syntheticDriver,
      decodeNotification: (
        bytes: Uint8Array,
        context: Parameters<NonNullable<MatrixDriver["decodeNotification"]>>[1],
      ) =>
        bytes[0] === 0x55
          ? receipt
          : syntheticDriver.decodeNotification!(bytes, context),
    };
    const { runtime, transport } = await setup(driver);
    try {
      const original = transport.write.bind(transport);
      vi.spyOn(transport, "write").mockImplementationOnce(async (...args) => {
        transport.emitNotification(wrong, Uint8Array.of(0x55));
        transport.emitNotification(rx, Uint8Array.of(0x55));
        return original(...args);
      });
      const result = await runtime.probe("test-lumen", "lumen-info");
      expect(result.identification.matched).toBe(true);
      expect(
        runtime.transactions
          .at(-1)!
          .packets.filter((packet) => packet.direction === "RX")
          .map((packet) => packet.relation),
      ).toEqual([
        "unrelated-concurrent",
        "related-receipt",
        "matched-response",
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("owns the endpoint captured at notification subscription", async () => {
    const { runtime, transport } = await setup();
    try {
      const endpoint = { ...rx };
      await runtime.enableNotifications(endpoint);
      endpoint.characteristicUuid = SYNTHETIC_COMMAND;
      const result = await runtime.probe("test-lumen", "lumen-info");
      expect(result.responseRecord?.endpoint).toEqual(rx);
      expect(transport.notificationListenerCount).toBe(2);
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps replayed history outside live correlation even when connected", async () => {
    const replay = new ReplayTransport(syntheticFingerprint(), [info]);
    const runtime = new ApplicationRuntime(
      replay,
      undefined,
      new DriverRegistry([syntheticDriver]),
    );
    try {
      await runtime.connect();
      await runtime.enableDriverNotifications();
      expect(runtime.session.source).toBe("replay");
      expect(runtime.session.notifications.length).toBeGreaterThan(0);
      expect(
        runtime.session.notifications.every(
          (record) => record.receiveSequence === undefined,
        ),
      ).toBe(true);
      expect(runtime.geometryProposal()).toBeNull();
      await expect(runtime.probe("test-lumen", "lumen-info")).rejects.toThrow(
        /cannot perform live probes/,
      );
    } finally {
      await runtime.dispose();
    }
  });

  it.each([false, true])(
    "retires live adoption during historical import (selected already: %s)",
    async (selectedAlready) => {
      const { runtime, transport } = await setup();
      try {
        const archive = runtime.exportBundle();
        if (!selectedAlready) transport.notificationOnWrite = null;
        const pendingWrite = deferred<TransportReceipt>();
        const original = transport.write.bind(transport);
        let receipt: TransportReceipt | undefined;
        vi.spyOn(transport, "write").mockImplementationOnce(async (...args) => {
          receipt = await original(...args);
          return pendingWrite.promise;
        });
        const pending = runtime
          .probe("test-lumen", "lumen-info")
          .catch((error: unknown) => error);
        await vi.waitFor(() => expect(receipt).toBeDefined());
        runtime.importBundle(archive);
        pendingWrite.resolve(receipt!);
        expect(await pending).toBeInstanceOf(Error);
        expect(runtime.session.source).toBe("imported");
        expect(runtime.geometryProposal()).toBeNull();
        expect(
          runtime.session.notifications.every(
            (record) => record.receiveSequence === undefined,
          ),
        ).toBe(true);
        expect(runtime.session.experimentalTxEnabled).toBe(false);
      } finally {
        await runtime.dispose();
      }
    },
  );

  it("keeps new RX evidence when a bounded collection evicts records without changing length", async () => {
    const { runtime } = await setup();
    try {
      const historical = {
        timestamp: "2000-01-01T00:00:00.000Z",
        raw: Uint8Array.of(0),
        rawHex: "00",
        decoded: null,
      };
      runtime.session.notifications.push(
        ...Array.from({ length: INPUT_LIMITS.traceEvents }, () => historical),
      );
      const result = await runtime.probe("test-lumen", "lumen-info");
      expect(runtime.session.notifications).toHaveLength(
        INPUT_LIMITS.traceEvents,
      );
      expect(result.responseRecord).toBe(runtime.session.notifications.at(-1));
      expect(
        runtime.transactions
          .at(-1)!
          .packets.filter((packet) => packet.direction === "RX"),
      ).toEqual([expect.objectContaining({ relation: "matched-response" })]);
    } finally {
      await runtime.dispose();
    }
  });

  it("cannot establish identification or geometry from wrong-endpoint or ambiguous expired replies", async () => {
    vi.useFakeTimers();
    const { runtime, transport } = await setup();
    try {
      transport.notificationOnWriteEndpoint = wrong;
      const first = runtime.probe("test-lumen", "lumen-info");
      await vi.advanceTimersByTimeAsync(30);
      const timedOut = await first;
      expect(timedOut).toMatchObject({
        responseTimedOut: true,
        response: null,
        identification: { matched: false },
      });
      expect(runtime.session.protocolResolution).toBeNull();
      expect(runtime.session.latestDeviceInfoRecord).toBeNull();
      expect(runtime.geometryProposal()).toBeNull();
      expect(
        runtime.transactions
          .at(-1)!
          .packets.filter((packet) => packet.direction === "RX"),
      ).toEqual([
        expect.objectContaining({ relation: "unrelated-concurrent" }),
      ]);
      expect(transport.state).toBe("connected");
      transport.notificationOnWriteEndpoint = rx;
      const ambiguous = await runtime.probe("test-lumen", "lumen-info");
      expect(ambiguous).toMatchObject({
        responseAmbiguous: true,
        responseTimedOut: false,
        response: null,
        identification: { matched: false },
      });
      expect(runtime.session.protocolResolution).toBeNull();
      expect(runtime.session.latestDeviceInfoRecord).toBeNull();
      expect(runtime.geometryProposal()).toBeNull();
      expect(runtime.transactions.at(-1)!.findings.join(" ")).toMatch(
        /ambiguous/,
      );
      expect(
        runtime.transactions
          .at(-1)!
          .packets.some((packet) => packet.relation === "matched-response"),
      ).toBe(false);
      expect(runtime.session.notifications).toHaveLength(2);
      expect(transport.writeAttempts).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
      await runtime.disconnect();
      await runtime.connect();
      runtime.session.enableExperimentalTx();
      const fresh = await runtime.probe("test-lumen", "lumen-info");
      expect(fresh.identification.matched).toBe(true);
      expect(runtime.geometryProposal()).toMatchObject({
        width: 24,
        height: 8,
      });
    } finally {
      await runtime.dispose();
    }
  });
});
