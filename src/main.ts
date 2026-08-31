import "./style.css";
import { SafeBleTransport } from "./ble/transport";
import type { DiagnosticState } from "./ble/device";
import type { BleLogEntry } from "./ble/logger";
import { orientationPattern } from "./render/patterns";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root");

root.innerHTML = `
  <header>
    <p class="eyebrow">LOCAL-ONLY BLE LAB</p>
    <h1>iLedHat diagnostics</h1>
    <p class="lede">Connect, inspect, read, and observe notifications. Command writes remain deliberately unavailable until the FFF1 wire protocol is verified.</p>
  </header>
  <section class="warning" aria-label="Safety status">
    <strong>TX lock: active</strong>
    <span>No raw-write UI and no command encoder are present in this build.</span>
  </section>
  <div class="actions">
    <button id="connect">Connect to iLedHat</button>
    <button id="read" disabled>Safe read FFF1</button>
    <button id="disconnect" class="secondary" disabled>Disconnect</button>
  </div>
  <section class="grid">
    <article class="panel">
      <h2>BLE status</h2>
      <dl id="status"></dl>
    </article>
    <article class="panel preview-panel">
      <div>
        <h2>32×16 host framebuffer</h2>
        <p>Orientation preview only. It is never transmitted.</p>
      </div>
      <canvas id="preview" width="32" height="16" aria-label="Orientation test pattern preview"></canvas>
    </article>
  </section>
  <section class="panel log-panel">
    <div class="log-heading"><h2>Timestamped BLE log</h2><span id="log-count">0 events</span></div>
    <ol id="log" aria-live="polite"></ol>
  </section>
  <footer>Static PWA · no analytics · no backend · no display content upload</footer>
`;

const transport = new SafeBleTransport();
const connectButton = requiredButton("#connect");
const readButton = requiredButton("#read");
const disconnectButton = requiredButton("#disconnect");
const statusElement = requiredElement("#status");
const logElement = requiredElement("#log");
const logCountElement = requiredElement("#log-count");

transport.subscribe((state) => renderState(state));
transport.logger.subscribe((entry) => appendLog(entry));

connectButton.addEventListener("click", () => run(async () => transport.connect()));
readButton.addEventListener("click", () => run(async () => { await transport.read(); }));
disconnectButton.addEventListener("click", () => run(async () => transport.disconnect()));

drawPreview();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch((error: unknown) => {
    transport.logger.add("ERROR", `ServiceWorker: ${String(error)}`);
  }));
}

async function run(action: () => Promise<void>): Promise<void> {
  connectButton.disabled = true;
  readButton.disabled = true;
  disconnectButton.disabled = true;
  try {
    await action();
  } catch {
    // The transport already records a normalized error.
  } finally {
    renderState(transport.state);
  }
}

function renderState(state: Readonly<DiagnosticState>): void {
  const rows: [string, string][] = [
    ["Browser Web Bluetooth supported", yesNo(state.webBluetoothSupported)],
    ["Device selected", yesNo(state.deviceSelected)],
    ["Device name", state.deviceName ?? "—"],
    ["GATT connected", yesNo(state.gattConnected)],
    ["FFF0 found", yesNo(state.serviceFound)],
    ["FFF1 found", yesNo(state.characteristicFound)],
    ["FFF1 read", yesNo(state.readSupported)],
    ["FFF1 notify", yesNo(state.notifySupported)],
    ["FFF1 writeWithoutResponse", yesNo(state.writeWithoutResponseSupported)],
    ["Notifications enabled", yesNo(state.notificationsEnabled)],
  ];
  statusElement.replaceChildren(...rows.flatMap(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    detail.dataset.value = value.toLowerCase();
    return [term, detail];
  }));
  connectButton.disabled = !state.webBluetoothSupported || state.gattConnected;
  readButton.disabled = !state.gattConnected || !state.readSupported;
  disconnectButton.disabled = !state.gattConnected;
}

function appendLog(entry: BleLogEntry): void {
  const item = document.createElement("li");
  const time = document.createElement("time");
  time.dateTime = entry.at.toISOString();
  time.textContent = entry.at.toLocaleTimeString([], { hour12: false });
  const kind = document.createElement("strong");
  kind.textContent = entry.kind;
  const detail = document.createElement("span");
  detail.textContent = [entry.txSafety ? `[${entry.txSafety.toUpperCase()}]` : "", entry.detail ?? ""].filter(Boolean).join(" ");
  item.append(time, kind, detail);
  logElement.prepend(item);
  logCountElement.textContent = `${transport.logger.entries.length} event${transport.logger.entries.length === 1 ? "" : "s"}`;
}

function drawPreview(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#preview");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  const frame = orientationPattern();
  const image = context.createImageData(frame.width, frame.height);
  for (let source = 0, target = 0; source < frame.data.length; source += 3, target += 4) {
    image.data[target] = frame.data[source] ?? 0;
    image.data[target + 1] = frame.data[source + 1] ?? 0;
    image.data[target + 2] = frame.data[source + 2] ?? 0;
    image.data[target + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function requiredElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function requiredButton(selector: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
