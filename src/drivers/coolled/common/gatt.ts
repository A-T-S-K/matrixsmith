import type { GattEndpoint } from "../../../core/device";

export const COOLLED_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";
export const COOLLED_IO_UUID = "0000fff1-0000-1000-8000-00805f9b34fb";
export const COOLLED_ENDPOINT: GattEndpoint = {
  serviceUuid: COOLLED_SERVICE_UUID,
  characteristicUuid: COOLLED_IO_UUID,
};
