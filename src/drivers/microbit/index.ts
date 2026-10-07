import { normalizeUuid } from "../../core/device";
import { packetHex } from "../../core/transmission";
import type { MatrixDriver } from "../types";
import {
  MICROBIT_CODEC_ID,
  MICROBIT_SOURCE_BASIS,
  microbitLedReference,
} from "../../profiles/microbit-led-reference";
import { encodeMatrixState } from "./codec";
export { LED_MATRIX_ENDPOINT as MICROBIT_LED_ENDPOINT } from "./gatt";
import { LED_MATRIX_ENDPOINT as MICROBIT_LED_ENDPOINT } from "./gatt";
export const microbitLedDriver: MatrixDriver = Object.freeze<MatrixDriver>({
  id: "microbit-led-reference",
  family: "micro:bit DAL LED service reference",
  contentCodecId: MICROBIT_CODEC_ID,
  discoveryHints: () => ({ filters: [], optionalServices: [] }),
  match(fingerprint) {
    const candidate =
      fingerprint.services.some(
        (s) => normalizeUuid(s.uuid) === MICROBIT_LED_ENDPOINT.serviceUuid,
      ) ||
      fingerprint.advertisedServices.some(
        (s) => normalizeUuid(s) === MICROBIT_LED_ENDPOINT.serviceUuid,
      );
    const named = /micro:bit/i.test(fingerprint.name ?? "");
    return {
      driverId: "microbit-led-reference",
      score: candidate ? 50 : named ? 20 : 0,
      confidence: candidate ? "candidate" : named ? "weak" : "none",
      reasons:
        candidate || named
          ? [
              "Name/service supplies candidate evidence only; board generation, firmware and service availability remain unproven.",
            ]
          : [],
      contradictions: [],
    };
  },
  profiles: () => [microbitLedReference],
  resolveProfile: () => null,
  capabilities: () => [
    {
      id: "static-frame",
      label: "Offline binary matrix",
      supported: true,
      live: false,
      risk: "transient",
      persistence: "unknown",
      evidenceConfidence: "inferred",
      validation: "unverified",
      evidenceRefs: ["microbit-led-source"],
    },
  ],
  endpoints: () => [MICROBIT_LED_ENDPOINT],
  operations: () => [],
  familyProbes: () => [],
  probes: () => [],
  guidedTests: () => [],
  claimEvidence: () => [],
  plan(operation, context) {
    if (context.profile !== microbitLedReference)
      throw new Error(
        "Use the explicit reviewed offline reference definition.",
      );
    if (operation.type !== "ShowFrame")
      throw new Error(
        `Unsupported micro:bit reference operation: ${operation.type}.`,
      );
    const frame = operation.frame;
    if (frame.width !== 5 || frame.height !== 5 || frame.data.length !== 75)
      throw new RangeError("Only an exact 5×5 RGB framebuffer is supported.");
    for (let i = 0; i < 75; i += 3) {
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
    const pixels = new Uint8Array(25);
    for (let i = 0; i < 25; i++) pixels[i] = frame.data[i * 3] === 255 ? 1 : 0;
    const bytes = encodeMatrixState({ width: 5, height: 5, pixels });
    return {
      id: "offline:microbit-led-matrix",
      driverId: "microbit-led-reference",
      profileId: context.profile.id,
      operation,
      risk: "transient",
      persistence: "unknown",
      validation: "unverified",
      evidenceRefs: [...MICROBIT_SOURCE_BASIS],
      packets: [
        {
          index: 0,
          endpoint: MICROBIT_LED_ENDPOINT,
          writeMode: "with-response",
          bytes,
          hex: packetHex(bytes),
        },
      ],
      execution: "dry-run-only",
      purpose: "operation",
      responseExpectation: { type: "none" },
      timeoutMs: 1000,
      recoveryNotes: [
        "No live timing, acceptance, readback or recovery contract is established.",
      ],
      metadata: {
        codec: MICROBIT_CODEC_ID,
        delivery: "direct-characteristic-value",
        valueSize: 5,
        consequence:
          "Pinned DAL stops display animation and replaces all 25 image pixels. Physical acceptance and power-cycle behavior unknown.",
        conversionPolicy:
          "Exact binary black/white; rows top to bottom, left pixel bit 4; unused bits 7–5 zero.",
        persistenceBasis:
          "Pinned callback mutates the display image; no storage operation in this path. Other firmware and power-cycle behavior unknown.",
        timing: "unknown",
        acknowledgement: "unknown",
        writeModePolicy:
          "With-response model from the pinned WRITE property; no device or protocol receipt established.",
      },
    };
  },
});
