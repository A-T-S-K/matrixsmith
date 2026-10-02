import { expect, test } from "./fixtures";

test("workbench sections follow URLs and browser history", async ({ page }) => {
  await page.goto("/?sim#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await page.getByRole("button", { name: /Protocol workbench/ }).click();
  await expect(page).toHaveURL(/#\/device\/develop\/transactions$/);
  const sections = page.getByRole("navigation", {
    name: "Protocol workbench sections",
  });
  await sections.getByRole("button", { name: "GATT explorer" }).click();
  await expect(page).toHaveURL(/#\/device\/develop\/gatt$/);
  await expect(
    page.getByRole("heading", { name: "GATT explorer" }),
  ).toBeVisible();
  await sections.getByRole("button", { name: "Raw events" }).click();
  await expect(page).toHaveURL(/#\/device\/develop\/raw$/);
  await page.goBack();
  await expect(
    sections.getByRole("button", { name: "GATT explorer" }),
  ).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(
    sections.getByRole("button", { name: "Raw events" }),
  ).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("button", { name: /Investigate$/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Protocol workbench/ }).click();
  await expect(page).toHaveURL(/#\/device\/develop\/raw$/);
  await page.screenshot({ path: "/private/tmp/workbench-navigation.png" });
});

test("direct links request missing context without connecting", async ({
  page,
}) => {
  await page.goto("/#/offline/report/develop/gatt");
  await expect(
    page.getByRole("heading", { name: "Reopen diagnostic report" }),
  ).toBeVisible();
  await page.goto("/#/device/develop/gatt");
  await expect(
    page.getByRole("heading", { name: "Connect a display" }),
  ).toBeVisible();
});
