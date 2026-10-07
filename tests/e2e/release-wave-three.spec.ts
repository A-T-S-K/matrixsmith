import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";

test("source labels, honest report controls, Markdown privacy and failed-action retry", async ({
  page,
}) => {
  await page.goto("/?sim#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  await page
    .getByText("Brightness and display status", { exact: true })
    .click();
  await expect(
    page.getByText("No device information received", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Device actions" }).click();
  await page.getByRole("button", { name: "Developer tools" }).click();
  await page
    .getByRole("button", { name: "Protocol candidates", exact: true })
    .click();
  await expect(
    page.getByText("Selected profile / driver match", { exact: true }),
  ).toBeVisible();
  // Use the public command to receive actual simulator protocol information.
  const capture = await page.evaluate(async () => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    const before = store.getSnapshot().deviceInfoEvidence;
    await store.refreshInfo();
    const received = store.getSnapshot().deviceInfoEvidence;
    await store.identify();
    const fingerprint = store.controller.session.fingerprint!;
    store.controller.session.fingerprint = {
      ...fingerprint,
      name: "PRIVATE-WAVE-THREE-NAME",
      browserDeviceId: "PRIVATE-WAVE-THREE-BROWSER",
      rawAdvertisementHex: "DEADBEEF778899AA",
      manufacturerDataHex: "11223344ABCDFFEE",
    };
    store.startDevelopInvestigation();
    store.setView("develop");
    return {
      before,
      received,
      archive: store.exportBundle("full-local-archive"),
    };
  });
  expect(capture.before).toMatchObject({
    basis: "unread",
    label: "No device information received",
  });
  expect(capture.received).toMatchObject({
    basis: "received",
    label: "Device information received",
    timestamp: expect.any(String),
  });
  await page
    .getByRole("button", { name: "Protocol candidates", exact: true })
    .click();
  await expect(
    page.getByText("Identified by current live probe", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Device actions" }).click();
  await page.getByRole("button", { name: "Share report…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("radio", { name: /Investigation —/ }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("textbox", { name: "Goal / question" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("checkbox", { name: "GATT", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByText(/Investigation objective/)).toBeVisible();
  await dialog.getByRole("radio", { name: /Canonical device report/ }).check();
  await dialog
    .getByRole("textbox", { name: "Goal / question" })
    .fill("Inspect the retained evidence");
  await dialog.getByRole("checkbox", { name: "GATT", exact: true }).uncheck();
  await dialog.getByRole("radio", { name: /Forensic —/ }).check();
  await expect(
    dialog.getByRole("textbox", { name: "Goal / question" }),
  ).toHaveCount(0);
  const safeDownload = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download .md", exact: true })
    .click();
  const safe = readFileSync((await (await safeDownload).path())!, "utf8");
  expect(safe).not.toMatch(
    /PRIVATE-WAVE-THREE|DEADBEEF778899AA|11223344ABCDFFEE/,
  );
  expect(safe).toContain("Known identifiers omitted by default");
  expect(safe).toContain("still need manual review");
  await dialog
    .getByRole("checkbox", { name: /Include known identifiers/ })
    .check();
  await expect(
    dialog.getByText("Identifiers included by explicit choice", {
      exact: true,
    }),
  ).toBeVisible();
  const fullDownload = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download .md", exact: true })
    .click();
  const full = readFileSync((await (await fullDownload).path())!, "utf8");
  expect(full).toContain("PRIVATE-WAVE-THREE-NAME");
  expect(full).toContain("DEADBEEF778899AA");
  expect(full).toContain("Identifiers included by explicit choice");
  await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: {
          reportStore: {
            _files: { download: (...args: [string, string, string]) => void };
          };
        };
      }
    ).matrixsmithStore;
    const files = store.reportStore._files;
    const original = files.download;
    files.download = () => {
      files.download = original;
      throw new Error("Synthetic download adapter failure");
    };
  });
  await dialog
    .getByRole("button", { name: "Download .md", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Synthetic download adapter failure",
  );
  const retry = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download .md", exact: true })
    .click();
  expect(readFileSync((await (await retry).path())!, "utf8")).toContain(
    "# MatrixSmith",
  );
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("radio", { name: /Canonical device report/ }).check();
  await expect(
    dialog.getByRole("textbox", { name: "Goal / question" }),
  ).toHaveValue("Inspect the retained evidence");
  await expect(
    dialog.getByRole("checkbox", { name: "GATT", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Close report" }).click();
  await page.evaluate((archive) => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    store.importBundle(archive);
    store.setView("develop");
  }, capture.archive);
  await page
    .getByRole("button", { name: "Protocol candidates", exact: true })
    .click();
  await expect(
    page.getByText("Imported / replayed evidence", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Identified by current live probe", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    const bundle = JSON.parse(store.exportBundle("full-local-archive"));
    bundle.investigation = null;
    store.setReportKind("investigation");
    store.importBundle(JSON.stringify(bundle));
    store.openReport();
  });
  await expect(
    dialog.getByRole("radio", { name: /Investigation —/ }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("radio", { name: /Canonical device report/ }),
  ).toBeChecked();
});
