import { LED_MATRIX_ENDPOINT } from "../drivers/microbit/gatt";
export { LED_MATRIX_ENDPOINT } from "../drivers/microbit/gatt";
import {
  normalizeUuid,
  type DeviceFingerprint,
  type GattEndpoint,
} from "../core/device";
import { decodeMatrixState } from "../drivers/microbit/codec";
import {
  MICROBIT_DAL_REVISION,
  MICROBIT_SOURCE_BASIS,
} from "../profiles/microbit-led-reference";
import { freezeDefinition } from "../profiles/freeze";

export interface ReviewedRead {
  readonly id: string;
  readonly driverId: string;
  readonly definitionIdentity: string;
  readonly endpoint: GattEndpoint;
  readonly applicability: string;
  readonly requiredProperty: "read";
  readonly valueBytes: number;
  readonly timeoutMs: number;
  readonly cost: {
    readonly reads: number;
    readonly bytes: number;
    readonly elapsedMs: number;
  };
  readonly interpretation: string;
  readonly sources: readonly string[];
  readonly question: string;
  readonly consequence: string;
  readonly stopping: "service-observed";
  decode(bytes: Uint8Array): {
    readonly conforming: boolean;
    readonly pixels: readonly number[];
    readonly summary: string;
  };
}
/** Authored application machinery. Profiles, knowledge and copied IDs cannot extend it. */
export const REGISTERED_READS: readonly ReviewedRead[] = freezeDefinition([
  {
    id: "microbit-led/matrix-state-read",
    driverId: "microbit-led-reference",
    definitionIdentity: `microbit-matrix-read-v1@${MICROBIT_DAL_REVISION}`,
    endpoint: LED_MATRIX_ENDPOINT,
    applicability: `Inspected Lancaster microbit-dal ${MICROBIT_DAL_REVISION}; DAL v2.1.1 documentation. Other firmware applicability unknown.`,
    requiredProperty: "read",
    valueBytes: 5,
    timeoutMs: 3000,
    cost: { reads: 1, bytes: 5, elapsedMs: 3000 },
    interpretation: "microbit-dal-matrix-state-decoder-v1",
    sources: MICROBIT_SOURCE_BASIS,
    question: "What LED Matrix State value does the accessible service supply?",
    consequence:
      "Reads one supplied characteristic value; physical appearance remains unconfirmed.",
    stopping: "service-observed",
    decode: decodeMatrixState,
  },
]);
export function readAccess(
  read: ReviewedRead,
  fingerprint: DeviceFingerprint,
): string | null {
  const service = fingerprint.services.find(
    (s) => normalizeUuid(s.uuid) === read.endpoint.serviceUuid,
  );
  if (!service)
    return "LED service is not accessible. Browser permission and firmware-dependent service availability remain unknown. Reconnect using Explore unknown BLE; the optional service may be disabled in firmware.";
  const characteristic = service.characteristics.find(
    (c) => normalizeUuid(c.uuid) === read.endpoint.characteristicUuid,
  );
  if (!characteristic)
    return "LED Matrix State characteristic is not accessible in this connection. Review firmware/service availability and reconnect explicitly.";
  if (!characteristic.properties.read)
    return "The accessible LED Matrix State characteristic has no Read property. No read was dispatched. Review the firmware contract before reconnecting.";
  return null;
}
export function relevantRead(
  read: ReviewedRead,
  fingerprint: DeviceFingerprint,
): boolean {
  return (
    /micro:bit/i.test(fingerprint.name ?? "") ||
    fingerprint.services.some(
      (s) => normalizeUuid(s.uuid) === read.endpoint.serviceUuid,
    ) ||
    fingerprint.advertisedServices.some(
      (s) => normalizeUuid(s) === read.endpoint.serviceUuid,
    )
  );
}
