import type { Capability } from "../../core/capabilities";
import type { DeviceFingerprint, DeviceProfile } from "../../core/device";
import type { MatrixOperation } from "../../core/operations";
import { createPlanId, packetHex, type TransmissionPlan } from "../../core/transmission";
import { ILEDHAT_PROFILE_ID, iledHat31aeProfile } from "../../profiles/iledhat-31ae-32x16";
import { ILEDHAT_SIGNATURE, matchesKnownProfile } from "../../profiles/known-profiles";
import { COOLLED_ENDPOINT, COOLLED_SERVICE_UUID } from "../coolled/common/gatt";
import { notificationMatchesExpectation, type DriverContext, type MatrixDriver } from "../types";
import { matchCoolLedUx } from "./matcher";
import { decodeCoolLedUxNotification } from "./notifications";
import { COOLLEDUX_OPCODES, encodeBrightness, encodeDeviceInfoQuery, encodePower } from "./protocol";
import { compileAnimation, compileAnimationStaticFrame, compileGif, compileGraffitiFrame, type CompiledProgram } from "./content";
import { diagnosticContent, type BuiltDiagnosticContent } from "./diagnostics";
import type { DiagnosticRegion } from "../../investigation/regions";
import { coolLedUxGuidedTests } from "./guided-tests";
import { coolLedUxCorePlan } from "./core-plan";
import { coolLedUxBaselineClaimEvidence } from "./claims";
import type { RasterStrategy } from "../../core/raster-strategy";
import type { Framebuffer } from "../../render/framebuffer";

export const coolLedUxDriver: MatrixDriver = {
  id: "coolledux", family: "CoolLEDUX",
  // 0x31AE is the observed iLedHat company identifier; requesting it lets the
  // browser expose that manufacturer data without narrowing the chooser.
  discoveryHints: () => ({ filters: [{ services: [COOLLED_SERVICE_UUID] }], optionalServices: [COOLLED_SERVICE_UUID], optionalManufacturerData: [0x31ae] }),
  match: matchCoolLedUx, profiles: () => [iledHat31aeProfile], resolveProfile: resolveIledHatProfile,
  capabilities: coolLedUxCapabilities, endpoints: () => [COOLLED_ENDPOINT],
  probes: () => [{
    id: "get-device-info", label: "Identify CoolLEDUX with device info", risk: "read-only", persistence: "none", validation: "verified",
    plan: (context) => createCoolLedUxPlan({ type: "GetDeviceInfo" }, context, "probe"),
    interpret: (notification) => notification.family === "CoolLEDUX" && notification.kind === "device-info" && notification.opcode === COOLLEDUX_OPCODES.deviceInfo
      ? { matched: true, confidence: "exact", summary: "Valid structured 0x1F device-info response identifies CoolLEDUX for this session." } : null,
  }],
  plan: (operation, context) => createCoolLedUxPlan(operation, context),
  decodeNotification: decodeCoolLedUxNotification,
  responseMatches: notificationMatchesExpectation,
  guidedTests: coolLedUxGuidedTests,
  corePlan: coolLedUxCorePlan,
  diagnosticRegions: coolLedUxDiagnosticRegions,
  claimEvidence: coolLedUxBaselineClaimEvidence,
};

/**
 * The characterized profile, when the fingerprint actually identifies it.
 *
 * Delegated to the shared known-profile evaluation so that the rule which
 * selects the profile and the rule which resolves the protocol family cannot
 * drift apart — and so any explicit contradiction (wrong geometry, wrong
 * manufacturer, wrong characteristic properties) withdraws both at once.
 */
function resolveIledHatProfile(fingerprint: DeviceFingerprint): DeviceProfile | null {
  return matchesKnownProfile(ILEDHAT_SIGNATURE, fingerprint) ? iledHat31aeProfile : null;
}

/**
 * What this driver can do for a profile, at the confidence the evidence
 * actually supports.
 *
 * Presenting every stored-program path as generically "experimental" was
 * accurate while nothing had been measured. On the characterized iLedHat it
 * understates what is known: the static substrate, its encoder and the
 * animation path were all physically verified. It would be equally wrong to
 * overstate — an image and a line of text ride on a verified substrate, but
 * neither has been looked at on the panel, so they are marked as resting on
 * verified prerequisites rather than as directly demonstrated.
 */
