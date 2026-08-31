import type { GattEndpoint } from "../../core/device";

export const COOLLEDX_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";
export const COOLLEDX_IO_UUID = "0000fff1-0000-1000-8000-00805f9b34fb";
export const COOLLEDX_ENDPOINT: GattEndpoint = {
  serviceUuid: COOLLEDX_SERVICE_UUID,
  characteristicUuid: COOLLEDX_IO_UUID,
};
