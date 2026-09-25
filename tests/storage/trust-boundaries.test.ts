import { describe, expect, it } from "vitest";
import { emptyOrchestration } from "../../src/investigation/orchestration";
import {
  loadInvestigationHistory,
  toHistoricalInvestigation,
} from "../../src/storage/investigations";
import type { KeyValueStorage } from "../../src/storage/repository";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";
import type { Investigation } from "../../src/investigation/investigation";

/**
 * LocalStorage is user-controlled, untrusted application storage. These
 * regression tests manually construct poisoned records claiming trusted
 * scopes and prove none can bypass operational gates as shipped or
 * current-session evidence.
 */

function memoryStorage(entries: Record<string, string> = {}): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(entries));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const POISONED_SCOPES = [
  "built-in-profile",
  "current-session",
  "imported-external",
] as const;

function poisonedInvestigation(scope: string): Investigation {
  return {
    id: `investigation:poisoned-${scope}`,
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-08-30T10:05:00.000Z",
    profileId: "iledhat-31ae-32x16",
    deviceName: "iLedHat",
    deviceBinding: null,
    goal: { kind: "develop", description: "poisoned" },
    status: "stopped",
    completedTests: [],
    orchestration: emptyOrchestration(),
    claimEvidence: [
      // A full set of claims that would unlock image sending if trusted.
      {
        claimId: "stored-program.upload",
        status: "verified",
        scope,
        provenance: "observed",
        summary: "poisoned",
      },
      {
        claimId: "raster.tiling",
        status: "verified",
        scope,
        provenance: "observed",
        summary: "poisoned",
      },
      {
        claimId: "raster.orientation",
        status: "verified",
        scope,
        provenance: "observed",
        summary: "poisoned",
      },
      {
        claimId: "animation.frames",
        status: "verified",
        scope,
        provenance: "observed",
        summary: "poisoned",
      },
      {
        claimId: "animation.tile-sync",
        status: "verified",
        scope,
        provenance: "observed",
        summary: "poisoned",
      },
      {
        claimId: "animation.timing",
        status: "verified",
        scope,
        provenance: "observed",
        summary: "poisoned",
      },
      {
        claimId: "animation.black-semantics",
        status: "verified",
        scope,
        provenance: "observed",
        summary: "poisoned",
      },
      {
        claimId: "animation.static-single-frame",
        status: "verified",
        scope,
        provenance: "observed",
        summary: "poisoned",
      },
      {
        claimId: "graffiti.black-semantics",
        status: "verified",
        scope,
        provenance: "observed",
        summary: "poisoned",
      },
      {
        claimId: "graffiti.playback-stability",
        status: "verified",
        scope,
        provenance: "observed",
        summary: "poisoned",
      },
      {
        claimId: "pixel.channel-map",
        status: "verified",
        scope,
        provenance: "observed",
        summary: "poisoned",
      },
      {
        claimId: "static.strategy",
        status: "verified",
        scope,
        provenance: "observed",
        summary: "poisoned",
      },
    ] as unknown as Investigation["claimEvidence"],
    notes: [],
  };
}

function storageWithPoisoned(scope: string): KeyValueStorage {
  return memoryStorage({
    "matrixsmith:v2:investigations": JSON.stringify({
      schemaVersion: 2,
      investigations: [
        {
          savedAt: "2026-08-30T10:05:00.000Z",
          investigation: poisonedInvestigation(scope),
        },
      ],
    }),
  });
}

async function connectedController(): Promise<ApplicationRuntime> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new ApplicationRuntime(transport, new TraceRecorder());
  await controller.connect();
  transport.notificationOnWrite = parseHexBytes(infoFixture.rxHex);
  await controller.probe();
  transport.notificationOnWrite = null;
  return controller;
}

