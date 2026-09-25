import type { JSX } from "preact";
import type { AppSnapshot, PresentationStore } from "../../presentation/store";
import {
  GeometrySetup,
  KnownCharacterized,
  CoreProgress,
  CoreComplete,
  StoppedInvestigation,
} from "../features/investigation/ProgressSections";
import {
  NextAction,
  WhatWeKnow,
  RecentResult,
} from "../features/investigation/ActionSections";
import {
  PreviousInvestigation,
  TroubleshootEntry,
  ReportActions,
} from "../features/investigation/HistorySections";
import {
  SupportMap,
  TestCatalogue,
  CompletedTests,
} from "../features/investigation/CatalogueSections";
import { DeveloperTools } from "../features/investigation/DeveloperTools";

/** The guided investigation workspace. */
export function InvestigationView({
  snapshot,
  store,
}: {
  readonly snapshot: AppSnapshot;
  readonly store: PresentationStore;
}): JSX.Element {
  const started = Boolean(snapshot.investigation?.completedTests.length);
  return (
    <section class="view investigate">
      <h1 class="view-title">Investigate</h1>
      {snapshot.investigation && started && (
        <p class="goal-line">{snapshot.investigation.goalLabel}</p>
      )}

      <StoppedInvestigation snapshot={snapshot} store={store} />
      {snapshot.cycleWarning && (
        <p class="cycle-warning" role="status">
          MatrixSmith detected a recommendation loop and stopped advancing
          automatically. {snapshot.cycleWarning}
        </p>
      )}
      {snapshot.assessment.readiness === "needs-geometry" ? (
        <GeometrySetup store={store} />
      ) : snapshot.coreProgress?.complete ? (
        snapshot.investigation ? (
          <CoreComplete snapshot={snapshot} store={store} />
        ) : (
          <KnownCharacterized store={store} />
        )
      ) : (
        <NextAction snapshot={snapshot} store={store} />
      )}
      <CoreProgress snapshot={snapshot} />
      <WhatWeKnow snapshot={snapshot} />
      <RecentResult snapshot={snapshot} store={store} />
      <PreviousInvestigation snapshot={snapshot} store={store} />
      <TroubleshootEntry snapshot={snapshot} store={store} />

      <details class="secondary-section">
        <summary>
          All guided tests
          {snapshot.guidedTests.length
            ? ` (${snapshot.guidedTests.length})`
            : ""}
        </summary>
        <TestCatalogue snapshot={snapshot} store={store} />
      </details>
      <details class="secondary-section">
        <summary>
          Previous tests
          {snapshot.investigation?.completedTests.length
            ? ` (${snapshot.investigation.completedTests.length})`
            : ""}
        </summary>
        <CompletedTests snapshot={snapshot} store={store} />
      </details>
      <details class="secondary-section">
        <summary>Technical support map</summary>
        <SupportMap snapshot={snapshot} />
      </details>
      <details class="secondary-section">
        <summary>Reports</summary>
        <ReportActions store={store} />
      </details>
      <details class="secondary-section">
        <summary>Developer tools</summary>
        <DeveloperTools snapshot={snapshot} store={store} />
      </details>
    </section>
  );
}
