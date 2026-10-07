import { expect, test } from "./fixtures";
import type { ProtocolTransaction } from "../../src/diagnostics/transactions";
import type { SimulatedIledHatTransport } from "../../src/dev/simulated-device";
import type { PresentationStore } from "../../src/presentation/store";

test("compilation links survive capped history and failed uploads retain actual acceptance", async ({
  page,
}) => {
  await page.goto("/?sim#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  const text = page.getByRole("textbox", { name: "Text", exact: true });
  const send = page.getByRole("button", {
    name: "Send to display",
    exact: true,
  });
  await text.fill("LEDGER");
  await page
    .getByRole("combobox", { name: "Display", exact: true })
    .selectOption("still");
  await send.click();
  await expect(page.getByText("Upload sent.", { exact: true })).toBeVisible();
  const evictedId = await page.evaluate(() => {
    const store = (
      globalThis as unknown as { matrixsmithStore: PresentationStore }
    ).matrixsmithStore;
    const history = store.controller.transactions as ProtocolTransaction[];
    const template = history.at(-1)!;
    history.splice(0, history.length);
    for (let index = 0; index < 10000; index++)
      history.push({ ...template, id: `retained-browser-fixture:${index}` });
    return history[0]!.id;
  });
  await text.fill("LINKED");
  await send.click();
  await expect(page.getByText("Upload sent.", { exact: true })).toBeVisible();
  const retained = await page.evaluate((oldId) => {
    const runtime = (
      globalThis as unknown as { matrixsmithStore: PresentationStore }
    ).matrixsmithStore.controller;
    return {
      count: runtime.transactions.length,
      evicted: !runtime.transactions.some(({ id }) => id === oldId),
      transactionId: runtime.transactions.at(-1)!.id,
      compilationId: runtime.contentCompilations.at(-1)!.transactionId,
    };
  }, evictedId);
  expect(retained.count).toBe(10000);
  expect(retained.evicted).toBe(true);
  expect(retained.compilationId).toBe(retained.transactionId);

  await page.evaluate(() => {
    const transport = (
      globalThis as unknown as {
        matrixsmithTransport: SimulatedIledHatTransport;
      }
    ).matrixsmithTransport;
    const original = transport.write.bind(transport);
    let dispatched = 0;
    transport.write = async (...args) => {
      dispatched++;
      if (dispatched === 2) {
        transport.write = original;
        throw new Error("Authored rejection after one accepted packet");
      }
      return original(...args);
    };
  });
  await text.fill("RETAINED");
  await send.click();
  await expect(
    page.getByText("Upload did not finish.", { exact: true }),
  ).toBeVisible();
  await expect(text).toHaveValue("RETAINED");
  const failed = await page.evaluate(() => {
    const runtime = (
      globalThis as unknown as { matrixsmithStore: PresentationStore }
    ).matrixsmithStore.controller;
    const transaction = runtime.transactions.at(-1)!;
    const tx = transaction.packets.filter(
      ({ direction }) => direction === "TX",
    );
    return {
      error: transaction.error,
      hostAccepted: transaction.hostAccepted,
      dispatched: tx.length,
      accepted: tx.filter(({ hostAcceptedAt }) => hostAcceptedAt !== undefined)
        .length,
      transactionId: transaction.id,
      compilationId: runtime.contentCompilations.at(-1)!.transactionId,
    };
  });
  expect(failed.error).toContain("Authored rejection");
  expect(failed.hostAccepted).toBe(false);
  expect(failed.dispatched).toBe(2);
  expect(failed.accepted).toBe(1);
  expect(failed.compilationId).toBe(failed.transactionId);
});
