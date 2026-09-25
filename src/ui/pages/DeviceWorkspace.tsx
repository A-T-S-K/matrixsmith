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
  return (
    <main class="workspace">
      <DeviceHeader snapshot={snapshot} store={store} />
      <div class="workspace-shell">
        <aside class="sidebar">
          <p class="sidebar-label">DEVICE WORKSPACE</p>
          <nav>
            {PRIMARY_NAV.map(([id, label, icon]) => (
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
        {PRIMARY_NAV.map(([id, label, icon]) => (
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
