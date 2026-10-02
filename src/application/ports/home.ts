import type { KeyValueStorage } from "./persistence";
export interface HomeCapabilities {
  onHistoryChange?(listener: () => void): () => void;
  readonly storage: KeyValueStorage;
  readonly bluetoothSupported: boolean;
  authorizedDevices(): Promise<readonly { id: string; name: string }[]>;
}
