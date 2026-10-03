/** DEV/test-only reviewed software fixtures; removed from production by Vite. */
import { discoveryDriver } from "../../tests/helpers/discovery-driver";
import {
  syntheticFingerprint,
  lumenFrame,
  SYNTHETIC_SERVICE,
  SYNTHETIC_NOTIFY,
} from "../../tests/helpers/synthetic-driver";
import { DriverRegistry } from "../drivers/registry";
import { FakeTransport } from "../transport/fake";

export function discoveryWorkspace(mode: string) {
  const fixture = (id: string, opcode: number) =>
    discoveryDriver(id, opcode, {
      geometry: true,
      metadata: { cost: { packets: 1, bytes: 4, elapsedMs: 3000 } },
      plan: (plan) => ({
        ...plan,
        timeoutMs: 1500,
        responseExpectation:
          plan.responseExpectation.type === "notification"
            ? { ...plan.responseExpectation, timeoutMs: 1500 }
            : plan.responseExpectation,
      }),
    });
  const a = fixture("a", 0x91);
  const b = fixture("b", mode === "discovery-ambiguous" ? 0x91 : 0x92);
  const registry = new DriverRegistry([a, b]);
  return {
    registry,
    createTransport(): FakeTransport {
      const transport = new FakeTransport(syntheticFingerprint());
      transport.notificationOnWriteEndpoint = {
        serviceUuid: SYNTHETIC_SERVICE,
        characteristicUuid: SYNTHETIC_NOTIFY,
      };
      transport.notificationOnWrite = lumenFrame(
        mode === "discovery-ambiguous" ? 0x91 : 0x92,
        [0x4c, 0x4d, 24, 8, 7],
      );
      return transport;
    },
  };
}
