import type { JSX } from "preact";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
import { FileButton } from "../../components/FileButton";
import { ImagePreview } from "../../components/ImagePreview";
import { UnavailableAction } from "../../components/UnavailableAction";

export function ImageEditor({
  snapshot,
  store,
  canSend,
  sendTitle,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
  canSend: boolean;
  sendTitle: string;
}): JSX.Element {
  const content = snapshot.content;
  const settings = content.settings;
  return (
    <>
      <FileButton
        accept="image/png,image/jpeg,image/webp"
        onFile={(file) => store.loadImage(file, file.name)}
      >
        Choose an image (PNG/JPEG/WebP) →
      </FileButton>
      {content.image ? (
        <>
          <ImagePreview frame={content.image.preview} />
          <div class="field-row">
            <label class="field">
              <span>Mode</span>
              <select
                value={settings.imageMode}
                onChange={(event) =>
                  void store.setImageProcessing({
                    mode: (event.currentTarget as HTMLSelectElement)
                      .value as typeof settings.imageMode,
                  })
                }
              >
                <option value="auto">Auto</option>
                <option value="artwork">Artwork</option>
                <option value="photo">Photo</option>
                <option value="pixel-art">Pixel Art</option>
              </select>
            </label>
            <label class="field">
              <span>Composition</span>
              <select
                value={settings.imageComposition}
                onChange={(event) =>
                  void store.setImageProcessing({
                    composition: (event.currentTarget as HTMLSelectElement)
                      .value as typeof settings.imageComposition,
                  })
                }
              >
                <option value="contain">Fit whole image</option>
                <option value="cover">Fill / crop</option>
                <option value="foreground-trim">Foreground trim</option>
                <option value="custom">Custom / focal crop</option>
              </select>
            </label>
          </div>
          {content.image.processed && (
            <p class="notice">
              {content.image.processed.analysis.likelyMode ===
              content.image.processed.resolvedMode
                ? `${labelMode(content.image.processed.resolvedMode)} · ${content.image.processed.analysis.confidence} confidence`
                : `Auto used ${labelMode(content.image.processed.resolvedMode)}-safe processing · uncertain content type`}
            </p>
          )}
          <p class="fineprint">
            32×16 · {content.image.processed?.resolvedMode ?? "Legacy / Smooth"}{" "}
            · {content.image.processed?.outputColorCount ?? "—"} colors · static
            delivery uses the selected device profile strategy.
          </p>
          {content.image.processed?.warnings.map((warning) => (
            <p key={warning} class="notice warning">
              {warning}
            </p>
          ))}
          {settings.imageComposition === "custom" && (
            <div class="custom-crop-controls">
              <RangeField
                label="Zoom"
                min="1"
                max="4"
                step="0.1"
                value={settings.imageZoom}
                onChange={(value) =>
                  void store.setImageProcessing({ zoom: value })
                }
              />
              <RangeField
                label="Horizontal focal offset"
                min="-16"
                max="16"
                step="1"
                value={settings.imageOffsetX}
                onChange={(value) =>
                  void store.setImageProcessing({ offsetX: value })
                }
              />
              <RangeField
                label="Vertical focal offset"
                min="-8"
                max="8"
                step="1"
                value={settings.imageOffsetY}
                onChange={(value) =>
                  void store.setImageProcessing({ offsetY: value })
                }
              />
            </div>
          )}
          <details class="secondary-section">
            <summary>Advanced image processing</summary>
            {(settings.imageMode === "artwork" ||
              content.image.processed?.analysis.likelyMode === "artwork") && (
              <label class="check-row">
                <input
                  type="checkbox"
                  checked={settings.imageOpticalFit}
                  onChange={(event) =>
                    void store.setImageProcessing({
                      opticalFit: event.currentTarget.checked,
                    })
                  }
                />
                <span>
                  Use more of display (previewed optical widening, max 1.35×)
                </span>
              </label>
            )}
            <RangeField
              label="Photo edge strength"
              min="0"
              max="0.25"
              step="0.01"
              value={settings.imageEdgeStrength}
              onChange={(value) =>
                void store.setImageProcessing({ edgeStrength: value })
              }
            />
            <button
              class="text-action"
              onClick={() => void store.setImageProcessing({ mode: "legacy" })}
            >
              Use Legacy / Smooth reducer
            </button>
          </details>
          <p class="fineprint">
            {content.image.name} · {content.image.sourceWidth}×
            {content.image.sourceHeight} source. Processed locally; raw image
            bytes are not persisted or uploaded.
          </p>
        </>
      ) : (
        <p class="empty">
          Choose a local image to see how it will look on the display.
        </p>
      )}
      <UnavailableAction
        class="primary send"
        available={canSend && Boolean(content.image)}
        reason={!content.image ? "Choose an image before sending." : sendTitle}
        onClick={() => store.requestSendImage()}
      >
        Display it
      </UnavailableAction>
    </>
  );
}

function RangeField({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: string;
  max: string;
  step: string;
  value: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label class="field">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function labelMode(mode: string): string {
  return mode === "pixel-art"
    ? "Pixel Art"
    : mode.charAt(0).toUpperCase() + mode.slice(1);
}
