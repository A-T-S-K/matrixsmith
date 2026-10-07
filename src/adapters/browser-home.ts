import { INVESTIGATIONS_KEY } from "../storage/keys";
import type { HomeCapabilities } from "../application/ports/home";

export function createHomeCapabilities(): HomeCapabilities {
  const navigatorLike = typeof navigator === "undefined" ? {} : navigator;
  return {
    onHistoryChange(listener) {
      const browser = typeof window === "undefined" ? null : window;
      const changed = (event: StorageEvent): void => {
        if (
          (event.key === null || event.key === INVESTIGATIONS_KEY) &&
          event.storageArea === browser?.localStorage
        )
          listener();
      };
      browser?.addEventListener("storage", changed);
      return () => browser?.removeEventListener("storage", changed);
    },
    storage: {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
      removeItem: (key) => localStorage.removeItem(key),
    },
    bluetoothSupported: "bluetooth" in navigatorLike,
    async authorizedDevices() {
      const bluetooth = (
        navigatorLike as Navigator & {
          bluetooth?: Bluetooth & {
            getDevices?: () => Promise<readonly BluetoothDevice[]>;
          };
        }
      ).bluetooth;
      return ((await bluetooth?.getDevices?.()) ?? []).map((device) => ({
        id: device.id,
        name: device.name ?? "Unnamed display",
      }));
    },
  };
}
