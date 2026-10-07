import { ApplicationRuntime } from "../../src/application/runtime";
import { FakeTransport } from "../../src/transport/fake";
import { DriverRegistry } from "../../src/drivers/registry";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { knownIledHatFingerprint } from "./fixtures";
import { parseHexBytes } from "../../src/discovery/advertisement";
import info from "../fixtures/iledhat/coolledux-device-info-cc.json";
import { COOLLED_ENDPOINT } from "../../src/drivers/coolled/common/gatt";
import type { ObservationValue } from "../../src/investigation/observations";
export async function setupStill(
  width = 32,
  height = 16,
  codec = true,
  deviceId?: string,
) {
  const fingerprint = {
    ...knownIledHatFingerprint(),
    ...(deviceId ? { browserDeviceId: deviceId } : {}),
    name: "Unfamiliar display",
    manufacturerDataHex: undefined,
    rawAdvertisementHex: undefined,
    manuallyConfirmedGeometry: undefined,
  };
  const transport = new FakeTransport(fingerprint);
  const runtime = new ApplicationRuntime(
    transport,
    undefined,
    new DriverRegistry([
      {
        ...coolLedUxDriver,
        contentCodecId: codec ? "coolledux-reviewed-v1" : undefined,
      },
    ]),
  );
  await runtime.connect();
  transport.notificationOnWriteEndpoint = COOLLED_ENDPOINT;
  transport.notificationOnWrite = parseHexBytes(info.rxHex);
  await runtime.probe();
  runtime.confirmProvisionalGeometry(width, height);
  transport.notificationOnWrite = null;
  return { runtime, transport };
}

export const yes = (fieldId: string): ObservationValue => ({
  fieldId,
  kind: "boolean",
  value: "yes",
});
export const bootstrapValues: readonly ObservationValue[] = [
  yes("initial"),
  yes("coverage"),
  yes("layout"),
  { fieldId: "moved", kind: "boolean", value: "no" },
  {
    fieldId: "visible",
    kind: "duration",
    milliseconds: 100,
    measuredBy: "matrixsmith-timer",
  },
  {
    fieldId: "end",
    kind: "duration",
    milliseconds: 15100,
    measuredBy: "matrixsmith-timer",
  },
];
export async function observed(
  runtime: ApplicationRuntime,
  testId: string,
  values: readonly ObservationValue[],
) {
  const run = runtime.beginExperiment(testId);
  const attempt = runtime.beginAttempt(
    run.experimentRunId,
    "initial-experiment",
  );
  const transfer = await runtime.runGuidedTestTransfer(testId, {
    attemptId: attempt.attemptId,
    reason: "initial-experiment",
    confirmedConsequence: true,
  });
  const timing = testId.endsWith("bootstrap")
    ? {
        attemptNumber: 1,
        parameters: {},
        t0: transfer.finalWriteAcceptedAt,
        marks: [],
        values,
        validity: "valid" as const,
        invalidationReason: null,
        note: null,
        startedAt: attempt.startedAt,
        endedAt: new Date().toISOString(),
      }
    : null;
  runtime.settleAttempt(attempt.attemptId, {
    validity: "valid",
    observations: values,
    timing,
  });
  return {
    transfer,
    attempt,
    record: () =>
      runtime.recordGuidedTestObservations(
        testId,
        values,
        transfer.transactionIds,
        attempt.startedAt,
        timing ? [timing] : [],
      ),
  };
}

export async function verifyStill(runtime: ApplicationRuntime) {
  (
    await observed(runtime, "coolledux-still-bootstrap", bootstrapValues)
  ).record();
  (
    await observed(runtime, "coolledux-still-channels", [
      ...["red", "green", "blue"].map((optionId, index) => ({
        fieldId: `color-${index}`,
        kind: "choice" as const,
        optionId,
      })),
      yes("black"),
    ])
  ).record();
  (
    await observed(runtime, "coolledux-still-encoder", [
      yes("coverage"),
      yes("layout"),
      yes("colors"),
    ])
  ).record();
}
