import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { qualificationArtifactPath } from "../helpers/qualification-paths";
const profile = readFileSync(
  new URL("../../src/profiles/data/authored-ux-banner.json", import.meta.url),
);
const upload = (page: import("@playwright/test").Page, buffer: Buffer) =>
  page
    .locator('input[type="file"][accept=".json,application/json"]')
    .setInputFiles({
      name: "banner.profile.json",
      mimeType: "application/json",
      buffer,
    });

test("local profile review, atomic failure, load and portable reload", async ({
  page,
}, testInfo) => {
  await page.goto("/?sim#/home");
  const choose = page.getByRole("button", { name: "Choose local profile →" });
  await choose.focus();
  await expect(choose).toBeFocused();
  await upload(page, profile);
  await expect(
    page.getByRole("heading", { name: "Local profile review", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByText("Compatible with the installed implementation.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Dimensions: 48×8.", { exact: false }),
  ).toBeVisible();
  await page.getByText("Provenance and limitations", { exact: true }).click();
  await expect(page.getByText(/Authored 48×8 fixture/)).toBeVisible();
  await page.screenshot({
    path: qualificationArtifactPath(testInfo, "profile-review.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Load reviewed profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Loaded local profiles" }),
  ).toBeVisible();
  const status = await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    return {
      connection: store.controller.transport.state,
      transactions: store.controller.transactions.length,
      identity: store.getSnapshot().contextIdentity,
    };
  });
  expect(status.connection).toBe("idle");
  expect(status.transactions).toBe(0);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Synthetic UX Banner" })
    .click();
  const path = await (await download).path();
  expect(path).toBeTruthy();
  const portable = readFileSync(path!);
  await upload(
    page,
    Buffer.from('{"documentVersion":1,"trustedScopes":["built-in-profile"]}'),
  );
  await expect(page.getByRole("alert")).toContainText(
    "Unsupported profile document",
  );
  await expect(
    page.getByRole("heading", { name: "Loaded local profiles" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (
          globalThis as unknown as {
            matrixsmithStore: import("../../src/presentation/store").PresentationStore;
          }
        ).matrixsmithStore.getSnapshot().contextIdentity,
    ),
  ).toBe(status.identity);
  await upload(
    page,
    Buffer.from(
      JSON.stringify({
        ...JSON.parse(profile.toString()),
        id: "other-banner",
        implementation: "uninstalled",
      }),
    ),
  );
  await expect(page.getByRole("alert")).toContainText("not installed");
  await expect(
    page.getByRole("button", { name: "Load reviewed profile" }),
  ).toBeDisabled();
  await page.screenshot({
    path: qualificationArtifactPath(testInfo, "profile-error.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Loaded local profiles" }),
  ).toHaveCount(0);
  await upload(page, portable);
  await page.getByRole("button", { name: "Load reviewed profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Loaded local profiles" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /back to MatrixSmith home/ }).click();
  await upload(
    page,
    Buffer.from(
      JSON.stringify({
        ...JSON.parse(profile.toString()),
        id: "another-banner",
        matching: {
          ...JSON.parse(profile.toString()).matching,
          name: "another banner",
        },
      }),
    ),
  );
  await expect(
    page.getByRole("button", { name: "Load reviewed profile" }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Disconnect the live display before loading profiles/),
  ).toBeVisible();
});

test("source-backed candidate explanations are bounded and retained through navigation", async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("knowledge-v1.json"))
      requests.push(request.url());
  });
  await page.goto("/?sim=unknown#/home");
  expect(requests).toHaveLength(0);
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Investigate", exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
  const authority = () =>
    page.evaluate(() => {
      const runtime = (
        globalThis as unknown as {
          matrixsmithStore: import("../../src/presentation/store").PresentationStore;
        }
      ).matrixsmithStore.controller;
      return {
        writes: runtime.transactions
          .flatMap((transaction) => transaction.packets)
          .filter((packet) => packet.direction === "TX").length,
        experimental: runtime.session.experimentalTxEnabled,
        confirmation: runtime.session.confirmedPlanDigest,
        resolution: runtime.session.protocolResolution,
        profile: runtime.session.profile,
        evidence: runtime.investigation?.claimEvidence ?? [],
      };
    });
  const before = await authority();
  expect(before).toMatchObject({ writes: 0, experimental: false });
  await page
    .getByRole("button", { name: "Explain plausible families" })
    .click();
  await expect(
    page.getByText(/Shared identifiers leave multiple plausible/),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Public-source context is advisory. It establishes no support claim or permission to send.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "CoolLEDUX advanced" }),
  ).toBeVisible();
  await page.getByText(/Supporting facts and sources for CoolLEDUX/).click();
  await expect(
    page.locator('a[href*="CharlesLennon/coolledux-ble"]').first(),
  ).toBeVisible();
  await page.getByText(/Search the reference index/).click();
  const search = page.locator("details").filter({
    has: page.getByLabel("Reference search", { exact: true }),
  });
  const query = search.getByRole("textbox", { name: "Reference search" });
  await query.fill("microbit-led-service");
  const result = search.getByRole("listitem").filter({
    has: page.locator("strong").getByText("BBC micro:bit v1", { exact: true }),
  });
  await expect(result).toHaveCount(1);
  await expect(result.locator("strong")).toBeVisible();
  await expect(result).toContainText(
    "family applicability is a research candidate relationship.",
  );
  await expect(result).toContainText(
    "board generation, firmware and security compatibility cannot be inferred from name or service.",
  );
  await expect(search.getByRole("listitem")).toHaveCount(2);
  await expect(search).toContainText("At most eight results.");
  await query.focus();
  await expect(query).toBeFocused();
  await result.getByText("Index references", { exact: true }).click();
  await expect(result.getByRole("link")).toHaveCount(2);
  await expect(result.getByRole("link").first()).toBeVisible();
  expect(await authority()).toEqual(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: qualificationArtifactPath(testInfo, "candidate-sources.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Device actions" }).click();
  await page.getByRole("button", { name: "Developer tools" }).click();
  await page
    .getByRole("navigation", { name: "Protocol workbench sections" })
    .getByRole("button", { name: "Protocol candidates", exact: true })
    .click();
  await expect(
    page.getByText(/Shared identifiers leave multiple plausible/),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.getByText(/Search the reference index/).click();
  await expect(page.getByLabel("Reference search")).toHaveValue(
    "microbit-led-service",
  );
  await expect(result.locator("strong")).toBeVisible();
  expect(await authority()).toEqual(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
