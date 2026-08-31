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
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch((error: unknown) => trace.record("error", { scope: "service-worker", message: String(error) })));
