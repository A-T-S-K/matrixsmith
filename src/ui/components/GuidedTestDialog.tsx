import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type {
  AppSnapshot,
  GuidedFlowState,
  PresentationStore,
} from "../../presentation/store";
import { completedTestResolution } from "../../investigation/investigation";
import { FramePreview } from "./FramePreview";
import { StatusBadge } from "./StatusBadge";
import { SpatialObservation } from "./observation/SpatialObservation";
import { TimedObservation } from "./observation/TimedObservation";
import { SimpleObservation } from "./observation/SimpleObservation";
import { Dialog } from "./Dialog";

/**
 * One guided hardware test as an ABOUT → RUN → OBSERVE → RESULT flow.
 *
 * ABOUT answers only what a person needs before agreeing to change their
 * display: what is being tested, why, what will happen to the panel, and how
 * long it takes. Risk classifications, packet counts, and CRCs are real
 * evidence but they are not the decision — they stay collapsed.
 *
 * OBSERVE delegates to the presentation the test's own content implies:
 * spatial for questions about a place, timed for a measured timeline, plain
 * for everything else. No per-test JSX exists here.
 */
export function GuidedTestDialog({
  snapshot,
  store,
}: {
  readonly snapshot: AppSnapshot;
  readonly store: PresentationStore;
}): JSX.Element {
  const flow = snapshot.guidedFlow;
  if (!flow) return <></>;
  return (
    <Dialog
      labelledBy="guided-title"
      class="validation-dialog guided-dialog"
      onClose={() => store.closeGuidedTest()}
    >
      <header class="guided-header">
        <div>
          {/* Where am I, and is this the same test again? Both questions get a
            plain answer in the header rather than in technical details. */}
          {(flow.corePosition || flow.attemptNumber > 1) && (
            <p class="run-position">
              {flow.corePosition && (
                <span class="test-of">
                  Test {flow.corePosition.position} of {flow.corePosition.total}
                </span>
              )}
              {flow.attemptNumber > 1 && (
                <span class="attempt-of">Attempt {flow.attemptNumber}</span>
              )}
            </p>
          )}
          <h1 id="guided-title">{flow.title}</h1>
          <ol class="stage-steps" aria-label="Test progress">
            {(["about", "running", "observe", "result"] as const).map(
              (stage, index) => (
                <li
                  key={stage}
                  class={
                    (flow.stage === "failed" ? "running" : flow.stage) === stage
                      ? "active"
                      : stageIndex(
                            flow.stage === "failed" ? "running" : flow.stage,
                          ) > index
                        ? "done"
                        : ""
                  }
                  aria-current={
                    (flow.stage === "failed" ? "running" : flow.stage) === stage
                      ? "step"
                      : undefined
                  }
                >
                  {stageLabel(stage)}
                </li>
              ),
            )}
          </ol>
        </div>
        {flow.stage !== "running" && (
          <button
            class="close"
            aria-label={
              flow.stage === "observe"
                ? "Stop observation and save as incomplete"
                : "Close test"
            }
            title={
              flow.stage === "observe"
                ? "The content was already transmitted; closing records this test as incomplete evidence."
                : ""
            }
            onClick={() => store.closeGuidedTest()}
          >
            ×
          </button>
        )}
      </header>
      <div class="validation-body">
        {flow.stage === "about" && (
          <AboutStage flow={flow} snapshot={snapshot} store={store} />
        )}
        {flow.stage === "running" && <RunningStage flow={flow} />}
        {flow.stage === "failed" && <FailedStage flow={flow} store={store} />}
        {flow.stage === "observe" && <ObserveStage flow={flow} store={store} />}
        {flow.stage === "result" && (
          <ResultStage flow={flow} snapshot={snapshot} store={store} />
        )}
      </div>
    </Dialog>
  );
}

function stageLabel(stage: GuidedFlowState["stage"]): string {
  return stage === "about"
    ? "About"
    : stage === "running"
      ? "Run"
      : stage === "observe"
        ? "Observe"
        : stage === "result"
          ? "Result"
          : "Failed";
}

