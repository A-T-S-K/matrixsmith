import type { DeviceFingerprint } from "../core/device";

/**
 * Physical device/session identity boundary for investigations. An
 * investigation is explicitly bound to the physical display whose evidence it
 * holds; current-session evidence must never silently cross to a different
 * physical unit. The strongest available identity is the browser's stable
 * per-authorization device id; without one, only a deterministic fingerprint
 * key exists — which identifies a *kind* of device, never proves the same
 * physical unit.
 */

export interface InvestigationDeviceBinding {
  /** Browser-stable id for a user-authorized device, when the transport exposes one. */
  readonly browserDeviceId?: string;
  readonly profileId: string | null;
  /** Deterministic fingerprint-shape key. Never interpreted as a MAC or unique hardware id. */
  readonly fingerprintKey: string;
}

/**
 * Deterministic key over the observable fingerprint shape. Includes observed
 * advertisement bytes as opaque material only — they are never parsed as a
 * MAC or promoted to a unique hardware identity.
 */
export function fingerprintIdentityKey(fingerprint: DeviceFingerprint): string {
  const services = fingerprint.services
    .map((service) => `${service.uuid}:${service.characteristics.map((characteristic) => characteristic.uuid).sort().join(",")}`)
    .sort()
    .join(";");
  return [
    fingerprint.transportKind,
    fingerprint.name ?? "",
    [...fingerprint.advertisedServices].sort().join(","),
    fingerprint.manufacturerDataHex ?? "",
    services,
  ].join("|");
}

export function deviceIdentityBinding(fingerprint: DeviceFingerprint | null, profileId: string | null): InvestigationDeviceBinding | null {
  if (!fingerprint) return null;
  return {
    ...(fingerprint.browserDeviceId ? { browserDeviceId: fingerprint.browserDeviceId } : {}),
    profileId,
    fingerprintKey: fingerprintIdentityKey(fingerprint),
  };
}

export type BindingComparison =
  /** Same browser-authorized device: strong evidence of the same physical unit. */
  | "same-authorized-device"
  /** Identical fingerprint shape but no browser device id on both sides; could be a different identical unit. */
  | "same-fingerprint-shape"
  | "different"
  /** One side has no binding at all. */
  | "unknown";

export function compareBindings(a: InvestigationDeviceBinding | null | undefined, b: InvestigationDeviceBinding | null | undefined): BindingComparison {
  if (!a || !b) return "unknown";
  if (a.browserDeviceId && b.browserDeviceId) return a.browserDeviceId === b.browserDeviceId ? "same-authorized-device" : "different";
  return a.fingerprintKey === b.fingerprintKey ? "same-fingerprint-shape" : "different";
}

/**
 * Whether an active investigation bound to `bound` may continue as the
 * CURRENT investigation (retaining current-session evidence) when the device
 * identified by `connected` connects. Only the browser-stable authorized
 * device id proves the same physical unit; a matching fingerprint shape can
 * be a different identical display and never carries evidence across.
 */
export function bindingAllowsSessionContinuity(bound: InvestigationDeviceBinding | null | undefined, connected: InvestigationDeviceBinding | null | undefined): boolean {
  return compareBindings(bound, connected) === "same-authorized-device";
}
