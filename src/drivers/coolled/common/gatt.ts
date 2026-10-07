import type { GattEndpoint } from "../../../core/device";

export {
  COOLLED_SERVICE_UUID,
  COOLLED_IO_UUID,
} from "../../../core/service-identifiers";
import {
  COOLLED_SERVICE_UUID,
  COOLLED_IO_UUID,
} from "../../../core/service-identifiers";
export const COOLLED_ENDPOINT: GattEndpoint = {
  serviceUuid: COOLLED_SERVICE_UUID,
  characteristicUuid: COOLLED_IO_UUID,
};
