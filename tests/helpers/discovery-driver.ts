import { syntheticDriver, lumenFrame } from "./synthetic-driver";
import type {
  MatrixDriver,
  DiscoveryMetadata,
  IdentificationResult,
} from "../../src/drivers/types";
import { packetHex, type TransmissionPlan } from "../../src/core/transmission";

/** Isolated reviewed SOFTWARE vectors. Never production definitions or physical evidence. */
export function discoveryDriver(
  id: string,
  opcode: number,
  options: {
    metadata?: Partial<DiscoveryMetadata>;
    plan?: (plan: TransmissionPlan) => TransmissionPlan;
    interpretation?: IdentificationResult;
    geometry?: boolean;
  } = {},
): MatrixDriver {
  return {
    ...syntheticDriver,
    id,
    family: `Software ${id}`,
    profiles: () => [],
    resolveProfile: () => null,
    match: (fingerprint) => ({
      ...syntheticDriver.match(fingerprint),
      driverId: id,
    }),
    diagnosticTools: () => [],
    familyProbes: (context) => {
      const original = syntheticDriver.familyProbes!(context)[0]!;
      return [
        {
          ...original,
          id: "info",
          safety: {
            hazard: "routine",
            persistence: "none",
            assurance: "verified",
          },
          establishesClaims: [],
          discovery: {
            available: true,
            question: `Is this software ${id}?`,
            distinguishes: [id],
            prerequisites: [],
            parameters: "fixed",
            consequence: "Read-only software vector; no physical evidence.",
            cost: { packets: 1, bytes: 4, elapsedMs: 130 },
            stopping: "identity",
            ...options.metadata,
          },
          plan: (context) => {
            const base = original.plan(context);
            const bytes = lumenFrame(opcode - 0x80);
            const expectation = base.responseExpectation;
            const plan: TransmissionPlan = {
              ...base,
              driverId: id,
              validation: "verified",
              id: `${id}:info`,
              packets: [{ ...base.packets[0]!, bytes, hex: packetHex(bytes) }],
              responseExpectation:
                expectation.type === "notification"
                  ? { ...expectation, opcode }
                  : expectation,
            };
            return options.plan?.(plan) ?? plan;
          },
          identify: ({ response }) =>
            options.interpretation ??
            (response?.family === `Software ${id}`
              ? {
                  matched: true,
                  confidence: "exact",
                  summary: `Software ${id} vector identified. Physical capabilities unverified.`,
                }
              : {
                  matched: false,
                  reason: "No correlated software vector; candidates remain.",
                }),
        },
      ];
    },
    decodeNotification: (bytes, context) => {
      if (
        bytes[1] !== opcode ||
        bytes.reduce((sum, byte) => sum ^ byte, 0) !== 0
      )
        return null;
      const normalized = bytes.slice();
      normalized[1] = 0x91;
      normalized[normalized.length - 1] = normalized
        .slice(0, -1)
        .reduce((sum, byte) => sum ^ byte, 0);
      const decoded = syntheticDriver.decodeNotification!(normalized, context);
      return decoded ? { ...decoded, family: `Software ${id}`, opcode } : null;
    },
    interpretGeometry: options.geometry
      ? (response) =>
          typeof response.fields.width === "number" &&
          typeof response.fields.height === "number"
            ? { width: response.fields.width, height: response.fields.height }
            : null
      : undefined,
  };
}
