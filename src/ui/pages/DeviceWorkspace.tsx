import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact";
import { lazy, Suspense } from "preact/compat";
import type {
  AppSnapshot,
  PresentationStore,
  WorkspaceView,
} from "../../presentation/store";
import { DeviceHeader } from "../components/DeviceHeader";
const ControlView = lazy(async () => ({
  default: (await import("../views/ControlView")).ControlView,
}));
const InvestigationView = lazy(async () => ({
  default: (await import("../views/InvestigationView")).InvestigationView,
}));
const DevelopView = lazy(async () => ({
  default: (await import("../views/DevelopView")).DevelopView,
}));

// Device-centered navigation: Create/Control for known displays and guided
// Investigation for characterization and troubleshooting. The protocol
// workbench is deliberately NOT a primary navigation peer — every guided
// workflow and report completes without it; it stays one click away for
// someone deliberately looking for developer tooling.
export const PRIMARY_NAV: readonly [WorkspaceView, string, string][] = [
  ["control", "Create", "◉"],
  ["diagnose", "Investigate", "◇"],
];

export function DeviceWorkspace({
  snapshot,
  store,
}: {
  readonly snapshot: AppSnapshot;
  readonly store: PresentationStore;
}): JSX.Element {
  const mainRef = useRef<HTMLElement>(null);
  const focusedRoute = useRef("");
  useEffect(() => {
    const key = `${snapshot.contextIdentity}:${snapshot.view}:${snapshot.workbenchSection}:${snapshot.missingContext}`;
    if (focusedRoute.current === key || snapshot.busy) return;
    const main = mainRef.current;
    if (!main || document.querySelector('[role="dialog"]')) return;
    const focusHeading = () => {
      const current = store.getSnapshot();
      if (current.busy) return false;
      if (current.sendAttempt?.phase === "review") {
        focusedRoute.current = key;
        return true;
      }
      const heading = main.querySelector<HTMLElement>("h1");
      if (!heading) return false;
      if (document.activeElement?.matches("input,textarea,select")) return true;
      focusedRoute.current = key;
      heading.tabIndex = -1;
      heading.focus();
      return true;
    };
    if (focusHeading()) return;
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [
    snapshot.contextIdentity,
    snapshot.view,
    snapshot.workbenchSection,
    snapshot.missingContext,
    snapshot.busy,
  ]);
  const primaryNav =
    snapshot.source === "imported"
      ? PRIMARY_NAV.filter(([id]) => id !== "control")
      : PRIMARY_NAV;
  if (snapshot.missingContext)
    return (
      <main ref={mainRef} class="workspace">
        <h1 tabIndex={-1}>
          {snapshot.missingContext === "offline"
            ? "Reopen diagnostic report"
            : "Connect a display"}
        </h1>
        <p>
          {snapshot.missingContext === "offline"
            ? "This link needs a report opened in this browser session. Reopen the JSON report from Home."
            : "This link selects a live view. Connect a display explicitly from Home."}
        </p>
        <button onClick={() => store.goHome()}>Go to Home</button>
      </main>
    );
  return (
    <main ref={mainRef} class="workspace">
      <DeviceHeader snapshot={snapshot} store={store} />
      {(snapshot.offlineWorkspaceAvailable ||
        snapshot.source === "imported") && (
        <section class="notice" aria-label="Workspace contexts">
          <strong>
            {snapshot.source === "imported"
              ? "Active: offline report · read-only"
              : `Active: live display · ${snapshot.connection}`}
          </strong>
          <div class="inline-form">
            {snapshot.source === "imported" ? (
              snapshot.liveWorkspaceAvailable ? (
                <button
                  disabled={Boolean(snapshot.contextTransitionReason)}
                  onClick={() => store.returnToLiveWorkspace()}
                >
                  Return to live display (
                  {snapshot.retainedLiveConnection === "idle"
                    ? "disconnected"
                    : snapshot.retainedLiveConnection}
                  )
                </button>
              ) : (
                <button
                  disabled={
                    Boolean(snapshot.contextTransitionReason) ||
                    !snapshot.bluetoothSupported
                  }
                  onClick={() => void store.connect()}
                >
                  Connect a display
                </button>
              )
            ) : (
              <button
                disabled={Boolean(snapshot.contextTransitionReason)}
                onClick={() => store.returnToOfflineWorkspace()}
              >
                Return to retained report
              </button>
            )}
            <button
              disabled={Boolean(snapshot.contextTransitionReason)}
              onClick={() => store.closeOfflineWorkspace()}
            >
              Close retained report
            </button>
          </div>
          {snapshot.contextTransitionReason && (
            <p>{snapshot.contextTransitionReason}</p>
          )}
        </section>
      )}
      <div class="workspace-shell">
        <aside class="sidebar">
          <p class="sidebar-label">DEVICE WORKSPACE</p>
          <nav>
            {primaryNav.map(([id, label, icon]) => (
              <button
                key={id}
                class={snapshot.view === id ? "active" : ""}
                onClick={() => store.setView(id)}
              >
                <span>{icon}</span>
                {label}
              </button>
            ))}
          </nav>
          <div class="sidebar-secondary">
            <p class="sidebar-label">DEVELOPER TOOLS</p>
            <button
              class={`secondary-nav ${snapshot.view === "develop" ? "active" : ""}`}
              onClick={() => store.setView("develop")}
            >
              <span>⌘</span>Protocol workbench
              <small class="nav-note">
                Optional — never required for guided workflows
              </small>
            </button>
          </div>
          <div class="sidebar-safety">
            <span>✓</span>
            <div>
              <strong>Safety policy active</strong>
              <small>Unsafe operations restricted</small>
            </div>
          </div>
        </aside>
        <div class="workspace-content">
          {snapshot.view === "control" && (
            <Suspense fallback={<p role="status">Loading Create…</p>}>
              <ControlView snapshot={snapshot} store={store} />
            </Suspense>
          )}{" "}
          {snapshot.view === "diagnose" && (
            <Suspense fallback={<p role="status">Loading investigation…</p>}>
              <InvestigationView snapshot={snapshot} store={store} />
            </Suspense>
          )}{" "}
          {snapshot.view === "develop" && (
            <Suspense
              fallback={<p role="status">Loading protocol workbench…</p>}
            >
              <DevelopView snapshot={snapshot} store={store} />
            </Suspense>
          )}
        </div>
      </div>
      <nav class="bottom-nav" aria-label="Device workspace">
        {primaryNav.map(([id, label, icon]) => (
          <button
            key={id}
            class={snapshot.view === id ? "active" : ""}
            onClick={() => store.setView(id)}
          >
            <span>{icon}</span>
            <small>{label}</small>
          </button>
        ))}
      </nav>
    </main>
  );
}
