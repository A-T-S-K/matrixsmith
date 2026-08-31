import type { Capability } from "../core/capabilities";
import type { SessionValidationResult, ValidationAreaId } from "./validation";

/**
 * Support-state vocabulary. "Unsupported" is reserved for areas with
 * evidence that the feature cannot work; work that simply has not been
 * performed is "Not tested" or "Unknown".
 */
export type SupportState =
  | "Verified"
  | "Experimental"
  | "Not tested"
  | "Unknown"
  | "Rejected"
  | "Unsupported"
  | "Out of scope";

export type SupportAreaId =
  | "bluetooth-transport"
  | "protocol-identity"
  | "device-state"
  | "brightness"
  | "persistence"
  | "static-frame"
  | "pixel-orientation"
  | "color-encoding"
  | "stored-programs"
  | "text-rendering"
  | "animation"
  | "gif"
  | "recovery";

export interface SupportArea {
  readonly id: SupportAreaId;
  readonly label: string;
  readonly state: SupportState;
  readonly evidence: string;
}

export interface SupportInput {
  readonly connected: boolean;
  readonly live: boolean;
  readonly resolvedDriverId: string | null;
  readonly capabilities: readonly Capability[];
  readonly validations: readonly SessionValidationResult[];
}

const AREA_LABELS: Readonly<Record<SupportAreaId, string>> = {
  "bluetooth-transport": "Bluetooth transport",
  "protocol-identity": "Protocol identity",
  "device-state": "Device state",
  brightness: "Brightness",
  persistence: "Persistence",
  "static-frame": "Static framebuffer",
  "pixel-orientation": "Pixel orientation",
  "color-encoding": "Color encoding",
  "stored-programs": "Stored programs",
  "text-rendering": "Text rendering",
  animation: "Animation",
  gif: "GIF",
  recovery: "Recovery",
};

function validationState(input: SupportInput, area: ValidationAreaId): { state: SupportState; evidence: string } | null {
  const rejecting = input.validations.find((validation) => validation.rejectedAreas.includes(area));
  if (rejecting) return { state: "Rejected", evidence: "Physical session validation failed for this area" };
  const validating = input.validations.find((validation) => validation.validatedAreas.includes(area));
  if (validating) return { state: "Verified", evidence: "Passed physical session validation" };
  return null;
}

function capabilityState(capability: Capability | undefined, hasDriver: boolean): { state: SupportState; evidence: string } {
  if (!hasDriver) return { state: "Unknown", evidence: "No resolved protocol driver" };
  if (!capability) return { state: "Not tested", evidence: "Not implemented for this driver yet" };
  if (capability.validation === "rejected") return { state: "Rejected", evidence: "Contradicting profile evidence" };
  if (capability.validation === "verified" && capability.live) return { state: "Verified", evidence: "Verified on this profile" };
  if (capability.validation === "experimental" || capability.validation === "verified") return { state: "Experimental", evidence: "Source-supported; not physically validated on this device" };
  return { state: "Not tested", evidence: "Not validated on this device" };
}

