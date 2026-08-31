import { describe, expect, it } from "vitest";
import { encodeCommand, ProtocolUnavailableError } from "../../src/protocol/protocol";

describe("protocol safety gate", () => {
  it("cannot encode speculative FFF1 packets", () => {
    expect(() => encodeCommand()).toThrow(ProtocolUnavailableError);
  });
});
