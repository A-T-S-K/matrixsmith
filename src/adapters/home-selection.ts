import {
  COOLLED_SERVICE_UUID,
  LED_MATRIX_ENDPOINT,
} from "../core/service-identifiers";
import type { ApplicationCommand } from "../application/commands";

/** Lightweight sourced permission hints, prepared before a cold Home gesture. */
export const HOME_DISCOVERY_HINTS = Object.freeze({
  filters: [{ services: [COOLLED_SERVICE_UUID] }],
  optionalServices: [COOLLED_SERVICE_UUID, LED_MATRIX_ENDPOINT.serviceUuid],
  optionalManufacturerData: [0x31ae],
});
export function selectFromHome(
  action: Extract<ApplicationCommand, { kind: "connect" }>,
): Promise<BluetoothDevice> {
  const options = {
    ...(action.mode === "inspection"
      ? { acceptAllDevices: true as const }
      : { filters: HOME_DISCOVERY_HINTS.filters }),
    optionalServices: [
      ...new Set([
        ...HOME_DISCOVERY_HINTS.optionalServices,
        ...(action.optionalServices ?? []).map(String),
      ]),
    ],
    optionalManufacturerData: HOME_DISCOVERY_HINTS.optionalManufacturerData,
  };
  return navigator.bluetooth.requestDevice(options);
}
