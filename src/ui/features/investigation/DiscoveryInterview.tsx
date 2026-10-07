import { useEffect, useRef } from "preact/hooks";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";

export function showDiscovery(snapshot: AppSnapshot): boolean {
  return (
    !!snapshot.discovery &&
    ((snapshot.discovery.status !== "retired" &&
      !(
        snapshot.geometryProfile?.driverId === "coolledux" &&
        (snapshot.discovery.terminal === "geometry" ||
          snapshot.discovery.terminal === "dimensions" ||
          (snapshot.discovery.terminal === "configuration" &&
            snapshot.geometryProfile.metadata.candidateProfile === true))
      )) ||
      snapshot.assessment.readiness === "needs-identification" ||
      !snapshot.liveConnected)
  );
}

export function DiscoveryInterview({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}) {
  const interview = snapshot.discovery;
  const heading = useRef<HTMLHeadingElement>(null);
  const running =
    interview?.status === "running" || interview?.status === "stopping";
  useEffect(() => {
    if (interview?.status === "complete") heading.current?.focus();
  }, [interview?.status, running]);
  return (
    <section class="next-action" aria-labelledby="discovery-title">
      <p class="panel-kicker">DISPLAY SETUP</p>
      <h2 id="discovery-title" tabIndex={-1} ref={heading}>
        Set up this display
      </h2>
      <p>
        This stage reads and identifies the display. It does not replace
        displayed content or verify everyday use.
      </p>
      <div role="status" aria-live="polite" aria-atomic="true">
        <p>
          {interview?.summary ??
            "Review accessible evidence and run useful registered, reviewed machine checks with one action."}
        </p>
        {interview?.question && (
          <p>
            <strong>{interview.question}</strong>
          </p>
        )}
        {interview && (
          <p>
            {interview.attempts.length} check
            {interview.attempts.length === 1 ? "" : "s"} completed.
          </p>
        )}
      </div>
      {running ? (
        <button
          class="secondary"
          onClick={() => store.stopDiscovery()}
          disabled={interview.status === "stopping"}
        >
          Stop
        </button>
      ) : !interview ? (
        <button
          class="primary"
          onClick={() => void store.identify()}
          disabled={!snapshot.liveConnected || snapshot.busy !== null}
        >
          Set up this display
        </button>
      ) : null}
      {interview && (
        <>
          {interview.status !== "retired" &&
            interview.attempts
              .filter((attempt) => attempt.readValue)
              .map((attempt) => (
                <figure class="readback-preview" key={attempt.stepId}>
                  <figcaption>
                    Supplied LED Matrix State · 5×5 source interpretation
                  </figcaption>
                  <pre
                    role="img"
                    aria-label="Five rows of decoded binary LED Matrix State, source interpretation only"
                  >
                    {Array.from({ length: 5 }, (_, y) =>
                      attempt
                        .readValue!.pixels.slice(y * 5, y * 5 + 5)
                        .map((pixel) => (pixel ? "●" : "·"))
                        .join(" "),
                    ).join("\n")}
                  </pre>
                  <p>
                    Received{" "}
                    <time dateTime={attempt.readValue!.timestamp}>
                      {attempt.readValue!.timestamp}
                    </time>{" "}
                    · source: live GATT read.
                  </p>
                  <p>
                    Physical appearance unconfirmed. Hardware identity, board
                    generation, firmware security, physical geometry and
                    rendering, and power-cycle persistence remain unknown.
                    Frame, text and control sending remain blocked.
                  </p>
                  <p>
                    Runtime scope: inspected Lancaster microbit-dal
                    318c6abbb3d952d3f49a595a726486230e82fb5b and DAL v2.1.1
                    documentation. Other firmware applicability remains unknown.
                  </p>
                </figure>
              ))}
          <ul>
            {interview.attempts.map((attempt) => (
              <li key={attempt.stepId}>
                <strong>{attempt.outcome}</strong>: {attempt.summary}
              </li>
            ))}
          </ul>
          <details>
            <summary>Sources and exact technical evidence</summary>
            <p>
              Transactions retain correlated response bytes and endpoints.
              Candidate scores and advisory knowledge are not execution
              authority.
            </p>
            <ul>
              {interview.attempts.map((attempt) => (
                <li key={attempt.stepId}>
                  {attempt.stepId} · {attempt.definitionIdentity} · transaction{" "}
                  {attempt.transactionId ?? "not dispatched"} · response
                  sequence {attempt.responseSequence ?? "none"} · original
                  connection {attempt.connectionId} · sources{" "}
                  {attempt.sources.join(", ") || "none"}
                  {attempt.readValue && (
                    <p>
                      Decoder: {attempt.readValue.interpretation} · received
                      bytes: {attempt.readValue.hex}
                    </p>
                  )}
                  {attempt.failureStage && (
                    <p>Failure stage: {attempt.failureStage}</p>
                  )}
                </li>
              ))}
            </ul>
            <ul>
              {interview.hypotheses.map((hypothesis) => (
                <li key={hypothesis.driverId}>
                  {hypothesis.driverId}: {hypothesis.support.length} supporting
                  check(s), {hypothesis.contradictions.length} scoped
                  contradiction(s), {hypothesis.unanswered.length} unanswered
                  question(s).
                  {hypothesis.contradictions.map((contradiction) => (
                    <p key={contradiction.stepId}>
                      Scope: {contradiction.configurationId ?? "family"} ·{" "}
                      {contradiction.summary}
                    </p>
                  ))}
                  {hypothesis.unanswered.length > 0 && (
                    <p>Unanswered: {hypothesis.unanswered.join(" ")}</p>
                  )}
                </li>
              ))}
            </ul>
          </details>
          {(running ||
            interview.terminal === "interrupted" ||
            interview.terminal === "access") && (
            <button class="secondary" onClick={() => void store.disconnect()}>
              Disconnect and review access
            </button>
          )}
          {!running && (
            <div class="next-action-cta">
              <button
                class="secondary"
                onClick={() => store.setView("develop")}
              >
                Open Protocol workbench
              </button>
              <button class="secondary" onClick={() => store.openReport()}>
                Open report
              </button>
              {interview.terminal !== "geometry" &&
                interview.terminal !== "dimensions" &&
                interview.terminal !== "configuration" && (
                  <button
                    class="secondary"
                    disabled={
                      !snapshot.liveConnected ||
                      snapshot.busy !== null ||
                      interview.pendingRead
                    }
                    onClick={() => void store.identify()}
                  >
                    Start a new setup
                  </button>
                )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
