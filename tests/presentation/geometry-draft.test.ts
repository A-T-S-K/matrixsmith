import { expect, it } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { DriverRegistry } from "../../src/drivers/registry";
import { FakeTransport } from "../../src/transport/fake";
import { ReplayTransport } from "../../src/transport/replay";
import { PresentationStore } from "../../src/presentation/store";
import { createBrowserEnvironment } from "../../src/adapters/presentation/browser-environment";
import {
  lumenFrame,
  syntheticDriver,
  syntheticFingerprint,
} from "../helpers/synthetic-driver";

it("keeps blank/raw drafts per workspace and authorized target, retaining text but expiring response provenance on reconnect", async () => {
  const registry = new DriverRegistry([syntheticDriver]);
  const transport = new FakeTransport(syntheticFingerprint());
  transport.notificationOnWrite = lumenFrame(0x91, [0x4c, 0x4d, 24, 8, 7]);
  const runtime = new ApplicationRuntime(transport, undefined, registry);
  const store = new PresentationStore(runtime, transport, {
    ...createBrowserEnvironment(),
    createOfflineWorkspace: (fingerprint) => {
      const replay = new ReplayTransport(fingerprint);
      return {
        transport: replay,
        controller: new ApplicationRuntime(replay, undefined, registry),
      };
    },
  });
  try {
    await store.connect();
    runtime.session.enableExperimentalTx();
    await store.identify();
    expect(store.getSnapshot().geometryDraft).toMatchObject({
      width: "",
      height: "",
    });
    store.updateGeometryDraft("width", "2.");
    store.updateGeometryDraft("width", "");
    expect(store.getSnapshot().geometryDraft.width).toBe("");
    store.updateGeometryDraft("width", "2.");
    store.updateGeometryDraft("height", "8");
    store.submitGeometryDraft();
    expect(store.getSnapshot().geometryDraft).toMatchObject({
      width: "2.",
      height: "8",
      errors: { width: expect.any(String) },
    });
    expect(runtime.session.profile).toBeNull();
    store.setView("develop");
    store.setView("control");
    store.setView("diagnose");
    expect(store.getSnapshot().geometryDraft.width).toBe("2.");
    const proposal = store.getSnapshot().geometryProposal!;
    store.confirmProvisionalGeometry(16, 8);
    expect(store.getSnapshot().assessment.readiness).toBe("limited");
    expect(store.getSnapshot().guidedTests).toEqual([]);
    expect(store.getSnapshot().nextTest).toBeNull();
    expect(store.getSnapshot().recommended.action).toBe("checks");
    store.updateContentSettings({ text: "HI" });
    const preview = store.getSnapshot().content.textPreview;
    expect(preview).not.toBeNull();
    store.confirmProvisionalGeometry(24, 8);
    expect(store.getSnapshot().content.textPreview).not.toBe(preview);
    expect(store.getSnapshot().geometryDraft).toMatchObject({
      width: "2.",
      height: "8",
    });
    const json = runtime.exportBundle();
    store.importBundle(json);
    expect(store.getSnapshot().geometryDraft).toMatchObject({
      width: "",
      height: "",
    });
    expect(store.getSnapshot().geometryProposal).toBeNull();
    store.updateGeometryDraft("width", "99");
    store.returnToLiveWorkspace();
    expect(store.getSnapshot().geometryDraft).toMatchObject({
      width: "2.",
      height: "8",
    });
    expect(store.getSnapshot().geometryProposal?.id).toBe(proposal.id);
    expect(runtime.session.experimentalTxEnabled).toBe(false);
    expect(runtime.session.confirmedPlanDigest).toBeNull();
    await store.disconnect();
    await store.connect();
    expect(store.getSnapshot().geometryDraft).toMatchObject({
      width: "2.",
      height: "8",
    });
    expect(store.getSnapshot().geometryProposal).toBeNull();
    store.useReportedGeometry(proposal.id);
    expect(store.getSnapshot().error).toMatch(/expired/);
    // A new authorized unit of the same model must not inherit the draft.
    runtime.session.fingerprint = {
      ...syntheticFingerprint(),
      browserDeviceId: "replacement-unit",
    };
    store.setView("diagnose");
    expect(store.getSnapshot().geometryDraft).toMatchObject({
      width: "",
      height: "",
    });
    expect(store.getSnapshot().geometryProposal).toBeNull();
  } finally {
    await store.dispose();
  }
});
