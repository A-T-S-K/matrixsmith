import type { GuidedTestDefinition } from "../../src/investigation/tests";
import type { DeviceFingerprint, DeviceProfile } from "../../src/core/device";
import { packetHex, type TransmissionPlan } from "../../src/core/transmission";
import type { MatrixOperation } from "../../src/core/operations";
import {
  describeCapabilityOperation,
  notificationMatchesExpectation,
  type MatrixDriver,
} from "../../src/drivers/types";

/** Authored software vectors only. Never a production driver or hardware evidence. */
export const SYNTHETIC_SERVICE = "76000000-5f64-4000-8000-000000000001";
export const SYNTHETIC_COMMAND = "76000000-5f64-4000-8000-000000000002";
export const SYNTHETIC_NOTIFY = "76000000-5f64-4000-8000-000000000003";
export const syntheticProfile: DeviceProfile = {
  id: "test-lumen-24x8",
  name: "Synthetic Lumen 24×8",
  driverId: "test-lumen",
  width: 24,
  height: 8,
  validation: "experimental",
  evidence: [
    {
      id: "authored-lumen-vectors",
      summary: "Deterministic test data; no physical verification.",
      confidence: "inferred",
      source: "tests/helpers/synthetic-driver.ts",
    },
  ],
  metadata: { synthetic: true },
};

export function syntheticFingerprint(known = false): DeviceFingerprint {
  return {
    schemaVersion: 1,
    transportKind: "fake",
    browserDeviceId: "synthetic-only",
    name: known ? syntheticProfile.name : "Synthetic unknown panel",
    advertisedServices: [SYNTHETIC_SERVICE],
    services: [
      {
        uuid: SYNTHETIC_SERVICE,
        isPrimary: true,
        characteristics: [
          {
            uuid: SYNTHETIC_COMMAND,
            properties: {
              read: false,
              notify: false,
              indicate: false,
              write: true,
              writeWithoutResponse: false,
            },
          },
          {
            uuid: SYNTHETIC_NOTIFY,
            properties: {
              read: false,
              notify: true,
              indicate: false,
              write: false,
              writeWithoutResponse: false,
            },
          },
        ],
      },
    ],
    evidenceRefs: ["authored-lumen-vectors"],
    notes: ["Synthetic test fixture. No Bluetooth hardware was used."],
  };
}

/** A7 | opcode | payload-length | payload | XOR of all preceding bytes. */
export function lumenFrame(
  opcode: number,
  payload: readonly number[] = [],
): Uint8Array {
  const prefix = [0xa7, opcode, payload.length, ...payload];
  return Uint8Array.from([
    ...prefix,
    prefix.reduce((sum, byte) => sum ^ byte, 0),
  ]);
}

function queryPlan(
  profileId: string,
  purpose: TransmissionPlan["purpose"],
): TransmissionPlan {
  const bytes = lumenFrame(0x11);
  return Object.freeze({
    id: `test-lumen:${purpose}`,
    driverId: "test-lumen",
    profileId,
    operation: { type: "GetDeviceInfo" },
    risk: "read-only",
    persistence: "none",
    validation: "experimental",
    evidenceRefs: ["authored-lumen-vectors"],
    packets: [
      {
        index: 0,
        endpoint: {
          serviceUuid: SYNTHETIC_SERVICE,
          characteristicUuid: SYNTHETIC_COMMAND,
        },
        writeMode: "with-response",
        bytes,
        hex: packetHex(bytes),
      },
    ],
    responseExpectation: {
      type: "notification",
      required: true,
      timeoutMs: 30,
      opcode: 0x91,
      kind: "device-info",
      fulfillsOperation: true,
    },
    execution: "live",
    purpose,
    timeoutMs: 100,
    recoveryNotes: ["No automatic retry; all responses are synthetic."],
    metadata: { synthetic: true },
  } satisfies TransmissionPlan);
}

export const syntheticQueryTest: GuidedTestDefinition = {
  id: "lumen-read-info",
  driverId: "test-lumen",
  title: "Read Synthetic Lumen information",
  category: "core",
  targetClaims: ["device-info.query"],
  prerequisites: [],
  requiresCompletedTests: [],
  risk: "read-only",
  persistence: "none",
  consequence: "Runs a read-only query. Stored display content is unchanged.",
  operation: { type: "GetDeviceInfo" },
  about: {
    question: "Does the registered synthetic query receive a response?",
    whyRelevant: "Exercise query execution without physical verification.",
    whatMatrixSmithDoes:
      "Send one bounded authored query and record its response.",
    whatChangesOnDevice: "No stored display content changes.",
    estimatedObservationTime: "No physical observation is inferred.",
    possibleOutcomes: [
      {
        outcome: "Response recorded",
        learns: "Software correlation only; no physical verification.",
      },
    ],
    observeInstructions:
      "Review the recorded query. No physical capability has been verified.",
    technicalDetails: [
      "Requires explicit per-session experimental permission.",
    ],
  },
  observation: [],
  showRegionDiagram: false,
  interpret: () => ({
    status: "inconclusive",
    established: [],
    rejected: [],
    unknowns: ["Physical behavior remains unverified."],
    summary: "Read-only query execution recorded; software evidence only.",
    claimUpdates: [],
  }),
};

