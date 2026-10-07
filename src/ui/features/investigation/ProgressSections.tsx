import type { JSX } from "preact";

import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
function focusGeometry(id: string): void {
  requestAnimationFrame(() => {
    const element = document.getElementById(id);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "center" });
  });
}

export function GeometrySetup({
  store,
  snapshot,
}: {
  store: PresentationStore;
  snapshot: AppSnapshot;
}): JSX.Element {
  const { width, height, errors } = snapshot.geometryDraft;
  return (
    <section class="next-action" aria-labelledby="geometry-title">
      <p class="panel-kicker">ONE DETAIL NEEDED</p>
      <h2 id="geometry-title">Establish the display size</h2>
      <p>
        The family is identified. Dimensions create a provisional target; they
        do not verify a model or physical rendering.
      </p>
      <ReportedGeometry snapshot={snapshot} store={store} />
      <h3>Enter dimensions manually</h3>
      <p id="geometry-help">
        Use pixel columns for width and pixel rows for height. Check the product
        specification, label, seller documentation, or count the LEDs. Do not
        guess.
      </p>
      <form
        class="inline-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          store.submitGeometryDraft();
          if (Object.keys(store.getSnapshot().geometryDraft.errors).length)
            focusGeometry(
              store.getSnapshot().geometryDraft.errors.width
                ? "geometry-width"
                : "geometry-height",
            );
          else focusGeometry("geometry-status");
        }}
      >
        <label class="field" for="geometry-width">
          <span>Width (pixels)</span>
          <input
            id="geometry-width"
            type="text"
            inputMode="numeric"
            value={width}
            aria-invalid={Boolean(errors.width || errors.budget)}
            aria-describedby={`geometry-help${errors.width ? " geometry-width-error" : ""}${errors.budget ? " geometry-budget-error" : ""}`}
            onInput={(event) =>
              store.updateGeometryDraft("width", event.currentTarget.value)
            }
          />
          {errors.width && (
            <span id="geometry-width-error">{errors.width}</span>
          )}
        </label>
        <label class="field" for="geometry-height">
          <span>Height (pixels)</span>
          <input
            id="geometry-height"
            type="text"
            inputMode="numeric"
            value={height}
            aria-invalid={Boolean(errors.height || errors.budget)}
            aria-describedby={`geometry-help${errors.height ? " geometry-height-error" : ""}${errors.budget ? " geometry-budget-error" : ""}`}
            onInput={(event) =>
              store.updateGeometryDraft("height", event.currentTarget.value)
            }
          />
          {errors.height && (
            <span id="geometry-height-error">{errors.height}</span>
          )}
        </label>
        <button
          class="primary"
          type="submit"
          disabled={snapshot.busy !== null || !snapshot.liveConnected}
        >
          Use these dimensions
        </button>
        {errors.budget && (
          <p id="geometry-budget-error" role="alert">
            {errors.budget}
          </p>
        )}
      </form>
    </section>
  );
}

