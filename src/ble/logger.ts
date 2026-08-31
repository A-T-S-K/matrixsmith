export type BleLogKind =
  | "CONNECT"
  | "SERVICE_DISCOVERED"
  | "CHARACTERISTIC_DISCOVERED"
  | "NOTIFICATIONS_ENABLED"
  | "RX"
  | "TX"
  | "DISCONNECT"
  | "ERROR";

export type TxSafety = "known-safe" | "experimental" | "blocked";

export interface BleLogEntry {
  readonly at: Date;
  readonly kind: BleLogKind;
  readonly detail?: string;
  readonly txSafety?: TxSafety;
}

export type BleLogListener = (entry: BleLogEntry) => void;

export class BleLogger {
  readonly #entries: BleLogEntry[] = [];
  readonly #listeners = new Set<BleLogListener>();

  get entries(): readonly BleLogEntry[] {
    return this.#entries;
  }

  subscribe(listener: BleLogListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  add(kind: BleLogKind, detail?: string, txSafety?: TxSafety): void {
    const entry: BleLogEntry = { at: new Date(), kind, detail, txSafety };
    this.#entries.push(entry);
    for (const listener of this.#listeners) listener(entry);
  }

  blockedTx(detail: string): void {
    this.add("TX", detail, "blocked");
  }
}

export function toHex(value: DataView | Uint8Array): string {
  const bytes = value instanceof DataView
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : value;
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}
