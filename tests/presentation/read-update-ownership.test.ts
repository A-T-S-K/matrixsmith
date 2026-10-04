import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { DriverRegistry } from "../../src/drivers/registry";
import { FakeTransport } from "../../src/transport/fake";
import { emptyFingerprint } from "../../src/core/device";
import { LED_MATRIX_ENDPOINT } from "../../src/application/reviewed-reads";
import { PresentationStore } from "../../src/presentation/store";
import { createBrowserEnvironment } from "../../src/adapters/presentation/browser-environment";
import {
  UpdateManager,
  workspaceUpdateBlocker,
} from "../../src/app/update-manager";
import { createBrowserUpdates } from "../../src/adapters/updates/browser-updates";

afterEach(() => vi.useRealTimers());
async function setup() {
  const transport = new FakeTransport({
    ...emptyFingerprint("fake", "micro:bit fixture"),
    services: [
      {
        uuid: LED_MATRIX_ENDPOINT.serviceUuid,
        isPrimary: true,
        characteristics: [
          {
            uuid: LED_MATRIX_ENDPOINT.characteristicUuid,
            properties: {
              read: true,
              write: true,
              writeWithoutResponse: false,
              notify: false,
              indicate: false,
            },
          },
        ],
      },
    ],
  });
  const runtime = new ApplicationRuntime(
    transport,
    undefined,
    new DriverRegistry([]),
  );
  await runtime.connect("inspection");
  const store = new PresentationStore(
    runtime,
    transport,
    createBrowserEnvironment(),
  );
  let settle!: (bytes: Uint8Array) => void;
  vi.spyOn(transport, "read").mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  return { store, runtime, settle: () => settle(new Uint8Array(5)) };
}
for (const recovery of ["settlement", "disconnect"] as const) {
  it(`blocks update after read timeout and immediately releases after ${recovery}`, async () => {
    vi.useFakeTimers();
    const { store, runtime, settle } = await setup();
    const activate = vi.fn().mockResolvedValue(undefined),
      reload = vi.fn();
    const manager = new UpdateManager({
      hasWaiting: () => true,
      check: async () => {},
      activate,
      reload,
      subscribe: () => () => {},
    });
    manager.setBlocker(() => workspaceUpdateBlocker(store.getSnapshot()));
    try {
      const pending = store.identify();
      await vi.advanceTimersByTimeAsync(3000);
      await pending;
      expect(store.getSnapshot().busy).toBeNull();
      expect(runtime.discoveryBusy).toBe(true);
      expect(store.getSnapshot().discovery?.pendingRead).toBe(true);
      await manager.applyUpdate();
      expect(activate).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      if (recovery === "disconnect") await runtime.disconnect();
      else {
        settle();
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(runtime.executionBusy).toBe(false);
      expect(store.getSnapshot().contextTransitionReason).toBeNull();
      if (recovery === "disconnect")
        expect(store.getSnapshot().profileLoadReason).toBeNull();
      else expect(store.getSnapshot().profileLoadReason).toMatch(/Disconnect/);
      await manager.applyUpdate();
      expect(activate).toHaveBeenCalledOnce();
      expect(reload).toHaveBeenCalledOnce();
      if (recovery === "disconnect") {
        settle();
        await vi.advanceTimersByTimeAsync(0);
      }
    } finally {
      manager.dispose();
      await store.dispose();
    }
  });
}
it("another tab refuses service-worker readiness while a timed-out read is pending", async () => {
  vi.useFakeTimers();
  const { store, settle } = await setup();
  const container = Object.assign(new EventTarget(), {
    controller: {},
    register: vi.fn(async () =>
      Object.assign(new EventTarget(), {
        waiting: null,
        installing: null,
        update: async () => {},
      }),
    ),
  });
  const manager = createBrowserUpdates(
    container as unknown as ServiceWorkerContainer,
    vi.fn(),
  );
  manager.setBlocker(() => workspaceUpdateBlocker(store.getSnapshot()));
  const readiness = async () => {
    const channel = new MessageChannel();
    const response = new Promise<{ ready: boolean }>((resolve) => {
      channel.port1.onmessage = (event) => {
        resolve(event.data);
        channel.port1.close();
        channel.port2.close();
      };
    });
    container.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "matrixsmith:check-ready" },
        ports: [channel.port2],
      }),
    );
    return response;
  };
  try {
    const pending = store.identify();
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    expect(await readiness()).toMatchObject({ ready: false });
    settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(await readiness()).toMatchObject({ ready: true });
  } finally {
    manager.dispose();
    await store.dispose();
  }
});
