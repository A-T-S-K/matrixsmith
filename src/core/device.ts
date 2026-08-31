import type { EvidenceReference, ValidationStatus } from "./evidence";

export type TransportKind = "web-bluetooth" | "web-serial" | "web-usb" | "network" | "fake" | "replay";

export interface CharacteristicProperties {
  readonly read: boolean;
  readonly notify: boolean;
  readonly indicate: boolean;
  readonly write: boolean;
  readonly writeWithoutResponse: boolean;
}

export interface GattCharacteristicFingerprint {
  readonly uuid: string;
  readonly properties: CharacteristicProperties;
}

export interface GattServiceFingerprint {
  readonly uuid: string;
  readonly isPrimary: boolean;
  readonly characteristics: readonly GattCharacteristicFingerprint[];
}

export interface DeviceFingerprint {
  readonly schemaVersion: 1;
  readonly transportKind: TransportKind;
  readonly browserDeviceId?: string;
  readonly name?: string;
  readonly advertisedServices: readonly string[];
  readonly rawAdvertisementHex?: string;
  readonly manufacturerDataHex?: string;
  readonly services: readonly GattServiceFingerprint[];
  readonly manuallyConfirmedGeometry?: { readonly width: number; readonly height: number };
  readonly evidenceRefs: readonly string[];
  readonly notes: readonly string[];
}

export interface DeviceProfile {
  readonly id: string;
  readonly name: string;
  readonly driverId: string;
  readonly width: number;
  readonly height: number;
  readonly validation: ValidationStatus;
  readonly evidence: readonly EvidenceReference[];
  readonly metadata: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

export interface GattEndpoint {
  readonly serviceUuid: string;
  readonly characteristicUuid: string;
}

export function normalizeUuid(uuid: string): string {
  const value = uuid.trim().toLowerCase();
  if (/^[0-9a-f]{4}$/.test(value)) return `0000${value}-0000-1000-8000-00805f9b34fb`;
  return value;
}

export function emptyFingerprint(transportKind: TransportKind, name?: string): DeviceFingerprint {
  return {
    schemaVersion: 1,
    transportKind,
    ...(name ? { name } : {}),
    advertisedServices: [],
    services: [],
    evidenceRefs: [],
    notes: [],
  };
}