function FailedStage({
  flow,
  store,
}: {
  flow: GuidedFlowState;
  store: PresentationStore;
}): JSX.Element {
  return (
    <div class="guided-failure" role="alert">
      <h2>Test transfer did not complete</h2>
      <p>
        {flow.failure?.message ?? "The diagnostic could not be transferred."}
      </p>
      <p class="fineprint">
        The failed attempt remains in the investigation record. No observation
        result was inferred from it.
      </p>
      <div class="step-nav">
        {flow.failure?.retryable && (
          <button
            class="primary"
            onClick={() => void store.retryFailedGuidedTransfer()}
          >
            Retry transfer
          </button>
        )}
        <button class="secondary" onClick={() => store.closeGuidedTest()}>
          Close
        </button>
      </div>
    </div>
  );
}
function stageIndex(stage: GuidedFlowState["stage"]): number {
  return ["about", "running", "observe", "result"].indexOf(stage);
}

function AboutStage({
  flow,
  snapshot,
  store,
}: {
  flow: GuidedFlowState;
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const [confirmChecked, setConfirmChecked] = useState(false);
  const timed = flow.presentation === "timed";
  const frame = flow.previews[0];
  return (
    <>
      <p class="guided-question">{flow.about.question}</p>
      <p>{flow.about.whyRelevant}</p>
      {frame && (
        <div class="about-preview">
          <FramePreview
            frame={frame}
            scale={8}
            label="The image this test will show"
          />
          <small>
            {flow.regions.length > 0
              ? "Zones are labelled once the pattern is on the display."
              : "What the display will show"}
          </small>
        </div>
      )}
      <dl class="about-facts">
        <div>
          <dt>What changes on the display</dt>
          <dd>{flow.about.whatChangesOnDevice}</dd>
        </div>
        <div>
          <dt>How long</dt>
          <dd>{flow.about.estimatedObservationTime}</dd>
        </div>
      </dl>
      {timed && (
        <div class="readiness">
          <p class="readiness-title">Ready to watch the display?</p>
          <ol class="readiness-steps">
            <li>MatrixSmith uploads the test pattern.</li>
            <li>Timing starts automatically the moment the upload finishes.</li>
            <li>You tap when you actually see each thing happen.</li>
          </ol>
          <p class="fineprint">
            Look at the panel before you tap, and hold the phone where you can
            reach the buttons. If you miss a moment you can retry — nothing is
            ruined.
          </p>
        </div>
      )}
      <details>
        <summary>What each outcome would mean</summary>
        <ul class="observation-list">
          {flow.about.possibleOutcomes.map((outcome) => (
            <li key={outcome.outcome}>
              <span>
                <strong>{outcome.outcome}:</strong> {outcome.learns}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <details class="technical-disclosure">
        <summary>Technical details</summary>
        <ul class="observation-list">
          <li>
            <span>What MatrixSmith does: {flow.about.whatMatrixSmithDoes}</span>
          </li>
          <li>
            <span>Safety class: {flow.risk}</span>
          </li>
          {flow.about.technicalDetails.map((detail) => (
            <li key={detail}>
              <span>{detail}</span>
            </li>
          ))}
          {flow.planSummary && (
            <li>
              <span>
                Transmission: {flow.planSummary.packetCount} packets (1 announce
                + {flow.planSummary.chunkCount} chunks),{" "}
                {flow.planSummary.programBytes} bytes uncompressed, CRC32{" "}
                {flow.planSummary.crc32}, {flow.planSummary.pacingMs} ms pacing.
              </span>
            </li>
          )}
        </ul>
      </details>
      {flow.about.preTransferNote && (
        <p class="notice warning">{flow.about.preTransferNote}</p>
      )}
      <p class="notice warning">{flow.consequence}</p>
      <label class="confirm-check">
        <input
          type="checkbox"
          checked={confirmChecked}
          onChange={(event) =>
            setConfirmChecked((event.currentTarget as HTMLInputElement).checked)
          }
        />
        <span>
          I understand this replaces the stored display content and that
          automatic restoration is not verified.
        </span>
      </label>
      <div class="step-nav">
        <button
          class="primary"
          disabled={!confirmChecked || snapshot.busy !== null}
          onClick={() => void store.confirmGuidedTransfer()}
        >
          {timed ? "I'm ready — run test" : "Run test"}
        </button>
        <button class="secondary" onClick={() => store.closeGuidedTest()}>
          Cancel
        </button>
      </div>
    </>
  );
}

function RunningStage({ flow }: { flow: GuidedFlowState }): JSX.Element {
  return (
    <>
      <p class="guided-progress">
        <span class="spinner" aria-hidden="true" />
        {flow.transferProgress ?? "Preparing diagnostic…"}
      </p>
      {flow.presentation === "timed" && (
        <p class="watch-now">Watch the display now.</p>
      )}
      <p class="fineprint">
        This window stays open until the transfer completes — closing it would
        not cancel the Bluetooth upload.
      </p>
      <p class="fineprint">
        Larger programs can take several seconds to start rendering after the
        final packet.
      </p>
    </>
  );
}

function ObserveStage({
  flow,
  store,
}: {
  flow: GuidedFlowState;
  store: PresentationStore;
}): JSX.Element {
  if (flow.awaitingRetryConfirmation)
    return <RetryConfirmation flow={flow} store={store} />;
  const timing =
    flow.presentation === "timed" && flow.observeStage === "timing";
  return (
    <>
      {timing ? (
        <TimedObservation flow={flow} store={store} />
      ) : (
        <>
          {flow.presentation === "timed" && (
            <TimingRecap flow={flow} store={store} />
          )}
          {flow.questionPresentation === "spatial" ? (
            <SpatialObservation flow={flow} store={store} />
          ) : (
            <SimpleObservation flow={flow} store={store} />
          )}
        </>
      )}
      <div class="observe-footer">
        <button class="quiet small" onClick={() => store.abandonGuidedTest()}>
          Stop observation and save as incomplete
        </button>
        <p class="fineprint">
          The diagnostic content was already sent to the display; stopping
          records this test as incomplete evidence rather than discarding it.
        </p>
      </div>
    </>
  );
}

/** After a timed run: what was captured, and the option to measure again. */
function TimingRecap({
  flow,
  store,
}: {
  flow: GuidedFlowState;
  store: PresentationStore;
}): JSX.Element {
  return (
    <div class="timing-recap">
      <div class="timing-recap-head">
        <div>
          <p class="panel-kicker">TIMING CAPTURED</p>
          {flow.timingSummary && (
            <strong>Stayed still for {flow.timingSummary}</strong>
          )}
        </div>
        <button
          class="secondary small"
          onClick={() => store.requestTimingRetry()}
        >
          Measure again
        </button>
      </div>
      <p class="fineprint">
        Your marks are recorded as human observations, so these durations are
        approximate. A few questions about what you saw remain.
      </p>
    </div>
  );
}

/**
 * A retry re-sends persistent content, so it is always an intentional act —
 * but it is the same already-understood test, so the confirmation is a
 * sentence rather than the full pre-transfer warning.
 */
function RetryConfirmation({
  flow,
  store,
}: {
  flow: GuidedFlowState;
  store: PresentationStore;
}): JSX.Element {
  return (
    <div class="retry-confirm">
      <h2>Retry this observation?</h2>
      <p>
        MatrixSmith will send the same diagnostic image again so the timing can
        start over.
      </p>
      <ul class="observation-list">
        <li>
          <span>✓ Same test</span>
        </li>
        <li>
          <span>✓ Same content</span>
        </li>
        <li>
          <span>
            ✓ Same settings
            {Object.keys(flow.attempts[0]?.parameters ?? {}).length > 0
              ? ` (${Object.entries(flow.attempts[0]!.parameters)
                  .map(([key, value]) => `${key}=${value}`)
                  .join(", ")})`
              : ""}
          </span>
        </li>
      </ul>
      <p class="fineprint">
        This will be attempt {(flow.attempts.at(-1)?.attemptNumber ?? 0) + 1}.
        Earlier attempts stay in the record — including any whose transfer
        failed — and are never used to draw conclusions unless they were valid.
      </p>
      <div class="step-nav">
        <button class="primary" onClick={() => void store.retryTimingAttempt()}>
          Retry
        </button>
        <button class="secondary" onClick={() => store.cancelTimingRetry()}>
          Not now
        </button>
      </div>
    </div>
  );
}

function ResultStage({
  flow,
  snapshot,
  store,
}: {
  flow: GuidedFlowState;
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const result = flow.result;
  if (!result) return <></>;
  const tone =
    result.status === "passed"
      ? "good"
      : result.status === "failed"
        ? "bad"
        : "warn";
  // An experiment whose measurement fell short has not answered anything, and
  // must not be presented as a verdict or as the end of the road. It keeps its
  // milestone, and the offer is to measure the same thing again.
  const incomplete = completedTestResolution(result) === "retryable-incomplete";
  return (
    <>
      <div class="result-head">
        <StatusBadge tone={incomplete ? "warn" : tone}>
          {incomplete ? "NOT ENOUGH OBSERVATION" : result.status.toUpperCase()}
        </StatusBadge>
      </div>
      <p class="result-summary">{result.summary}</p>
      {(result.established.length > 0 ||
        result.rejected.length > 0 ||
        result.unknowns.length > 0) && (
        <>
          <h3 class="result-subhead">What we learned</h3>
          <ul class="observation-list learned">
            {result.established.map((item) => (
              <li key={item} class="passed">
                <span>✓ {item}</span>
              </li>
            ))}
            {result.rejected.map((item) => (
              <li key={item} class="failed">
                <span>✕ {item}</span>
              </li>
            ))}
            {result.unknowns.map((item) => (
              <li key={item}>
                <span>? {item}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {incomplete && (
        <p class="fineprint">
          This is still{" "}
          {flow.corePosition
            ? `test ${flow.corePosition.position} of ${flow.corePosition.total}`
            : "the same test"}{" "}
          — measuring again does not start a new one, and the attempts so far
          stay in the record.
        </p>
      )}
      {!incomplete && flow.coreComplete && (
        <p class="next-up">
          <span class="panel-kicker">DONE</span> Core characterization complete.
        </p>
      )}
      {!incomplete && !flow.coreComplete && flow.nextTest && (
        <p class="next-up">
          <span class="panel-kicker">NEXT</span> {flow.nextTest.title}
        </p>
      )}
      <div class="step-nav">
        {/*
        Optional characterization is never the automatic next step. Once the
        core plan is resolved the product says so and offers to finish;
        continuing is a deliberate choice, not the default button.
      */}
        {incomplete ? (
          <button
            class="primary"
            onClick={() => store.measureAgain(flow.testId)}
          >
            Measure again
          </button>
        ) : flow.coreComplete ? (
          <button
            class="primary"
            onClick={() => {
              store.closeGuidedTest();
              store.stopInvestigation();
            }}
          >
            Finish
          </button>
        ) : flow.nextTest ? (
          <button class="primary" onClick={() => store.continueToNextTest()}>
            Continue
          </button>
        ) : (
          <button class="primary" onClick={() => store.closeGuidedTest()}>
            Done
          </button>
        )}
        {!incomplete && flow.coreComplete && flow.nextTest && (
          <button
            class="secondary"
            onClick={() => store.continueToNextTest({ includeOptional: true })}
          >
            Continue optional characterization
          </button>
        )}
        <button
          class="secondary"
          onClick={() => void store.copyTestReport(flow.testId)}
        >
          Copy report
        </button>
      </div>
      <div class="result-tertiary">
        <button
          class="quiet small"
          onClick={() => {
            store.closeGuidedTest();
            store.stopInvestigation();
          }}
        >
          {incomplete ? "Stop for now" : "Stop testing for now"}
        </button>
        {snapshot.rasterStrategyLabel && (
          <p class="fineprint">
            Active static-image strategy: {snapshot.rasterStrategyLabel}.
          </p>
        )}
      </div>
    </>
  );
}
