import type { ResponseExpectation } from "../core/transmission";
import type { DecodedNotification } from "../drivers/types";
import { normalizeUuid, type GattEndpoint } from "../core/device";

export interface NotificationRecord {
  readonly timestamp: string;
  readonly raw: Uint8Array;
  readonly rawHex: string;
  readonly decoded: DecodedNotification | null;
  readonly endpoint?: GattEndpoint;
  /** Internal live context; never imported/exported as correlation authority. */
  readonly connectionGeneration?: number;
  readonly receiveSequence?: number;
}

export interface ResponseContext {
  readonly connectionId: string;
  readonly generation: number;
}

type NotificationExpectation = Exclude<ResponseExpectation, { type: "none" }>;
interface Waiter {
  readonly expectation: NotificationExpectation;
  readonly context: ResponseContext;
  readonly matches: (
    notification: DecodedNotification,
    expectation: ResponseExpectation,
  ) => boolean;
  readonly resolve: (record: NotificationRecord) => void;
  readonly reject: (error: Error) => void;
  afterSequence: number | null;
  timer?: ReturnType<typeof setTimeout>;
}

export class ResponseTimeoutError extends Error {}
export const RESPONSE_AMBIGUITY_MESSAGE =
  "Response is ambiguous after an earlier unresolved request. Reconnect before establishing evidence.";
export class ResponseAmbiguityError extends Error {}
export class ResponseCancelledError extends Error {}

export interface ArmedResponse {
  readonly promise: Promise<NotificationRecord>;
  /** Called immediately before the reviewed request packet's transport.write. */
  dispatch(): void;
  cancel(): void;
}

export class NotificationRouter {
  readonly #waiters = new Set<Waiter>();
  readonly #ownership = new WeakMap<
    NotificationRecord,
    ResponseContext & { sequence: number; endpoint: string | null }
  >();
  readonly #expired: NotificationExpectation[] = [];
  #context: ResponseContext | null = null;
  #receiveSequence = 0;

  get receiveSequence(): number {
    return this.#receiveSequence;
  }

  /** Only the application connection boundary establishes live ownership. */
  beginConnection(context: ResponseContext): void {
    this.reset();
    this.#context = { ...context };
  }

  recordLive(
    record: NotificationRecord,
    context: ResponseContext,
  ): NotificationRecord {
    if (!sameContext(this.#context, context)) return record;
    const sequence = ++this.#receiveSequence;
    const owned = {
      ...record,
      connectionGeneration: context.generation,
      receiveSequence: sequence,
    };
    this.#ownership.set(owned, {
      ...context,
      sequence,
      endpoint: record.endpoint ? endpointKey(record.endpoint) : null,
    });
    return owned;
  }

  arm(
    expectation: NotificationExpectation,
    matches: Waiter["matches"],
    connectionId: string,
  ): ArmedResponse {
    if (!this.#context || this.#context.connectionId !== connectionId)
      throw new Error("No current connection context for the response.");
    if (!expectation.endpoints?.length)
      throw new Error("A response requires reviewed notification endpoints.");
    // Own the contract even if a caller mutates its original while waiting.
    const ownedExpectation = {
      ...expectation,
      endpoints: expectation.endpoints.map((endpoint) => ({ ...endpoint })),
    };
    let waiter: Waiter;
    const promise = new Promise<NotificationRecord>((resolve, reject) => {
      waiter = {
        expectation: ownedExpectation,
        context: { ...this.#context! },
        matches,
        resolve,
        reject,
        afterSequence: null,
      };
      this.#waiters.add(waiter);
    });
    // Cancellation also settles safely when a standalone owner forgets to observe.
    void promise.catch(() => undefined);
    return {
      promise,
      dispatch: () => {
        if (!this.#waiters.has(waiter) || waiter.afterSequence !== null) return;
        // reset/beginConnection remove all retired waiters before changing context.
        waiter.afterSequence = this.#receiveSequence;
        // No request token exists in current protocols. An unresolved earlier
        // request with an overlapping signature makes subsequent replies unsafe.
        if (
          this.#expired.some((expired) =>
            signaturesOverlap(expired, ownedExpectation),
          )
        ) {
          this.#settle(
            waiter,
            new ResponseAmbiguityError(RESPONSE_AMBIGUITY_MESSAGE),
          );
          return;
        }
        waiter.timer = setTimeout(() => {
          this.#settle(
            waiter,
            new ResponseTimeoutError(
              `Protocol response timed out after ${ownedExpectation.timeoutMs} ms.`,
            ),
          );
        }, ownedExpectation.timeoutMs);
      },
      cancel: () =>
        this.#settle(
          waiter,
          new ResponseCancelledError("Response wait cancelled."),
        ),
    };
  }

  publish(record: NotificationRecord): void {
    const owner = this.#ownership.get(record);
    if (!owner || !sameContext(this.#context, owner) || !record.decoded) return;
    for (const waiter of this.#waiters) {
      if (
        !sameContext(owner, waiter.context) ||
        waiter.afterSequence === null ||
        owner.sequence <= waiter.afterSequence ||
        !owner.endpoint ||
        !waiter.expectation.endpoints.some(
          (endpoint) => endpointKey(endpoint) === owner.endpoint,
        )
      )
        continue;
      if (!waiter.matches(record.decoded, waiter.expectation)) continue;
      clearTimeout(waiter.timer);
      this.#waiters.delete(waiter);
      waiter.resolve(record);
      // A single notification must never establish two requests.
      break;
    }
  }

  #settle(waiter: Waiter, error: Error): void {
    if (!this.#waiters.delete(waiter)) return;
    clearTimeout(waiter.timer);
    if (
      !(error instanceof ResponseAmbiguityError) &&
      waiter.afterSequence !== null &&
      sameContext(this.#context, waiter.context)
    )
      this.#expired.push(waiter.expectation);
    waiter.reject(error);
  }

  /** Retire waiters, timers and ambiguity when their connection ends. */
  reset(
    reason = "The connection ended before the expected response arrived.",
  ): void {
    for (const waiter of this.#waiters)
      this.#settle(waiter, new ResponseCancelledError(reason));
    this.#context = null;
    this.#expired.length = 0;
  }
}

export function endpointKey(endpoint: GattEndpoint): string {
  return `${normalizeUuid(endpoint.serviceUuid)}/${normalizeUuid(endpoint.characteristicUuid)}`;
}

function sameContext(a: ResponseContext | null, b: ResponseContext): boolean {
  return (
    a !== null &&
    a.connectionId === b.connectionId &&
    a.generation === b.generation
  );
}

function signaturesOverlap(
  a: NotificationExpectation,
  b: NotificationExpectation,
): boolean {
  return (
    a.endpoints.some((endpoint) =>
      b.endpoints.some((other) => endpointKey(endpoint) === endpointKey(other)),
    ) &&
    (a.opcode === undefined ||
      b.opcode === undefined ||
      a.opcode === b.opcode) &&
    (a.kind === undefined || b.kind === undefined || a.kind === b.kind)
  );
}
