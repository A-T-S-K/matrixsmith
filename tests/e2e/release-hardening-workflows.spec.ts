import { test, expect } from "./fixtures";

test("brightness continuation stays with its original connection through disconnect recovery", async ({
  page,
}) => {
  await page.goto("/?sim#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  const result = await page.evaluate(async () => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    const runtime = store.controller;
    await runtime.probe();
    const send = runtime.send;
    let calls = 0;
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    const heldSend: typeof send = async (...args) => {
      calls += 1;
      const response = await send(...args);
      if (calls === 1) {
        enter();
        await held;
      }
      return response;
    };
    Object.defineProperty(runtime, "send", {
      configurable: true,
      value: heldSend,
    });
    try {
      const pending = store.applyBrightness(0x40);
      await entered;
      await store.disconnect();
      await runtime.connect();
      release();
      await pending;
      return {
        calls,
        info: store.getSnapshot().info,
        error: store.getSnapshot().error,
        state: runtime.transport.state,
      };
    } finally {
      release();
      Object.defineProperty(runtime, "send", {
        configurable: true,
        value: send,
      });
    }
  });
  expect(result).toMatchObject({ calls: 1, error: null, state: "connected" });
  expect(result.info ?? "").not.toMatch(/Brightness .* verified/);
});
