import type { JSX } from "preact";
import type { AppSnapshot, MatrixStore, WorkspaceView } from "../store";
import { DeviceHeader } from "../components/DeviceHeader";
import { ControlView } from "../views/ControlView";
import { InvestigationView } from "../views/InvestigationView";
import { DevelopView } from "../views/DevelopView";

// Device-centered navigation: Create/Control for known displays and guided
// Investigation for characterization and troubleshooting. The protocol
// workbench is deliberately NOT a primary navigation peer — every guided
// workflow and report completes without it; it stays one click away for
// someone deliberately looking for developer tooling.
export const PRIMARY_NAV: readonly [WorkspaceView, string, string][] = [["control", "Create", "◉"], ["diagnose", "Investigate", "◇"]];

export function DeviceWorkspace({ snapshot, store }: { readonly snapshot: AppSnapshot; readonly store: MatrixStore }): JSX.Element {
  return <main class="workspace"><DeviceHeader snapshot={snapshot} store={store}/><div class="workspace-shell"><aside class="sidebar"><p class="sidebar-label">DEVICE WORKSPACE</p><nav>{PRIMARY_NAV.map(([id, label, icon]) => <button class={snapshot.view === id ? "active" : ""} onClick={() => store.setView(id)}><span>{icon}</span>{label}</button>)}</nav>
    <div class="sidebar-secondary"><p class="sidebar-label">DEVELOPER TOOLS</p><button class={`secondary-nav ${snapshot.view === "develop" ? "active" : ""}`} onClick={() => store.setView("develop")}><span>⌘</span>Protocol workbench<small class="nav-note">Optional — never required for guided workflows</small></button></div>
    <div class="sidebar-safety"><span>✓</span><div><strong>Safety policy active</strong><small>Unsafe operations restricted</small></div></div></aside><div class="workspace-content">{snapshot.view === "control" && <ControlView snapshot={snapshot} store={store}/>} {snapshot.view === "diagnose" && <InvestigationView snapshot={snapshot} store={store}/>} {snapshot.view === "develop" && <DevelopView snapshot={snapshot} store={store}/>}</div></div><nav class="bottom-nav" aria-label="Device workspace">{PRIMARY_NAV.map(([id, label, icon]) => <button class={snapshot.view === id ? "active" : ""} onClick={() => store.setView(id)}><span>{icon}</span><small>{label}</small></button>)}</nav></main>;
}
