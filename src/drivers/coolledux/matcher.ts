import type { DeviceFingerprint } from "../../core/device";
import type { DriverMatch } from "../types";
import { matchCoolLedGatt } from "../coolled/common/matcher";
import { applyKnownProfileDisposition } from "../coolled/common/known-device";

export function matchCoolLedUx(fingerprint: DeviceFingerprint): DriverMatch {
  return applyKnownProfileDisposition(
    matchCoolLedGatt(fingerprint, "coolledux"),
    fingerprint,
  );
}
