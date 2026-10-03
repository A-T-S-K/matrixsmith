import { definitionDigest } from "../core/transmission";
import {
  ILEDHAT_DOCUMENT,
  iledHat31aeProfile,
} from "../profiles/iledhat-31ae-32x16";
import type { DeviceProfile } from "../core/device";
import type { MatrixDriver } from "./types";
import { DriverRegistry as RegistryCore } from "./registry-core";
import { coolLedXDriver } from "./coolledx";
import { coolLedUxDriver } from "./coolledux";
export type { DriverSelection } from "./registry-core";
const ILEDHAT_DEFINITION_IDENTITY = definitionDigest({
  document: ILEDHAT_DOCUMENT,
  profile: iledHat31aeProfile,
});
export const builtInDrivers: readonly MatrixDriver[] = Object.freeze([
  coolLedXDriver,
  coolLedUxDriver,
]);
/** Live composition adds the existing reviewed iLedHat identity to the pure registry. */
export class DriverRegistry extends RegistryCore {
  override definitionIdentity(
    driverId: string,
    profile: DeviceProfile | null,
  ): string {
    const accepted = this.acceptedProfiles.find(
      (entry) => entry.profile === profile,
    );
    if (accepted)
      return `${accepted.document.implementation}/${accepted.definitionIdentity}`;
    if (profile === iledHat31aeProfile)
      return `coolledux-reviewed-v1/${ILEDHAT_DEFINITION_IDENTITY}`;
    return super.definitionIdentity(driverId, profile);
  }
}
