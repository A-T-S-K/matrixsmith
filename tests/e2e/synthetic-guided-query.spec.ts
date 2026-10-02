import { test, expect } from "./fixtures";

test("registered synthetic query has a deliberate Run, honest consequence and recorded response", async ({
  page,
}) => {
  await page.goto("/?sim=lumen#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  // Explicit experimental permission is independent of the read-only Run.
  await page.evaluate(async () => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    const runtime = store.controller;
    runtime.session.enableExperimentalTx();
    await store.identify();
    if (runtime.session.protocolResolution?.driverId !== "test-lumen")
      throw new Error("Identification failed");
    runtime.confirmProvisionalGeometry(24, 8);
    runtime.session.confirmPlanDigest("unrelated confirmation");
    store.startGuidedTest("lumen-read-info", "manual-selection");
  });
  await expect(
    page
      .getByRole("status")
      .getByText(
        "Authored Lumen response matched; this is software evidence only.",
        { exact: true },
      ),
  ).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "Read Synthetic Lumen information",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      "Runs a read-only query. Stored display content is unchanged.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByText(/I understand this replaces/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(
    page.getByText(
      "Query executed; the required response was recorded. No physical capability was verified.",
      { exact: true },
    ),
  ).toBeVisible();
  const state = await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    const runtime = store.controller;
    return {
      transaction: runtime.transactions.at(-1),
      confirmation: runtime.session.confirmedPlanDigest,
      panel: runtime.panelProgram(),
      evidence: runtime.investigation?.claimEvidence,
      compilationCount: JSON.parse(runtime.exportBundle()).contentCompilations
        .length,
      attempt: runtime.experiments.at(-1)?.attempts.at(-1),
    };
  });
  expect(state.transaction).toMatchObject({
    operation: "GetDeviceInfo",
    protocolAcknowledged: true,
    decodedResponse: { family: "Synthetic Lumen" },
  });
  expect(state.confirmation).toBe("unrelated confirmation");
  expect(state.panel.certainty).toBe("unknown");
  expect(state.compilationCount).toBe(0);
  expect(state.evidence).toEqual([]);
  expect(state.attempt).toMatchObject({ validity: "valid", observations: [] });
  expect(state.attempt?.transferIds).toHaveLength(1);
});
