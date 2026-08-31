import type { ResponseExpectation } from "../core/transmission";
import type { DecodedNotification } from "../drivers/types";

export interface NotificationRecord {
  readonly timestamp: string;
  readonly raw: Uint8Array;
  readonly rawHex: string;
  readonly decoded: DecodedNotification | null;
}

interface Waiter {
  readonly expectation: Exclude<ResponseExpectation, { type: "none" }>;
  readonly matches: (notification: DecodedNotification, expectation: ResponseExpectation) => boolean;
  readonly resolve: (notification: DecodedNotification) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface ArmedResponse {
  readonly promise: Promise<DecodedNotification>;
  cancel(): void;
}

export class NotificationRouter {
  readonly #waiters = new Set<Waiter>();

  arm(expectation: Exclude<ResponseExpectation, { type: "none" }>, matches: Waiter["matches"]): ArmedResponse {
    let waiter: Waiter;
    const promise = new Promise<DecodedNotification>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(waiter);
        reject(new Error(`Protocol response timed out after ${expectation.timeoutMs} ms.`));
      }, expectation.timeoutMs);
      waiter = { expectation, matches, resolve, reject, timer };
      this.#waiters.add(waiter);
    });
    return { promise, cancel: () => { clearTimeout(waiter.timer); this.#waiters.delete(waiter); } };
  }

  publish(record: NotificationRecord): void {
    if (!record.decoded) return;
    for (const waiter of this.#waiters) {
      if (!waiter.matches(record.decoded, waiter.expectation)) continue;
      clearTimeout(waiter.timer);
      this.#waiters.delete(waiter);
      waiter.resolve(record.decoded);
    }
  }
}
