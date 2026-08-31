import { describe, expect, it, vi } from "vitest";
import { COOLLEDX_ENDPOINT } from "../../src/drivers/coolledx/gatt";
import { ReplayTransport } from "../../src/transport/replay";
import { knownIledHatFingerprint } from "../helpers/fixtures";

describe("ReplayTransport", () => {
  it("replays recorded notifications but never simulates TX", async () => {
    const listener = vi.fn();
    const transport = new ReplayTransport(knownIledHatFingerprint(), [Uint8Array.of(0x03, 0x00)]);
    await transport.selectAndConnect({ mode: "registered", hints: { filters: [], optionalServices: [] } });
    await transport.subscribe(COOLLEDX_ENDPOINT, listener);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(listener).toHaveBeenCalledWith(Uint8Array.of(0x03, 0x00));
    await expect(transport.write(COOLLEDX_ENDPOINT, Uint8Array.of(1), "without-response")).rejects.toThrow(/cannot transmit/);
  });
});
