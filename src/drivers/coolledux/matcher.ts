import type { DeviceFingerprint } from "../../core/device";
import type { DriverMatch } from "../types";
import { matchCoolLedGatt } from "../coolled/common/matcher";

export function matchCoolLedUx(fingerprint: DeviceFingerprint): DriverMatch {
  return matchCoolLedGatt(fingerprint, "coolledux");
}
