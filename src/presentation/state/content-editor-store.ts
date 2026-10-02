import { ContentCache } from "./content-cache";
import type { FrameSequence } from "../../render/frame-sequence";
import { CONTENT_TEXT_CODE_UNIT_LIMIT } from "../../storage/settings";
import {
  Framebuffer,
  renderText,
  DEFAULT_CONTENT_SETTINGS,
  saveContentSettings,
  INPUT_LIMITS,
} from "./dependencies";
import type {
  FitMode,
  ImageComposition,
  ImageMode,
  ContentSettings,
} from "./dependencies";
import { hexToRgb } from "./selectors";
import { loadContentSettings } from "./dependencies";
import type { DecodedImageSource } from "./dependencies";
import type { ContentState } from "./types";

import type { NoticeStore } from "./notice-store";
import type { SnapshotStore } from "./snapshot-store";
import type { WorkspaceStore } from "./workspace-store";
import type { PresentationEnvironment } from "../environment";

interface Ports {
  noticeStore(): Pick<NoticeStore, "setError" | "_run" | "setInfo">;
  snapshotStore(): Pick<SnapshotStore, "_emit">;
  workspaceStore(): Pick<WorkspaceStore, "getController">;
}
export class ContentEditorStore {
  private readonly textCache = new ContentCache<Framebuffer | null>();
  clearTextCache(): void {
    this.textCache.clear();
  }
  dispose(): void {
    this.reconnectDraft = null;
    this.clearTextCache();
    this._imageVersion++;
    this._gifVersion++;
    this._imageFile = null;
    this.imageOwner = null;
    this._imageState = null;
    this._imageSource = null;
    this._gifAbort?.abort();
    this._gifSequence = null;
    this._gifState = null;
  }
  private _settings: ContentSettings;
  private imageOwner: {
    workspace: ReturnType<ReturnType<Ports["workspaceStore"]>["getController"]>;
    profile: ReturnType<
      ReturnType<Ports["workspaceStore"]>["getController"]
    >["session"]["profile"];
    width: number;
    height: number;
  } | null = null;
  private _imageFile: Blob | null = null;
  private _imageSource: DecodedImageSource | null = null;
  private _imageName = "";
  private _imageVersion = 0;
  private _gifVersion = 0;
  private _imageState: ContentState["image"] | null = null;
  private _gifSequence: FrameSequence | null = null;
  private _gifAbort: AbortController | null = null;
  private _gifState: ContentState["gif"] | null = null;
  constructor(
    private readonly ports: Ports,
    private readonly environment: Pick<PresentationEnvironment, "storage">,
  ) {
    this._settings = loadContentSettings(environment.storage);
  }
  getSettings() {
    return this._settings;
  }
  private reconnectDraft: { finished: boolean } | null = null;
  /** Hold the existing preview through this explicit disconnect/connect only. */
  retainDraftForReconnect(): () => void {
    const token = { finished: false };
    const owner = this.imageOwner;
    this.reconnectDraft = token;
    return () => {
      if (this.reconnectDraft !== token || this.imageOwner !== owner) return;
      token.finished = true;
      const workspace = this.ports.workspaceStore().getController();
      const profile = workspace.session.profile;
      if (!profile && owner?.workspace === workspace) return;
      this.reconnectDraft = null;
      if (
        owner &&
        owner.workspace === workspace &&
        profile &&
        owner.width === profile.width &&
        owner.height === profile.height &&
        owner.profile?.id === profile.id
      ) {
        this.imageOwner = { ...owner, profile };
      }
    };
  }
  getImageState() {
    const current = this.ports.workspaceStore().getController();
    if (this.reconnectDraft?.finished && current.session.profile) {
      const owner = this.imageOwner;
      const profile = current.session.profile;
      if (
        owner?.workspace === current &&
        owner.width === profile.width &&
        owner.height === profile.height &&
        owner.profile?.id === profile.id
      )
        this.imageOwner = { ...owner, profile };
      this.reconnectDraft = null;
    }
    if (
      this.imageOwner &&
      !(this.reconnectDraft && this.imageOwner.workspace === current) &&
      (this.imageOwner.workspace !== current ||
        this.imageOwner.profile !== current.session.profile ||
        this.imageOwner.width !== current.session.profile?.width ||
        this.imageOwner.height !== current.session.profile?.height)
    ) {
      this._imageState = null;
      this._imageFile = null;
      this._imageSource = null;
      this.imageOwner = null;
    }
    return this._imageState;
  }
  getGifSequence() {
    return this._gifSequence;
  }
  getGifState() {
    return this._gifState;
  }
  updateContentSettings(partial: Partial<ContentSettings>): void {
    if (
      partial.text !== undefined &&
      partial.text.length > CONTENT_TEXT_CODE_UNIT_LIMIT
    ) {
      this.ports
        .noticeStore()
        .setError(
          `Text is limited to ${CONTENT_TEXT_CODE_UNIT_LIMIT} text units (some symbols use two) to keep editing responsive. The previous text was retained.`,
          "text-limit",
        );
      this.ports.snapshotStore()._emit();
      return;
    }
    this.ports.noticeStore().setError(null, "text-limit");
    this._settings = { ...this._settings, ...partial, schemaVersion: 1 };
    const saved = saveContentSettings(this._settings, this.environment.storage);
    if (!saved.ok)
      this.ports
        .noticeStore()
        .setError(`Settings were not saved: ${saved.message}`, "settings");
    else this.ports.noticeStore().setError(null, "settings");
    this.ports.snapshotStore()._emit();
  }
  resetContentSettings(): void {
    this._settings = DEFAULT_CONTENT_SETTINGS;
    const saved = saveContentSettings(this._settings, this.environment.storage);
    if (!saved.ok)
      this.ports
        .noticeStore()
        .setError(`Settings were not saved: ${saved.message}`, "settings");
    else this.ports.noticeStore().setError(null, "settings");
    this.ports.snapshotStore()._emit();
  }
  async loadImage(file: Blob, name: string): Promise<void> {
    const version = ++this._imageVersion;
    const workspace = this.ports.workspaceStore().getController();
    const profile = workspace.session.profile;
    const width = profile?.width;
    const height = profile?.height;
    const isCurrent = (): boolean =>
      version === this._imageVersion &&
      workspace === this.ports.workspaceStore().getController() &&
      workspace.session.profile === profile &&
      workspace.session.profile?.width === width &&
      workspace.session.profile?.height === height;
    if (file.size > INPUT_LIMITS.captureBytes)
      throw new Error("Image file exceeds the 25 MiB input budget.");
    const { decodeImageFile, decodeImageSource, ILEDHAT_RGB444, processImage } =
      await import("../../render/image");
    await this.ports.noticeStore()._run("Decoding image…", async () => {
      if (!isCurrent()) return;
      if (!profile)
        throw new Error(
          "Connect and identify a display before importing an image.",
        );
      try {
        const source = await decodeImageSource(file);
        if (!isCurrent()) return;
        const processed =
          this._settings.imageMode === "legacy"
            ? null
            : processImage(
                source,
                profile.width,
                profile.height,
                this._imageRecipe(),
                ILEDHAT_RGB444,
              );
        const decoded = processed
          ? {
              frame: processed.frame,
              sourceWidth: source.width,
              sourceHeight: source.height,
              fitMode: this._settings.imageFitMode,
            }
          : await decodeImageFile(
              file,
              profile.width,
              profile.height,
              this._settings.imageFitMode,
            );
        if (!isCurrent()) return;
        this._imageFile = file;
        this._imageSource = source;
        this._imageName = name;
        this.reconnectDraft = null;
        this.imageOwner = {
          workspace,
          profile,
          width: profile.width,
          height: profile.height,
        };
        this._imageState = {
          preview: decoded.frame,
          sourceWidth: decoded.sourceWidth,
          sourceHeight: decoded.sourceHeight,
          fitMode: decoded.fitMode,
          name,
          processed,
        };
        this.ports
          .noticeStore()
          .setInfo(
            processed
              ? `Image processed locally as ${processed.resolvedMode} to ${profile.width}×${profile.height}. Nothing was uploaded anywhere.`
              : `Image decoded locally with Legacy / Smooth to ${profile.width}×${profile.height}. Nothing was uploaded anywhere.`,
          );
      } catch (error) {
        if (isCurrent()) throw error;
      }
    });
  }
  async setImageFit(mode: FitMode): Promise<void> {
    this.updateContentSettings({ imageFitMode: mode });
    if (this._imageFile) await this.loadImage(this._imageFile, this._imageName);
  }
  async setImageProcessing(partial: {
    mode?: ImageMode;
    composition?: ContentSettings["imageComposition"];
    opticalFit?: boolean;
    edgeStrength?: number;
    zoom?: number;
    offsetX?: number;
    offsetY?: number;
  }): Promise<void> {
    this.updateContentSettings({
      ...(partial.mode === undefined ? {} : { imageMode: partial.mode }),
      ...(partial.composition === undefined
        ? {}
        : { imageComposition: partial.composition }),
      ...(partial.opticalFit === undefined
        ? {}
        : { imageOpticalFit: partial.opticalFit }),
      ...(partial.edgeStrength === undefined
        ? {}
        : { imageEdgeStrength: partial.edgeStrength }),
      ...(partial.zoom === undefined ? {} : { imageZoom: partial.zoom }),
      ...(partial.offsetX === undefined
        ? {}
        : { imageOffsetX: partial.offsetX }),
      ...(partial.offsetY === undefined
        ? {}
        : { imageOffsetY: partial.offsetY }),
    });
    if (this._imageSource) await this._reprocessImage();
  }
  async loadGif(file: Blob, name: string): Promise<void> {
    const version = ++this._gifVersion;
    this._gifAbort?.abort();
    const abort = new AbortController();
    this._gifAbort = abort;
    const workspace = this.ports.workspaceStore().getController();
    const profile = workspace.session.profile;
    const width = profile?.width;
    const height = profile?.height;
    const isCurrent = (): boolean => {
      const current = this.ports.workspaceStore().getController();
      return (
        version === this._gifVersion &&
        current === workspace &&
        current.session.profile === profile &&
        current.session.profile?.width === width &&
        current.session.profile?.height === height
      );
    };
    await this.ports.noticeStore()._run("Decoding GIF…", async () => {
      if (!profile || width === undefined || height === undefined)
        throw new Error(
          "Connect and identify a display before importing a GIF.",
        );
      const { decodeGif } = await import("../../render/gif");
      if (!isCurrent()) return;
      try {
        const decoded = await decodeGif(file, width, height, {
          signal: abort.signal,
          isCurrent,
        });
        if (!isCurrent()) return;
        this._gifSequence = decoded.sequence;
        this._gifState = { ...decoded, name };
        this.ports
          .noticeStore()
          .setInfo(
            "GIF decoded locally for this display. Nothing was uploaded anywhere.",
          );
      } catch (error) {
        if (isCurrent()) throw error;
      } finally {
        if (this._gifAbort === abort) this._gifAbort = null;
      }
    });
  }

