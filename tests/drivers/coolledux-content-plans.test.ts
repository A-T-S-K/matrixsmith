import { describe, expect, it } from "vitest";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { Framebuffer } from "../../src/render/framebuffer";
import { diagnosticAnimation, orientationPattern } from "../../src/render/patterns";
import { renderText } from "../../src/render/font";
import type { DriverContext } from "../../src/drivers/types";

const context: DriverContext = { profile: iledHat31aeProfile, fingerprint: knownIledHatFingerprint(), source: "live" };

describe("CoolLEDUX content plans", () => {
  it("compiles ShowFrame into an honest persistent experimental multi-packet plan", () => {
    const plan = coolLedUxDriver.plan({ type: "ShowFrame", frame: orientationPattern(32, 16) }, context);
    expect(plan.risk).toBe("persistent");
    expect(plan.persistence).toBe("persistent");
    expect(plan.validation).toBe("experimental");
    expect(plan.packets.length).toBeGreaterThan(2);
    // The characterized profile routes normal static content through
    // one-frame Animation; Graffiti was physically ruled out on this panel.
    expect(plan.metadata.contentType).toBe("animation");
    expect(plan.metadata.rasterStrategy).toBe("animation-single-frame");
    expect(plan.metadata.tileCount).toBe(4);
    expect(plan.metadata.chunkCount).toBe(plan.packets.length - 1);
    expect(plan.recoveryNotes.join(" ")).toContain("replaces the stored display program");
  });

  it("attaches 60 ms pacing metadata to every packet without sleeping in the codec", () => {
    const plan = coolLedUxDriver.plan({ type: "ShowFrame", frame: orientationPattern(32, 16) }, context);
    expect(plan.packets.every((packet) => packet.delayAfterMs === 60)).toBe(true);
  });

  it("derives dimensions from the profile and rejects mismatched content", () => {
    expect(() => coolLedUxDriver.plan({ type: "ShowFrame", frame: new Framebuffer(64, 16) }, context)).toThrow(/DeviceProfile/);
    expect(() => coolLedUxDriver.plan({ type: "ShowFrame", frame: new Framebuffer(32, 8) }, context)).toThrow(/DeviceProfile/);
  });

  it("compiles ShowText from a locally rendered framebuffer", () => {
    const frame = renderText("HI", 32, 16, { color: { r: 255, g: 0, b: 0 } });
    const plan = coolLedUxDriver.plan({ type: "ShowText", text: "HI", frame }, context);
    expect(plan.metadata.contentType).toBe("text");
    expect(plan.risk).toBe("persistent");
    // The plan itself never embeds the text; reports decide whether to include it.
    expect(JSON.stringify(plan.metadata)).not.toContain("HI");
  });

  it("requires the rendered framebuffer for ShowText", () => {
    expect(() => coolLedUxDriver.plan({ type: "ShowText", text: "HI" }, context)).toThrow(/rendered Framebuffer/);
  });

  it("compiles ShowAnimation with per-frame delays preserved in metadata", () => {
    const plan = coolLedUxDriver.plan({ type: "ShowAnimation", sequence: diagnosticAnimation(32, 16) }, context);
    expect(plan.metadata.contentType).toBe("animation");
    expect(plan.metadata.frameCount).toBe(2);
    expect(plan.metadata.tileCount).toBe(4);
  });

  it("compiles ShowGif with raw bytes and warns via geometry checks", () => {
    const gif = Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 8, 0, 16, 0, 0, 0);
    const plan = coolLedUxDriver.plan({ type: "ShowGif", gifBytes: gif, width: 8, height: 16 }, context);
    expect(plan.metadata.contentType).toBe("gif");
    expect(() => coolLedUxDriver.plan({ type: "ShowGif", gifBytes: gif, width: 64, height: 16 }, context)).toThrow(/exceeds/);
  });

  it("keeps every content capability persistent, whatever its confidence", () => {
    const capabilities = coolLedUxDriver.capabilities(iledHat31aeProfile);
    for (const id of ["static-frame", "text", "animation", "gif"] as const) {
      const capability = capabilities.find((value) => value.id === id);
      expect(capability?.risk).toBe("persistent");
      expect(capability?.persistence).toBe("persistent");
    }
  });

  it("presents each capability at the confidence its evidence supports", () => {
    const byId = new Map(coolLedUxDriver.capabilities(iledHat31aeProfile).map((capability) => [capability.id, capability]));
    // Physically demonstrated on this panel.
    expect(byId.get("static-frame")?.validation).toBe("verified");
    expect(byId.get("static-frame")?.evidenceConfidence).toBe("observed");
    expect(byId.get("animation")?.validation).toBe("verified");
    // Rides on that verified substrate, but has not been looked at yet, so it
    // is corroborated rather than directly observed.
    expect(byId.get("text")?.validation).toBe("verified");
    expect(byId.get("text")?.evidenceConfidence).toBe("corroborated");
    // Never demonstrated here at all.
    expect(byId.get("gif")?.validation).toBe("experimental");
    expect(byId.get("power")?.validation).toBe("experimental");
    expect(byId.get("power")?.live).toBe(false);
  });

  it("keeps an uncharacterized CoolLEDUX profile's content experimental", () => {
    const generic = { ...iledHat31aeProfile, id: "coolledux-unknown" };
    const byId = new Map(coolLedUxDriver.capabilities(generic).map((capability) => [capability.id, capability]));
    for (const id of ["static-frame", "text", "animation", "gif"] as const) {
      expect(byId.get(id)?.validation).toBe("experimental");
    }
  });
});
