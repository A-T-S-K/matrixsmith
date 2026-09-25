import { normalizeUuid } from "../core/device";

/** Turns chooser hints like "FFF0, a950" into unique Web Bluetooth UUIDs. */
export function parseServiceHints(text: string): BluetoothServiceUUID[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map(normalizeUuid),
    ),
  ];
}
