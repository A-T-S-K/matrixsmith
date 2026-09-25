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
  const gate = snapshot.contentGates[selected];
  const live = snapshot.liveConnected;
  const canSend = gate.allowed && live && snapshot.busy === null;
  const sendReason =
    snapshot.busy ??
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
              value={settings.text}
              placeholder="HELLO"
              onInput={(event) =>
                store.updateContentSettings({
                  text: (event.currentTarget as HTMLInputElement).value,
                })
              }
            />
          </label>
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
          {content.textScrollPlan ? (
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
              <p
                class={
                  content.textScrollPlan.safe ? "fineprint" : "notice warning"
                }
              >
                {content.textScrollPlan.textWidth} columns ·{" "}
                {content.textScrollPlan.frameCount} frames ·{" "}
                {content.textScrollPlan.decodedBytesPerTile.toLocaleString()}{" "}
                decoded bytes/tile · step {content.textScrollPlan.step} · raster
                fallback
              </p>
              {content.textScrollPlan.warnings.map((warning) => (
                <p key={warning} class="notice warning">
                  {warning}
                </p>
              ))}
              <details class="secondary-section">
                <summary>Text backend</summary>
                <p class="fineprint">
                  Raster scrolling is bounded and available now. Firmware-native
                  CoolLEDUX Text remains experimental: the pinned protocol
                  evidence does not define its segment layout clearly enough to
                  transmit safely without hardware validation.
                </p>
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
              <p class="fineprint">
                {content.gif.name} · {content.gif.byteLength.toLocaleString()}{" "}
                bytes
                {content.gif.width !== null
                  ? ` · ${content.gif.width}×${content.gif.height}`
                  : ""}
                . Read locally; never uploaded.
              </p>
              {content.gif.warning && (
                <p class="notice warning">{content.gif.warning}</p>
              )}
            </>
          ) : (
            <p class="empty">
              The display decodes GIFs itself, so the file is sent as-is.
            </p>
          )}
          <UnavailableAction
            class="primary send"
            available={canSend && Boolean(content.gif)}
            reason={!content.gif ? "Choose a GIF before sending." : sendReason}
            onClick={() => store.requestSendGif()}
          >
            Send experimental GIF
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
