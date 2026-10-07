import { expect, it, vi } from "vitest";
import { UpdateManager, type UpdatePort } from "../../src/app/update-manager";
function setup(waiting = true) {
  const port: UpdatePort = {
    hasWaiting: () => waiting,
    check: vi.fn(async () => {}),
    activate: vi.fn(async () => {}),
    subscribe: () => () => {},
    reload: vi.fn(),
  };
  return { port, manager: new UpdateManager(port) };
}
it("discovers an already waiting update without an announcement", () => {
  const { manager } = setup();
  expect(manager.state.available).toBe(true);
});
it("does not reload if no update is waiting", async () => {
  const { manager, port } = setup(false);
  await manager.applyUpdate();
  expect(port.reload).not.toHaveBeenCalled();
  expect(manager.state.error).toMatch(/No update/);
});
it("blocks activation while work is in progress", async () => {
  const { manager, port } = setup();
  manager.setBlocker(() => "A transfer is in progress.");
  await manager.applyUpdate();
  expect(port.activate).not.toHaveBeenCalled();
  expect(manager.state.error).toMatch(/transfer/);
});
it("surfaces activation failure and permits retry", async () => {
  const { manager, port } = setup();
  vi.mocked(port.activate).mockRejectedValueOnce(
    new Error("Other tab is busy."),
  );
  await manager.applyUpdate();
  expect(manager.state.error).toMatch(/Other tab/);
  await manager.applyUpdate();
  expect(port.reload).toHaveBeenCalledOnce();
});
it("releases the update subscription once on disposal", () => {
  const unsubscribe = vi.fn();
  const { port } = setup();
  port.subscribe = () => unsubscribe;
  const manager = new UpdateManager(port);
  manager.dispose();
  manager.dispose();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it("holds bootstrap ownership independently of the workspace blocker", async () => {
  const { manager, port } = setup();
  const release = manager.beginActivity("Opening workspace");
  manager.setBlocker(() => null);
  expect(manager.blockingReason).toBe("Opening workspace");
  await manager.applyUpdate();
  expect(port.activate).not.toHaveBeenCalled();
  release();
  release();
  expect(manager.blockingReason).toBeNull();
  await manager.applyUpdate();
  expect(port.activate).toHaveBeenCalledOnce();
});

it("refuses a new chooser while another tab has reserved activation", () => {
  const { manager } = setup();
  manager.setActivationLock(true);
  expect(() => manager.beginActivity("Opening workspace")).toThrow(
    /update is being applied/,
  );
  expect(manager.blockingReason).toBeNull();
  manager.setActivationLock(false);
  const release = manager.beginActivity("Opening workspace");
  release();
  manager.dispose();
  expect(() => manager.beginActivity("Opening workspace")).toThrow();
});
