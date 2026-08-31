/** No encoder exists until the exact FFF1 protocol is evidenced. */
export class ProtocolUnavailableError extends Error {
  constructor() {
    super("The iLedHat FFF1 wire protocol is unknown; command encoding is intentionally unavailable.");
    this.name = "ProtocolUnavailableError";
  }
}

export function encodeCommand(): never {
  throw new ProtocolUnavailableError();
}
