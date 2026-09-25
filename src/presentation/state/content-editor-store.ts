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
  dispose(): void {
    this._imageVersion++;
    this._gifVersion++;
    this._imageFile = null;
    this._imageSource = null;
    this._gifBytes = null;
  }
  private _settings: ContentSettings;
  private _imageFile: Blob | null = null;
  private _imageSource: DecodedImageSource | null = null;
  private _imageName = "";
  private _imageVersion = 0;
  private _gifVersion = 0;
  private _imageState: ContentState["image"] | null = null;
  private _gifBytes: Uint8Array | null = null;
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
  getImageState() {
    return this._imageState;
  }
  getGifBytes() {
    return this._gifBytes;
  }
  getGifState() {
    return this._gifState;
  }
  updateContentSettings(partial: Partial<ContentSettings>): void {
    this._settings = { ...this._settings, ...partial, schemaVersion: 1 };
    const saved = saveContentSettings(this._settings, this.environment.storage);
    if (!saved.ok)
      this.ports
        .noticeStore()
        .setError(`Settings were not saved: ${saved.message}`);
    this.ports.snapshotStore()._emit();
  }
  resetContentSettings(): void {
    this._settings = DEFAULT_CONTENT_SETTINGS;
    const saved = saveContentSettings(this._settings, this.environment.storage);
    if (!saved.ok)
      this.ports
        .noticeStore()
        .setError(`Settings were not saved: ${saved.message}`);
    this.ports.snapshotStore()._emit();
  }
  async loadImage(file: Blob, name: string): Promise<void> {
    const version = ++this._imageVersion;
    const workspace = this.ports.workspaceStore().getController();
    if (file.size > INPUT_LIMITS.captureBytes)
      throw new Error("Image file exceeds the 25 MiB input budget.");
    const { decodeImageFile, decodeImageSource, ILEDHAT_RGB444, processImage } =
      await import("../../render/image");
    await this.ports.noticeStore()._run("Decoding image…", async () => {
      const profile = this.ports.workspaceStore().getController()
        .session.profile;
      if (!profile)
        throw new Error(
          "Connect and identify a display before importing an image.",
        );
      const source = await decodeImageSource(file);
      if (
        version !== this._imageVersion ||
        workspace !== this.ports.workspaceStore().getController()
      )
        return;
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
      if (
        version !== this._imageVersion ||
        workspace !== this.ports.workspaceStore().getController()
      )
        return;
      this._imageFile = file;
      this._imageSource = source;
      this._imageName = name;
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
    const workspace = this.ports.workspaceStore().getController();
    if (file.size > INPUT_LIMITS.gifBytes)
      throw new Error("GIF exceeds the 8 MiB input budget.");
    const { readGifMetadata } = await import("../../render/image");
    await this.ports.noticeStore()._run("Reading GIF…", async () => {
      const profile = this.ports.workspaceStore().getController()
        .session.profile;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (
        version !== this._gifVersion ||
        workspace !== this.ports.workspaceStore().getController()
      )
        return;
      const meta = readGifMetadata(bytes);
      if (!meta.isGif)
        throw new Error(
          "That file is not a GIF (missing GIF87a/GIF89a header).",
        );
      const warning =
        profile &&
        meta.width !== null &&
        meta.height !== null &&
        (meta.width > profile.width || meta.height > profile.height)
          ? `GIF canvas ${meta.width}×${meta.height} exceeds the ${profile.width}×${profile.height} display; only source-tested up to 8 columns per segment.`
          : profile && meta.width !== null && meta.width > 8
            ? `GIF wider than 8 columns: the native GIF path is only source-verified inside the untiled 8-column zone.`
            : null;
      this._gifBytes = bytes;
      this._gifState = {
        byteLength: meta.byteLength,
        width: meta.width,
        height: meta.height,
        warning,
        name,
      };
      this.ports
        .noticeStore()
        .setInfo("GIF read locally. Nothing was uploaded anywhere.");
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
    const { decodeImageFile, ILEDHAT_RGB444, processImage } =
      await import("../../render/image");
    const profile = this.ports.workspaceStore().getController().session.profile;
    const source = this._imageSource;
    const file = this._imageFile;
    if (!profile || !source || !file) return;
    const version = ++this._imageVersion;
    const workspace = this.ports.workspaceStore().getController();
    await this.ports.noticeStore()._run("Updating image preview…", async () => {
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
      if (
        version !== this._imageVersion ||
        workspace !== this.ports.workspaceStore().getController()
      )
        return;
      this._imageState = {
        preview: frame,
        sourceWidth: source.width,
        sourceHeight: source.height,
        fitMode: this._settings.imageFitMode,
        name: this._imageName,
        processed,
      };
    });
  }
  _renderTextFrame(width: number, height: number): Framebuffer | null {
    if (!this._settings.text.trim()) return null;
    return renderText(this._settings.text, width, height, {
      color: hexToRgb(this._settings.textColor),
      background: hexToRgb(this._settings.textBackground),
      alignment: this._settings.textAlignment,
    });
  }
}
