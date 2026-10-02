import { expect, test } from "./fixtures";

test("text budget rejection and valid recovery", async ({ page }) => {
  await page.goto("/?sim#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  const text = page.getByRole("textbox", { name: "Text", exact: true });
  await text.fill("HI");
  // A programmatic input event must obey the editor cap too.
  await text.evaluate((element) => {
    (element as HTMLInputElement).value = "X".repeat(1000);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByText(/previous text was retained/)).toBeVisible();
  await expect(text).toHaveValue("HI");
  await text.fill("X".repeat(512));
  await page
    .getByRole("combobox", { name: "Display", exact: true })
    .selectOption("scroll");
  await expect(
    page.getByRole("button", { name: "Display it", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Shorten the message or choose Still/),
  ).toBeVisible();
  await expect(page.getByLabel("Actual scrolling-text preview")).toHaveCount(0);
  await text.fill("HI");
  await page
    .getByRole("combobox", { name: "Display", exact: true })
    .selectOption("still");
  await page.getByRole("button", { name: "Display it", exact: true }).click();
  await expect(page.getByText("Display updated.")).toBeVisible();
});
