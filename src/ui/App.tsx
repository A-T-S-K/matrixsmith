import type { JSX } from "preact";
import { Home } from "./pages/Home";
import { DeviceWorkspace } from "./pages/DeviceWorkspace";
import { ReportDialog } from "./components/report/ReportDialog";
import { PendingSendDialog, ValidationDialog } from "./components/ValidationDialog";
import { useMatrixSnapshot, type MatrixStore } from "./store";
export function App({ store }: { readonly store: MatrixStore }): JSX.Element { const snapshot = useMatrixSnapshot(store); return <><div class="app-shell">{snapshot.page === "home" ? <Home snapshot={snapshot} store={store}/> : <DeviceWorkspace snapshot={snapshot} store={store}/>}</div>{(snapshot.error || snapshot.info || snapshot.busy) && <div class={`toast ${snapshot.error ? "error" : ""}`} role="status"><span>{snapshot.error ?? snapshot.info ?? snapshot.busy}</span>{!snapshot.busy && <button onClick={() => store.clearMessage()}>×</button>}</div>}<ReportDialog snapshot={snapshot} store={store}/><ValidationDialog snapshot={snapshot} store={store}/><PendingSendDialog snapshot={snapshot} store={store}/></>; }
