import { describe, expect, it } from "vitest";
import {
  recoverConnection,
  transitionConnection,
  type ConnectionState,
} from "../../src/application/machines/connection-machine";
import {
  transitionGuidedTest,
  type GuidedTestState,
} from "../../src/application/machines/guided-test-machine";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import type { CompletedGuidedTest } from "../../src/investigation/investigation";

const target = {
  kind: "unresolved" as const,
  fingerprint: knownIledHatFingerprint(),
  candidates: [],
};

describe("connection state machine", () => {
  it("preserves a valid session when replacement selection fails", () => {
    const connected: ConnectionState = {
      value: "connected",
      connectionId: "c1",
      target,
    };
    const selecting = transitionConnection(connected, {
      type: "SELECT",
      mode: "replacement",
    });
    const failed = transitionConnection(selecting, {
      type: "FAILED",
      operation: "select",
      error: {
        code: "chooser-cancelled",
        message: "Cancelled",
        recoverable: true,
      },
    });
    expect(recoverConnection(failed)).toEqual(connected);
  });

  it("quarantines an indeterminate write until disconnect", () => {
    const connected: ConnectionState = {
      value: "connected",
      connectionId: "c1",
      target,
    };
    const quarantined = transitionConnection(connected, {
      type: "WRITE_INDETERMINATE",
      reason: { planDigest: "sha256:x", packetIndex: 1, message: "Timed out" },
    });
    expect(quarantined.value).toBe("quarantined");
    expect(
      transitionConnection(quarantined, {
        type: "CONNECT",
        requestedDeviceId: null,
      }),
    ).toBe(quarantined);
    expect(
      transitionConnection(quarantined, { type: "DISCONNECT" }).value,
    ).toBe("disconnecting");
  });
});

describe("guided-test state machine", () => {
  const prepared = { testId: "t", title: "Test", planDigest: "sha256:x" };
  const run = {
    runId: "r",
    prepared,
    startedAt: "2026-09-02T00:00:00.000Z",
    finalWriteAcceptedAt: "2026-09-02T00:00:01.000Z",
  };

  it("keeps stage-specific data only in its valid state", () => {
    let state: GuidedTestState = { value: "idle" };
    state = transitionGuidedTest(state, { type: "PREPARE", prepared });
    state = transitionGuidedTest(state, {
      type: "START_TRANSFER",
      progress: {
        completedPackets: 0,
        totalPackets: 1,
        completedBytes: 0,
        totalBytes: 1,
      },
    });
    state = transitionGuidedTest(state, { type: "OBSERVE_TIMED", run });
    state = transitionGuidedTest(state, { type: "TICK", elapsedMs: 1250 });
    expect(state.value).toBe("observing-timed");
    if (state.value === "observing-timed")
      expect(state.timing.elapsedMs).toBe(1250);
    state = transitionGuidedTest(state, { type: "REQUEST_RETRY" });
    state = transitionGuidedTest(state, { type: "RETRY" });
    expect(state).toEqual({ value: "about", prepared });
  });

  it("restores the exact observation state when retry is cancelled", () => {
    const observing: GuidedTestState = {
      value: "observing-timed",
      run,
      timing: {
        phaseIndex: 1,
        elapsedMs: 1500,
        marks: [{ id: "visible", elapsedMs: 1500 }],
      },
    };
    const confirming = transitionGuidedTest(observing, {
      type: "REQUEST_RETRY",
    });
    expect(transitionGuidedTest(confirming, { type: "CANCEL_RETRY" })).toBe(
      observing,
    );
  });

  it("preserves failure details and permits only modeled retries", () => {
    const about: GuidedTestState = { value: "about", prepared };
    const failed = transitionGuidedTest(about, {
      type: "FAIL",
      failure: { code: "radio", message: "Disconnected", retryable: false },
    });
    expect(failed.value).toBe("failed");
    expect(transitionGuidedTest(failed, { type: "RETRY" })).toBe(failed);

    const retryable = transitionGuidedTest(about, {
      type: "FAIL",
      failure: { code: "busy", message: "Try again", retryable: true },
    });
    expect(transitionGuidedTest(retryable, { type: "RETRY" })).toEqual({
      value: "about",
      prepared,
    });
    expect(transitionGuidedTest(retryable, { type: "ABANDON" })).toEqual({
      value: "idle",
    });
  });

  it("does not complete or fail from idle without a prepared test", () => {
    const idle: GuidedTestState = { value: "idle" };
    expect(
      transitionGuidedTest(idle, {
        type: "COMPLETE",
        completed: {} as CompletedGuidedTest,
      }),
    ).toBe(idle);
    expect(
      transitionGuidedTest(idle, {
        type: "FAIL",
        failure: { code: "x", message: "x", retryable: true },
      }),
    ).toBe(idle);
  });
});
