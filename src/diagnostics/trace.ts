import { packetHex } from "../core/transmission";
import { INPUT_LIMITS } from "../application/input-limits";

export type TraceEventType =
  | "app.started"
  | "device.selection.started"
  | "device.selected"
  | "driver.match"
  | "driver.selected"
  | "gatt.connect.started"
  | "gatt.connected"
  | "gatt.service.resolved"
  | "gatt.characteristic.resolved"
  | "gatt.notifications.enabled"
  | "gatt.read"
  | "gatt.write.lateHostAccepted"
  | "gatt.write.lateRejected"
  | "notification.raw"
  | "notification.decoded"
  | "tx.plan.created"
  | "tx.plan.authorized"
  | "tx.plan.blocked"
  | "tx.packet.started"
  | "tx.packet.hostAccepted"
  | "tx.packet.failed"
  | "tx.packet.indeterminate"
  | "tx.packet.lateHostAccepted"
  | "tx.packet.lateRejected"
  | "tx.ack"
  | "tx.completed"
  | "tx.response.matched"
  | "tx.response.timeout"
  | "tx.response.ambiguous"
  | "discovery.progress"
  | "protocol.probe.started"
  | "protocol.probe.resolved"
  | "protocol.probe.rejected"
  | "observation.recorded"
  | "evidence.imported"
  | "validation.recorded"
  | "content.compiled"
  | "disconnect"
  | "error"
  | "investigation.started"
  | "investigation.resumed"
  | "investigation.device-resumed"
  | "investigation.device-detached"
  | "guided-test.query-executed"
  | "guided-test.query-failed"
  | "guided-test.transferred"
  | "guided-test.recorded"
  | "guided-test.abandoned"
  | "raster-strategy.validated"
  | "guided-test.duplicate-blocked"
  | "guided-test.reopened"
  | "guided-test.cycle-detected"
  | "guided-test.transfer-failed"
  | "panel-program.invalidated"
  | "advertisement.observed"
  | "connection.quarantined"
  | "connection.unexpected-disconnect.handled"
  | "device.provisional-target.created"
  | "geometry.proposal.rejected";

export interface TraceEvent {
  readonly timestamp: string;
  readonly type: TraceEventType;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly rawBytes?: Uint8Array;
}

export type TraceListener = (event: TraceEvent) => void;

export class TraceRecorder {
  private _revision = 0;
  get revision(): number {
    return this._revision;
  }
  readonly #events: TraceEvent[] = [];
  readonly #listeners = new Set<TraceListener>();

  get events(): readonly TraceEvent[] {
    return this.#events;
  }

  subscribe(listener: TraceListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  record(
    type: TraceEventType,
    metadata: TraceEvent["metadata"] = {},
    rawBytes?: Uint8Array,
  ): TraceEvent {
    const event: TraceEvent = {
      timestamp: new Date().toISOString(),
      type,
      metadata,
      ...(rawBytes ? { rawBytes: rawBytes.slice() } : {}),
    };
    this.#events.push(event);
    this._revision++;
    if (this.#events.length > INPUT_LIMITS.traceEvents) this.#events.shift();
    for (const listener of this.#listeners) listener(event);
    return event;
  }

  importSerialized(events: readonly Record<string, unknown>[]): void {
    // Batch only potential overflow; below the cap the sequential path is cheap.
    // Only plain data can be inspected without intermediate user callbacks.
    // Subscriptions (including those on retained workspaces), accessors and
    // custom iterables keep the sequential append/trim/notify contract below.
    if (
      this.#listeners.size === 0 &&
      this.#events.length + events.length > INPUT_LIMITS.traceEvents &&
      isDataArray(events) &&
      events.every(isDataRecord) &&
      this.#listeners.size === 0
    ) {
      const accepted = events.filter(
        (value) =>
          typeof value.timestamp === "string" &&
          typeof value.type === "string" &&
          isMetadata(value.metadata),
      );
      const retained = accepted.slice(-INPUT_LIMITS.traceEvents);
      const removed = Math.max(
        0,
        this.#events.length + accepted.length - INPUT_LIMITS.traceEvents,
      );
      this.#events.splice(0, removed);
      for (const value of retained) {
        const rawBytes =
          typeof value.rawHex === "string" ? fromHex(value.rawHex) : undefined;
        this.#events.push({
          timestamp: value.timestamp as string,
          type: value.type as TraceEventType,
          metadata: { ...(value.metadata as TraceEvent["metadata"]) },
          ...(rawBytes ? { rawBytes } : {}),
        });
      }
      // Revision remains the number of accepted mutations, even for evictions.
      this._revision += accepted.length;
      return;
    }
    for (const value of events) {
      if (
        typeof value.timestamp !== "string" ||
        typeof value.type !== "string" ||
        !isMetadata(value.metadata)
      )
        continue;
      const rawBytes =
        typeof value.rawHex === "string" ? fromHex(value.rawHex) : undefined;
      const event: TraceEvent = {
        timestamp: value.timestamp,
        type: value.type as TraceEventType,
        metadata: { ...value.metadata },
        ...(rawBytes ? { rawBytes } : {}),
      };
      this.#events.push(event);
      this._revision++;
      if (this.#events.length > INPUT_LIMITS.traceEvents) this.#events.shift();
      for (const listener of this.#listeners) listener(event);
    }
  }
}

export function serializeTraceEvent(
  event: TraceEvent,
): Record<string, unknown> {
  return {
    timestamp: event.timestamp,
    type: event.type,
    metadata: event.metadata,
    ...(event.rawBytes
      ? { rawHex: packetHex(event.rawBytes).replaceAll(" ", "") }
      : {}),
  };
}

function fromHex(hex: string): Uint8Array | undefined {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return undefined;
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

function isMetadata(value: unknown): value is TraceEvent["metadata"] {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (item) =>
        item === null || ["string", "number", "boolean"].includes(typeof item),
    )
  );
}

/** JSON-shaped data only: accessor inputs must retain streaming visibility. */
function hasDataProperties(value: object): boolean {
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => "value" in descriptor,
  );
}

function isDataArray(value: readonly Record<string, unknown>[]): boolean {
  return (
    Object.getPrototypeOf(value) === Array.prototype &&
    Reflect.ownKeys(value).length === value.length + 1 &&
    !Object.hasOwn(value, Symbol.iterator) &&
    hasDataProperties(value) &&
    Array.from({ length: value.length }, (_, i) => i).every((i) =>
      Object.hasOwn(value, i),
    )
  );
}

function isDataRecord(value: Record<string, unknown>): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    hasDataProperties(value) &&
    (typeof value.metadata !== "object" ||
      value.metadata === null ||
      ((Object.getPrototypeOf(value.metadata) === Object.prototype ||
        Array.isArray(value.metadata)) &&
        hasDataProperties(value.metadata)))
  );
}
