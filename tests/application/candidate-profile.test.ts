import { describe, expect, it } from "vitest";
import {
  buildCandidateProfile,
  candidateContext,
  inspectCandidateEvidence,
} from "../../src/application/candidate-profile";
import {
  setupStill,
  verifyStill,
  observed,
  bootstrapValues,
} from "../helpers/still-runtime";
import {
  parseProfileDocument,
  type ProfileDocumentV2,
} from "../../src/profiles/document";
import { registryWithLocalProfile } from "../../src/profiles/local-catalog";
import { DriverRegistry } from "../../src/drivers/registry";
import { ApplicationRuntime } from "../../src/application/runtime";
import { FakeTransport } from "../../src/transport/fake";
import { Framebuffer } from "../../src/render/framebuffer";
import { parseHexBytes } from "../../src/discovery/advertisement";
import info from "../fixtures/iledhat/coolledux-device-info-cc.json";
import { COOLLED_ENDPOINT } from "../../src/drivers/coolled/common/gatt";
import v1 from "../../src/profiles/data/authored-ux-banner.json";

describe("portable candidate configuration, never authority", () => {
  it("requires retained valid measured attempts and matching successful transfers, even when claims remain", async () => {
    const { runtime } = await setupStill();
    try {
      await verifyStill(runtime);
      const context = candidateContext(runtime);
      const bootstrap = runtime.experiments[0]!.attempts[0]!;
      runtime.settleAttempt(bootstrap.attemptId, {
        validity: "valid",
        timing: null,
      });
      expect(candidateContext(runtime)).not.toBe(context);
      expect(
        buildCandidateProfile(runtime).document.candidate.history.status,
      ).toBe("incomplete");
      runtime.settleAttempt(bootstrap.attemptId, {
        validity: "valid",
        timing: bootstrap.timing,
      });
      expect(
        buildCandidateProfile(runtime).document.candidate.history.status,
      ).toBe("locally-verified");
      const transfer = runtime.transfers.find(
        (entry) => entry.attemptId === bootstrap.attemptId,
      )!;
      const fingerprint = transfer.fingerprint;
      Object.assign(transfer, {
        fingerprint: { ...fingerprint, testId: "unrelated-test" },
      });
      expect(
        buildCandidateProfile(runtime).document.candidate.history.status,
      ).toBe("incomplete");
      Object.assign(transfer, {
        fingerprint,
        failureReason: "Interrupted transfer",
      });
      expect(
        buildCandidateProfile(runtime).document.candidate.history.status,
      ).toBe("incomplete");
      Object.assign(transfer, {
        failureReason: null,
        finalWriteAcceptedAt: null,
      });
      expect(
        buildCandidateProfile(runtime).document.candidate.history.status,
      ).toBe("incomplete");
    } finally {
      await runtime.dispose();
    }
  });
  it("exports actual valid still attempts and reloads with fresh live revalidation", async () => {
    const { runtime } = await setupStill(
      32,
      16,
      true,
      "private-candidate-specimen-sentinel",
    );
    let loaded: ApplicationRuntime | undefined;
    try {
      await verifyStill(runtime);
      const before = JSON.stringify({
        session: runtime.session,
        investigation: runtime.investigation,
        registry: runtime.registry.acceptedProfiles,
      });
      const artifact = buildCandidateProfile(runtime);
      expect(artifact.document.candidate).toMatchObject({
        recommendation: "animation-single-frame",
        history: {
          status: "locally-verified",
          testIds: [
            "coolledux-still-bootstrap",
            "coolledux-still-channels",
            "coolledux-still-encoder",
          ],
        },
        identity: {
          manufacturer: null,
          firmware: null,
          model: null,
          chip: null,
        },
      });
      expect(artifact.document.contradictions.companyId).toBeNull();
      expect(artifact.document.dimensions).toEqual({ width: 32, height: 16 });
      expect(JSON.stringify(artifact.document)).not.toContain(
        "private-candidate-specimen-sentinel",
      );
      expect(artifact.evidence).not.toContain(
        "private-candidate-specimen-sentinel",
      );
      expect(runtime.exportBundle("full-local-archive")).toContain(
        "private-candidate-specimen-sentinel",
      );
      expect(
        inspectCandidateEvidence(artifact.document, artifact.evidence),
      ).toContain("grant no current permission");
      expect(() =>
        inspectCandidateEvidence(
          { ...artifact.document, dimensions: { width: 16, height: 16 } },
          artifact.evidence,
        ),
      ).toThrow("geometry");
      expect(() =>
        inspectCandidateEvidence(
          {
            ...artifact.document,
            candidate: {
              ...artifact.document.candidate,
              history: {
                ...artifact.document.candidate.history,
                definitionIdentity: "incompatible-definition",
              },
            },
          },
          artifact.evidence,
        ),
      ).toThrow("definition");
      const document = parseProfileDocument(JSON.stringify(artifact.document));
      expect(document).toEqual(artifact.document);
      const registry = registryWithLocalProfile(document, runtime.registry);
      const transport = new FakeTransport({
        ...runtime.session.fingerprint!,
        browserDeviceId: "fresh-specimen",
      });
      loaded = new ApplicationRuntime(transport, undefined, registry);
      expect(loaded.investigation).toBeNull();
      expect(loaded.session.experimentalTxEnabled).toBe(false);
      expect(loaded.session.confirmedPlanDigest).toBeNull();
      expect(transport.state).toBe("idle");
      await loaded.connect();
      expect(loaded.session.selection?.selected).toBeNull(); // Name + GATT cannot identify family.
      transport.notificationOnWriteEndpoint = COOLLED_ENDPOINT;
      transport.notificationOnWrite = parseHexBytes(info.rxHex);
      await loaded.probe();
      transport.notificationOnWrite = null;
      expect(loaded.session.profile?.id).toBe("local-candidate:still-display");
      expect(loaded.staticViability().selected).toBeNull();
      const plan = loaded.plan({
        type: "ShowFrame",
        frame: new Framebuffer(32, 16),
      });
      expect(plan.metadata.rasterStrategy).toBe("animation-single-frame");
      expect(loaded.evaluate(plan).allowed).toBe(false);
      expect(
        loaded
          .guidedTests()
          .find((entry) => entry.test.id === "coolledux-still-bootstrap")
          ?.available,
      ).toBe(true);
      await verifyStill(loaded);
      expect(loaded.assessment().capabilities.text).toMatchObject({
        availability: "available",
        confidence: "experimental",
      });
      expect(loaded.assessment().capabilities.animation.availability).not.toBe(
        "available",
      );
      expect(loaded.session.experimentalTxEnabled).toBe(false);
      expect(loaded.session.confirmedPlanDigest).toBeNull();
      expect(
        JSON.stringify({
          session: runtime.session,
          investigation: runtime.investigation,
          registry: runtime.registry.acceptedProfiles,
        }),
      ).toBe(before);
    } finally {
      await runtime.dispose();
      await loaded?.dispose();
    }
  });
  it("partial, missing attempts, stale geometry, failed and historical evidence cannot claim completion", async () => {
    const { runtime } = await setupStill();
    try {
      expect(
        buildCandidateProfile(runtime).document.candidate,
      ).not.toHaveProperty("recommendation");
      (
        await observed(runtime, "coolledux-still-bootstrap", bootstrapValues)
      ).record();
      expect(
        buildCandidateProfile(runtime).document.candidate.history.status,
      ).toBe("incomplete");
      await runtime.disconnect();
      expect(() => buildCandidateProfile(runtime)).toThrow(/current CoolLEDUX/);
      await runtime.connect();
      expect(() => buildCandidateProfile(runtime)).toThrow(/current CoolLEDUX/);
    } finally {
      await runtime.dispose();
    }
    const verified = await setupStill();
    try {
      await verifyStill(verified.runtime);
      const context = candidateContext(verified.runtime);
      const archive = verified.runtime.exportBundle();
      const attempt = verified.runtime.experiments[0]!.attempts[0]!;
      Object.assign(attempt, { validity: "invalid" });
      expect(
        buildCandidateProfile(verified.runtime).document.candidate.history
          .status,
      ).toBe("incomplete");
      verified.runtime.confirmProvisionalGeometry(16, 16);
      expect(candidateContext(verified.runtime)).not.toBe(context);
      expect(
        buildCandidateProfile(verified.runtime).document.candidate.history
          .status,
      ).toBe("incomplete");
      verified.runtime.importBundle(archive);
      expect(verified.runtime.staticViability().selected).toBeNull();
      expect(() => buildCandidateProfile(verified.runtime)).toThrow();
    } finally {
      await verified.runtime.dispose();
    }
  });
  it("preserves identifying match names honestly and withdraws explicit company/geometry contradictions", async () => {
    const { runtime } = await setupStill();
    let loaded: ApplicationRuntime | undefined;
    try {
      runtime.session.fingerprint = {
        ...runtime.session.fingerprint!,
        name: "Personal matching name sentinel",
        manufacturerDataHex: "AA55DEADBEEF",
      };
      const artifact = buildCandidateProfile(runtime);
      expect(JSON.stringify(artifact.document)).toContain(
        "personal matching name sentinel",
      );
      expect(artifact.evidence.toLowerCase()).not.toContain(
        "personal matching name sentinel",
      );
      expect(runtime.exportBundle("full-local-archive")).toContain(
        "Personal matching name sentinel",
      );
      expect(artifact.document.contradictions.companyId).toBe(0x55aa);
      expect(artifact.document.candidate.identity.manufacturer).toBeNull();
      const registry = registryWithLocalProfile(
        artifact.document,
        runtime.registry,
      );
      expect(
        registry.drivers
          .find((driver) => driver.id === "coolledux")!
          .resolveProfile({
            ...runtime.session.fingerprint!,
            manufacturerDataHex: "BB55",
          }),
      ).toBeNull();
      const changedSize = {
        ...artifact.document,
        dimensions: { width: 48, height: 16 },
      };
      const changedRegistry = registryWithLocalProfile(
        parseProfileDocument(JSON.stringify(changedSize)),
        new DriverRegistry(
          runtime.registry.drivers.map((driver) =>
            driver.id === "coolledux"
              ? {
                  ...driver,
                  interpretGeometry: () => ({ width: 32, height: 16 }),
                }
              : driver,
          ),
        ),
      );
      const transport = new FakeTransport({
        ...runtime.session.fingerprint!,
        manuallyConfirmedGeometry: undefined,
      });
      loaded = new ApplicationRuntime(transport, undefined, changedRegistry);
      await loaded.connect();
      transport.notificationOnWriteEndpoint = COOLLED_ENDPOINT;
      transport.notificationOnWrite = parseHexBytes(info.rxHex); // The explicit test interpreter supplies geometry; production CoolLEDUX bytes remain unknown.
      await loaded.probe();
      expect(loaded.session.profile).toBeNull();
      expect(loaded.geometryProposal()).toMatchObject({
        width: 32,
        height: 16,
      });
      expect(loaded.guidedTests().every((entry) => !entry.available)).toBe(
        true,
      );
      expect(loaded.session.experimentalTxEnabled).toBe(false);
    } finally {
      await runtime.dispose();
      await loaded?.dispose();
    }
  });
  it("V1 stays unchanged, unsupported versions and executable/authority/permutation fields fail closed", async () => {
    const { runtime } = await setupStill();
    try {
      const document = buildCandidateProfile(runtime).document;
      expect(parseProfileDocument(JSON.stringify(v1))).toEqual(v1);
      expect(() =>
        parseProfileDocument(JSON.stringify({ ...v1, documentVersion: 3 })),
      ).toThrow("supported versions are 1 and 2");
      for (const extras of [
        { opcode: 3 },
        { approval: true },
        { trustedScopes: ["current-session"] },
        { callback: "run" },
        { assurance: "verified" },
      ])
        expect(() =>
          parseProfileDocument(JSON.stringify({ ...document, ...extras })),
        ).toThrow();
      for (const assumptions of [
        { rowStride: 8 },
        { tileWidth: 16 },
        { channelMap: ["b", "r", "g"] },
      ])
        expect(() =>
          parseProfileDocument(
            JSON.stringify({
              ...document,
              candidate: {
                ...document.candidate,
                assumptions: {
                  ...document.candidate.assumptions,
                  ...assumptions,
                },
              },
            }),
          ),
        ).toThrow();
      expect(() =>
        registryWithLocalProfile(
          parseProfileDocument(
            JSON.stringify({
              ...document,
              namespace: "matrixsmith",
              id: "iledhat-31ae-32x16",
            }),
          ),
          runtime.registry,
        ),
      ).toThrow("reserved");
      expect(() =>
        registryWithLocalProfile(
          parseProfileDocument(
            JSON.stringify({
              ...document,
              matching: { ...document.matching, name: "iledhat" },
            }),
          ),
          runtime.registry,
        ),
      ).toThrow("collides");
      expect(() =>
        inspectCandidateEvidence(
          {
            ...document,
            dimensions: { width: 16, height: 16 },
          } as ProfileDocumentV2,
          buildCandidateProfile(runtime).evidence,
        ),
      ).toThrow();
      expect(() =>
        inspectCandidateEvidence(
          document,
          runtime.exportBundle("full-local-archive"),
        ),
      ).toThrow("conflicts");
    } finally {
      await runtime.dispose();
    }
  });
});
