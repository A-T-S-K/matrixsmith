import { useEffect, useRef } from "preact/hooks";
import { sendMessage } from "../../../presentation/store";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";

/** One result beside Send. Packet progress is deliberately outside live regions. */
export function SendResult({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}) {
  const attempt = snapshot.sendAttempt;
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      snapshot.busy ||
      !attempt ||
      !["completed", "failed", "review"].includes(attempt.phase)
    )
      return;
    // A disabled send or removed recovery button can leave focus on the body.
    // Restore an action only in that case; never take focus from draft editing.
    if (document.activeElement !== document.body) return;
    const recovery = resultRef.current?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    const send = resultRef.current
      ?.closest(".content-editor")
      ?.querySelector<HTMLButtonElement>(".primary.send:not(:disabled)");
    (recovery ?? send)?.focus();
  }, [attempt?.id, attempt?.phase, snapshot.busy]);
  if (!attempt) return null;
  const evidence = attempt.evidence;
  const failure = attempt.failure;
  const message = sendMessage(attempt);
  if (!message) return null;
  return (
    <div
      ref={resultRef}
      class={`notice ${failure || evidence?.responseTimedOut ? "warning" : ""}`}
    >
      <div
        role={failure || evidence?.responseTimedOut ? "alert" : "status"}
        aria-atomic="true"
      >
        <strong>{message.headline}</strong>
        <p>{message.guidance}</p>
      </div>
      {attempt.progress && (
        <p class="fineprint">
          Host accepted {attempt.progress.completedPackets} of{" "}
          {attempt.progress.totalPackets} planned packets.
        </p>
      )}
      {failure?.reconnectRequired && (
        <button
          class="secondary"
          disabled={snapshot.busy !== null || attempt.phase === "recovering"}
          onClick={() => void store.reconnectAndReviewDraft()}
        >
          Reconnect and review draft
        </button>
      )}
      {(evidence || failure) && (
        <details class="secondary-section">
          <summary>Send details</summary>
          <p>Target: {attempt.target}</p>
          {failure && <p>{failure.message}</p>}
          {failure?.stage === "upload" && (
            <p>
              Writes may have reached the display. The final content is unknown.
            </p>
          )}
          {evidence && (
            <>
              <p>
                Host acceptance:{" "}
                {evidence.hostAccepted
                  ? "All writes accepted by the host."
                  : "Not confirmed."}
              </p>
              <p>
                Protocol response:{" "}
                {evidence.responseTimedOut
                  ? "Timed out."
                  : evidence.protocolAcknowledged === true
                    ? "Matching acknowledgement received."
                    : evidence.protocolAcknowledged === false
                      ? "No matching acknowledgement."
                      : "Not expected for this upload."}
              </p>
              <p>
                Device-state verification:{" "}
                {evidence.deviceStateVerified
                  ? "Matching response fulfilled the operation expectation."
                  : "Not verified."}
              </p>
              <p>
                Completed:{" "}
                <time dateTime={evidence.completedAt}>
                  {evidence.completedAt}
                </time>
              </p>
              {evidence.finalWriteAcceptedAt && (
                <p>
                  Final host write:{" "}
                  <time dateTime={evidence.finalWriteAcceptedAt}>
                    {evidence.finalWriteAcceptedAt}
                  </time>
                </p>
              )}
              <p>
                Visual rendering, firmware acceptance, and retained content were
                not confirmed by these results.
              </p>
            </>
          )}
        </details>
      )}
    </div>
  );
}
