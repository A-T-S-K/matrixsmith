import type {
  KeyValueStorage,
  PersistenceResult,
} from "../application/ports/persistence";
export type {
  KeyValueStorage,
  PersistenceResult,
} from "../application/ports/persistence";

export function storageFailure(error: unknown): PersistenceResult {
  const quota =
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED");
  return {
    ok: false,
    reason: quota ? "quota-exceeded" : "unavailable",
    message:
      error instanceof Error
        ? error.message
        : "Browser storage is unavailable.",
  };
}

export class BrowserStorageRepository {
  constructor(private readonly storage: KeyValueStorage = localStorage) {}
  get(key: string): string | null {
    return this.storage.getItem(key);
  }
  set(key: string, value: string): void {
    this.storage.setItem(key, value);
  }
  remove(key: string): void {
    this.storage.removeItem(key);
  }
}
