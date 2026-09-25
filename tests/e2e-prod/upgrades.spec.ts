import { expect, test, type Page } from "@playwright/test";

async function installed(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}
async function discover(page: Page) {
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
  await expect(
    page.getByRole("button", { name: "Update and reload" }),
  ).toBeVisible();
}
async function build(page: Page): Promise<string> {
  return page.evaluate(
    async () =>
      (
        (await (await fetch("./build-metadata.json")).json()) as {
          buildId: string;
        }
      ).buildId,
  );
}
test.beforeEach(async ({ request }) => {
  await request.get("/__test/release/a");
});

test("two production builds upgrade, refresh other tabs, work offline, and roll back", async ({
  page,
  context,
  request,
}) => {
  const errors: string[] = [];
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  page.on("pageerror", (e) => errors.push(e.message));
  await installed(page);
  const first = await build(page);
  const other = await context.newPage();
  await installed(other);
  await request.get("/__test/release/b");
  await discover(page);
  await page.getByRole("button", { name: "Update and reload" }).click();
  await expect
    .poll(() =>
      build(page)
        .then((value) => value !== first)
        .catch(() => false),
    )
    .toBe(true);
  await expect
    .poll(() =>
      build(other)
        .then((value) => value !== first)
        .catch(() => false),
    )
    .toBe(true);
  const second = await build(page);
  await context.setOffline(true);
  await page.reload();
  for (const hash of [
    "#/home",
    "#/device/create",
    "#/device/investigate",
    "#/offline/report",
  ]) {
    await page.goto("/" + hash);
    await expect(page.locator("#app")).not.toBeEmpty();
  }
  await context.setOffline(false);
  await request.get("/__test/release/a");
  await discover(page);
  await page.getByRole("button", { name: "Update and reload" }).click();
  await expect.poll(() => build(page).catch(() => "navigating")).toBe(first);
  expect(first).not.toBe(second);
  expect(errors).toEqual([]);
});

test("failed precaching preserves the installed offline shell", async ({
  page,
  context,
  request,
}) => {
  await installed(page);
  const first = await build(page);
  await request.get("/__test/release/b?broken");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
    const installing = registration?.installing;
    if (installing)
      await new Promise<void>((resolve) => {
        const done = () => {
          if (
            installing.state === "redundant" ||
            installing.state === "activated"
          )
            resolve();
        };
        installing.addEventListener("statechange", done);
        done();
      });
  });
  await context.setOffline(true);
  await page.reload();
  expect(await build(page)).toBe(first);
  await expect(
    page.getByRole("heading", { name: /Make the display/i }),
  ).toBeVisible();
});

test("an unresponsive tab blocks activation and closing it permits retry", async ({
  page,
  context,
  request,
}) => {
  const other = await context.newPage();
  await other.goto("/__test/unresponsive");
  await installed(page);
  const first = await build(page);
  await request.get("/__test/release/b");
  await discover(page);
  await page.getByRole("button", { name: "Update and reload" }).click();
  await expect(page.getByRole("alert")).toContainText("Another app tab");
  expect(await build(page)).toBe(first);
  await other.close();
  await page.getByRole("button", { name: "Update and reload" }).click();
  await expect
    .poll(() =>
      build(page)
        .then((value) => value !== first)
        .catch(() => false),
    )
    .toBe(true);
});
