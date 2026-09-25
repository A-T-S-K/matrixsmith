import {
  Framebuffer,
  FrameSequence,
  planRasterScroll,
  resolvesToScroll,
  diagnosticAnimation,
} from "./dependencies";
import type {
  TransmissionPlan,
  ScrollPlan,
  ContentPathId,
} from "./dependencies";
import { PERSISTENT_CONTENT_CONSEQUENCE } from "./types";
import { hexToRgb } from "./selectors";

import type { ExecutionProgress } from "./dependencies";

import type { ContentEditorStore } from "./content-editor-store";
import type { WorkspaceStore } from "./workspace-store";
import type { NavigationStore } from "./navigation-store";
import type { SnapshotStore } from "./snapshot-store";
import type { NoticeStore } from "./notice-store";
import type { PresentationEnvironment } from "../environment";
import type { PendingSendCommand } from "./internal-types";
interface Ports {
  contentEditorStore(): Pick<
    ContentEditorStore,
    | "getSettings"
    | "_renderTextFrame"
    | "getImageState"
    | "getGifBytes"
    | "getGifState"
  >;
  workspaceStore(): Pick<WorkspaceStore, "getController">;
  navigationStore(): Pick<NavigationStore, "_closeOverlay" | "_openOverlay">;
  snapshotStore(): Pick<SnapshotStore, "_emit">;
  noticeStore(): Pick<NoticeStore, "setError" | "_run" | "setInfo">;
}
export class ContentSendStore {
  async dispose(): Promise<void> {
    this._pendingSend = null;
    await this._wakeLock.release();
  }
  private _pendingSend: PendingSendCommand | null = null;
  private _sendProgress: ExecutionProgress | null = null;
  private readonly _wakeLock: PresentationEnvironment["wakeLock"];
  constructor(
    private readonly ports: Ports,
    environment: Pick<PresentationEnvironment, "wakeLock">,
  ) {
    this._wakeLock = environment.wakeLock;
  }
  getSendProgress() {
    return this._sendProgress;
  }
  getWakeLock() {
    return this._wakeLock;
  }
  getPendingSend() {
    return this._pendingSend;
  }
  setPendingSend(value: ContentSendStore["_pendingSend"]): void {
    this._pendingSend = value;
  }
  requestSendText(): void {
    void this._requestContentSend("Display text", "text", () => {
      const profile = this._requireProfile();
      if (
        resolvesToScroll(
          this.ports.contentEditorStore().getSettings().textDisplayMode,
          this.ports.contentEditorStore().getSettings().text.trim(),
          profile.width,
        )
      ) {
        const scroll = this._scrollPlan(profile.width, profile.height);
        if (!scroll?.safe)
          throw new Error(
            scroll?.warnings.at(-1) ??
              "Scrolling text exceeds the safe raster budget.",
          );
        const plan = this.ports.workspaceStore().getController().plan({
          type: "ShowScrollingText",
          text: this.ports.contentEditorStore().getSettings().text,
          sequence: scroll.sequence,
          backend: "raster",
        });
        const extras: Record<string, string> = {
          textContent: this.ports.contentEditorStore().getSettings().text,
          textRendering: "bounded raster scroll (embedded 5x7 font)",
          textWidth: String(scroll.textWidth),
          frameCount: String(scroll.frameCount),
          decodedBytesPerTile: String(scroll.decodedBytesPerTile),
          scrollStep: String(scroll.step),
          backend: "raster fallback",
        };
        return { plan, preview: scroll.sequence.frames[0] ?? null, extras };
      }
      const frame = this.ports
        .contentEditorStore()
        ._renderTextFrame(profile.width, profile.height);
      if (!frame) throw new Error("Enter text before sending.");
      const extras: Record<string, string> = {
        textContent: this.ports.contentEditorStore().getSettings().text,
        textRendering: "local bitmap renderer (embedded 5x7 font)",
      };
      return {
        plan: this.ports.workspaceStore().getController().plan({
          type: "ShowText",
          text: this.ports.contentEditorStore().getSettings().text,
          frame,
        }),
        preview: frame,
        extras,
      };
    });
  }
  requestSendImage(): void {
    void this._requestContentSend("Display image", "image", () => {
      const image = this.ports.contentEditorStore().getImageState();
      if (!image) throw new Error("Choose an image first.");
      return {
        plan: this.ports
          .workspaceStore()
          .getController()
          .plan({ type: "ShowFrame", frame: image.preview }),
        preview: image.preview,
        extras: {
          sourceDimensions: `${image.sourceWidth}×${image.sourceHeight}`,
          fitMode: image.fitMode,
          processingMode: image.processed?.resolvedMode ?? "legacy",
          outputColors: String(
            image.processed?.outputColorCount ?? "unmeasured",
          ),
        },
      };
    });
  }
  requestSendAnimation(): void {
    void this._requestContentSend("Send demo animation", "animation", () => {
      const sequence = this._buildAnimationSequence();
      return {
        plan: this.ports
          .workspaceStore()
          .getController()
          .plan({ type: "ShowAnimation", sequence }),
        preview: sequence.frames[0] ?? null,
      };
    });
  }
  requestSendGif(): void {
    void this._requestContentSend("Send experimental GIF", "gif", () => {
      const profile = this._requireProfile();
      const bytes = this.ports.contentEditorStore().getGifBytes();
      const meta = this.ports.contentEditorStore().getGifState();
      if (!bytes || !meta) throw new Error("Choose a GIF first.");
      const width = Math.min(meta.width ?? profile.width, profile.width);
      const height = Math.min(meta.height ?? profile.height, profile.height);
      return {
        plan: this.ports.workspaceStore().getController().plan({
          type: "ShowGif",
          gifBytes: bytes,
          width,
          height,
        }),
        preview: null,
      };
    });
  }
  cancelPendingSend(): void {
    this._pendingSend = null;
    this.ports.navigationStore()._closeOverlay("send");
    this.ports.snapshotStore()._emit();
  }
  async confirmPendingSend(): Promise<void> {
    const pending = this._pendingSend;
    if (!pending) return;
    await this._transmitContent(pending, true);
    this.ports.snapshotStore()._emit();
  }
  async _requestContentSend(
    label: string,
    path: ContentPathId,
    build: () => {
      plan: TransmissionPlan;
      preview: Framebuffer | null;
      extras?: Record<string, string>;
    },
  ): Promise<void> {
    try {
      const gate = this.ports
        .workspaceStore()
        .getController()
        .contentGates()
        .find((candidate) => candidate.path === path);
      if (!gate?.allowed)
        throw new Error(gate?.reason ?? "This content path is unavailable.");
      const built = build();
      const command: PendingSendCommand = {
        plan: built.plan,
        extras: built.extras,
        view: {
          planId: built.plan.id,
          label,
          consequence: PERSISTENT_CONTENT_CONSEQUENCE,
          packetCount: built.plan.packets.length,
          programBytes: Number(built.plan.metadata.programBytes ?? 0),
          chunkCount: Number(built.plan.metadata.chunkCount ?? 0),
          preview: built.preview,
        },
      };
      if (built.plan.validation === "verified")
        await this._transmitContent(command, false);
      else {
        this._pendingSend = command;
        this.ports.navigationStore()._openOverlay("send");
      }
    } catch (error) {
      this.ports
        .noticeStore()
        .setError(error instanceof Error ? error.message : String(error));
    }
    this.ports.snapshotStore()._emit();
  }
  async _transmitContent(
    pending: PendingSendCommand,
    confirmedConsequence: boolean,
  ): Promise<void> {
    await this.ports.noticeStore()._run("Updating display…", async () => {
      this._sendProgress = {
        completedPackets: 0,
        totalPackets: pending.plan.packets.length,
        elapsedMs: 0,
        estimatedRemainingMs: null,
      };
      this.ports.snapshotStore()._emit();
      const locked = await this._wakeLock.acquire();
      if (!locked && !this._wakeLock.supported)
        this.ports
          .noticeStore()
          .setInfo("Keep this screen on until sending finishes.");
      try {
        await this.ports
          .workspaceStore()
          .getController()
          .sendPersistentContent(pending.plan, {
            confirmedConsequence,
            extras: pending.extras,
            onProgress: (progress) => {
              this._sendProgress = progress;
              this.ports.snapshotStore()._emit();
            },
          });
        this._pendingSend = null;
        this.ports.navigationStore()._closeOverlay("send");
        this.ports.noticeStore().setInfo("Display updated.");
      } finally {
        this._sendProgress = null;
        await this._wakeLock.release();
      }
    });
  }
  _requireProfile(): { width: number; height: number } {
    const profile = this.ports.workspaceStore().getController().session.profile;
    if (!profile) throw new Error("No device profile is resolved.");
    return profile;
  }
  _buildAnimationSequence(): FrameSequence {
    const profile = this._requireProfile();
    return diagnosticAnimation(profile.width, profile.height);
  }
  _scrollPlan(width: number, height: number): ScrollPlan | null {
    const text = this.ports.contentEditorStore().getSettings().text.trim();
    if (!text) return null;
    return planRasterScroll(text, width, height, {
      color: hexToRgb(this.ports.contentEditorStore().getSettings().textColor),
      background: hexToRgb(
        this.ports.contentEditorStore().getSettings().textBackground,
      ),
    });
  }
}
