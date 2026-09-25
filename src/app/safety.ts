import type { DeviceFingerprint } from "../core/device";
import {
  copyPreparedTransmission,
  isPreparedTransmission,
  packetHex,
  transmissionDigest,
  type AuthorizedTransmission,
  type TargetBinding,
  type TransmissionPlan,
} from "../core/transmission";
import type { DriverMatch } from "../drivers/types";

export interface SafetyContext {
  readonly source: "live" | "imported" | "fake" | "replay";
  readonly fingerprint: DeviceFingerprint | null;
  readonly selectedDriverId: string | null;
  readonly selectedProfileId: string | null;
  readonly driverMatch: DriverMatch | null;
  readonly ambiguous: boolean;
  readonly experimentalSessionEnabled: boolean;
  readonly targetBinding: TargetBinding | null;
  /** Digest whose exact target, bytes, pacing, and consequence were confirmed. */
  readonly confirmedPlanDigest: string | null;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
  readonly authorized?: AuthorizedTransmission;
}

export class SafetyPolicy {
  authorize(plan: TransmissionPlan, context: SafetyContext): PolicyDecision {
    const reasons: string[] = [];
    if (!isPreparedTransmission(plan))
      reasons.push(
        "The operation was not prepared for the current physical target.",
      );
    const prepared = isPreparedTransmission(plan) ? plan : null;
    if (
      prepared &&
      (!context.targetBinding ||
        !sameBinding(prepared.targetBinding, context.targetBinding))
    )
      reasons.push(
        "The prepared operation belongs to a different connection or physical target.",
      );
    if (
      prepared &&
      transmissionDigest(prepared, prepared.targetBinding) !== prepared.digest
    )
      reasons.push(
        "The prepared operation changed after its digest was created.",
      );
    reasons.push(...validatePlan(plan));
    if (context.source !== "live")
      reasons.push(
        "Offline, imported, fake, and replay sessions cannot transmit.",
      );
    if (!context.fingerprint) reasons.push("No live fingerprint is connected.");
    if (plan.execution !== "live")
      reasons.push("The driver marked this plan dry-run-only.");
    if (plan.purpose === "operation" && context.ambiguous)
      reasons.push("Driver selection is ambiguous.");
    if (
      plan.purpose === "operation" &&
      (!context.selectedDriverId || context.selectedDriverId !== plan.driverId)
    )
      reasons.push("The plan driver is not the selected driver.");
    if (
      plan.purpose === "operation" &&
      (!context.selectedProfileId ||
        context.selectedProfileId !== plan.profileId)
    )
      reasons.push("The plan profile is not the selected profile.");
    const acceptableConfidence =
      plan.purpose === "probe"
        ? ["candidate", "strong", "exact"]
        : ["strong", "exact"];
    if (
      !context.driverMatch ||
      !acceptableConfidence.includes(context.driverMatch.confidence)
    )
      reasons.push(
        "Driver confidence is below the live threshold for this plan purpose.",
      );
    if (plan.validation === "unverified" || plan.validation === "rejected")
      reasons.push("The operation is not validated for this profile.");
    if (plan.risk === "persistent" || plan.persistence === "persistent") {
      if (plan.purpose !== "operation")
        reasons.push("Persistent probes are never allowed.");
      if (
        plan.validation !== "verified" &&
        (!prepared || context.confirmedPlanDigest !== prepared.digest)
      )
        reasons.push(
          "Experimental persistent operations require confirmation of this exact target-bound plan digest.",
        );
    }
    if (plan.risk === "destructive")
      reasons.push("Destructive operations are blocked.");
    if (plan.risk === "firmware")
      reasons.push("Firmware operations are blocked.");
    if (
      plan.validation === "experimental" &&
      !context.experimentalSessionEnabled
    )
      reasons.push("Experimental transmission requires a per-session unlock.");
    if (
      plan.purpose === "probe" &&
      (plan.risk !== "read-only" || plan.persistence !== "none")
    )
      reasons.push(
        "Automatic family-identification probes must be read-only and non-persistent.",
      );
    if (!endpointAvailable(plan, context.fingerprint))
      reasons.push(
        "The required endpoint and write-without-response property are unavailable.",
      );
    if (reasons.length > 0) return { allowed: false, reasons };
    const owned = copyPreparedTransmission(prepared!);
    return {
      allowed: true,
      reasons: [],
      authorized: {
        plan: owned,
        targetBinding: { ...owned.targetBinding },
        digest: owned.digest,
        authorizedAt: new Date().toISOString(),
        policyDecision: "allow",
      },
    };
  }
}

function sameBinding(a: TargetBinding, b: TargetBinding): boolean {
  return (
    a.connectionId === b.connectionId &&
    a.fingerprintKey === b.fingerprintKey &&
    a.browserDeviceId === b.browserDeviceId
  );
}

function validatePlan(plan: TransmissionPlan): string[] {
  const reasons: string[] = [];
  if (plan.packets.length === 0)
    reasons.push("A transmission must contain at least one packet.");
  const seen = new Set<number>();
  let totalBytes = 0;
  for (let position = 0; position < plan.packets.length; position += 1) {
    const packet = plan.packets[position]!;
    if (packet.index !== position || seen.has(packet.index))
      reasons.push("Packet indexes must be unique and contiguous from zero.");
    seen.add(packet.index);
    if (packet.bytes.length === 0 || packet.bytes.length > 512)
      reasons.push("Packet byte length is outside the safe GATT budget.");
    totalBytes += packet.bytes.length;
    if (packet.hex !== packetHex(packet.bytes))
      reasons.push("Packet hex does not match the authoritative bytes.");
    if ((packet.delayAfterMs ?? 0) < 0 || (packet.delayAfterMs ?? 0) > 60_000)
      reasons.push("Packet pacing is outside the safe budget.");
  }
  if (totalBytes > 16 * 1024 * 1024)
    reasons.push("Transmission total bytes exceed the safe budget.");
  if (
    !Number.isFinite(plan.timeoutMs) ||
    plan.timeoutMs < 1 ||
    plan.timeoutMs > 120_000
  )
    reasons.push("Transmission timeout is outside the safe budget.");
  return [...new Set(reasons)];
}

function endpointAvailable(
  plan: TransmissionPlan,
  fingerprint: DeviceFingerprint | null,
): boolean {
  if (!fingerprint) return false;
  return plan.packets.every((packet) =>
    fingerprint.services.some(
      (service) =>
        service.uuid.toLowerCase() ===
          packet.endpoint.serviceUuid.toLowerCase() &&
        service.characteristics.some(
          (characteristic) =>
            characteristic.uuid.toLowerCase() ===
              packet.endpoint.characteristicUuid.toLowerCase() &&
            (packet.writeMode === "without-response"
              ? characteristic.properties.writeWithoutResponse
              : characteristic.properties.write),
        ),
    ),
  );
}
