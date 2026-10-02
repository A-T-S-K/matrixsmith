import { ContentCache } from "./content-cache";
import type { ContentCompilationRecord } from "../../diagnostics/content-evidence";
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
import { PERSISTENT_CONTENT_CONSEQUENCE, type SendAttempt } from "./types";
import { hexToRgb } from "./selectors";

import type { ConnectionStore } from "./connection-store";

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
    | "getGifSequence"
    | "getGifState"
    | "retainDraftForReconnect"
  >;
  workspaceStore(): Pick<WorkspaceStore, "getController">;
  navigationStore(): Pick<NavigationStore, "_closeOverlay" | "_openOverlay">;
  snapshotStore(): Pick<SnapshotStore, "_emit">;
  noticeStore(): Pick<NoticeStore, "setError" | "_run" | "setInfo" | "getBusy">;
  connectionStore(): Pick<ConnectionStore, "disconnect" | "connect">;
}
export class ContentSendStore {
  private scrollCache = new ContentCache<ScrollPlan | null>();
  private demoCache = new ContentCache<FrameSequence>();
  clearContentCaches(): void {
    this.scrollCache.clear();
    this.demoCache.clear();
  }
  captureCaches() {
    return { scroll: this.scrollCache, demo: this.demoCache };
  }
  restoreCaches(
    state: ReturnType<ContentSendStore["captureCaches"]> | null,
  ): void {
    this.scrollCache = state?.scroll ?? new ContentCache<ScrollPlan | null>();
    this.demoCache = state?.demo ?? new ContentCache<FrameSequence>();
  }
  invalidateContext(): void {
    this._pendingSend = null;
    this.owner = null;
    this.attempt = null;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.invalidateContext();
    await this._wakeLock.release();
  }
  private _pendingSend: PendingSendCommand | null = null;
  private attempt: SendAttempt | null = null;
  private owner: {
    id: number;
    workspace: ReturnType<WorkspaceStore["getController"]>;
    connectionId: string | null;
    width: number | undefined;
    height: number | undefined;
    profile: ReturnType<WorkspaceStore["getController"]>["session"]["profile"];
  } | null = null;
  private nextAttempt = 0;
  private disposed = false;
  private readonly wakeOwners = new Set<number>();
  private current(owner = this.owner): boolean {
    const workspace = this.ports.workspaceStore().getController();
    return (
      !this.disposed &&
      owner !== null &&
      this.owner === owner &&
      owner.workspace === workspace &&
      owner.connectionId === workspace.transport.connectionId &&
      owner.profile === workspace.session.profile &&
      owner.width === workspace.session.profile?.width &&
      owner.height === workspace.session.profile?.height
    );
  }
  getSendAttempt(): SendAttempt | null {
    return this.current() ? this.attempt : null;
  }
  private readonly _wakeLock: PresentationEnvironment["wakeLock"];
  constructor(
    private readonly ports: Ports,
    environment: Pick<PresentationEnvironment, "wakeLock">,
  ) {
    this._wakeLock = environment.wakeLock;
  }
  getSendProgress() {
    return this.getSendAttempt()?.phase === "sending"
      ? (this.attempt?.progress ?? null)
      : null;
  }
  getWakeLock() {
    return this._wakeLock;
  }
  getPendingSend() {
    return this.current() ? this._pendingSend : null;
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
            scroll?.reason ?? "Scrolling text exceeds the safe raster budget.",
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
      const profile = this._requireProfile();
      if (
        image.preview.width !== profile.width ||
        image.preview.height !== profile.height
      )
        throw new Error(
          "This image was prepared for another display size. Choose the file again.",
        );
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
    void this._requestContentSend("Display GIF", "gif", () => {
      const profile = this._requireProfile();
      const sequence = this.ports.contentEditorStore().getGifSequence();
      const meta = this.ports.contentEditorStore().getGifState();
      if (!sequence || !meta) throw new Error("Choose a GIF first.");
      if (
        sequence.width !== profile.width ||
        sequence.height !== profile.height
      )
        throw new Error(
          "This GIF was decoded for another display size. Choose the file again.",
        );
      return {
        plan: this.ports
          .workspaceStore()
          .getController()
          .plan({ type: "ShowAnimation", sequence }),
        preview: sequence.frames[0] ?? null,
        extras: {
          originalContent: "gif",
          deliveryBackend: "local-gif-raster-animation",
          sourceDimensions: `${meta.sourceWidth}×${meta.sourceHeight}`,
          frameCount: meta.frameCount,
          frameDelaysMs: sequence.timing.map(
            ({ milliseconds }) => milliseconds,
          ),
          totalDurationMs: meta.totalDurationMs,
          sourceRepetition: meta.repetition,
        },
      };
    });
  }

