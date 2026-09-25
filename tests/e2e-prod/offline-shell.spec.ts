import { expect, test } from "@playwright/test";

test("built production shell navigates and reloads offline", async ({
  page,
  context,
}) => {
  const failures: string[] = [];
  page.on("requestfailed", (request) =>
    failures.push(
      `${request.url()} — ${request.failure()?.errorText ?? "failed"}`,
    ),
  );
  page.on("pageerror", (error) =>
    failures.push(`pageerror — ${error.message}`),
  );
  await page.goto("/#/home");
  await expect(
    page.getByRole("heading", { name: /Make the display/i }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cached = await page.evaluate(async () => {
    const scripts = [...document.scripts]
      .map((script) => script.src)
      .filter(Boolean);
    const styles = [
      ...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    ].map((link) => link.href);
    return Promise.all(
      [...scripts, ...styles].map(async (url) => ({
        url,
        cached: Boolean(await caches.match(url)),
      })),
    );
  });
  expect(cached.every(({ cached }) => cached)).toBe(true);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(failures).toEqual([]);
  await expect(
    page.getByRole("heading", { name: /Make the display/i }),
  ).toBeVisible();
  await page.goto("/#/device/investigate", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app")).not.toBeEmpty();
});
