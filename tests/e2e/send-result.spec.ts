import { expect, test } from "./fixtures";
import type { PresentationStore } from "../../src/presentation/store";
import type { SimulatedIledHatTransport } from "../../src/dev/simulated-device";

for (const width of [1280, 390]) {
  test(`truthful completion, retained draft and explicit recovery at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?sim#/home");
    await page.getByRole("button", { name: "Connect a display" }).click();
    const text = page.getByRole("textbox", { name: "Text", exact: true });
    const send = page.getByRole("button", {
      name: "Send to display",
      exact: true,
    });
    await text.fill("HELLO");
    await page
      .getByRole("combobox", { name: "Display", exact: true })
      .selectOption("still");
    await send.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Upload sent.", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Check the display. Its appearance was not confirmed."),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(send).toBeFocused();
    const details = page.getByText("Send details", { exact: true });
    await details.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("Host acceptance: All writes accepted by the host."),
    ).toBeVisible();
    await expect(
      page.getByText("Protocol response: Not expected for this upload."),
    ).toBeVisible();
    await expect(
      page.getByText("Device-state verification: Not verified."),
    ).toBeVisible();
    await details.press("Enter");
    await send.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/private/tmp/send-result-${width}.png` });
    await page.evaluate(() => {
      const globals = globalThis as unknown as {
        matrixsmithTransport: SimulatedIledHatTransport;
      };
      const transport = globals.matrixsmithTransport;
      const original = transport.write.bind(transport);
      transport.write = async () => {
        transport.write = original;
        transport.quarantine(
          "Injected indeterminate write for browser regression.",
        );
        throw new Error(
          "Injected indeterminate write. Its outcome is unknown.",
        );
      };
    });
    await send.click();
    await expect(
      page.getByText("Upload did not finish.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Check the display before sending again."),
    ).toBeVisible();
    await expect(text).toHaveValue("HELLO");
    await expect(send).toBeDisabled();
    await text.fill("REVIEW");
    await expect(
      page.getByText("Upload did not finish.", { exact: true }),
    ).toBeVisible();
    const recovery = page.getByRole("button", {
      name: "Reconnect and review draft",
      exact: true,
    });
    await recovery.scrollIntoViewIfNeeded();
    await recovery.focus();
    await expect(recovery).toBeFocused();
    const recoveryBox = await recovery.boundingBox();
    const sendBox = await send.boundingBox();
    expect(recoveryBox!.y).toBeGreaterThan(sendBox!.y);
    expect(recoveryBox!.x + recoveryBox!.width).toBeLessThanOrEqual(width);
    const unobstructed = await recovery.evaluate((button) => {
      const r = button.getBoundingClientRect();
      return button.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    });
    expect(unobstructed).toBe(true);
    await page.screenshot({
      path: `/private/tmp/send-recovery-${width}.png`,
    });
    const before = await page.evaluate(() => {
      const store = (
        globalThis as unknown as { matrixsmithStore: PresentationStore }
      ).matrixsmithStore;
      return {
        connection: store.getSnapshot().sendAttempt!.connectionId,
        transactions: store.getSnapshot().transactions.length,
      };
    });
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("Review your draft.", { exact: true }),
    ).toBeVisible();
    await expect(text).toHaveValue("REVIEW");
    await expect(send).toBeEnabled();
    await expect(send).toBeFocused();
    const after = await page.evaluate(() => {
      const store = (
        globalThis as unknown as { matrixsmithStore: PresentationStore }
      ).matrixsmithStore;
      return {
        connection: store.getSnapshot().sendAttempt!.connectionId,
        transactions: store.getSnapshot().transactions.length,
      };
    });
    expect(after.connection).not.toBe(before.connection);
    expect(after.transactions).toBe(before.transactions);
    await send.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Upload sent.", { exact: true })).toBeVisible();
  });
}

test("experimental confirmation is fresh for each prepared attempt and Back cancels", async ({
  page,
}) => {
  await page.goto("/?sim=experimental#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("HI");
  const send = page.getByRole("button", {
    name: "Send to display",
    exact: true,
  });
  await send.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(
    dialog.getByText(/Replaces the display’s stored content/),
  ).toBeVisible();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await send.click();
  await dialog
    .getByRole("button", { name: "Send to display", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Upload sent.", { exact: true })).toBeVisible();
  await send.click();
  await expect(dialog).toHaveCount(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(send).toBeFocused();
});