export function coolLedUxCapabilities(profile: DeviceProfile): readonly Capability[] {
  const exact = profile.id === ILEDHAT_PROFILE_ID;
  const characterized = exact && profile.quirks?.preferredRasterStrategy !== undefined && profile.quirks.preferredRasterStrategy !== "unresolved";
  const iledHatRefs = ["iledhat-physical-2026-09-01"];
  const persistent = { risk: "persistent" as const, persistence: "persistent" as const };
  // Directly demonstrated on the panel: the substrate itself.
  const demonstrated = characterized
    ? { evidenceConfidence: "observed" as const, validation: "verified" as const, evidenceRefs: [...iledHatRefs, "coolledux-ble@4f5656d"] }
    : { evidenceConfidence: "corroborated" as const, validation: "experimental" as const, evidenceRefs: ["coolledux-ble@4f5656d"] };
  // Rides on that substrate; not itself smoke-tested on the panel yet.
  const viaSubstrate = characterized
    ? { evidenceConfidence: "corroborated" as const, validation: "verified" as const, evidenceRefs: [...iledHatRefs, "coolledux-ble@4f5656d"] }
    : { evidenceConfidence: "corroborated" as const, validation: "experimental" as const, evidenceRefs: ["coolledux-ble@4f5656d"] };
  return [
    { id: "device-info", label: "Device information", supported: true, live: exact, risk: "read-only", persistence: "none", evidenceConfidence: "observed", validation: exact ? "verified" : "experimental", evidenceRefs: ["iledhat-coolledux-probe", "coolledux-ble@4f5656d"] },
    { id: "brightness", label: "Brightness", supported: true, live: exact, risk: "transient", persistence: "unknown", evidenceConfidence: "corroborated", validation: exact ? "verified" : "experimental", evidenceRefs: ["iledhat-coolledux-brightness", "coolledux-ble@4f5656d"] },
    // Untested on this panel and unchanged: source-confirmed upstream only.
    { id: "power", label: "Power", supported: true, live: false, risk: "transient", persistence: "unknown", evidenceConfidence: "corroborated", validation: "experimental", evidenceRefs: ["coolledux-ble@4f5656d"] },
    { id: "static-frame", label: characterized ? "Static frame (verified one-frame Animation route)" : "Static frame (stored program)", supported: true, live: exact, ...persistent, ...demonstrated },
    { id: "animation", label: "Animation (stored program)", supported: true, live: exact, ...persistent, ...demonstrated },
    { id: "text", label: characterized ? "Rendered text (via the verified static route)" : "Rendered text (stored program)", supported: true, live: exact, ...persistent, ...viaSubstrate },
    // GIF depends on a decoder this panel has never been observed running.
    { id: "gif", label: "GIF (stored program)", supported: true, live: exact, ...persistent, evidenceConfidence: "corroborated", validation: "experimental", evidenceRefs: ["coolledux-ble@4f5656d"] },
  ];
}

export function createCoolLedUxPlan(operation: MatrixOperation, context: DriverContext, purpose: "operation" | "probe" = "operation"): TransmissionPlan {
  if (context.profile.driverId !== "coolledux") throw new Error("CoolLEDUX cannot plan for a profile owned by another driver.");
  if (operation.type === "ShowFrame" || operation.type === "ShowAnimation" || operation.type === "ShowText" || operation.type === "ShowScrollingText" || operation.type === "ShowGif" || operation.type === "ShowDiagnostic") {
    return createContentPlan(operation, context);
  }
  let bytes: Uint8Array;
  let risk: TransmissionPlan["risk"] = "transient";
  let persistence: TransmissionPlan["persistence"] = "unknown";
  let validation: TransmissionPlan["validation"] = "unverified";
  let execution: TransmissionPlan["execution"] = "dry-run-only";
  let responseExpectation: TransmissionPlan["responseExpectation"] = { type: "none" };
  switch (operation.type) {
    case "GetDeviceInfo":
      bytes = encodeDeviceInfoQuery(); risk = "read-only"; persistence = "none"; validation = "verified"; execution = "live";
      responseExpectation = { type: "notification", kind: "device-info", opcode: COOLLEDUX_OPCODES.deviceInfo, required: true, timeoutMs: 1500, fulfillsOperation: true };
      break;
    case "SetBrightness":
      bytes = encodeBrightness(operation.raw); validation = "verified"; execution = "live";
      responseExpectation = { type: "notification", kind: "command-echo", opcode: COOLLEDUX_OPCODES.brightness, required: true, timeoutMs: 1500, fulfillsOperation: false };
      break;
    case "SetPower": bytes = encodePower(operation.on); validation = "experimental"; break;
    default: throw new Error(`${operation.type} is outside the CoolLEDUX direct-command scope of this branch.`);
  }
  const packet = { index: 0, endpoint: COOLLED_ENDPOINT, writeMode: "without-response" as const, bytes, hex: packetHex(bytes) };
  return Object.freeze({
    id: createPlanId(purpose === "probe" ? "coolledux-probe" : "coolledux"), driverId: "coolledux", profileId: context.profile.id, operation,
    risk, persistence, validation, execution, purpose, evidenceRefs: ["coolledux-ble@4f5656d", ...(context.profile.id === ILEDHAT_PROFILE_ID ? ["iledhat-nrf-2026-08-31"] : [])],
    packets: Object.freeze([packet]), ackPolicy: "none", responseExpectation,
    retryPolicy: { maxAttempts: 1, retryOn: [] }, timeoutMs: 5000,
    recoveryNotes: ["No automatic retry is enabled.", "Power and mirror remain dry-run-only on this exact hardware."],
    metadata: { family: "CoolLEDUX", dryRunOnly: execution === "dry-run-only" },
  });
}

