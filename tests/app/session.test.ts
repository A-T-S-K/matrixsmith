import { describe, expect, it } from "vitest";
import { ApplicationState } from "../../src/application/state";

describe("ApplicationState", () => {
  it("keeps the experimental unlock in memory and clears it on disconnect state reset", () => {
    const session = new ApplicationState();
    expect(session.experimentalTxEnabled).toBe(false);
    session.enableExperimentalTx();
    expect(session.experimentalTxEnabled).toBe(true);
    session.clearConnection();
    expect(session.experimentalTxEnabled).toBe(false);
  });
});
