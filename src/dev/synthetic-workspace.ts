/** Development/test injection only. Vite removes this branch from production. */
import {
  syntheticDriver,
  syntheticFingerprint,
  lumenFrame,
  SYNTHETIC_SERVICE,
  SYNTHETIC_NOTIFY,
} from "../../tests/helpers/synthetic-driver";
import { DriverRegistry } from "../drivers/registry";
import { FakeTransport } from "../transport/fake";
export const registry = new DriverRegistry([syntheticDriver]);
export function createTransport(): FakeTransport {
  const transport = new FakeTransport(syntheticFingerprint());
  transport.notificationOnWriteEndpoint = {
    serviceUuid: SYNTHETIC_SERVICE,
    characteristicUuid: SYNTHETIC_NOTIFY,
  };
  transport.notificationOnWrite = lumenFrame(0x91, [0x4c, 0x4d, 24, 8, 7]);
  return transport;
}
