export interface CoolLedManufacturerMetadata {
  readonly companyId: number;
  readonly deviceIdentifierBytes: Uint8Array;
  readonly height?: number;
  readonly width?: number;
  readonly colorModeRaw?: number;
  readonly firmwareRaw?: number;
}

export function parseCoolLedManufacturerData(
  bytes: Uint8Array,
): CoolLedManufacturerMetadata | null {
  if (bytes.length < 2) return null;
  const companyId = (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8);
  const vendor = bytes.slice(2);
  const knownLayout = vendor.length >= 11;
  return {
    companyId,
    deviceIdentifierBytes: vendor.slice(0, Math.min(6, vendor.length)),
    ...(knownLayout
      ? {
          height: vendor[6],
          width: ((vendor[7] ?? 0) << 8) | (vendor[8] ?? 0),
          colorModeRaw: vendor[9],
          firmwareRaw: vendor[10],
        }
      : {}),
  };
}