/**
 * Stored-program content plans. All content replaces the device's stored
 * display program: risk and persistence are declared honestly as persistent,
 * and the safety policy requires an explicit per-plan confirmation plus the
 * experimental session unlock before live transmission. Dimensions always
 * come from the profile; nothing assumes 64x16 or a global 32x16.
 */
/**
 * Which strategy a static raster is delivered through.
 *
 * Precedence, strongest first:
 *
 *   1. a strategy this session physically validated,
 *   2. the profile's own preferred strategy, once its evidence resolved one,
 *   3. Graffiti, the upstream default, for profiles with no preference.
 *
 * Step 2 is the one that was missing. Falling straight through to Graffiti
 * meant a panel whose profile says "Graffiti physically does not hold a still
 * image here, use one-frame Animation" still had every normal image and every
 * line of text compiled through Graffiti until somebody re-ran the guided
 * characterization. A profile fact is not worth shipping if normal use does
 * not consult it.
 */
function selectStaticStrategy(context: DriverContext): RasterStrategy {
  if (context.rasterStrategy) return context.rasterStrategy;
  const preferred = context.profile.quirks?.preferredRasterStrategy;
  if (preferred && preferred !== "unresolved") return preferred;
  return "graffiti";
}

/**
 * How a logical black pixel is written on the Graffiti path.
 *
 * Session evidence wins, then the profile's own observed semantics, then the
 * conservative inherited 0x0004 workaround. Requiring a current-session
 * observation to use a fact the profile already ships meant a characterized
 * panel had the workaround applied to it anyway — writing a visibly dim blue
 * where the user asked for black.
 */
function graffitiBlackFor(context: DriverContext): import("../../core/quirks").BlackSemantics | null {
  return context.resolvedBehavior?.graffitiBlack ?? context.profile.quirks?.graffitiBlack ?? null;
}

function compileStaticRaster(frame: Framebuffer, context: DriverContext): { compiled: CompiledProgram; strategy: RasterStrategy } {
  const selected = selectStaticStrategy(context);
  switch (selected) {
    case "animation-single-frame": return { compiled: compileAnimationStaticFrame(frame, "single"), strategy: selected };
    case "animation-identical-frames": return { compiled: compileAnimationStaticFrame(frame, "identical-pair"), strategy: selected };
    case "graffiti": return { compiled: compileGraffitiFrame(frame, undefined, {}, graffitiBlackFor(context)), strategy: selected };
  }
}

