import type { HomeCapabilities } from "../application/ports/home";

export function createHomeCapabilities(): HomeCapabilities {
  const navigatorLike = typeof navigator === "undefined" ? {} : navigator;
  return {
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
