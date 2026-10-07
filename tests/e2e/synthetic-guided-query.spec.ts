import { test, expect } from "./fixtures";

test("registered synthetic query has a deliberate Run, honest consequence and recorded response", async ({
  page,
}) => {
  await page.goto("/?sim=lumen#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  // Explicit experimental permission is independent of the read-only Run.
  const before = await page.evaluate(async () => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    const runtime = store.controller;
    const connected = {
      transactions: runtime.transactions.length,
      experimental: runtime.session.experimentalTxEnabled,
      resolution: runtime.session.protocolResolution,
      evidence: runtime.investigation?.claimEvidence ?? [],
    };
    runtime.session.enableExperimentalTx();
    // This experimental fixture is not eligible for automatic discovery.
    // Use its registered, explicitly permitted diagnostic and real correlation.
    await store.runDiagnostic("lumen-identify");
    if (runtime.session.protocolResolution?.driverId !== "test-lumen")
      throw new Error("Identification failed");
    runtime.confirmProvisionalGeometry(24, 8);
    runtime.session.confirmPlanDigest("unrelated confirmation");
    store.startGuidedTest("lumen-read-info", "manual-selection");
    return {
      connected,
      transactions: runtime.transactions.length,
      panel: runtime.panelProgram(),
      diagnostic: runtime.diagnosticRuns.at(-1),
      transaction: runtime.transactions.at(-1),
    };
  });
  expect(before.connected).toEqual({
    transactions: 0,
    experimental: false,
    resolution: null,
    evidence: [],
  });
  expect(before.diagnostic).toMatchObject({
    toolId: "lumen-identify",
    status: "passed",
    findings: [
      "Authored Lumen response matched; this is software evidence only.",
    ],
  });
  expect(before.transactions).toBe(1);
  expect(before.transaction).toMatchObject({
    operation: "GetDeviceInfo",
    protocolAcknowledged: true,
    decodedResponse: { family: "Synthetic Lumen" },
  });
  expect(before.transaction?.packets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        direction: "RX",
        relation: "matched-response",
      }),
    ]),
  );
  expect(before.diagnostic?.steps[0]?.transactionIds).toEqual([
    before.transaction?.id,
  ]);
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
  expect(
    await page.evaluate(() => {
      const runtime = (
        globalThis as unknown as {
          matrixsmithStore: import("../../src/presentation/store").PresentationStore;
        }
      ).matrixsmithStore.controller;
      return {
        transactions: runtime.transactions.length,
        transfers: runtime.transfers.length,
        attempts: runtime.experiments.at(-1)?.attempts.length,
        confirmation: runtime.session.confirmedPlanDigest,
      };
    }),
  ).toEqual({
    transactions: before.transactions,
    transfers: 0,
    attempts: 0,
    confirmation: "unrelated confirmation",
  });
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
      transactionCount: runtime.transactions.length,
      confirmation: runtime.session.confirmedPlanDigest,
      panel: runtime.panelProgram(),
      evidence: runtime.investigation?.claimEvidence,
      compilationCount: JSON.parse(runtime.exportBundle()).contentCompilations
        .length,
      attempt: runtime.experiments.at(-1)?.attempts.at(-1),
      transfer: runtime.transfers.at(-1),
      inProgress: runtime.inProgressAttempts(),
      experimental: runtime.session.experimentalTxEnabled,
    };
  });
  expect(state.transaction).toMatchObject({
    operation: "GetDeviceInfo",
    source: "diagnostic",
    protocolAcknowledged: true,
    decodedResponse: { family: "Synthetic Lumen" },
  });
  expect(state.transactionCount).toBe(before.transactions + 1);
  expect(state.transaction?.packets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        direction: "RX",
        relation: "matched-response",
      }),
    ]),
  );
  expect(state.confirmation).toBe("unrelated confirmation");
  expect(state.experimental).toBe(true);
  expect(state.panel.certainty).toBe("unknown");
  expect(state.panel).toEqual(before.panel);
  expect(state.compilationCount).toBe(0);
  expect(state.evidence).toEqual([]);
  expect(state.attempt).toMatchObject({ validity: "valid", observations: [] });
  expect(state.attempt?.transferIds).toHaveLength(1);
  expect(state.attempt?.transferIds).toEqual([state.transfer?.transferId]);
  expect(state.transfer?.transactionIds).toEqual([state.transaction?.id]);
  expect(state.inProgress).toEqual([]);
});
