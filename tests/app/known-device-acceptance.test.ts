import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { MatrixStore } from "../../src/ui/store";
import type { DeviceFingerprint } from "../../src/core/device";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { compileAnimationStaticFrame, compileGraffitiFrame } from "../../src/drivers/coolledux/content";
import { encodeFrameRegion } from "../../src/drivers/coolledux/pixels";
import { Framebuffer } from "../../src/render/framebuffer";
import { ILEDHAT_PROFILE_ID } from "../../src/profiles/iledhat-31ae-32x16";

/**
 * The future normal user.
 *
 * Connect a known iLedHat, open Create, send a picture. No protocol probe, no
 * Investigation, no guided characterization, no session evidence of any kind.
 * Everything MatrixSmith needs was measured once and shipped with the profile.
 *
 * The companion suite below is the other half of the bargain: recognizing a
 * display we know must not make us less careful with one we do not.
 */

async function freshKnownDevice(): Promise<{ store: MatrixStore; controller: MatrixController; transport: ScriptedCoolLedUxDevice }> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new MatrixController(transport, new TraceRecorder());
  const store = new MatrixStore(controller, transport);
  await store.connect();
  return { store, controller, transport };
}

/** Same shared FFF0/FFF1 transport, a display nothing is known about. */
function unknownSharedTransport(): DeviceFingerprint {
  const known = knownIledHatFingerprint();
  const stripped: DeviceFingerprint = { ...known, name: "Generic LED Panel" };
  delete (stripped as { manufacturerDataHex?: string }).manufacturerDataHex;
  delete (stripped as { manuallyConfirmedGeometry?: unknown }).manuallyConfirmedGeometry;
  delete (stripped as { rawAdvertisementHex?: string }).rawAdvertisementHex;
  return stripped;
}

function testImage(): Framebuffer {
  const frame = new Framebuffer(32, 16);
  for (let x = 0; x < 8; x += 1) for (let y = 0; y < 8; y += 1) frame.setPixel(x, y, 255, 0, 0);
  for (let x = 24; x < 32; x += 1) for (let y = 8; y < 16; y += 1) frame.setPixel(x, y, 0, 0, 255);
  return frame;
}