export function computeSupportMatrix(input: SupportInput): readonly SupportArea[] {
  const hasDriver = Boolean(input.resolvedDriverId);
  const capability = (id: Capability["id"]): Capability | undefined => input.capabilities.find((value) => value.id === id);
  const area = (id: SupportAreaId, state: SupportState, evidence: string): SupportArea => ({ id, label: AREA_LABELS[id], state, evidence });
  const contentArea = (id: SupportAreaId & ValidationAreaId, capabilityId: Capability["id"] | null): SupportArea => {
    const fromValidation = validationState(input, id);
    if (fromValidation) return area(id, fromValidation.state, fromValidation.evidence);
    if (!hasDriver) return area(id, "Unknown", "No resolved protocol driver");
    const cap = capabilityId ? capability(capabilityId) : undefined;
    if (capabilityId && !cap) return area(id, "Not tested", "Not implemented for this driver yet");
    return area(id, "Not tested", "Compiler ready; awaiting physical validation");
  };

  const staticValidated = validationState(input, "static-frame")?.state === "Verified";
  const rows: SupportArea[] = [
    area("bluetooth-transport", input.connected ? "Verified" : "Unknown", input.connected ? (input.live ? "Live GATT fingerprint captured" : "Imported GATT fingerprint") : "No active or imported device"),
    area("protocol-identity", hasDriver ? "Verified" : input.connected ? "Not tested" : "Unknown", hasDriver ? "Resolved by protocol evidence" : input.connected ? "Safe identification not run yet" : "No device evidence"),
    (() => { const s = capabilityState(capability("device-info"), hasDriver); return area("device-state", s.state, s.evidence); })(),
    (() => { const s = capabilityState(capability("brightness"), hasDriver); return area("brightness", s.state, s.evidence); })(),
    (() => {
      const fromValidation = validationState(input, "persistence");
      if (fromValidation) return area("persistence", fromValidation.state, fromValidation.evidence);
      if (staticValidated) return area("persistence", "Experimental", "Stored program accepted this session; long-term behavior unknown");
      return area("persistence", "Unknown", "Persistence behavior not established");
    })(),
    contentArea("static-frame", "static-frame"),
    contentArea("pixel-orientation", null),
    contentArea("color-encoding", null),
    (() => {
      const fromValidation = validationState(input, "stored-programs");
      if (fromValidation) return area("stored-programs", fromValidation.state, fromValidation.evidence);
      if (!hasDriver) return area("stored-programs", "Unknown", "No resolved protocol driver");
      return area("stored-programs", "Not tested", "Program compiler ready; awaiting physical validation");
    })(),
    (() => {
      const fromValidation = validationState(input, "text-rendering");
      if (fromValidation) return area("text-rendering", fromValidation.state, fromValidation.evidence);
      if (!hasDriver) return area("text-rendering", "Unknown", "No resolved protocol driver");
      if (staticValidated) return area("text-rendering", "Experimental", "Shares the validated static-frame pipeline");
      return area("text-rendering", "Not tested", "Rendered-text path awaits static-frame validation");
    })(),
    contentArea("animation", "animation"),
    (() => {
      const fromValidation = validationState(input, "gif");
      if (fromValidation) return area("gif", fromValidation.state, fromValidation.evidence);
      if (!hasDriver) return area("gif", "Unknown", "No resolved protocol driver");
      return area("gif", "Not tested", "Source-confirmed on other hardware only; untiled zone untested here");
    })(),
    area("recovery", "Unknown", "Manual hardware reset once restored default content; automatic restoration is not implemented or verified"),
  ];
  return rows;
}

/**
 * Deterministic next tests derived from the support matrix. Recommendations
 * advance the device-support state instead of repeating already-verified
 * checks forever.
 */
export function suggestNextTests(input: SupportInput): readonly string[] {
  if (!input.connected) return ["Connect a display and enumerate browser-authorized GATT services."];
  if (!input.resolvedDriverId) return ["Run safe protocol identification (verified read-only 0x1F device-info query)."];
  if (!input.live) return ["Reconnect the physical display to continue live validation; imported evidence stays read-only."];
  const matrix = computeSupportMatrix(input);
  const state = (id: SupportAreaId): SupportState => matrix.find((row) => row.id === id)?.state ?? "Unknown";
  if (state("brightness") !== "Verified") return ["Run the reversible brightness round-trip diagnostic."];
  if (state("static-frame") === "Not tested") return ["Validate static framebuffer with the guided orientation/color diagnostic (replaces stored display content)."];
  if (state("static-frame") === "Rejected") return ["Static-frame validation failed; capture an nRF Connect log of the upload and import it for correlation before retrying."];
  const suggestions: string[] = [];
  if (state("static-frame") === "Verified") {
    if (state("pixel-orientation") !== "Verified") suggestions.push("Re-run static-frame validation and answer the orientation questions.");
    if (state("color-encoding") !== "Verified") suggestions.push("Re-run static-frame validation and answer the color questions.");
    if (state("animation") === "Not tested") suggestions.push("Validate animation with the guided two-frame diagnostic (replaces stored display content).");
    if (state("animation") === "Verified" && state("gif") === "Not tested") suggestions.push("Validate GIF playback with a small local GIF (experimental; replaces stored display content).");
  }
  if (suggestions.length === 0) return ["No required diagnostic tests. Optionally refresh device info to confirm state."];
  return suggestions;
}