  _imageRecipe(): {
    mode: ImageMode;
    composition: ImageComposition;
    edgeStrength: number;
  } {
    return {
      mode: this._settings.imageMode,
      composition: {
        mode: this._settings.imageComposition,
        zoom: this._settings.imageZoom,
        offsetX: this._settings.imageOffsetX,
        offsetY: this._settings.imageOffsetY,
        opticalScaleX: this._settings.imageOpticalFit ? 1.35 : 1,
      },
      edgeStrength: this._settings.imageEdgeStrength,
    };
  }
  async _reprocessImage(): Promise<void> {
    const profile = this.ports.workspaceStore().getController().session.profile;
    this.getImageState();
    const source = this._imageSource;
    const file = this._imageFile;
    if (!profile || !source || !file) return;
    const version = ++this._imageVersion;
    const workspace = this.ports.workspaceStore().getController();
    const width = profile.width;
    const height = profile.height;
    const isCurrent = (): boolean =>
      version === this._imageVersion &&
      workspace === this.ports.workspaceStore().getController() &&
      workspace.session.profile === profile &&
      profile.width === width &&
      profile.height === height;
    const { decodeImageFile, ILEDHAT_RGB444, processImage } =
      await import("../../render/image");
    if (!isCurrent()) return;
    await this.ports.noticeStore()._run("Updating image preview…", async () => {
      try {
        const processed =
          this._settings.imageMode === "legacy"
            ? null
            : processImage(
                source,
                profile.width,
                profile.height,
                this._imageRecipe(),
                ILEDHAT_RGB444,
              );
        const frame = processed
          ? processed.frame
          : (
              await decodeImageFile(
                file,
                profile.width,
                profile.height,
                this._settings.imageFitMode,
              )
            ).frame;
        if (!isCurrent()) return;
        this.reconnectDraft = null;
        this.imageOwner = {
          workspace,
          profile,
          width: profile.width,
          height: profile.height,
        };
        this._imageState = {
          preview: frame,
          sourceWidth: source.width,
          sourceHeight: source.height,
          fitMode: this._settings.imageFitMode,
          name: this._imageName,
          processed,
        };
      } catch (error) {
        if (isCurrent()) throw error;
      }
    });
  }
  _renderTextFrame(width: number, height: number): Framebuffer | null {
    const workspace = this.ports.workspaceStore().getController();
    const settings = this._settings;
    return this.textCache.get(
      [
        workspace,
        workspace.session.profile,
        width,
        height,
        settings.text,
        settings.textColor,
        settings.textBackground,
        settings.textAlignment,
        settings.textDisplayMode,
      ],
      () => {
        if (!settings.text.trim()) return null;
        return renderText(settings.text, width, height, {
          color: hexToRgb(this._settings.textColor),
          background: hexToRgb(this._settings.textBackground),
          alignment: this._settings.textAlignment,
        });
      },
    );
  }
}