describe("a fresh session on the known iLedHat is immediately usable", () => {
  it("resolves the driver and profile with no probe and no investigation", async () => {
    const { controller, transport } = await freshKnownDevice();
    // Nothing was run: no probe transaction, no guided test, no evidence.
    expect(transport.writes).toHaveLength(0);
    expect(controller.transactions).toHaveLength(0);
    expect(controller.investigation).toBeNull();
    expect(controller.allClaimEvidence().every((entry) => entry.scope !== "current-session")).toBe(true);

    expect(controller.session.selection?.selected?.id).toBe("coolledux");
    expect(controller.session.selection?.ambiguous).toBe(false);
    expect(controller.session.profile?.id).toBe(ILEDHAT_PROFILE_ID);
    expect(controller.profileReady()).toBe(true);
  });

  it("opens the image, text and animation gates from shipped evidence", async () => {
    const { controller } = await freshKnownDevice();
    expect(controller.contentGate("image").allowed).toBe(true);
    expect(controller.contentGate("text").allowed).toBe(true);
    expect(controller.contentGate("animation").allowed).toBe(true);
    // GIF depends on a decoder this panel has never been observed running.
    expect(controller.contentGate("gif").allowed).toBe(false);
    expect(controller.contentGate("gif").missingClaims).toContain("gif.playback");
  });

  it("derives animation-single-frame as the static strategy", async () => {
    const { controller } = await freshKnownDevice();
    const assessment = controller.staticViability();
    expect(assessment.selected).toBe("animation-single-frame");
    const verdicts = Object.fromEntries(assessment.strategies.map((entry) => [entry.strategy, entry.verdict]));
    expect(verdicts).toEqual({
      graffiti: "not-viable",
      "animation-single-frame": "viable",
      "animation-identical-frames": "viable",
    });
  });

  it("compiles a normal image through the verified one-frame Animation route", async () => {
    const { controller } = await freshKnownDevice();
    const frame = testImage();
    const plan = controller.plan({ type: "ShowFrame", frame });

    expect(plan.metadata.contentType).toBe("animation");
    expect(plan.metadata.rasterStrategy).toBe("animation-single-frame");
    expect(plan.metadata.frameCount).toBe(1);
    expect(plan.metadata.width).toBe(32);
    expect(plan.metadata.height).toBe(16);
    expect(plan.metadata.tileCount).toBe(4);
    expect(plan.metadata.tileWidth).toBe(8);

    // Byte-identical to the one-frame Animation compiler, and NOT to Graffiti.
    const animation = compileAnimationStaticFrame(frame, "single");
    expect(plan.metadata.crc32).toBe(`0x${animation.crc32.toString(16).padStart(8, "0").toUpperCase()}`);
    const graffiti = compileGraffitiFrame(frame, undefined, {}, { state: "true-black", basis: "observed" });
    expect(plan.metadata.crc32).not.toBe(`0x${graffiti.crc32.toString(16).padStart(8, "0").toUpperCase()}`);
  });

  it("encodes black as real 0x0000 and never touches the high nibble", async () => {
    const { controller } = await freshKnownDevice();
    controller.plan({ type: "ShowFrame", frame: testImage() });
    // The lit red square is 0x0F00; everything around it is literal 0x0000,
    // never the inherited 0x0004 sentinel, and no pixel sets byte0's high
    // nibble — this panel has no fourth channel for it to drive.
    const stream = encodeFrameRegion(testImage(), 0, 8, "animation");
    let sawBlack = false;
    let sawRed = false;
    for (let index = 0; index < stream.length; index += 2) {
      const word = ((stream[index] ?? 0) << 8) | (stream[index + 1] ?? 0);
      expect(word & 0xf000).toBe(0);
      expect(word).not.toBe(0x0004);
      if (word === 0x0000) sawBlack = true;
      if (word === 0x0f00) sawRed = true;
    }
    expect(sawBlack).toBe(true);
    expect(sawRed).toBe(true);
  });

  it("lets Create reach the confirmation step, without a probe", async () => {
    const { store, controller, transport } = await freshKnownDevice();
    store.updateContentSettings({ text: "HI" });
    store.requestSendText();
    const snapshot = store.getSnapshot();
    expect(snapshot.error).toBeNull();
    // Ready means characterized, not permitted: the send still stops for an
    // explicit confirmation, because it replaces the stored display program.
    expect(snapshot.pendingSend).not.toBeNull();
    expect(snapshot.pendingSend!.consequence).toMatch(/replaces/i);
    expect(transport.writes).toHaveLength(0);
    expect(controller.transactions).toHaveLength(0);
    // And it is the verified static route that was compiled.
    expect(store.getSnapshot().pendingSend!.label).toBe("Send rendered text");
    store.cancelPendingSend();
  });

  it("never asks the user to identify the protocol first", async () => {
    const { store } = await freshKnownDevice();
    const snapshot = store.getSnapshot();
    expect(snapshot.recommended.action).not.toBe("identify");
    expect(snapshot.device?.protocol).toBe("CoolLEDUX");
    expect(snapshot.device?.support).toBe("Supported");
    expect(snapshot.view).toBe("control");
  });

  it("names the static strategy in effect rather than claiming none was found", async () => {
    const { store } = await freshKnownDevice();
    // The label reads the strategy in EFFECT. Reading only a session-
    // validated value made a known, working display announce that no way to
    // show a still image had been found.
    expect(store.getSnapshot().rasterStrategyLabel).toBeTruthy();
    expect(store.controller.session.validatedRasterStrategy).toBeNull();
    expect(store.getSnapshot().coreProgress?.complete).toBe(true);
  });
});

describe("recognizing a known display does not weaken unknown-device safety", () => {
  async function freshUnknownDevice(): Promise<{ store: MatrixStore; controller: MatrixController }> {
    const transport = new ScriptedCoolLedUxDevice(unknownSharedTransport());
    const controller = new MatrixController(transport, new TraceRecorder());
    const store = new MatrixStore(controller, transport);
    await store.connect();
    return { store, controller };
  }

  it("inherits no iLedHat profile, driver assignment or evidence", async () => {
    const { controller } = await freshUnknownDevice();
    expect(controller.session.profile).toBeNull();
    expect(controller.session.selection?.selected).toBeNull();
    expect(controller.session.selection?.ambiguous).toBe(true);
    expect(controller.profileReady()).toBe(false);
    // Only source-reference facts about OTHER hardware are in scope.
    expect(controller.allClaimEvidence().every((entry) => entry.scope === "source-reference")).toBe(true);
  });

  it("keeps every content path gated", async () => {
    const { controller } = await freshUnknownDevice();
    for (const path of ["image", "text", "animation", "gif"] as const) {
      expect(controller.contentGate(path).allowed).toBe(false);
    }
    expect(controller.staticViability().selected).toBeNull();
  });

  it("cannot even build a plan without a resolved driver and profile", async () => {
    const { controller } = await freshUnknownDevice();
    expect(() => controller.plan({ type: "ShowFrame", frame: testImage() })).toThrow(/non-ambiguous/);
  });

  it("still offers safe identification as the next step", async () => {
    const { store } = await freshUnknownDevice();
    const snapshot = store.getSnapshot();
    expect(snapshot.recommended.action).toBe("identify");
    expect(snapshot.device?.support).toBe("Identification required");
    expect(snapshot.view).toBe("diagnose");
  });
});
