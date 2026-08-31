import { describe, expect, it } from "vitest";
import { MatrixSession } from "../../src/app/session";

describe("MatrixSession", () => {
  it("keeps the experimental unlock in memory and clears it on disconnect state reset", () => {
    const session = new MatrixSession();
    expect(session.experimentalTxEnabled).toBe(false);
    session.enableExperimentalTx();
    expect(session.experimentalTxEnabled).toBe(true);
    session.clearConnection();
    expect(session.experimentalTxEnabled).toBe(false);
  });
});
