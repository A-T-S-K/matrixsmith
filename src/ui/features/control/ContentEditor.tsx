import { RASTER_SCROLL_FRAME_BUDGET } from "../../../render/scroll";
import { unsupportedTextCharacters } from "../../../render/font";
import { CONTENT_TEXT_CODE_UNIT_LIMIT } from "../../../storage/settings";
import type { JSX } from "preact";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
import type { ContentPathId } from "../../../investigation/gating";
import { FramePreview } from "../../components/FramePreview";
import { AnimatedFramePreview } from "../../components/AnimatedFramePreview";
import { FileButton } from "../../components/FileButton";
import { UnavailableAction } from "../../components/UnavailableAction";
import { ImageEditor } from "./ImageEditor";

export function ContentEditor({
  selected,
  snapshot,
  store,
}: {
  selected: ContentPathId;
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const content = snapshot.content;
  const settings = content.settings;
  const unsupported = unsupportedTextCharacters(settings.text);
  const gate = snapshot.contentGates[selected];
  const live = snapshot.liveConnected;
  const scrollReason =
    selected === "text" && content.textScrollPlan?.safe === false
      ? content.textScrollPlan.reason
      : null;
  const canSend =
    gate.allowed && live && snapshot.busy === null && !scrollReason;
  const sendReason =
    snapshot.busy ??
    scrollReason ??
    (!live
      ? "Live content requires a connected physical display."
      : gate.allowed
        ? "This action is temporarily unavailable."
        : gate.reason);
  return (
    <div class="content-editor">
      {!gate.allowed && (
        <LockedNotice snapshot={snapshot} store={store} reason={gate.reason} />
      )}
      {snapshot.sendProgress && (
        <div class="notice" role="status" aria-live="polite">
          Updating display: {snapshot.sendProgress.completedPackets} of{" "}
          {snapshot.sendProgress.totalPackets} packets
        </div>
      )}

      {selected === "text" && (
        <>
          <label class="field">
            <span>Text</span>
            <input
              maxLength={CONTENT_TEXT_CODE_UNIT_LIMIT}
              value={settings.text}
              placeholder="HELLO"
              onInput={(event) =>
                store.updateContentSettings({
                  text: (event.currentTarget as HTMLInputElement).value,
                })
              }
            />
          </label>
          <p class="fineprint">
            {settings.text.length} / {CONTENT_TEXT_CODE_UNIT_LIMIT} text units.
            Some symbols use two units. Long scrolling messages may need
            shortening.
          </p>
          {unsupported.length > 0 && (
            <p class="notice warning">
              This display font supports basic English letters, numbers, and
              punctuation. These characters will appear as boxes:{" "}
              {unsupported.join(" ")}. Check the preview before sending.
            </p>
          )}
          <label class="field">
            <span>Display</span>
            <select
              value={settings.textDisplayMode}
              onChange={(event) =>
                store.updateContentSettings({
                  textDisplayMode: (event.currentTarget as HTMLSelectElement)
                    .value as typeof settings.textDisplayMode,
                })
              }
            >
              <option value="auto">Auto</option>
              <option value="still">Still</option>
              <option value="scroll">Scroll</option>
            </select>
          </label>
          {content.textScrollPlan?.safe ? (
            <AnimatedFramePreview
              sequence={content.textScrollPlan.sequence}
              label="Actual scrolling-text preview"
            />
          ) : content.textPreview ? (
            <FramePreview frame={content.textPreview} label="Text preview" />
          ) : (
            <p class="empty">Type something to preview it.</p>
          )}
          {content.textScrollPlan && (
            <>
              <details class="secondary-section">
                <summary>Technical scrolling limits</summary>
                <p class="fineprint">
                  {content.textScrollPlan.textWidth} columns ·{" "}
                  {content.textScrollPlan.frameCount} /{" "}
                  {RASTER_SCROLL_FRAME_BUDGET} frames ·{" "}
                  {content.textScrollPlan.decodedBytesPerTile.toLocaleString()}{" "}
                  /{" "}
                  {content.textScrollPlan.safetyBudgetBytesPerTile.toLocaleString()}{" "}
                  decoded bytes/tile · step {content.textScrollPlan.step}. The
                  preview uses the embedded ASCII font and bounded raster
                  animation.
                </p>
                {content.textScrollPlan.warnings.map((warning) => (
                  <p key={warning} class="notice warning">
                    {warning}
                  </p>
                ))}
              </details>
            </>
          )}
          <div class="field-row">
            <label class="field">
              <span>Color</span>
              <input
                type="color"
                value={settings.textColor}
                onInput={(event) =>
                  store.updateContentSettings({
                    textColor: (event.currentTarget as HTMLInputElement).value,
                  })
                }
              />
            </label>
            <label class="field">
              <span>Background</span>
              <input
                type="color"
                value={settings.textBackground}
                onInput={(event) =>
                  store.updateContentSettings({
                    textBackground: (event.currentTarget as HTMLInputElement)
                      .value,
                  })
                }
              />
            </label>
            <label class="field">
              <span>Alignment</span>
              <select
                value={settings.textAlignment}
                onChange={(event) =>
                  store.updateContentSettings({
                    textAlignment: (event.currentTarget as HTMLSelectElement)
                      .value as "left" | "center" | "right",
                  })
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
          </div>
          <UnavailableAction
            class="primary send"
            available={canSend && Boolean(settings.text.trim())}
            reason={
              !settings.text.trim() ? "Enter text before sending." : sendReason
            }
            onClick={() => store.requestSendText()}
          >
            Display it
          </UnavailableAction>
        </>
      )}

      {selected === "image" && (
        <ImageEditor
          snapshot={snapshot}
          store={store}
          canSend={canSend}
          sendTitle={sendReason}
        />
      )}

      {selected === "animation" && (
        <>
          <p class="fineprint">
            Animation is for authored multi-frame content and diagnostics.
            Normal scrolling messages live under Text.
          </p>
          <div class="frame-strip">
            {keyedFrames(content.animationPreview).map(
              ({ frame, key }, index) => (
                <div key={key}>
                  <small>Frame {index + 1}</small>
                  <FramePreview frame={frame} scale={5} />
                </div>
              ),
            )}
          </div>
          <UnavailableAction
            class="primary send"
            available={canSend}
            reason={sendReason}
            onClick={() => store.requestSendAnimation()}
          >
            Display demo
          </UnavailableAction>
        </>
      )}

      {selected === "gif" && (
        <>
          <FileButton
            accept="image/gif,.gif"
            onFile={(file) => store.loadGif(file, file.name)}
          >
            Choose a GIF →
          </FileButton>
          {content.gif ? (
            <>
              <AnimatedFramePreview
                sequence={content.gif.sequence}
                label="Decoded GIF preview"
              />
              <p class="fineprint">
                {content.gif.name} · {content.gif.sourceWidth}×
                {content.gif.sourceHeight} · {content.gif.frameCount} frames ·{" "}
                {content.gif.totalDurationMs / 1000} s · display{" "}
                {content.gif.targetWidth}×{content.gif.targetHeight}. Decoded
                locally; never uploaded.
              </p>
              {content.gif.warnings.map((warning) => (
                <p key={warning} class="notice warning">
                  {warning}
                </p>
              ))}
            </>
          ) : (
            <p class="empty">
              Your browser converts the GIF into an animation sized for this
              display.
            </p>
          )}
          <UnavailableAction
            class="primary send"
            available={canSend && Boolean(content.gif)}
            reason={!content.gif ? "Choose a GIF before sending." : sendReason}
            onClick={() => store.requestSendGif()}
          >
            Display GIF
          </UnavailableAction>
        </>
      )}
    </div>
  );
}

function keyedFrames(
  frames: AppSnapshot["content"]["animationPreview"],
): readonly {
  readonly frame: (typeof frames)[number];
  readonly key: string;
}[] {
  const occurrences = new Map<string, number>();
  return frames.map((frame) => {
    let hash = 2166136261;
    for (const byte of frame.data) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    const fingerprint = `${frame.width}x${frame.height}-${(hash >>> 0).toString(16)}`;
    const occurrence = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, occurrence + 1);
    return { frame, key: `${fingerprint}-${occurrence}` };
  });
}

/** Why this content type is not available yet, and the one step that changes that. */
function LockedNotice({
  snapshot,
  store,
  reason,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
  reason: string;
}): JSX.Element {
  return (
    <div class="locked-notice">
      <p>
        <strong>Preview only for now.</strong> {reason}
      </p>
      {snapshot.nextTest && (
        <button
          class="secondary"
          disabled={snapshot.busy !== null || !snapshot.liveConnected}
          onClick={() => {
            store.setView("diagnose");
            store.startGuidedTest(snapshot.nextTest!.testId);
          }}
        >
          Run “{snapshot.nextTest.title}”
        </button>
      )}
    </div>
  );
}
