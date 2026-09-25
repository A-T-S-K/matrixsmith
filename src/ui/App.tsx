import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { lazy, Suspense } from "preact/compat";
import { useLayoutEffect } from "preact/hooks";
import { GuidedTestDialog } from "./components/GuidedTestDialog";
import { NoticeRegion } from "./components/NoticeRegion";
import { ExperimentalSendDialog } from "./components/ExperimentalSendDialog";
import { DeviceWorkspace } from "./pages/DeviceWorkspace";
import { Home } from "./pages/Home";
import type { PresentationStore } from "../presentation/store";
import type { UpdateManager } from "../app/update-manager";
import { UpdateNotice } from "./components/UpdateNotice";
const ReportDialog = lazy(async () => ({
  default: (await import("./components/report/ReportDialog")).ReportDialog,
}));

export function App({
  store,
  updates,
}: {
  readonly store: PresentationStore;
  readonly updates?: UpdateManager;
}): JSX.Element {
  const snapshotSignal = useSignal(store.getSnapshot());
  useLayoutEffect(() => {
    const sync = (): void => {
      snapshotSignal.value = store.getSnapshot();
    };
    const unsubscribe = store.subscribe(sync);
    sync();
    return unsubscribe;
  }, [store, snapshotSignal]);
  const snapshot = snapshotSignal.value;
  return (
    <>
      <div class="app-shell">
        {snapshot.page === "home" ? (
          <Home snapshot={snapshot} store={store} />
        ) : (
          <DeviceWorkspace snapshot={snapshot} store={store} />
        )}
      </div>
      {(snapshot.error || snapshot.info || snapshot.busy) && (
        <NoticeRegion
          tone={snapshot.error ? "error" : "status"}
          onClose={!snapshot.busy ? () => store.clearMessage() : undefined}
        >
          {snapshot.error ?? snapshot.busy ?? snapshot.info}
        </NoticeRegion>
      )}
      <UpdateNotice
        updates={updates}
        blocked={
          snapshot.busy ??
          (snapshot.guidedFlow
            ? "Finish or close the guided test before updating."
            : null)
        }
      />
      <Suspense fallback={null}>
        <ReportDialog snapshot={snapshot} store={store} />
      </Suspense>
      <ExperimentalSendDialog snapshot={snapshot} store={store} />
      <GuidedTestDialog snapshot={snapshot} store={store} />
    </>
  );
}
