import { normalizeUuid } from "../../core/device";
import type { DeviceFingerprint } from "../../core/device";
import { packetHex } from "../../core/transmission";
import type { MatrixDriver } from "../types";
import {
  LSLED_CODEC_ID,
  LSLED_SOURCE_BASIS,
  lsledLegacyReference,
} from "../../profiles/lsled-legacy-reference";
import { encodeLegacyBitmap } from "./codec";
export const LSLED_ENDPOINT = Object.freeze({
  serviceUuid: normalizeUuid("fee0"),
  characteristicUuid: normalizeUuid("fee1"),
});
export function matchLegacy(fingerprint: DeviceFingerprint) {
  const reasons: string[] = [];
  const contradictions: string[] = [];
  const named =
    fingerprint.name === "LSLED" || fingerprint.name === "LED Badge Magic";
  if (named)
    reasons.push(
      "Name appears in source notes; firmware, chipset and compatibility remain unknown.",
    );
  const service = fingerprint.services.find(
    (s) => normalizeUuid(s.uuid) === LSLED_ENDPOINT.serviceUuid,
  );
  const characteristic = service?.characteristics.find(
    (c) => normalizeUuid(c.uuid) === LSLED_ENDPOINT.characteristicUuid,
  );
  const advertised = fingerprint.advertisedServices.some(
    (s) => normalizeUuid(s) === LSLED_ENDPOINT.serviceUuid,
  );
  if (advertised || service)
    reasons.push(
      "Shared FEE0 service is candidate evidence for OEM/open legacy, not authenticated identity.",
    );
  if (characteristic) {
    if (!characteristic.properties.write)
      contradictions.push("Observed FEE1 lacks the documented Write property.");
    if (characteristic.properties.read && characteristic.properties.notify)
      reasons.push(
        "Read/Write/Notify resembles documented OEM legacy properties; response semantics remain unknown.",
      );
    else if (
      !characteristic.properties.read &&
      !characteristic.properties.notify
    )
      reasons.push(
        "Write-only resembles documented open legacy; this does not establish firmware identity.",
      );
    else
      contradictions.push(
        "Observed Read/Notify combination differs from both documented legacy shapes.",
      );
  } else
    reasons.push(
      "FEE1 properties are missing evidence; absence is not a protocol contradiction.",
    );
  if (
    fingerprint.services.some(
      (s) => normalizeUuid(s.uuid) === normalizeUuid("f055"),
    ) ||
    fingerprint.advertisedServices.some(
      (s) => normalizeUuid(s) === normalizeUuid("f055"),
    )
  )
    reasons.push(
      "F055 is separate open next-gen evidence; no next-gen operation is implemented.",
    );
  return {
    driverId: "lsled-legacy",
    score: contradictions.length
      ? 0
      : characteristic
        ? 50
        : named || advertised || service
          ? 20
          : 0,
    confidence: contradictions.length
      ? ("none" as const)
      : characteristic
        ? ("candidate" as const)
        : named || advertised || service
          ? ("weak" as const)
          : ("none" as const),
    reasons,
    contradictions,
  };
}
export const lsledLegacyDriver: MatrixDriver = Object.freeze<MatrixDriver>({
  id: "lsled-legacy",
  family: "LSLED / Badge Magic legacy monochrome",
  contentCodecId: LSLED_CODEC_ID,
  discoveryHints: () => ({ filters: [], optionalServices: [] }),
  match: matchLegacy,
  profiles: () => [lsledLegacyReference],
  resolveProfile: () => null,
  capabilities: () => [
    {
      id: "static-frame",
      label: "Offline monochrome frame",
      supported: true,
      live: false,
      risk: "persistent",
      persistence: "unknown",
      evidenceConfidence: "inferred",
      validation: "unverified",
      evidenceRefs: ["lsled-layout-source"],
    },
  ],
  endpoints: () => [LSLED_ENDPOINT],
  operations: () => [],
  familyProbes: () => [],
  probes: () => [],
  guidedTests: () => [],
  claimEvidence: () => [],
  plan(operation, context) {
    if (context.profile !== lsledLegacyReference)
      throw new Error(
        "Use the explicit reviewed offline reference definition.",
      );
    if (operation.type !== "ShowFrame")
      throw new Error(`Unsupported LSLED legacy operation: ${operation.type}.`);
    const frame = operation.frame;
    if (frame.width !== 44 || frame.height !== 11 || frame.data.length !== 1452)
      throw new RangeError("Only an exact 44×11 RGB framebuffer is supported.");
    for (let i = 0; i < frame.data.length; i += 3) {
      const value = frame.data[i];
      if (
        (value !== 0 && value !== 255) ||
        frame.data[i + 1] !== value ||
        frame.data[i + 2] !== value
      )
        throw new RangeError(
          "ShowFrame requires exact black/white pixels; no implicit conversion.",
        );
    }
    const pixels = new Uint8Array(484);
    for (let i = 0; i < 484; i++) pixels[i] = frame.data[i * 3] === 255 ? 1 : 0;
    const program = encodeLegacyBitmap({ width: 44, height: 11, pixels });
    return {
      id: "offline:lsled-legacy",
      driverId: "lsled-legacy",
      profileId: context.profile.id,
      operation,
      risk: "persistent",
      persistence: "unknown",
      validation: "unverified",
      evidenceRefs: [...LSLED_SOURCE_BASIS],
      packets: program.packets.map((bytes, index) => ({
        index,
        endpoint: LSLED_ENDPOINT,
        writeMode: "with-response",
        bytes,
        hex: packetHex(bytes),
      })),
      execution: "dry-run-only",
      purpose: "operation",
      responseExpectation: { type: "none" },
      timeoutMs: 1000,
      recoveryNotes: [
        "No live recovery, probe, acknowledgement or timing contract is established.",
      ],
      metadata: {
        codec: LSLED_CODEC_ID,
        headerSize: program.headerSize,
        bitmapSize: program.bitmapSize,
        programSize: program.programSize,
        paddingSize: program.paddingSize,
        timestampPolicy: program.timestampPolicy,
        consequence:
          "Modeled program replacement; persistence and rendering unknown.",
        conversionPolicy:
          "Exact binary black/white; four unused low bits per final group row are zero.",
        timing: "unknown",
        acknowledgement: "unknown",
        writeModePolicy:
          "Offline with-response model; not a protocol acknowledgement.",
      },
    };
  },
});
