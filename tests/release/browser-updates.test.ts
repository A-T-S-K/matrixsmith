import { afterEach, expect, it, vi } from "vitest";
import { createBrowserUpdates } from "../../src/adapters/updates/browser-updates";

function setup() {
  const container = new EventTarget();
  const waiting = {
    postMessage: vi.fn<(message: unknown, ports: Transferable[]) => void>(),
  };
  const registration = Object.assign(new EventTarget(), {
    waiting,
    installing: null,
    update: vi.fn(async () => {}),
  });
  const port = Object.assign(container, {
    controller: {},
    register: vi.fn(async () => registration),
  });
  const reload = vi.fn();
  const manager = createBrowserUpdates(
    port as unknown as ServiceWorkerContainer,
    reload,
  );
  return { manager, waiting, registration, container, reload };
}
afterEach(() => vi.useRealTimers());
it("discovers waiting workers and reloads only once after activation", async () => {
  const { manager, waiting, container, reload } = setup();
  await Promise.resolve();
  expect(manager.state.available).toBe(true);
  waiting.postMessage.mockImplementation(() =>
    container.dispatchEvent(new Event("controllerchange")),
  );
  await manager.applyUpdate();
  expect(reload).toHaveBeenCalledOnce();
  manager.dispose();
});
it("surfaces another-tab refusal, then permits retry", async () => {
  const { manager, waiting, container, reload } = setup();
  await Promise.resolve();
  waiting.postMessage.mockImplementation((_message, ports) => {
    const port = ports[0] as MessagePort;
    port.postMessage({ error: "Another tab is busy." });
    port.close();
  });
  await manager.applyUpdate();
  expect(manager.state.error).toContain("Another tab");
  expect(reload).not.toHaveBeenCalled();
  waiting.postMessage.mockImplementation(() =>
    container.dispatchEvent(new Event("controllerchange")),
  );
  await manager.applyUpdate();
  expect(reload).toHaveBeenCalledOnce();
  manager.dispose();
});
it("acknowledges readiness, releases cancelled locks, and stops listening on disposal", async () => {
  const { manager, container } = setup();
  await Promise.resolve();
  const ready = async () => {
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
  manager.setBlocker(() => "Transfer in progress");
  expect(await ready()).toMatchObject({ ready: false });
  expect(manager.state.applying).toBe(false);
  manager.setBlocker(() => null);
  expect(await ready()).toMatchObject({ ready: true });
  expect(manager.state.applying).toBe(true);
  container.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "matrixsmith:update-cancelled" },
    }),
  );
  expect(manager.state.applying).toBe(false);
  manager.dispose();
  manager.dispose();
  container.dispatchEvent(new Event("controllerchange"));
});
it("bounds activation wait and clears the applying state after timeout", async () => {
  vi.useFakeTimers();
  const { manager } = setup();
  await Promise.resolve();
  const applying = manager.applyUpdate();
  await vi.advanceTimersByTimeAsync(15001);
  await applying;
  expect(manager.state.error).toContain("timed out");
  expect(manager.state.applying).toBe(false);
  manager.dispose();
});
