import { describe, expect, it } from "vitest";
import {
  findOfflineEntry,
  loadOfflineEntry,
  offlineCatalog,
} from "../../src/app/offline-catalog";
import { compileOfflineFrame } from "../../src/application/offline-compilation";
import {
  offlineReference,
  offlineRegistry,
} from "../../src/app/offline-entries/lsled";
import { Framebuffer } from "../../src/render/framebuffer";
import knowledge from "../../public/knowledge-v1.json";
import { builtInDrivers } from "../../src/drivers/registry";

describe("application-owned offline catalog", () => {
  it("loads literal immutable entries and rejects arbitrary paths and labels", async () => {
    expect(Object.isFrozen(offlineCatalog)).toBe(true);
    expect(offlineCatalog.map((entry) => entry.id)).toEqual([
      "microbit",
      "lsled",
      "merkury",
    ]);
    const entry = await loadOfflineEntry("lsled");
    expect(Object.isFrozen(entry)).toBe(true);
    expect(entry.reference).toBe(offlineReference);
    for (const descriptor of offlineCatalog) {
      const loaded = await loadOfflineEntry(descriptor.id);
      expect(loaded.id).toBe(descriptor.id);
      expect(loaded.label).toBe(descriptor.label);
      expect(loaded.geometry).toEqual({
        width: loaded.reference.profile.width,
        height: loaded.reference.profile.height,
      });
      expect(
        builtInDrivers.some(
          (driver) => driver.id === loaded.reference.profile.driverId,
        ),
      ).toBe(false);
      for (const basis of loaded.reference.sourceBasis) {
        const [id, revision] = basis.split("@");
        const source = knowledge.sources.find((source) => source.id === id);
        expect(source, `Missing source ${id}`).toBeDefined();
        expect(loaded.sourceIds).toContain(id);
        if (/^[a-f0-9]{40}$/.test(revision!))
          expect(source!.revision).toBe(revision);
      }
      expect(findOfflineEntry(descriptor.label)).toBeUndefined();
      await expect(loadOfflineEntry(descriptor.label)).rejects.toThrow(
        /Unknown offline reference/,
      );
    }
    for (const id of [
      "../drivers/coolled",
      "LSLED legacy 44×11",
      "x".repeat(33),
      "unknown",
      "https://evil.test",
    ]) {
      expect(findOfflineEntry(id)).toBeUndefined();
      await expect(loadOfflineEntry(id)).rejects.toThrow(
        /Unknown offline reference/,
      );
    }
  });
  it("cannot substitute a reference by its labels or forge its source basis", () => {
    const op = { type: "ShowFrame" as const, frame: new Framebuffer(44, 11) };
    expect(() =>
      compileOfflineFrame(
        offlineRegistry,
        { ...offlineReference, profile: { ...offlineReference.profile } },
        op,
      ),
    ).toThrow(/registered/);
    expect(() =>
      compileOfflineFrame(
        offlineRegistry,
        { ...offlineReference, sourceBasis: ["invented"] },
        op,
      ),
    ).toThrow(/source basis/);
  });
  it("owns independent deterministic output after caller mutation and later compilation", async () => {
    const entry = await loadOfflineEntry("lsled");
    const input = new Framebuffer(44, 11);
    const first = compileOfflineFrame(offlineRegistry, offlineReference, {
      type: "ShowFrame",
      frame: input,
    });
    const hex = first.plan.packets.map((p) => p.hex);
    input.data.fill(255);
    entry.compile("asymmetric").plan.packets[0]!.bytes.fill(42);
    expect(first.preview.data.every((v) => v === 0)).toBe(true);
    expect(first.plan.packets.map((p) => p.hex)).toEqual(hex);
    expect(
      entry.compile("blank").plan.packets.map((p) => [...p.bytes]),
    ).toEqual(first.plan.packets.map((p) => [...p.bytes]));
  });
});
