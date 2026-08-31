import { packetHex } from "../core/transmission";

export type TraceEventType =
  | "app.started" | "device.selection.started" | "device.selected" | "driver.match" | "driver.selected"
  | "gatt.connect.started" | "gatt.connected" | "gatt.service.resolved" | "gatt.characteristic.resolved"
  | "gatt.notifications.enabled" | "gatt.read" | "notification.raw" | "notification.decoded"
  | "tx.plan.created" | "tx.plan.authorized" | "tx.plan.blocked" | "tx.packet.started"
  | "tx.packet.hostAccepted" | "tx.packet.failed" | "tx.ack" | "tx.completed"
  | "tx.response.matched" | "tx.response.timeout" | "protocol.probe.started" | "protocol.probe.resolved" | "protocol.probe.rejected"
  | "observation.recorded" | "disconnect" | "error";

export interface TraceEvent {
  readonly timestamp: string;
  readonly type: TraceEventType;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly rawBytes?: Uint8Array;
}

export type TraceListener = (event: TraceEvent) => void;

export class TraceRecorder {
  readonly #events: TraceEvent[] = [];
  readonly #listeners = new Set<TraceListener>();

  get events(): readonly TraceEvent[] { return this.#events; }

  subscribe(listener: TraceListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  record(type: TraceEventType, metadata: TraceEvent["metadata"] = {}, rawBytes?: Uint8Array): TraceEvent {
    const event: TraceEvent = {
      timestamp: new Date().toISOString(),
      type,
      metadata,
      ...(rawBytes ? { rawBytes: rawBytes.slice() } : {}),
    };
    this.#events.push(event);
    for (const listener of this.#listeners) listener(event);
    return event;
  }

  importSerialized(events: readonly Record<string, unknown>[]): void {
    for (const value of events) {
      if (typeof value.timestamp !== "string" || typeof value.type !== "string" || !isMetadata(value.metadata)) continue;
      const rawBytes = typeof value.rawHex === "string" ? fromHex(value.rawHex) : undefined;
      const event: TraceEvent = {
        timestamp: value.timestamp,
        type: value.type as TraceEventType,
        metadata: value.metadata,
        ...(rawBytes ? { rawBytes } : {}),
      };
      this.#events.push(event);
      for (const listener of this.#listeners) listener(event);
    }
  }
}

export function serializeTraceEvent(event: TraceEvent): Record<string, unknown> {
  return {
    timestamp: event.timestamp,
    type: event.type,
    metadata: event.metadata,
    ...(event.rawBytes ? { rawHex: packetHex(event.rawBytes).replaceAll(" ", "") } : {}),
  };
}

function fromHex(hex: string): Uint8Array | undefined {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return undefined;
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function isMetadata(value: unknown): value is TraceEvent["metadata"] {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.values(value).every((item) => item === null || ["string", "number", "boolean"].includes(typeof item));
}
