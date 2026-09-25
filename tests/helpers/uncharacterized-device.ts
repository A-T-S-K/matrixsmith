import { createPresentationStore } from "./presentation-fixture";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { PresentationStore } from "../../src/presentation/store";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { coolLedXDriver } from "../../src/drivers/coolledx";
import { DriverRegistry } from "../../src/drivers/registry";
import type { MatrixDriver } from "../../src/drivers/types";
import { knownIledHatFingerprint } from "./fixtures";
import { ScriptedCoolLedUxDevice } from "./scripted-device";
import { uncharacterizedCoolLedUxEvidence } from "./evidence";

/**
 * A CoolLEDUX panel that still needs characterizing.
 *
 * The guided workflow exists to characterize an UNKNOWN display, so the tests
 * that exercise it — plan ordering, milestone numbering, retries, bounded
 * termination — need a device with open questions. The shipped iLedHat can no
 * longer play that part: its profile now carries a verified static substrate,
 * so its core plan is complete on connect and a journey test against it would
 * pass while walking nowhere.
 *
 * This swaps only the driver's shipped claim evidence, through the registry
 * seam the controller already exposes. The real guided tests, core plan,
 * compilers and matchers are untouched, so the journey under test is the real
 * one — it just starts from a device nobody has measured yet.
 */
export function uncharacterizedCoolLedUxDriver(): MatrixDriver {
  return {
    ...coolLedUxDriver,
    claimEvidence: () => uncharacterizedCoolLedUxEvidence(),
  };
}

export function uncharacterizedRegistry(): DriverRegistry {
  return new DriverRegistry([coolLedXDriver, uncharacterizedCoolLedUxDriver()]);
}

export async function uncharacterizedController(): Promise<{
  controller: ApplicationRuntime;
  transport: ScriptedCoolLedUxDevice;
}> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new ApplicationRuntime(
    transport,
    new TraceRecorder(),
    uncharacterizedRegistry(),
  );
  await controller.connect();
  return { controller, transport };
}

export async function uncharacterizedStore(): Promise<{
  store: PresentationStore;
  transport: ScriptedCoolLedUxDevice;
}> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const store = createPresentationStore(
    new ApplicationRuntime(
      transport,
      new TraceRecorder(),
      uncharacterizedRegistry(),
    ),
    transport,
  );
  await store.connect();
  await store.identify();
  return { store, transport };
}
