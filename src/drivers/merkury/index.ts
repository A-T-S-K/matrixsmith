import { packetHex } from "../../core/transmission";
import type { MatrixDriver } from "../types";
import {
  MERKURY_CODEC_ID,
  MERKURY_SOURCE_BASIS,
  merkuryReferenceProfile,
} from "../../profiles/merkury-reference";
import { encodeRgbBlocks } from "./codec";
import { MERKURY_ENDPOINT } from "./gatt";
export { MERKURY_ENDPOINT } from "./gatt";

export const merkuryRgbDriver: MatrixDriver = Object.freeze<MatrixDriver>({
  id: "merkury-rgb-reference",
  family: "Merkury MI-LNL62-999W source reference",
  contentCodecId: MERKURY_CODEC_ID,
  discoveryHints: () => ({ filters: [], optionalServices: [] }),
  match: () => ({
    driverId: "merkury-rgb-reference",
    score: 0,
    confidence: "none",
    reasons: [],
    contradictions: [],
  }),
  profiles: () => [merkuryReferenceProfile],
  resolveProfile: () => null,
  capabilities: () => [
    {
      id: "static-frame",
      label: "Offline RGB frame",
      supported: true,
      live: false,
      risk: "transient",
      persistence: "unknown",
      evidenceConfidence: "inferred",
      validation: "unverified",
      evidenceRefs: ["merkury-rgb-source"],
    },
  ],
  endpoints: () => [MERKURY_ENDPOINT],
  operations: () => [],
  familyProbes: () => [],
  probes: () => [],
  guidedTests: () => [],
  claimEvidence: () => [],
  plan(operation, context) {
    if (context.profile !== merkuryReferenceProfile)
      throw new Error(
        "Use the explicit reviewed offline reference definition.",
      );
    if (operation.type !== "ShowFrame")
      throw new Error(
        `Unsupported Merkury reference operation: ${operation.type}.`,
      );
    const blocks = encodeRgbBlocks(operation.frame);
    return {
      id: "offline:merkury-rgb-blocks",
      driverId: "merkury-rgb-reference",
      profileId: context.profile.id,
      operation,
      risk: "transient",
      persistence: "unknown",
      validation: "unverified",
      evidenceRefs: [...MERKURY_SOURCE_BASIS],
      packets: blocks.map((bytes, index) => ({
        index,
        endpoint: { ...MERKURY_ENDPOINT },
        writeMode: "with-response",
        bytes,
        hex: packetHex(bytes),
        delayAfterMs: 20,
      })),
      execution: "dry-run-only",
      purpose: "operation",
      responseExpectation: { type: "none" },
      timeoutMs: 1000,
      recoveryNotes: [
        "No hardware acceptance, receipt, retry or recovery contract established. Never automatically retry uncertain writes.",
      ],
      metadata: {
        codec: MERKURY_CODEC_ID,
        delivery: "eight-rgb-blocks",
        blockCount: 8,
        blockSize: 100,
        pixelPolicy:
          "Exact 16×16, row-major RGB bytes; no resize, gamma or brightness conversion.",
        consequence:
          "Source-scoped frame data only. Setup/finalization and continuous refresh omitted; rendering and persistence unknown.",
        pacingPolicy:
          "20 ms after every block from draw_file.py; draw_picture.py uses 25 ms and show_image.html uses 5 ms. No proven hardware timing rule.",
        writeModePolicy:
          "Offline with-response placeholder required by plan type. Python omits response selection; HTML uses writeValue. GATT properties and actual mode unknown.",
        acknowledgement: "unknown",
        persistenceBasis:
          "No storage command included; physical retention and power-cycle behavior unknown.",
      },
    };
  },
});
