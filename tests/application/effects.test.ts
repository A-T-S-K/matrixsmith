import { describe, expect, it, vi } from "vitest";
import {
  runApplicationEffect,
  type ApplicationEffectPort,
} from "../../src/application/effects";

function port(): ApplicationEffectPort {
  return {
    connect: vi.fn(async () => undefined),
    reconnectAuthorized: vi.fn(async () => undefined),
    importBundle: vi.fn(),
    importExternalCapture: vi.fn(),
    resumeStoredInvestigation: vi.fn(),
    forgetLocalHistory: vi.fn(),
  };
}

describe("application command effect runner", () => {
  it("routes semantic commands without protocol or browser details", async () => {
    const target = port();
    await runApplicationEffect(target, {
      kind: "connect",
      mode: "inspection",
      optionalServices: ["fff0"],
    });
    await runApplicationEffect(target, {
      kind: "import-bundle",
      content: "{}",
    });
    expect(target.connect).toHaveBeenCalledWith("inspection", ["fff0"]);
    expect(target.importBundle).toHaveBeenCalledWith("{}");
  });
});
