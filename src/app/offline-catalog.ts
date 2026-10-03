import type {
  OfflineCompilation,
  OfflineReferenceDefinition,
} from "../application/offline-compilation";
import { freezeDefinition } from "../profiles/freeze";

/** Application-owned descriptors. Labels never select or authenticate a driver. */
export interface OfflineEntry {
  readonly id: string;
  readonly label: string;
  readonly geometry: { readonly width: number; readonly height: number };
  readonly reference: OfflineReferenceDefinition;
  readonly examples: readonly { readonly id: string; readonly label: string }[];
  readonly pixelPolicy: string;
  readonly previewDescription: string;
  readonly deliveryDescription: string;
  readonly limitations: readonly string[];
  readonly sourceIds: readonly string[];
  compile(example: string): OfflineCompilation;
}
export const offlineCatalog = freezeDefinition([
  {
    id: "lsled",
    label: "LSLED legacy 44×11",
    load: async (): Promise<OfflineEntry> =>
      (await import("./offline-entries/lsled")).lsledEntry,
  },
]);
export function findOfflineEntry(id: string) {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) return undefined;
  return offlineCatalog.find((entry) => entry.id === id);
}
/** Literal catalog loaders only: user input never becomes an import path. */
export async function loadOfflineEntry(id: string): Promise<OfflineEntry> {
  const descriptor = findOfflineEntry(id);
  if (!descriptor)
    throw new Error(
      "Unknown offline reference. Select an implementation from the catalog.",
    );
  return descriptor.load();
}
