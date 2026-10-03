import { describe, expect, it, vi } from "vitest";
import { setupStill, verifyStill } from "../helpers/still-runtime";
import { PresentationStore } from "../../src/presentation/store";
import { createBrowserEnvironment } from "../../src/adapters/presentation/browser-environment";
import { ApplicationRuntime } from "../../src/application/runtime";
import { FakeTransport } from "../../src/transport/fake";
import type { FilesPort } from "../../src/application/ports/files";
import v1 from "../../src/profiles/data/authored-ux-banner.json";

async function setup(files: FilesPort) {
  const { runtime, transport } = await setupStill();
  const store = new PresentationStore(runtime, transport, {
    ...createBrowserEnvironment(),
    files,
    createLiveWorkspace: (registry) => {
      const fresh = new FakeTransport();
      return {
        transport: fresh,
        controller: new ApplicationRuntime(fresh, undefined, registry),
      };
    },
  });
  return { store, runtime };
}
describe("supervised candidate/profile export", () => {
  it("rejects an export whose formatted bytes exceed reload bounds without altering the loaded source", async () => {
    const files = {
      copyText: vi.fn().mockResolvedValue(true),
      download: vi.fn(),
    };
    const { store, runtime } = await setup(files);
    try {
      const document = {
        ...v1,
        sources: Array(16).fill("x".repeat(481)),
        limitations: Array(16).fill("x".repeat(481)),
      };
      expect(JSON.stringify(document).length).toBeLessThanOrEqual(16384);
      expect(JSON.stringify(document, null, 2).length).toBeGreaterThan(16384);
      await runtime.disconnect();
      await store.reviewLocalProfile(JSON.stringify(document));
      store.loadLocalProfile();
      const source = store.controller.registry.acceptedProfiles[0]!.document;
      await store.exportLoadedProfile(0);
      expect(store.getSnapshot().error).toContain("byte limit");
      expect(files.download).not.toHaveBeenCalled();
      expect(store.controller.registry.acceptedProfiles[0]!.document).toBe(
        source,
      );
      expect(source).toEqual(document);
    } finally {
      await store.dispose();
    }
  });
  it("retires a verified review when its actual attempt is invalidated", async () => {
    const files = {
      copyText: vi.fn().mockResolvedValue(true),
      download: vi.fn(),
    };
    const { store, runtime } = await setup(files);
    try {
      await verifyStill(runtime);
      await store.createCandidateProfile();
      const document = store.getSnapshot().candidateReview!.document;
      runtime.settleAttempt(runtime.experiments[0]!.attempts[0]!.attemptId, {
        validity: "invalid",
      });
      store.updateGeometryDraft("width", "32");
      expect(store.getSnapshot().candidateReview!.stale).toBe(true);
      await store.exportCandidateProfile();
      expect(files.download).not.toHaveBeenCalled();
      expect(store.getSnapshot().candidateReview!.document).toBe(document);
      await store.createCandidateProfile();
      expect(
        store.getSnapshot().candidateReview!.document.candidate.history.status,
      ).toBe("incomplete");
    } finally {
      await store.dispose();
    }
  });
  it("preserves valid content on clipboard/download/validation failures and retries without source mutation", async () => {
    const files = {
      copyText: vi.fn().mockResolvedValue(false),
      download: vi.fn(() => {
        throw new Error("Download failed");
      }),
    };
    const { store, runtime } = await setup(files);
    try {
      await verifyStill(runtime);
      const before = JSON.stringify({
        session: runtime.session,
        investigation: runtime.investigation,
      });
      await store.createCandidateProfile();
      const document = store.getSnapshot().candidateReview!.document;
      await store.exportCandidateProfile(true);
      expect(store.getSnapshot().error).toContain("Clipboard");
      expect(store.getSnapshot().candidateReview!.document).toBe(document);
      await store.exportCandidateProfile();
      expect(store.getSnapshot().error).toContain("Download failed");
      expect(store.getSnapshot().candidateReview!.document).toBe(document);
      files.copyText.mockResolvedValue(true);
      await store.exportCandidateProfile(true);
      expect(store.getSnapshot().info).toContain("copied");
      expect(store.getSnapshot().error).toBeNull();
      await store.reviseCandidateProfile("", "", "INVALID");
      expect(store.getSnapshot().candidateReview!.error).toBeTruthy();
      expect(store.getSnapshot().candidateReview!.document).toBe(document);
      expect(
        JSON.stringify({
          session: runtime.session,
          investigation: runtime.investigation,
        }),
      ).toBe(before);
      expect(runtime.registry.acceptedProfiles).toEqual([]);
    } finally {
      await store.dispose();
    }
  });
  it("changed target, geometry, definition and replacement review retire pending completion", async () => {
    let finish: (value: boolean) => void = () => {};
    const files = {
      copyText: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      ),
      download: vi.fn(),
    };
    const { store, runtime } = await setup(files);
    try {
      await store.createCandidateProfile();
      const original = store.getSnapshot().candidateReview!.document;
      const generating = store.createCandidateProfile();
      runtime.confirmProvisionalGeometry(24, 16);
      await generating;
      expect(store.getSnapshot().candidateReview!.document).toBe(original);
      expect(store.getSnapshot().candidateReview!.error).toContain(
        "context changed",
      );
      await store.createCandidateProfile();
      const pending = store.exportCandidateProfile(true);
      await vi.waitFor(() => expect(files.copyText).toHaveBeenCalledTimes(1));
      runtime.confirmProvisionalGeometry(16, 16);
      finish(true);
      await pending;
      expect(store.getSnapshot().info ?? "").not.toContain("copied");
      expect(store.getSnapshot().candidateReview!.stale).toBe(true);
      await store.exportCandidateProfile();
      expect(files.download).not.toHaveBeenCalled();
      expect(
        store.getSnapshot().candidateReview!.document.dimensions.width,
      ).toBe(24);
      await store.createCandidateProfile();
      expect(store.getSnapshot().candidateReview!.stale).toBe(false);
      expect(
        store.getSnapshot().candidateReview!.document.dimensions.width,
      ).toBe(16);
      const copying = store.exportCandidateProfile(true);
      await vi.waitFor(() => expect(files.copyText).toHaveBeenCalledTimes(2));
      await store.reviseCandidateProfile(
        "Public configuration",
        "public matching condition",
        "reviewed-display",
      );
      finish(true);
      await copying;
      expect(store.getSnapshot().info ?? "").not.toContain("copied");
      const current = runtime.session.profile!;
      runtime.session.profile = {
        ...current,
        metadata: { definitionChanged: true },
      };
      store.updateGeometryDraft("width", "16");
      expect(store.getSnapshot().candidateReview!.stale).toBe(true);
      runtime.applyFingerprint(
        {
          ...runtime.session.fingerprint!,
          browserDeviceId: "replacement-target",
        },
        "live",
      );
      await store.createCandidateProfile();
      expect(store.getSnapshot().candidateReview!.error).toBeTruthy();
      expect(store.getSnapshot().candidateReview!.document.id).toBe(
        "reviewed-display",
      );
    } finally {
      await store.dispose();
    }
  });
  it("inspects a missing or conflicting attachment without adopting evidence and loads disconnected", async () => {
    const { store, runtime } = await setup({
      copyText: async () => true,
      download: () => {},
    });
    try {
      await store.createCandidateProfile();
      const document = store.getSnapshot().candidateReview!.document;
      await runtime.disconnect();
      await store.reviewLocalProfile(JSON.stringify(document));
      expect(store.getSnapshot().profileEvidenceStatus).toBeNull();
      const source = runtime.investigation;
      await store.inspectProfileEvidence("{}");
      expect(store.getSnapshot().profileEvidenceStatus).toBeTruthy();
      expect(store.getSnapshot().profileReview!.document).toEqual(document);
      expect(runtime.investigation).toBe(source);
      store.loadLocalProfile();
      expect(store.controller).not.toBe(runtime);
      expect(store.controller.transport.state).toBe("idle");
      expect(store.controller.investigation).toBeNull();
      expect(store.controller.session.confirmedPlanDigest).toBeNull();
      expect(store.controller.session.experimentalTxEnabled).toBe(false);
    } finally {
      await store.dispose();
    }
  });
});
