import type { KeyValueStorage } from "./persistence";
export interface HomeCapabilities {
  readonly storage: KeyValueStorage;
  readonly bluetoothSupported: boolean;
  authorizedDevices(): Promise<readonly { id: string; name: string }[]>;
}
