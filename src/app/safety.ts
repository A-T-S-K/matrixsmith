import type { DeviceFingerprint } from "../core/device";
import type { AuthorizedTransmission, TransmissionPlan } from "../core/transmission";
import type { DriverMatch } from "../drivers/types";

export interface SafetyContext {
  readonly source: "live" | "imported" | "fake" | "replay";
  readonly fingerprint: DeviceFingerprint | null;
  readonly selectedDriverId: string | null;
  readonly selectedProfileId: string | null;
  readonly driverMatch: DriverMatch | null;
  readonly ambiguous: boolean;
  readonly experimentalSessionEnabled: boolean;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
  readonly authorized?: AuthorizedTransmission;
}

export class SafetyPolicy {
  authorize(plan: TransmissionPlan, context: SafetyContext): PolicyDecision {
    const reasons: string[] = [];
    if (context.source !== "live") reasons.push("Offline, imported, fake, and replay sessions cannot transmit.");
    if (!context.fingerprint) reasons.push("No live fingerprint is connected.");
    if (context.ambiguous) reasons.push("Driver selection is ambiguous.");
    if (!context.selectedDriverId || context.selectedDriverId !== plan.driverId) reasons.push("The plan driver is not the selected driver.");
    if (!context.selectedProfileId || context.selectedProfileId !== plan.profileId) reasons.push("The plan profile is not the selected profile.");
    if (!context.driverMatch || !["strong", "exact"].includes(context.driverMatch.confidence)) reasons.push("Driver confidence is below the live threshold.");
    if (plan.validation === "unverified" || plan.validation === "rejected") reasons.push("The operation is not validated for this profile.");
    if (plan.risk === "persistent" || plan.persistence === "persistent") reasons.push("Persistent operations are blocked in this milestone.");
    if (plan.risk === "destructive") reasons.push("Destructive operations are blocked.");
    if (plan.risk === "firmware") reasons.push("Firmware operations are blocked.");
    if (plan.validation === "experimental" && !context.experimentalSessionEnabled) reasons.push("Experimental transmission requires a per-session unlock.");
    if (plan.operation.type !== "SetBrightness" || ![0x40, 0xc0].includes(plan.operation.raw)) reasons.push("Only the raw 0x40 and 0xC0 brightness experiments may be live.");
    if (plan.driverId !== "coolledx" || plan.profileId !== "iledhat-31ae-32x16") reasons.push("Live TX is restricted to the known iLedHat CoolLEDX candidate profile.");
    if (!endpointAvailable(plan, context.fingerprint)) reasons.push("The required endpoint and write-without-response property are unavailable.");
    if (reasons.length > 0) return { allowed: false, reasons };
    return { allowed: true, reasons: [], authorized: { plan, authorizedAt: new Date().toISOString(), policyDecision: "allow" } };
  }
}

function endpointAvailable(plan: TransmissionPlan, fingerprint: DeviceFingerprint | null): boolean {
  if (!fingerprint) return false;
  return plan.packets.every((packet) => fingerprint.services.some((service) =>
    service.uuid.toLowerCase() === packet.endpoint.serviceUuid.toLowerCase()
    && service.characteristics.some((characteristic) => characteristic.uuid.toLowerCase() === packet.endpoint.characteristicUuid.toLowerCase()
      && (packet.writeMode === "without-response" ? characteristic.properties.writeWithoutResponse : characteristic.properties.write)),
  ));
}
