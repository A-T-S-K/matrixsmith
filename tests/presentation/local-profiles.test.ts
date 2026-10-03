import { describe, expect, it, vi } from "vitest";
import data from "../../src/profiles/data/authored-ux-banner.json";
import { ApplicationRuntime } from "../../src/application/runtime";
import { FakeTransport } from "../../src/transport/fake";
import { PresentationStore } from "../../src/presentation/store";
import { createBrowserEnvironment } from "../../src/adapters/presentation/browser-environment";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import type { DriverRegistry } from "../../src/drivers/registry";

function setup() {
  const transports: FakeTransport[] = [];
  let rejectConstruction = false;
  const createLiveWorkspace = (registry?: DriverRegistry) => {
    if (rejectConstruction) throw new Error("Workspace construction failed.");
    const transport = new FakeTransport(knownIledHatFingerprint());
    transports.push(transport);
    return {
      transport,
      controller: new ApplicationRuntime(transport, undefined, registry),
    };
  };
  const first = createLiveWorkspace();
  const store = new PresentationStore(first.controller, first.transport, {
    ...createBrowserEnvironment(),
    createLiveWorkspace,
  });
  return {
    store,
    transports,
    failConstruction: () => {
      rejectConstruction = true;
    },
  };
}
describe("local review and workspace publication", () => {
  it("rejects runtime namespaces without installing and retains inspection details", async () => {
    const { store, transports } = setup();
    try {
      const original = store.controller;
      store.updateContentSettings({ text: "keep reserved-attempt draft" });
      for (const namespace of ["provisional", "protocol-candidate"]) {
        await store.reviewLocalProfile(JSON.stringify({ ...data, namespace }));
        expect(store.getSnapshot().profileReview?.document?.namespace).toBe(
          namespace,
        );
        expect(store.getSnapshot().profileReview?.problems.join(" ")).toContain(
          "reserved",
        );
        store.loadLocalProfile();
        expect(store.controller).toBe(original);
        expect(store.getSnapshot().loadedProfiles).toEqual([]);
        expect(store.getSnapshot().content.settings.text).toBe(
          "keep reserved-attempt draft",
        );
      }
      expect(transports).toHaveLength(1);
    } finally {
      await store.dispose();
    }
  });
  it("preserves a pending valid review and existing registry, workspace and drafts after rejected attempts", async () => {
    const { store } = setup();
    try {
      await store.reviewLocalProfile(JSON.stringify(data));
      store.loadLocalProfile();
      const original = store.controller;
      const loaded = store.getSnapshot().loadedProfiles;
      store.updateContentSettings({ text: "keep pending-review draft" });
      store.updateGeometryDraft("width", "48");
      store.updateGeometryDraft("height", "8");
      const geometryDraft = store.getSnapshot().geometryDraft;
      const valid = {
        ...data,
        namespace: "another-local",
        matching: { ...data.matching, name: "another banner" },
      };
      await store.reviewLocalProfile(JSON.stringify(valid));
      const review = store.getSnapshot().profileReview;
      for (const text of [
        JSON.stringify({ ...data, namespace: "provisional" }),
        JSON.stringify({ ...data, namespace: "protocol-candidate" }),
        JSON.stringify({ ...data, implementation: "uninstalled" }),
        JSON.stringify(data),
        "{bad",
      ]) {
        await store.reviewLocalProfile(text);
        expect(store.getSnapshot().error).toBeTruthy();
        expect(store.getSnapshot().profileReview).toBe(review);
        expect(store.controller).toBe(original);
        expect(store.getSnapshot().loadedProfiles).toEqual(loaded);
        expect(store.getSnapshot().geometryDraft).toEqual(geometryDraft);
        expect(store.getSnapshot().content.settings.text).toBe(
          "keep pending-review draft",
        );
      }
      store.loadLocalProfile();
      expect(store.getSnapshot().loadedProfiles).toEqual([data, valid]);
      expect(store.getSnapshot().content.settings.text).toBe(
        "keep pending-review draft",
      );
    } finally {
      await store.dispose();
    }
  });
  it("loads atomically without connecting or writing and preserves drafts", async () => {
    const { store, transports } = setup();
    try {
      const original = store.controller;
      store.updateContentSettings({ text: "keep this draft" });
      await store.reviewLocalProfile(JSON.stringify(data));
      expect(store.controller).toBe(original);
      expect(store.getSnapshot().profileReview?.problems).toEqual([]);
      store.loadLocalProfile();
      expect(store.controller).not.toBe(original);
      expect(store.getSnapshot().content.settings.text).toBe("keep this draft");
      expect(store.getSnapshot().loadedProfiles).toHaveLength(1);
      expect(store.getSnapshot().liveConnected).toBe(false);
      expect(store.controller.session.experimentalTxEnabled).toBe(false);
      expect(store.controller.investigation).toBeNull();
      expect(
        transports.every((t) => t.state === "idle" && t.writes.length === 0),
      ).toBe(true);
      const exported = JSON.stringify(store.getSnapshot().loadedProfiles[0]);
      const second = setup();
      try {
        await second.store.reviewLocalProfile(exported);
        second.store.loadLocalProfile();
        expect(second.store.getSnapshot().loadedProfiles[0]).toEqual(
          store.getSnapshot().loadedProfiles[0],
        );
      } finally {
        await second.store.dispose();
      }
      const chooser = vi.spyOn(transports[1]!, "selectAndConnect");
      const connection = store.connect();
      expect(chooser).toHaveBeenCalledOnce(); // no asynchronous preparation ahead of chooser
      await connection;
    } finally {
      await store.dispose();
    }
  });
  it("preserves registry/workspace on malformed, incompatible and duplicate input", async () => {
    const { store } = setup();
    try {
      const previous = store.controller;
      await store.reviewLocalProfile("{bad");
      store.loadLocalProfile();
      expect(store.controller).toBe(previous);
      expect(store.getSnapshot().profileReview?.error).toContain("JSON");
      await store.reviewLocalProfile(
        JSON.stringify({ ...data, implementation: "uninstalled" }),
      );
      expect(store.getSnapshot().profileReview?.problems.join(" ")).toContain(
        "not installed",
      );
      store.loadLocalProfile();
      expect(store.controller).toBe(previous);
      await store.reviewLocalProfile(JSON.stringify(data));
      store.loadLocalProfile();
      const loaded = store.controller;
      await store.reviewLocalProfile(JSON.stringify(data));
      store.loadLocalProfile();
      expect(store.controller).toBe(loaded);
      expect(store.getSnapshot().profileReview?.problems.join(" ")).toContain(
        "Duplicate",
      );
    } finally {
      await store.dispose();
    }
  });
  it("preserves the previous runtime when replacement construction fails", async () => {
    const { store, failConstruction } = setup();
    try {
      const original = store.controller;
      await store.reviewLocalProfile(JSON.stringify(data));
      failConstruction();
      store.loadLocalProfile();
      expect(store.controller).toBe(original);
      expect(store.getSnapshot().loadedProfiles).toEqual([]);
      expect(store.getSnapshot().error).toContain("construction failed");
    } finally {
      await store.dispose();
    }
  });
  it("refuses active hot swap and invalidates prepared plans after disconnected replacement", async () => {
    const { store, transports } = setup();
    try {
      await store.connect();
      const previous = store.controller;
      const plan = previous.plan({ type: "GetDeviceInfo" });
      const acceptedProfile = previous.session.profile;
      Object.assign(previous.session, { profile: { ...acceptedProfile! } });
      previous.session.enableExperimentalTx();
      expect(previous.authorize(plan).allowed).toBe(false);
      expect(previous.authorize(plan).reasons.join(" ")).toContain(
        "definition changed",
      );
      Object.assign(previous.session, { profile: acceptedProfile });
      await store.reviewLocalProfile(JSON.stringify(data));
      store.loadLocalProfile();
      expect(store.controller).toBe(previous);
      expect(store.getSnapshot().profileLoadReason).toContain("Disconnect");
      await store.disconnect();
      store.loadLocalProfile();
      expect(store.controller).not.toBe(previous);
      expect(store.controller.authorize(plan).allowed).toBe(false);
      expect(previous.authorize(plan).allowed).toBe(false);
      expect(transports.every((t) => t.writes.length === 0)).toBe(true);
    } finally {
      await store.dispose();
    }
  });
});
