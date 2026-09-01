import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { knownIledHatFingerprint } from "./fixtures";
import { ScriptedCoolLedUxDevice } from "./scripted-device";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";

// One-off QA helper: writes a realistic diagnostic bundle for manual browser
// QA. Only runs when QA_BUNDLE_PATH is set; never part of normal test runs.
it.runIf(Boolean(process.env.QA_BUNDLE_PATH))("generates a QA bundle", async () => {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new MatrixController(transport, new TraceRecorder());
  await controller.connect();
  transport.notificationOnWrite = parseHexBytes(infoFixture.rxHex);
  await controller.probe();
  transport.notificationOnWrite = null;
  await controller.runGuidedTestTransfer("coolledux-graffiti-timing", { confirmedConsequence: true, reason: "initial-experiment", attemptId: "attempt:test" });
  const transactionIds = controller.transactions.slice(-1).map((transaction) => transaction.id);
  controller.recordGuidedTestObservations("coolledux-graffiti-timing", [
    { kind: "boolean", fieldId: "initial-correct", value: "yes" },
    { kind: "duration", fieldId: "image-visible", milliseconds: 1420, measuredBy: "matrixsmith-timer" },
    { kind: "boolean", fieldId: "moved", value: "yes" },
    { kind: "duration", fieldId: "movement-start", milliseconds: 4650, measuredBy: "matrixsmith-timer" },
    { kind: "choice", fieldId: "motion-description", optionId: "wraps-repeats" },
  ], transactionIds);
  writeFileSync(process.env.QA_BUNDLE_PATH!, controller.exportBundle());
}, 60000);