  cancelPendingSend(): void {
    if (this.attempt?.phase === "sending") return;
    this._pendingSend = null;
    if (this.current() && this.attempt?.phase === "confirming")
      this.attempt = null;
    this.ports.navigationStore()._closeOverlay("send");
    this.ports.snapshotStore()._emit();
  }
  async confirmPendingSend(): Promise<void> {
    const pending = this.getPendingSend();
    if (
      !pending ||
      this.attempt?.phase !== "confirming" ||
      this.ports.noticeStore().getBusy()
    )
      return;
    await this._transmitContent(pending, true);
  }
  async _requestContentSend(
    label: string,
    path: ContentPathId,
    build: () => {
      plan: TransmissionPlan;
      preview: Framebuffer | null;
      extras?: Partial<ContentCompilationRecord>;
    },
  ): Promise<void> {
    if (this.disposed || this.ports.noticeStore().getBusy()) return;
    const workspace = this.ports.workspaceStore().getController();
    if (
      workspace.transport.state === "quarantined" &&
      this.getSendAttempt()?.failure?.reconnectRequired
    )
      return;
    const owner = {
      id: ++this.nextAttempt,
      workspace,
      connectionId: workspace.transport.connectionId,
      profile: workspace.session.profile,
      width: workspace.session.profile?.width,
      height: workspace.session.profile?.height,
    };
    this.owner = owner;
    this._pendingSend = null;
    this.attempt = {
      id: owner.id,
      path,
      target: workspace.session.profile?.name ?? "Current display",
      connectionId: owner.connectionId,
      phase: "preparing",
      progress: null,
      evidence: null,
      failure: null,
    };
    try {
      const gate = workspace
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
      else if (this.current(owner)) {
        this._pendingSend = command;
        this.attempt = { ...this.attempt!, phase: "confirming" };
        this.ports.navigationStore()._openOverlay("send");
      }
    } catch (error) {
      if (this.current(owner)) this.fail(error, false);
    }
    this.ports.snapshotStore()._emit();
  }
  private fail(error: unknown, executionStarted: boolean): void {
    this.attempt = {
      ...this.attempt!,
      phase: "failed",
      evidence: null,
      failure: {
        stage: executionStarted ? "upload" : "preflight",
        message: error instanceof Error ? error.message : String(error),
        reconnectRequired:
          this.owner!.workspace.transport.state === "quarantined",
      },
    };
  }
  async _transmitContent(
    pending: PendingSendCommand,
    confirmedConsequence: boolean,
  ): Promise<void> {
    const owner = this.owner;
    if (!owner || !this.current(owner)) return;
    await this.ports.noticeStore()._run("Sending upload…", async () => {
      let executionStarted = false;
      this.attempt = { ...this.attempt!, phase: "sending", progress: null };
      this._pendingSend = null;
      this.ports.navigationStore()._closeOverlay("send");
      this.ports.snapshotStore()._emit();
      this.wakeOwners.add(owner.id);
      try {
        await this._wakeLock.acquire();
        if (!this.current(owner)) return;
        const result = await owner.workspace.sendPersistentContent(
          pending.plan,
          {
            confirmedConsequence,
            extras: pending.extras,
            onExecutionStarted: () => {
              executionStarted = true;
            },
            onProgress: (progress) => {
              if (!this.current(owner)) return;
              this.attempt = { ...this.attempt!, progress };
              this.ports.snapshotStore()._emit();
            },
          },
        );
        if (this.current(owner))
          this.attempt = {
            ...this.attempt!,
            phase: "completed",
            evidence: {
              hostAccepted: result.hostAccepted,
              protocolAcknowledged: result.protocolAcknowledged,
              deviceStateVerified: result.deviceStateVerified,
              responseTimedOut: result.responseTimedOut,
              completedAt: result.completedAt,
              finalWriteAcceptedAt: result.finalWriteAcceptedAt,
            },
          };
      } catch (error) {
        if (this.current(owner)) this.fail(error, executionStarted);
      } finally {
        this.wakeOwners.delete(owner.id);
        if (this.wakeOwners.size === 0) await this._wakeLock.release();
        this.ports.snapshotStore()._emit();
      }
    });
  }
  async reconnectAndReviewDraft(): Promise<void> {
    const owner = this.owner;
    if (
      !owner ||
      !this.current(owner) ||
      !this.attempt?.failure?.reconnectRequired ||
      this.ports.noticeStore().getBusy()
    )
      return;
    this._pendingSend = null;
    this.attempt = { ...this.attempt, phase: "recovering" };
    this.ports.snapshotStore()._emit();
    const finishDraftRecovery = this.ports
      .contentEditorStore()
      .retainDraftForReconnect();
    try {
      await this.ports.connectionStore().disconnect();
      if (
        this.disposed ||
        this.owner !== owner ||
        this.ports.workspaceStore().getController() !== owner.workspace
      )
        return;
      if (owner.workspace.transport.state !== "idle") return;
      await this.ports.connectionStore().connect();
      if (
        this.disposed ||
        this.owner !== owner ||
        this.ports.workspaceStore().getController() !== owner.workspace
      )
        return;
      if (
        this.ports.workspaceStore().getController().transport.state ===
          "connected" &&
        owner.workspace.transport.connectionId !== owner.connectionId
      ) {
        this.owner = {
          ...owner,
          connectionId: owner.workspace.transport.connectionId,
          profile: owner.workspace.session.profile,
          width: owner.workspace.session.profile?.width,
          height: owner.workspace.session.profile?.height,
        };
        this.attempt = {
          ...this.attempt!,
          connectionId: this.owner.connectionId,
          target: owner.workspace.session.profile?.name ?? "Current display",
          phase: "review",
          progress: null,
          evidence: null,
          failure: null,
        };
        this.ports.noticeStore().setInfo(null);
      } else {
        this.owner = {
          ...owner,
          connectionId: owner.workspace.transport.connectionId,
          profile: owner.workspace.session.profile,
          width: owner.workspace.session.profile?.width,
          height: owner.workspace.session.profile?.height,
        };
        this.attempt = {
          ...this.attempt!,
          connectionId: this.owner.connectionId,
          phase: "failed",
          failure: {
            stage: "upload",
            message:
              "Reconnect did not complete. The previous upload outcome is still unknown. Review the connection error and reconnect before sending.",
            reconnectRequired: true,
          },
        };
      }
    } finally {
      finishDraftRecovery();
      this.ports.snapshotStore()._emit();
    }
  }
  _requireProfile(): { width: number; height: number } {
    const profile = this.ports.workspaceStore().getController().session.profile;
    if (!profile) throw new Error("No device profile is resolved.");
    return profile;
  }
  _buildAnimationSequence(): FrameSequence {
    const profile = this._requireProfile();
    const workspace = this.ports.workspaceStore().getController();
    return this.demoCache.get(
      [workspace, workspace.session.profile, profile.width, profile.height],
      () => diagnosticAnimation(profile.width, profile.height),
    );
  }
  _scrollPlan(width: number, height: number): ScrollPlan | null {
    const workspace = this.ports.workspaceStore().getController();
    const settings = this.ports.contentEditorStore().getSettings();
    return this.scrollCache.get(
      [
        workspace,
        workspace.session.profile,
        width,
        height,
        settings.text,
        settings.textColor,
        settings.textBackground,
        settings.textDisplayMode,
      ],
      () => {
        const text = settings.text.trim();
        if (!text) return null;
        return planRasterScroll(text, width, height, {
          color: hexToRgb(
            this.ports.contentEditorStore().getSettings().textColor,
          ),
          background: hexToRgb(
            this.ports.contentEditorStore().getSettings().textBackground,
          ),
        });
      },
    );
  }
}
