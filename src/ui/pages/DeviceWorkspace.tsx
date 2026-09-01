import type { JSX } from "preact";
import type { AppSnapshot, MatrixStore, WorkspaceView } from "../store";
import { DeviceHeader } from "../components/DeviceHeader";
import { ControlView } from "../views/ControlView";
import { InvestigationView } from "../views/InvestigationView";
import { DevelopView } from "../views/DevelopView";

// Device-centered navigation: Create/Control for known displays, guided
// Investigation for characterization and troubleshooting, and the protocol
// workbench as secondary developer tooling.
const nav: readonly [WorkspaceView, string, string][] = [["control", "Create", "◉"], ["diagnose", "Investigate", "◇"], ["develop", "Workbench", "⌘"]];

export function DeviceWorkspace({ snapshot, store }: { readonly snapshot: AppSnapshot; readonly store: MatrixStore }): JSX.Element {
  return <main class="workspace"><DeviceHeader snapshot={snapshot} store={store}/><div class="workspace-shell"><aside class="sidebar"><p class="sidebar-label">DEVICE WORKSPACE</p><nav>{nav.map(([id, label, icon]) => <button class={`${snapshot.view === id ? "active" : ""} ${id === "develop" ? "secondary-nav" : ""}`} onClick={() => store.setView(id)}><span>{icon}</span>{label}{id === "develop" && <small class="nav-note">Developer tools</small>}</button>)}</nav><div class="sidebar-safety"><span>✓</span><div><strong>Safety policy active</strong><small>Unsafe operations restricted</small></div></div></aside><div class="workspace-content">{snapshot.view === "control" && <ControlView snapshot={snapshot} store={store}/>} {snapshot.view === "diagnose" && <InvestigationView snapshot={snapshot} store={store}/>} {snapshot.view === "develop" && <DevelopView snapshot={snapshot} store={store}/>}</div></div><nav class="bottom-nav" aria-label="Device workspace">{nav.map(([id, label, icon]) => <button class={snapshot.view === id ? "active" : ""} onClick={() => store.setView(id)}><span>{icon}</span><small>{label}</small></button>)}</nav></main>;
}