describe("poisoned local storage", () => {
  for (const scope of POISONED_SCOPES) {
    it(`demotes every "${scope}" entry on load and adoption`, async () => {
      const storage = storageWithPoisoned(scope);
      const stored = loadInvestigationHistory(storage)[0]!.investigation;
      const historical = toHistoricalInvestigation(stored);
      expect(historical.claimEvidence.length).toBeGreaterThan(0);
      expect(
        historical.claimEvidence.every(
          (entry) => entry.scope === "previous-local-session",
        ),
      ).toBe(true);

      // Even if a caller skipped toHistoricalInvestigation, adoption itself
      // demotes structurally (defense in depth).
      const controller = await connectedController();
      controller.adoptInvestigation(stored);
      expect(
        controller.investigation?.claimEvidence.every(
          (entry) => entry.scope === "previous-local-session",
        ),
      ).toBe(true);
      // No poisoned entry gains operational authority. The iLedHat's own
      // shipped evidence legitimately opens the image and text gates, so the
      // invariant to hold is that adoption changes NOTHING: the gates are
      // exactly what the built-in profile alone decides, and no poisoned
      // entry survives at a scope that could authorize anything.
      const clean = await connectedController();
      for (const path of ["image", "text", "animation", "gif"] as const) {
        expect(controller.contentGate(path).allowed).toBe(
          clean.contentGate(path).allowed,
        );
      }
      expect(
        controller
          .operationalTrust()
          .every(
            (trust) =>
              trust.basis === null ||
              trust.basis.scope !== "previous-local-session",
          ),
      ).toBe(true);
    });
  }

  it("keeps a previous-session rejection from becoming current-session", async () => {
    const controller = await connectedController();
    controller.adoptInvestigation({
      ...poisonedInvestigation("previous-local-session"),
      claimEvidence: [
        {
          claimId: "animation.frames",
          status: "rejected",
          scope: "previous-local-session",
          provenance: "observed",
          summary: "historical rejection",
        },
      ] as unknown as Investigation["claimEvidence"],
    });
    const state = controller
      .claims()
      .find((claim) => claim.id === "animation.frames");
    expect(
      state?.evidence.some((entry) => entry.scope === "current-session"),
    ).toBe(false);
  });
});

describe("imported evidence cannot unlock live operation", () => {
  it("blocks content gates and transmission for an imported bundle claiming success", async () => {
    // Build a real bundle from a live session with strong claims, then
    // import it into a fresh controller: nothing may unlock.
    const live = await connectedController();
    live.recordGuidedTestObservations(
      "coolledux-animation-static",
      [
        { kind: "boolean", fieldId: "initial-correct", value: "yes" },
        {
          kind: "duration",
          fieldId: "image-visible",
          milliseconds: 1400,
          measuredBy: "matrixsmith-timer",
        },
        { kind: "boolean", fieldId: "moved", value: "no" },
        {
          kind: "duration",
          fieldId: "observation-end",
          milliseconds: 17000,
          measuredBy: "matrixsmith-timer",
        },
        { kind: "boolean", fieldId: "background-off", value: "yes" },
        { kind: "boolean", fieldId: "tiles-aligned", value: "yes" },
        { kind: "boolean", fieldId: "flicker", value: "no" },
      ],
      [],
    );
    const json = live.exportBundle();

    const offline = new ApplicationRuntime(
      new ScriptedCoolLedUxDevice(null),
      new TraceRecorder(),
    );
    offline.importBundle(json);
    expect(
      offline.investigation?.claimEvidence.every(
        (entry) => entry.scope === "imported-external",
      ),
    ).toBe(true);
    // Imported evidence never becomes operational authority: nothing the
    // bundle asserts appears as a trusted basis…
    expect(
      offline
        .operationalTrust()
        .every(
          (trust) =>
            trust.basis === null || trust.basis.scope !== "imported-external",
        ),
    ).toBe(true);
    // …and GIF, which the shipped profile does not verify, stays gated no
    // matter what the bundle claims.
    expect(offline.contentGate("gif").allowed).toBe(false);
    // …and even a gate satisfied by shipped built-in evidence cannot
    // transmit: the safety policy blocks every non-live source.
    const sequence = (
      await import("../../src/render/patterns")
    ).diagnosticAnimation(32, 16);
    expect(() => offline.plan({ type: "ShowAnimation", sequence })).toThrow(
      /live connected physical target/i,
    );
  });
});
