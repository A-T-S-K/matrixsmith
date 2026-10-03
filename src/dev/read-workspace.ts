/** Scripted software fixtures only; stripped from production. */
import { FakeTransport } from "../transport/fake";
import { emptyFingerprint } from "../core/device";
import { LED_MATRIX_ENDPOINT } from "../application/reviewed-reads";
import { DriverRegistry } from "../drivers/registry";
export function readWorkspace(mode: string) {
  return {
    registry: new DriverRegistry([]),
    createTransport() {
      const transport = new FakeTransport({
        ...emptyFingerprint("fake", "micro:bit scripted service"),
        services:
          mode === "read-missing"
            ? []
            : [
                {
                  uuid: LED_MATRIX_ENDPOINT.serviceUuid,
                  isPrimary: true,
                  characteristics: [
                    {
                      uuid: LED_MATRIX_ENDPOINT.characteristicUuid,
                      properties: {
                        read: mode !== "read-no-property",
                        notify: false,
                        indicate: false,
                        write: true,
                        writeWithoutResponse: false,
                      },
                    },
                  ],
                },
              ],
      });
      transport.read = async () => {
        if (mode === "read-pending" || mode === "read-timeout")
          await new Promise((resolve) =>
            setTimeout(resolve, mode === "read-timeout" ? 6000 : 1500),
          );
        return new Uint8Array(
          mode === "read-malformed" ? [128, 0, 0, 0, 0] : [16, 1, 8, 4, 18],
        );
      };
      return transport;
    },
  };
}
