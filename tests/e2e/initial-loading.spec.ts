import { expect, test } from "./fixtures";

test("cold Home does not fetch the application runtime before an action", async ({
  page,
}) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });

  await page.goto("/#/home");
  await expect(
    page.getByRole("heading", { name: /Make the display/i }),
  ).toBeVisible();

  expect(scripts.some((url) => url.includes("application-bootstrap"))).toBe(
    false,
  );
});
