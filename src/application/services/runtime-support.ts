import type { DeviceFingerprint } from "../../core/device";
import type { GattEndpoint } from "../../core/device";

import type { DecodedNotification } from "../../drivers/types";

export function candidateEndpoints(
  fingerprint: DeviceFingerprint,
): readonly GattEndpoint[] {
  return fingerprint.services.flatMap((service) =>
    service.characteristics.map((characteristic) => ({
      serviceUuid: service.uuid,
      characteristicUuid: characteristic.uuid,
    })),
  );
}

export function endpointNotifies(
  fingerprint: DeviceFingerprint,
  endpoint: GattEndpoint,
): boolean {
  return fingerprint.services.some(
    (service) =>
      service.uuid.toLowerCase() === endpoint.serviceUuid.toLowerCase() &&
      service.characteristics.some(
        (characteristic) =>
          characteristic.uuid.toLowerCase() ===
            endpoint.characteristicUuid.toLowerCase() &&
          (characteristic.properties.notify ||
            characteristic.properties.indicate),
      ),
  );
}

export function decodePriority(notification: DecodedNotification): number {
  if (notification.kind === "device-info") return 100;
  if (notification.kind === "command-response") return 90;
  if (notification.kind === "command-echo") return 80;
  if (notification.kind.startsWith("malformed")) return 0;
  return 20;
}

export function duration(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function numberField(
  notification: DecodedNotification | null,
  key: string,
): number | null {
  const value = notification?.fields[key];
  return typeof value === "number" ? value : null;
}