export const syntheticDriver: MatrixDriver = {
  id: "test-lumen",
  family: "Synthetic Lumen",
  // No counterfeit protocol.coolledux evidence. The current claim vocabulary
  // has no Lumen family fact; family identity is held by protocolResolution.
  discoveryHints: () => ({
    filters: [{ services: [SYNTHETIC_SERVICE] }],
    optionalServices: [SYNTHETIC_SERVICE],
  }),
  match: (fingerprint) => {
    const service = fingerprint.services.find(
      ({ uuid }) => uuid === SYNTHETIC_SERVICE,
    );
    const command = service?.characteristics.find(
      ({ uuid }) => uuid === SYNTHETIC_COMMAND,
    );
    const contradictions =
      command && !command.properties.write
        ? ["Synthetic command endpoint must support write-with-response."]
        : [];
    const candidate = Boolean(
      service && command && contradictions.length === 0,
    );
    return {
      driverId: "test-lumen",
      score: candidate ? 60 : 0,
      confidence: candidate ? "candidate" : "none",
      reasons: candidate
        ? [
            "Distinct authored service and command endpoint; protocol still needs a probe.",
          ]
        : [],
      contradictions,
    };
  },
  profiles: () => [syntheticProfile],
  resolveProfile: (fingerprint) =>
    fingerprint.name === syntheticProfile.name &&
    syntheticDriver.match(fingerprint).score > 0 &&
    (!fingerprint.manuallyConfirmedGeometry ||
      (fingerprint.manuallyConfirmedGeometry.width === 24 &&
        fingerprint.manuallyConfirmedGeometry.height === 8))
      ? syntheticProfile
      : null,
  capabilities: () => [
    {
      id: "device-info",
      label: "Read synthetic device information",
      supported: true,
      live: true,
      risk: "read-only",
      persistence: "none",
      evidenceConfidence: "inferred",
      validation: "experimental",
      evidenceRefs: ["authored-lumen-vectors"],
    },
    {
      id: "brightness",
      label: "Brightness",
      supported: false,
      live: false,
      risk: "transient",
      persistence: "volatile",
      evidenceConfidence: "unknown",
      validation: "unverified",
      evidenceRefs: [],
    },
  ],
  endpoints: () => [
    { serviceUuid: SYNTHETIC_SERVICE, characteristicUuid: SYNTHETIC_COMMAND },
    { serviceUuid: SYNTHETIC_SERVICE, characteristicUuid: SYNTHETIC_NOTIFY },
  ],
  operations: (context) => [
    describeCapabilityOperation(context, {
      id: "capability:device-info",
      operationId: "GetDeviceInfo",
      label: "Read device information",
      capabilityId: "device-info",
    }),
  ],
  familyProbes: () => [
    {
      id: "lumen-info",
      label: "Identify Synthetic Lumen",
      safety: {
        hazard: "experimental",
        persistence: "none",
        assurance: "experimental",
      },
      establishesClaims: ["transport.bluetooth", "device-info.query"],
      plan: () => queryPlan("protocol-candidate:test-lumen", "probe"),
      identify: ({ response, responseTimedOut }) =>
        response?.family === "Synthetic Lumen" && !responseTimedOut
          ? {
              matched: true,
              confidence: "exact",
              summary:
                "Authored Lumen response matched; this is software evidence only.",
            }
          : {
              matched: false,
              reason:
                "No valid Lumen response; silence does not identify a different family.",
            },
    },
  ],
  guidedTests: (profile) =>
    profile.driverId === "test-lumen" &&
    profile.width === 24 &&
    profile.height === 8
      ? [syntheticQueryTest]
      : [],
  diagnosticTools: () => [
    {
      id: "lumen-identify",
      driverId: "test-lumen",
      kind: "identify",
      label: "Identify Synthetic Lumen",
      purpose: "Exercise bounded synthetic identification.",
      explanation: "Scripted read-only query; no physical verification.",
      risk: "read-only",
      persistence: "none",
      validation: "experimental",
      available: true,
      workflow: "family-identification",
      probeId: "lumen-info",
    },
  ],
  plan: (operation: MatrixOperation, context) => {
    if (operation.type !== "GetDeviceInfo")
      throw new Error(`Synthetic Lumen does not support ${operation.type}.`);
    return queryPlan(context.profile.id, "operation");
  },
  decodeNotification: (bytes) => {
    if (
      bytes.length !== 9 ||
      bytes[0] !== 0xa7 ||
      bytes[1] !== 0x91 ||
      bytes[2] !== 5 ||
      bytes.reduce((sum, byte) => sum ^ byte, 0) !== 0 ||
      bytes[3] !== 0x4c ||
      bytes[4] !== 0x4d
    )
      return null;
    return {
      family: "Synthetic Lumen",
      kind: "device-info",
      opcode: 0x91,
      summary: "Synthetic device-info readback; no physical observation.",
      payloadHex: packetHex(bytes),
      fields: { width: bytes[5]!, height: bytes[6]!, brightnessRaw: bytes[7]! },
    };
  },
  responseMatches: notificationMatchesExpectation,
  claimEvidence: () => [],
};
