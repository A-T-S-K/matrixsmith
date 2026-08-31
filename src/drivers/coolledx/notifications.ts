import type { DecodedNotification } from "../types";

const ERROR_NAMES: Readonly<Record<number, string>> = {
  0x00: "success",
  0x01: "transmission failed",
  0x02: "device abnormality",
  0x03: "data error",
  0x04: "data length error",
  0x05: "data id error",
  0x06: "data checksum error",
};

export function decodeCoolLedNotification(packet: Uint8Array): DecodedNotification | null {
  if (packet.length < 2) return null;
  const code = packet[1];
  if (code === undefined || !(code in ERROR_NAMES)) return null;
  return {
    kind: "transfer-ack",
    code,
    success: code === 0,
    summary: ERROR_NAMES[code] ?? `unknown status 0x${code.toString(16).padStart(2, "0")}`,
  };
}
