export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PersistenceResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        "unavailable" | "quota-exceeded" | "invalid-data" | "too-large";
      readonly message: string;
    };
