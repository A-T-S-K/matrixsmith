import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { DriverRegistry } from "../../src/drivers/registry";
import { FakeTransport } from "../../src/transport/fake";
import { emptyFingerprint } from "../../src/core/device";
import {
  REGISTERED_READS,
  LED_MATRIX_ENDPOINT,
} from "../../src/application/reviewed-reads";
import { executeReviewedRead } from "../../src/application/services/reviewed-read-service";
import { decodeMatrixState } from "../../src/drivers/microbit/codec";
import { discoveryDriver } from "../helpers/discovery-driver";

const runtimes: ApplicationRuntime[] = [];
export function readFingerprint(read = true, service = true) {
  return {
    ...emptyFingerprint("fake", "micro:bit software fixture"),
    services: service
      ? [
          {
            uuid: LED_MATRIX_ENDPOINT.serviceUuid,
            isPrimary: true,
            characteristics: [
              {
                uuid: LED_MATRIX_ENDPOINT.characteristicUuid,
                properties: {
                  read,
                  notify: false,
                  indicate: false,
                  write: true,
                  writeWithoutResponse: false,
                },
              },
            ],
          },
        ]
      : [],
  };
}
async function setup(
  bytes = new Uint8Array([16, 1, 8, 4, 18]),
  read = true,
  service = true,
  reverse = false,
) {
  const transport = new FakeTransport(readFingerprint(read, service));
  const readCall = vi.spyOn(transport, "read").mockResolvedValue(bytes);
  const drivers = [discoveryDriver("a", 0x91), discoveryDriver("b", 0x92)];
  const runtime = new ApplicationRuntime(
    transport,
    undefined,
    new DriverRegistry(reverse ? drivers.reverse() : drivers),
  );
  runtimes.push(runtime);
  await runtime.connect("inspection");
  return { runtime, transport, readCall };
}
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
  vi.useRealTimers();
});
it("Stop during synchronous reservation publication prevents browser dispatch and releases ownership", async () => {
  const { runtime, transport, readCall } = await setup();
  let stopped = false;
  const unsubscribe = runtime.trace.subscribe((event) => {
    if (
      event.type === "discovery.progress" &&
      !stopped &&
      runtime.discovery?.pendingRead
    ) {
      stopped = true;
      runtime.stopDiscovery();
    }
  });
  try {
    await runtime.startDiscovery();
    expect(stopped).toBe(true);
    expect(readCall).not.toHaveBeenCalled();
    expect(transport.writes).toEqual([]);
    expect(runtime.discovery?.attempts[0]).toMatchObject({
      outcome: "retired",
      transactionId: null,
    });
    expect(runtime.discovery?.pendingRead).toBe(false);
    expect(runtime.executionBusy).toBe(false);
    expect(runtime.transactions).toEqual([]);
  } finally {
    unsubscribe();
  }
});
it("reads independently of registry order, retaining exact original evidence and zero writes/notifications/authority", async () => {
  for (const reverse of [false, true]) {
    const { runtime, transport, readCall } = await setup(
      undefined,
      true,
      true,
      reverse,
    );
    await runtime.startDiscovery();
    expect(readCall).toHaveBeenCalledExactlyOnceWith(LED_MATRIX_ENDPOINT);
    expect(transport.writes).toEqual([]);
    expect(transport.notificationListenerCount).toBe(0);
    expect(runtime.session.notifications).toEqual([]);
    expect(runtime.session.profile).toBeNull();
    expect(runtime.session.protocolResolution).toBeNull();
    expect(runtime.contentGates().every((g) => !g.allowed)).toBe(true);
    expect(runtime.discovery?.terminal).toBe("service-observed");
    expect(runtime.discovery?.remaining).toMatchObject({
      reads: 3,
      attempts: 3,
      packets: 8,
      bytes: 2043,
    });
    const transaction = runtime.transactions[0]!;
    expect(transaction).toMatchObject({
      source: "gatt-read",
      sessionSource: "live",
      driverId: "microbit-led-reference",
      profileId: null,
      endpoint: LED_MATRIX_ENDPOINT,
      decodedResponse: null,
      protocolAcknowledged: null,
      deviceStateVerified: false,
      packets: [
        {
          direction: "RX",
          hex: "10 01 08 04 12",
          endpoint: LED_MATRIX_ENDPOINT,
        },
      ],
    });
    expect(transaction.findings.join(" ")).toContain(
      REGISTERED_READS[0]!.definitionIdentity,
    );
    expect(transaction.findings.join(" ")).toContain(
      REGISTERED_READS[0]!.sources[0],
    );
    expect(runtime.discovery?.attempts[0]?.responseSequence).toBeNull();
  }
});
it.each([
  [false, true],
  [true, false],
])(
  "missing property/service prevents dispatch (%s, %s)",
  async (read, service) => {
    const { runtime, readCall } = await setup(undefined, read, service);
    await runtime.startDiscovery();
    expect(readCall).not.toHaveBeenCalled();
    expect(runtime.discovery?.terminal).toBe("access");
  },
);
it.each(["imported", "replay", "fake"] as const)(
  "%s cannot authorize a live read",
  async (source) => {
    const { runtime, readCall } = await setup();
    runtime.session.source = source;
    await expect(runtime.startDiscovery()).rejects.toThrow(/live display/);
    expect(readCall).not.toHaveBeenCalled();
  },
);
it("a copied contract or unknown endpoint cannot acquire registration", async () => {
  const { runtime, readCall } = await setup();
  const connection = {
    getSession: () => runtime.session,
    getTransport: () => runtime.transport,
    read: runtime.read,
  };
  for (const read of [
    { ...REGISTERED_READS[0]! },
    {
      ...REGISTERED_READS[0]!,
      endpoint: { ...LED_MATRIX_ENDPOINT, characteristicUuid: "unknown" },
    },
  ]) {
    expect(() =>
      executeReviewedRead(
        connection,
        runtime.registry,
        read,
        "copied",
        { current: () => true, reserve: () => {} },
        "fake",
      ),
    ).toThrow(/not application-registered/);
  }
  expect(readCall).not.toHaveBeenCalled();
});
it("literal rows and all 25 independently supplied positions use the reviewed ordering", () => {
  expect(decodeMatrixState(new Uint8Array([16, 1, 8, 4, 18])).pixels).toEqual([
    1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  ]);
  for (let i = 0; i < 25; i++) {
    const bytes = new Uint8Array(5);
    bytes[Math.floor(i / 5)] = 1 << (4 - (i % 5));
    const pixels = decodeMatrixState(bytes).pixels;
    expect(pixels[i]).toBe(1);
    expect(pixels.reduce((a, b) => a + b, 0)).toBe(1);
  }
});
it.each([
  [0, 1, 2, 3],
  [0, 1, 2, 3, 4, 5],
  [128, 0, 0, 0, 0],
  [32, 0, 0, 0, 0],
  [64, 0, 0, 0, 0],
])(
  "malformed or reserved raw values are non-authorizing: %j",
  async (...value) => {
    const { runtime } = await setup(new Uint8Array(value));
    await runtime.startDiscovery();
    expect(runtime.discovery?.attempts[0]?.outcome).toBe("inconclusive");
    expect(runtime.discovery?.attempts[0]?.failureStage).toBe("value");
    expect(runtime.discovery?.attempts[0]?.readValue).toBeUndefined();
    expect(runtime.transactions[0]?.packets[0]?.hex.split(" ")).toHaveLength(
      value.length,
    );
    expect(runtime.session.protocolResolution).toBeNull();
  },
);
it.each(["stop", "disconnect", "replacement", "definition"])(
  "%s suppresses late adoption and preserves original transaction context",
  async (mode) => {
    const { runtime, readCall } = await setup();
    let settle!: (bytes: Uint8Array) => void;
    readCall.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const originalConnection = runtime.transport.connectionId;
    const pending = runtime.startDiscovery();
    expect(runtime.discoveryBusy).toBe(true);
    if (mode === "stop") runtime.stopDiscovery();
    if (mode === "disconnect") {
      await runtime.disconnect();
      await runtime.connect();
    }
    if (mode === "replacement") {
      runtime.session.source = "imported";
      runtime.session.profile = { id: "new-profile" } as never;
    }
    if (mode === "definition")
      vi.spyOn(runtime.registry, "definitionIdentity").mockReturnValue(
        "changed",
      );
    settle(new Uint8Array(5));
    await pending;
    expect(runtime.discovery?.attempts[0]?.readValue).toBeUndefined();
    expect(runtime.discovery?.attempts[0]?.outcome).toBe("retired");
    expect(runtime.transactions[0]).toMatchObject({
      sessionSource: "live",
      driverId: "microbit-led-reference",
      profileId: null,
    });
    expect(runtime.transactions[0]?.findings.join(" ")).toContain(
      originalConnection,
    );
  },
);
it("timeout supervises pending work until explicit disconnect; late evidence cannot mutate replacement results", async () => {
  vi.useFakeTimers();
  const { runtime, transport, readCall } = await setup();
  let settle!: (bytes: Uint8Array) => void;
  readCall.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const pending = runtime.startDiscovery();
  await vi.advanceTimersByTimeAsync(3000);
  await pending;
  expect(runtime.discovery?.attempts[0]).toMatchObject({
    outcome: "timeout",
    failureStage: "deadline",
  });
  expect(runtime.discoveryBusy).toBe(true);
  expect(transport.state).toBe("connected");
  expect(() => runtime.read(LED_MATRIX_ENDPOINT)).toThrow(/owns execution/);
  await expect(runtime.startDiscovery()).rejects.toThrow(/owns/);
  await runtime.disconnect();
  expect(runtime.discoveryBusy).toBe(false);
  await runtime.connect();
  await runtime.startDiscovery();
  const replacement = runtime.discovery;
  settle(new Uint8Array([31, 31, 31, 31, 31]));
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.discovery).toEqual(replacement);
  expect(runtime.transactions).toHaveLength(2);
  expect(runtime.transactions[1]?.decodedResponse).toBeNull();
});
it("read failures neither quarantine writes nor reject a protocol", async () => {
  const { runtime, transport, readCall } = await setup();
  readCall.mockRejectedValue(new Error("unsupported pairing"));
  await runtime.startDiscovery();
  expect(runtime.discovery?.attempts[0]).toMatchObject({
    outcome: "transport",
    failureStage: "read",
  });
  expect(transport.state).toBe("connected");
  expect(
    runtime.discovery?.hypotheses.every((h) => h.contradictions.length === 0),
  ).toBe(true);
});
it("definition change before dispatch prevents browser work", async () => {
  const { runtime, readCall } = await setup();
  vi.spyOn(runtime.registry, "definitionIdentity")
    .mockReturnValueOnce("pinned")
    .mockReturnValue("changed");
  await runtime.startDiscovery();
  expect(readCall).not.toHaveBeenCalled();
});
it("a retired unresolved interview cannot overwrite a new interview on replacement", async () => {
  const { runtime, readCall } = await setup();
  let settle!: (bytes: Uint8Array) => void;
  readCall.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const old = runtime.startDiscovery();
  await runtime.disconnect();
  await runtime.connect();
  await runtime.startDiscovery();
  const replacement = runtime.discovery;
  settle(new Uint8Array(5));
  await old;
  expect(runtime.discovery).toEqual(replacement);
  expect(runtime.transactions).toHaveLength(2);
});
it("read V3 evidence round-trips offline without live eligibility or leaked target text", async () => {
  const { runtime } = await setup();
  const original = runtime.session.fingerprint!;
  runtime.session.fingerprint = {
    ...original,
    name: "private-target-938",
    browserDeviceId: "private-browser-id-938",
  };
  await runtime.startDiscovery();
  const bundle = runtime.exportBundle();
  const imported = new ApplicationRuntime(
    new FakeTransport(),
    undefined,
    new DriverRegistry([]),
  );
  runtimes.push(imported);
  imported.importBundle(bundle);
  expect(imported.transactions[0]).toEqual(runtime.transactions[0]);
  expect(imported.transactions[0]?.findings.join(" ")).toContain(
    "Reviewed read outcome: service-observed",
  );
  await expect(imported.startDiscovery()).rejects.toThrow(/live display/);
  const shared = runtime.exportBundle("shareable");
  expect(shared).not.toContain("private-target-938");
  expect(shared).not.toContain("private-browser-id-938");
});
it("oversized supplied values allocate no preview and preserve length plus bounded raw prefix", async () => {
  const { runtime } = await setup(new Uint8Array(4096).fill(255));
  await runtime.startDiscovery();
  expect(runtime.discovery?.attempts[0]?.readValue).toBeUndefined();
  expect(runtime.transactions[0]?.packets[0]?.hex.split(" ")).toHaveLength(512);
  expect(runtime.transactions[0]?.findings.join(" ")).toContain(
    "received 4096 bytes",
  );
  expect(runtime.discovery?.remaining.bytes).toBe(2043);
});
it("setup cannot race an already dispatched manual GATT read", async () => {
  const { runtime, readCall } = await setup();
  let settle!: (bytes: Uint8Array) => void;
  readCall.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const pending = runtime.read(LED_MATRIX_ENDPOINT);
  await expect(runtime.startDiscovery()).rejects.toThrow(
    /Another GATT operation owns/,
  );
  expect(readCall).toHaveBeenCalledTimes(1);
  expect(runtime.discovery).toBeNull();
  settle(new Uint8Array(5));
  await pending;
  await runtime.startDiscovery();
  expect(runtime.discovery?.terminal).toBe("service-observed");
});
it("copied accessible identifiers in session data cannot manufacture transport access", async () => {
  const { runtime, readCall } = await setup(undefined, true, false);
  runtime.session.fingerprint = readFingerprint();
  await runtime.startDiscovery();
  expect(readCall).not.toHaveBeenCalled();
  expect(runtime.discovery?.attempts[0]?.outcome).toBe("access");
});

it.each(["manual read", "discovery"])(
  "both import entrypoints reject while %s owns a pending read",
  async (owner) => {
    const { prepareDiagnosticBundleImport } =
      await import("../../src/diagnostics/bundle");
    const { runtime, readCall } = await setup();
    const json = runtime.exportBundle();
    const prepared = prepareDiagnosticBundleImport(json);
    let settle!: (bytes: Uint8Array) => void;
    readCall.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const pending =
      owner === "manual read"
        ? runtime.read(LED_MATRIX_ENDPOINT)
        : runtime.startDiscovery();
    await vi.waitFor(() => expect(readCall).toHaveBeenCalledOnce());
    const fingerprint = runtime.session.fingerprint;
    expect(() => runtime.importBundle(json)).toThrow(
      /owns execution|current operation/,
    );
    expect(() => runtime.adoptPreparedBundle(prepared)).toThrow(
      /owns execution|current operation/,
    );
    expect(runtime.session.fingerprint).toBe(fingerprint);
    expect(runtime.session.source).toBe("live");
    settle(new Uint8Array(5));
    await pending;
    runtime.adoptPreparedBundle(prepared);
    expect(runtime.session.source).toBe("imported");
  },
);
