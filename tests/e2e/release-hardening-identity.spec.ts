import { test, expect } from "./fixtures";

test("late structured company contradiction withdraws live profile trust in the browser", async ({
  page,
}) => {
  await page.goto("/?sim=iledhat#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  const result = await page.evaluate(async () => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    const runtime = store.controller;
    const transport = runtime.transport;
    const profileBefore = runtime.session.profile?.id ?? null;
    const geometryBefore =
      runtime.session.fingerprint?.manuallyConfirmedGeometry;
    const plan = runtime.plan({ type: "GetDeviceInfo" });
    runtime.session.enableExperimentalTx();
    runtime.session.confirmPlanDigest(plan.digest!);
    transport.observeAdvertisements = async () => ({
      capturedAt: new Date().toISOString(),
      source: "web-bluetooth-watch",
      advertisedServiceUuids: [],
      manufacturerData: [{ companyId: 0x31ae, dataHex: "FFFF" }],
      serviceData: [],
    });
    (
      runtime as unknown as {
        connection: { _enrichAdvertisementEvidence(): void };
      }
    ).connection._enrichAdvertisementEvidence();
    await Promise.resolve();
    await Promise.resolve();
    const harmlessPlanAllowed = runtime.authorize(plan).allowed;
    transport.observeAdvertisements = async () => ({
      capturedAt: new Date().toISOString(),
      source: "web-bluetooth-watch",
      advertisedServiceUuids: [],
      manufacturerData: [{ companyId: 0xffff, dataHex: "AE31" }],
      serviceData: [],
    });
    (
      runtime as unknown as {
        connection: { _enrichAdvertisementEvidence(): void };
      }
    ).connection._enrichAdvertisementEvidence();
    await Promise.resolve();
    await Promise.resolve();
    return {
      profileBefore,
      harmlessPlanAllowed,
      profileAfter: runtime.session.profile,
      withdrawn: runtime.session.identityTrustWithdrawn,
      experimental: runtime.session.experimentalTxEnabled,
      confirmation: runtime.session.confirmedPlanDigest,
      oldPlanAllowed: runtime.authorize(plan).allowed,
      contentAllowed: runtime.contentGates().some((gate) => gate.allowed),
      geometryPreserved:
        JSON.stringify(geometryBefore) ===
        JSON.stringify(runtime.session.fingerprint?.manuallyConfirmedGeometry),
      observedCompany:
        runtime.session.fingerprint?.advertisementObservation
          ?.manufacturerData[0]?.companyId,
    };
  });
  expect(result.profileBefore).not.toBeNull();
  expect(result).toMatchObject({
    harmlessPlanAllowed: true,
    profileAfter: null,
    withdrawn: true,
    experimental: false,
    confirmation: null,
    oldPlanAllowed: false,
    contentAllowed: false,
    geometryPreserved: true,
    observedCompany: 0xffff,
  });
});