export function ReportedGeometry({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const proposal = snapshot.geometryProposal;
  if (!proposal) return <></>;
  const profile = snapshot.geometryProfile;
  const reviewed = profile && !profile.id.startsWith("provisional:");
  const conflict =
    profile &&
    (profile.width !== proposal.width || profile.height !== proposal.height);
  return (
    <section aria-label="Reported display size">
      <p>
        <strong>
          Display reported {proposal.width}×{proposal.height} pixels.
        </strong>
      </p>
      <p>
        Source: {proposal.driverId} identification response,{" "}
        {proposal.recordedAt}.
      </p>
      {reviewed ? (
        <p>
          {conflict
            ? "This conflicts with reviewed profile geometry."
            : "This agrees with reviewed profile geometry."}{" "}
          The reviewed profile remains intact. Inspect the response in Protocol
          workbench before drawing conclusions.
        </p>
      ) : (
        <button
          class="secondary"
          disabled={snapshot.busy !== null}
          onClick={() => {
            store.useReportedGeometry(proposal.id);
            focusGeometry("geometry-status");
          }}
        >
          Use reported size
        </button>
      )}
      <details>
        <summary>Response and interpretation details</summary>
        <p>{proposal.rationale}</p>
        <p>
          Transaction: {proposal.transactionId}. Connection:{" "}
          {proposal.connectionId}.
        </p>
        <button onClick={() => store.setView("develop")}>
          Open Protocol workbench
        </button>
      </details>
    </section>
  );
}

export function GeometryOutcome({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const profile = snapshot.geometryProfile;
  if (!profile?.metadata.provisional)
    return <ReportedGeometry snapshot={snapshot} store={store} />;
  return (
    <section class="know-strip" aria-labelledby="geometry-status">
      <h2 id="geometry-status" tabIndex={-1}>
        {profile.width}×{profile.height} pixels · provisional
      </h2>
      <p>
        Source:{" "}
        {profile.metadata.geometrySource === "device-info"
          ? "display identification response"
          : "manual owner entry (user-confirmed)"}
        .
        {profile.metadata.geometryRecordedAt && (
          <>
            {" "}
            Recorded {profile.metadata.geometryRecordedAt} by {profile.driverId}
            .
          </>
        )}
        {snapshot.source === "imported" && (
          <> Historical imported geometry; no live authority.</>
        )}
      </p>
      <p>
        Reviewed model match and physical rendering remain unconfirmed. Geometry
        grants no capability evidence, experimental permission, or content-send
        authorization.
      </p>
      <ul>
        {Object.values(snapshot.assessment.capabilities)
          .filter((capability) =>
            ["device-info", "brightness", "static-frame"].includes(
              capability.id,
            ),
          )
          .map((capability) => (
            <li key={capability.id}>
              {capability.label}: {capability.availability}. {capability.reason}
            </li>
          ))}
      </ul>
      {snapshot.source !== "imported" && (
        <details>
          <summary>Change dimensions</summary>
          <GeometrySetup snapshot={snapshot} store={store} />
        </details>
      )}
    </section>
  );
}

export function KnownCharacterized({
  store,
}: {
  store: PresentationStore;
}): JSX.Element {
  return (
    <section class="core-complete" aria-labelledby="known-characterized-title">
      <p class="panel-kicker">READY</p>
      <h2 id="known-characterized-title">
        This model is ready for normal use.
      </h2>
      <p>
        Shipped physical evidence already establishes the normal content path.
        Revalidation is optional and records this unit’s observations
        separately.
      </p>
      <div class="next-action-cta">
        <button class="primary" onClick={() => store.setView("control")}>
          Create content
        </button>
        <button class="secondary" onClick={() => store.setView("develop")}>
          View evidence
        </button>
      </div>
    </section>
  );
}

/**
 * Compact, finite progress.
 *
 * The point is reassurance rather than detail: guided work is a short list of
 * milestones with an end, not an open-ended chain. Kept small deliberately —
 * it should answer "how much is left?" at a glance and then get out of the way.
 */
export function CoreProgress({
  snapshot,
}: {
  snapshot: AppSnapshot;
}): JSX.Element {
  const progress = snapshot.coreProgress;
  if (!progress || progress.complete) return <></>;
  return (
    <section class="core-progress" aria-label="Core characterization progress">
      <div class="core-progress-head">
        <strong>{progress.title}</strong>
        {/*
        The denominator is every slot in the plan and never moves. Skipped
        milestones are reported separately rather than deducted, so a branch
        closing reads as "one fewer to do", not as the plan shrinking.
      */}
        <small>
          {progress.resolved} of {progress.total} resolved
          {progress.skipped > 0 && (
            <>
              {" "}
              · {progress.completed} completed, {progress.skipped} skipped
            </>
          )}
        </small>
      </div>
      <div class="core-bar" aria-hidden="true">
        {progress.steps.map((step) => (
          <span key={step.id} class={step.state} />
        ))}
      </div>
      <details class="technical-disclosure">
        <summary>Milestones</summary>
        <ul class="core-steps">
          {progress.steps.map((step) => (
            <li key={step.id} class={step.state}>
              <span class="glyph" aria-hidden="true">
                {step.state === "complete"
                  ? "✓"
                  : step.state === "current"
                    ? "→"
                    : step.state === "skipped"
                      ? "–"
                      : "○"}
              </span>
              <span>
                {step.position}. {step.title}
                {step.state === "skipped" && (
                  <>
                    {" "}
                    — <em>skipped, not needed: {step.skipReason}</em>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/**
 * Core work is finished, so the product says so and stops.
 *
 * Optional characterization is real work with real value, but feeding it
 * automatically is what made the process feel infinite. Continuing is a
 * deliberate choice.
 */
export function CoreComplete({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const strategy = snapshot.rasterStrategyLabel;
  return (
    <section class="core-complete" aria-labelledby="core-complete-title">
      <p class="panel-kicker">DONE</p>
      <h2 id="core-complete-title">Core characterization complete</h2>
      <p>
        {strategy ? (
          <>
            This display can show still images via <strong>{strategy}</strong>.
            {snapshot.coreProgress?.title === "Verify one still-image route" &&
              " Verified for this session only. Text and images remain experimental and each replacement needs exact-send confirmation. Other operations remain separately gated."}
          </>
        ) : (
          <>
            No working way to show a still image was found on this display. The
            investigation report explains what was ruled out and what it would
            take.
          </>
        )}
      </p>
      <div class="next-action-cta">
        {strategy ? (
          <button
            class="primary"
            onClick={() => {
              store.stopInvestigation();
              store.setView("control");
            }}
          >
            Create content
          </button>
        ) : (
          <button class="primary" onClick={() => store.stopInvestigation()}>
            Finish
          </button>
        )}
        <button
          class="secondary"
          onClick={() => void store.copyInvestigationReport()}
        >
          Copy report
        </button>
      </div>
      {snapshot.nextTest && (
        <p class="fineprint">
          Optional follow-up is available under “All guided tests” —{" "}
          {snapshot.nextTest.title}.
        </p>
      )}
    </section>
  );
}

/**
 * A stopped investigation has an outcome worth taking away, so the report
 * stops being a secondary disclosure and becomes the action on offer. It stays
 * a strip rather than a card: the work is finished, and the next test is still
 * the thing the user is most likely to want.
 */
export function StoppedInvestigation({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const investigation = snapshot.investigation;
  if (
    !investigation ||
    investigation.status !== "stopped" ||
    investigation.completedTests.length === 0
  )
    return <></>;
  return (
    <section class="stopped-banner">
      <div>
        <strong>Investigation saved</strong>
        <small>
          {investigation.completedTests.length} test
          {investigation.completedTests.length === 1 ? "" : "s"} · kept on this
          device
        </small>
      </div>
      <button
        class="secondary small"
        onClick={() => void store.copyInvestigationReport()}
      >
        Copy report
      </button>
    </section>
  );
}

/** The one dominant action, with the reason it is next. */