function createContentPlan(operation: Extract<MatrixOperation, { type: "ShowFrame" | "ShowAnimation" | "ShowText" | "ShowScrollingText" | "ShowGif" | "ShowDiagnostic" }>, context: DriverContext): TransmissionPlan {
  const { profile } = context;
  let compiled: CompiledProgram;
  let contentType: string;
  let frameCount = 1;
  let rasterStrategyUsed: RasterStrategy | null = null;
  let diagnostic: BuiltDiagnosticContent | null = null;
  let diagnosticId: string | null = null;
  switch (operation.type) {
    case "ShowFrame": {
      assertGeometry(operation.frame.width, operation.frame.height, profile);
      const routed = compileStaticRaster(operation.frame, context);
      compiled = routed.compiled;
      rasterStrategyUsed = routed.strategy;
      contentType = routed.strategy === "graffiti" ? "graffiti" : "animation";
      frameCount = routed.strategy === "animation-identical-frames" ? 2 : 1;
      break;
    }
    case "ShowText": {
      if (!operation.frame) throw new Error("ShowText needs a locally rendered Framebuffer; the native text content path is not the primary route.");
      assertGeometry(operation.frame.width, operation.frame.height, profile);
      const routed = compileStaticRaster(operation.frame, context);
      compiled = routed.compiled;
      rasterStrategyUsed = routed.strategy;
      contentType = "text";
      frameCount = routed.strategy === "animation-identical-frames" ? 2 : 1;
      break;
    }
    case "ShowAnimation":
      assertGeometry(operation.sequence.width, operation.sequence.height, profile);
      compiled = compileAnimation(operation.sequence);
      contentType = "animation";
      frameCount = operation.sequence.frames.length;
      break;
    case "ShowScrollingText":
      assertGeometry(operation.sequence.width, operation.sequence.height, profile);
      compiled = compileAnimation(operation.sequence);
      contentType = "text";
      frameCount = operation.sequence.frames.length;
      break;
    case "ShowGif":
      if (operation.width > profile.width || operation.height > profile.height) throw new Error(`GIF canvas ${operation.width}×${operation.height} exceeds the ${profile.width}×${profile.height} profile.`);
      compiled = compileGif(operation.gifBytes, operation.width, operation.height);
      contentType = "gif";
      break;
    case "ShowDiagnostic": {
      const definition = diagnosticContent(operation.diagnosticId);
      diagnostic = definition.build(profile, operation.parameters);
      diagnosticId = definition.id;
      compiled = diagnostic.compiled;
      contentType = diagnostic.contentType;
      frameCount = diagnostic.frameCount;
      break;
    }
  }
  const packets = compiled.packets.map((bytes, index) => ({
    index, endpoint: COOLLED_ENDPOINT, writeMode: "without-response" as const, bytes, hex: packetHex(bytes),
    // Pacing metadata only; the executor owns timing.
    delayAfterMs: compiled.pacingMs,
  }));
  return Object.freeze({
    id: createPlanId("coolledux-content"), driverId: "coolledux", profileId: profile.id, operation,
    risk: "persistent" as const, persistence: "persistent" as const, validation: "experimental" as const,
    execution: "live" as const, purpose: "operation" as const,
    evidenceRefs: ["coolledux-ble@4f5656d", ...(profile.id === ILEDHAT_PROFILE_ID ? ["iledhat-nrf-2026-08-31"] : [])],
    packets: Object.freeze(packets), ackPolicy: "none" as const,
    responseExpectation: { type: "none" as const },
    retryPolicy: { maxAttempts: 1, retryOn: [] }, timeoutMs: 15000,
    recoveryNotes: [
      "This replaces the stored display program.",
      "The hardware reset path has been observed to restore factory content; automatic restoration is not implemented or verified.",
    ],
    metadata: {
      family: "CoolLEDUX", dryRunOnly: false, contentType,
      programBytes: compiled.programBytes.length,
      crc32: `0x${compiled.crc32.toString(16).padStart(8, "0").toUpperCase()}`,
      compressedBytes: compiled.compressedBytes.length,
      compression: compiled.compression,
      chunkCount: compiled.chunks.length,
      tileCount: compiled.tileCount,
      tileWidth: compiled.tileWidth,
      pacingMs: compiled.pacingMs,
      frameCount,
      width: operation.type === "ShowGif" ? operation.width : operation.type === "ShowAnimation" || operation.type === "ShowScrollingText" ? operation.sequence.width : operation.type === "ShowDiagnostic" ? profile.width : operation.frame!.width,
      height: operation.type === "ShowGif" ? operation.height : operation.type === "ShowAnimation" || operation.type === "ShowScrollingText" ? operation.sequence.height : operation.type === "ShowDiagnostic" ? profile.height : operation.frame!.height,
      ...(operation.type === "ShowScrollingText" ? { textBackend: operation.backend } : {}),
      ...(rasterStrategyUsed ? { rasterStrategy: rasterStrategyUsed } : {}),
      ...(diagnosticId ? { diagnosticId } : {}),
      ...(diagnostic?.playback ? { graffitiMode: diagnostic.playback.mode, graffitiSpeed: diagnostic.playback.speed, graffitiStayTime: diagnostic.playback.stayTime } : {}),
    },
  });
}

function assertGeometry(width: number, height: number, profile: DeviceProfile): void {
  if (width !== profile.width || height !== profile.height) {
    throw new Error(`Content is ${width}×${height} but the ${profile.id} profile is ${profile.width}×${profile.height}. Content builders must derive dimensions from the DeviceProfile.`);
  }
}

/** The labelled zones of a diagnostic operation, or none for other operations. */
function coolLedUxDiagnosticRegions(operation: MatrixOperation, profile: DeviceProfile): readonly DiagnosticRegion[] {
  if (operation.type !== "ShowDiagnostic") return [];
  try { return diagnosticContent(operation.diagnosticId).build(profile, operation.parameters).regions; }
  catch { return []; }
}
