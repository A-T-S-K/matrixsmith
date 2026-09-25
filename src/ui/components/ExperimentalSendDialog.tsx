import type { JSX } from "preact";
import type { AppSnapshot, PresentationStore } from "../../presentation/store";
import { Dialog } from "./Dialog";
import { FramePreview } from "./FramePreview";

/** One concise confirmation for experimental persistent content. */
export function ExperimentalSendDialog({
  snapshot,
  store,
}: {
  readonly snapshot: AppSnapshot;
  readonly store: PresentationStore;
}): JSX.Element {
  const pending = snapshot.pendingSend;
  if (!pending) return <></>;
  return (
    <Dialog
      labelledBy="send-title"
      class="validation-dialog"
      onClose={() => store.cancelPendingSend()}
    >
      <header>
        <div>
          <p class="eyebrow">EXPERIMENTAL CONTENT</p>
          <h1 id="send-title">{pending.label}</h1>
        </div>
        <button
          class="close"
          aria-label="Cancel send"
          onClick={() => store.cancelPendingSend()}
        >
          ×
        </button>
      </header>
      <div class="validation-body">
        <p class="notice warning">{pending.consequence}</p>
        {pending.preview && <FramePreview frame={pending.preview} />}{" "}
        {snapshot.sendProgress && (
          <div class="notice" role="status" aria-live="polite">
            Sending: {snapshot.sendProgress.completedPackets} of{" "}
            {snapshot.sendProgress.totalPackets} packets
          </div>
        )}
        {!snapshot.wakeLockSupported && (
          <p class="fineprint">Keep this screen on until sending finishes.</p>
        )}
        <div class="inline-form">
          <button
            class="primary"
            disabled={snapshot.busy !== null}
            onClick={() => void store.confirmPendingSend()}
          >
            {pending.label}
          </button>
          <button
            class="secondary"
            disabled={snapshot.busy !== null}
            onClick={() => store.cancelPendingSend()}
          >
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}
