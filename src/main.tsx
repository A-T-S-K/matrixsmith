import "./style.css";
import { render } from "preact";
import { MatrixController } from "./app/controller";
import { TraceRecorder } from "./diagnostics/trace";
import { WebBluetoothTransport } from "./transport/web-bluetooth";
import { App } from "./ui/App";
import { MatrixStore } from "./ui/store";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root");
const trace = new TraceRecorder();
const transport = new WebBluetoothTransport(trace);
const store = new MatrixStore(new MatrixController(transport, trace), transport);
trace.record("app.started", { webBluetoothSupported: "bluetooth" in navigator });
render(<App store={store}/>, root);
void store.initialize();
// Dev-only console handle for manual QA; never present in production builds.
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).matrixsmithStore = store;
// The offline shell belongs to production builds only. In dev the service
// worker would cache Vite's transient module URLs and serve stale HTML after
// refactors, so dev sessions unregister any worker left by a previous build.
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch((error: unknown) => trace.record("error", { scope: "service-worker", message: String(error) })));
  else void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))).catch(() => undefined);
}
