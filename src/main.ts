import "./style.css";
import { MatrixController } from "./app/controller";
import type { DeviceFingerprint } from "./core/device";
import type { TransmissionPlan } from "./core/transmission";
import { TraceRecorder, type TraceEvent } from "./diagnostics/trace";
import { COOLLEDX_ENDPOINT } from "./drivers/coolledx/gatt";
import { FrameSequence } from "./render/frame-sequence";
import { Framebuffer } from "./render/framebuffer";
import { orientationPattern } from "./render/patterns";
import { WebBluetoothTransport } from "./transport/web-bluetooth";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root");

root.innerHTML = `
  <header class="masthead"><div><p class="eyebrow">LOCAL-FIRST MATRIX PLATFORM</p><h1>MatrixSmith</h1></div><p class="lede">Control supported displays, inspect hardware evidence, and develop protocols without sending device data to a server.</p></header>
  <section class="safety-banner" id="safety-banner" aria-live="polite"><strong>Live TX locked</strong><span>Only a deliberate, session-unlocked iLedHat brightness experiment can pass policy.</span></section>
  <nav class="tabs" aria-label="Primary surfaces"><button class="tab active" data-tab="control">Control</button><button class="tab" data-tab="inspect">Inspect</button><button class="tab" data-tab="lab">Lab</button></nav>
  <section id="control" class="surface active">
    <div class="surface-heading"><div><h2>Control</h2><p>Normal, verified device controls live here.</p></div><span class="status-pill" id="connection-pill">Disconnected</span></div>
    <div class="actions"><button id="connect">Connect display</button><button id="disconnect" class="secondary" disabled>Disconnect</button></div>
    <article class="panel"><h3>Selected display</h3><dl id="control-identity"></dl></article>
    <article class="panel quiet"><h3>Brightness</h3><p>The current iLedHat profile is experimental. Brightness validation is available in <button class="text-button" data-open-tab="lab">Lab</button>.</p></article>
  </section>
  <section id="inspect" class="surface" hidden>
    <div class="surface-heading"><div><h2>Inspect</h2><p>Portable observations, matching reasons, GATT, and capabilities.</p></div></div>
    <div class="actions"><button id="safe-read" disabled>Explicit safe read</button><button id="notifications" class="secondary" disabled>Enable notifications</button></div>
    <div class="inspect-grid"><article class="panel"><h3>Fingerprint</h3><dl id="fingerprint"></dl></article><article class="panel"><h3>Driver matches</h3><div id="matches" class="stack"></div></article></div>
    <article class="panel"><h3>Accessible GATT</h3><div id="gatt" class="stack"></div></article>
    <article class="panel"><h3>Capabilities</h3><div id="capabilities" class="capability-grid"></div></article>
  </section>
  <section id="lab" class="surface" hidden>
    <div class="surface-heading"><div><h2>Lab</h2><p>Dry-run protocol plans, controlled validation, unknown-device evidence, and offline diagnostics.</p></div></div>
    <article class="panel danger-zone"><label class="toggle"><input id="experiment-unlock" type="checkbox"><span><strong>Enable experimental TX for this session</strong><small>Memory only. Clears on disconnect or reload.</small></span></label></article>
    <div class="lab-grid">
      <article class="panel"><h3>Brightness validation</h3><p>Separated raw values; these are not percentages.</p><div class="actions"><button id="plan-low" disabled>Low test <code>0x40</code></button><button id="plan-high" disabled>High test <code>0xC0</code></button></div></article>
      <article class="panel"><h3>Dry-run controls</h3><div class="actions compact"><button data-dry="mode" disabled>Mode: static</button><button data-dry="speed" disabled>Speed <code>0x10</code></button><button data-dry="power" disabled>Switch on</button><button data-dry="frame" disabled>Static frame</button><button data-dry="animation" disabled>2-frame animation</button><button data-dry="text" disabled>Text banner</button></div></article>
    </div>
    <article class="panel plan-panel"><div class="panel-heading"><h3>Exact TransmissionPlan</h3><span id="plan-state">No plan</span></div><div id="plan-view" class="empty">Create a plan to inspect the operation, evidence, endpoint, and exact packets.</div><p id="host-result" class="host-result"><strong>HOST RESULT</strong> Not sent. Browser acceptance never implies device verification.</p><button id="send-plan" class="send" disabled>Send this exact plan</button></article>
    <article class="panel"><h3>Device observation</h3><p>Browser acceptance is not device verification.</p><div class="actions compact"><button data-observation="Brightness changed as expected">Changed as expected</button><button data-observation="No visible change">No visible change</button><button data-observation="Unexpected behavior">Unexpected behavior</button></div><div class="inline-form"><input id="observation-note" placeholder="Additional manual observation"><button id="record-note" class="secondary">Record</button></div></article>
    <article class="panel"><h3>Probe unknown device</h3><p>Optional service UUID hints must be supplied before the chooser. Unknown-device mode has no generic write path.</p><div class="inline-form"><input id="service-hints" placeholder="FFF0, service UUID…"><button id="probe" class="secondary">Open inspection chooser</button></div><p class="fineprint">The browser may hide services that were not granted by the chooser.</p></article>
    <article class="panel"><h3>Diagnostic bundle</h3><p>Explicit local JSON export/import. Import creates offline evidence only.</p><div class="actions"><button id="download-bundle" disabled>Download bundle</button><label class="file-button">Import bundle<input id="import-bundle" type="file" accept="application/json,.json"></label></div></article>
    <article class="panel trace-panel"><div class="panel-heading"><h3>Structured trace</h3><span id="trace-count">0 events</span></div><ol id="trace"></ol></article>
  </section>
  <footer>Static PWA · no analytics · no backend · no telemetry · no arbitrary raw writer</footer>
`;

const trace = new TraceRecorder();
const transport = new WebBluetoothTransport(trace);
const controller = new MatrixController(transport, trace);
let currentPlan: TransmissionPlan | null = null;
let hostResult = "Not sent. Browser acceptance never implies device verification.";
const connectButton = button("#connect");
const disconnectButton = button("#disconnect");
const safeReadButton = button("#safe-read");
const notificationsButton = button("#notifications");
const unlock = input("#experiment-unlock");
const sendButton = button("#send-plan");

trace.subscribe(appendTrace);
trace.record("app.started", { webBluetoothSupported: "bluetooth" in navigator });
transport.subscribeState(() => render());
for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) tab.addEventListener("click", () => openTab(tab.dataset.tab ?? "control"));
for (const opener of document.querySelectorAll<HTMLButtonElement>("[data-open-tab]")) opener.addEventListener("click", () => openTab(opener.dataset.openTab ?? "control"));
connectButton.addEventListener("click", () => run(async () => { await controller.connect(); await controller.enableNotifications(COOLLEDX_ENDPOINT).catch(() => undefined); }));
disconnectButton.addEventListener("click", () => run(async () => { await controller.disconnect(); currentPlan = null; hostResult = "Not sent. Browser acceptance never implies device verification."; unlock.checked = false; }));
safeReadButton.addEventListener("click", () => run(async () => { await controller.read(COOLLEDX_ENDPOINT); }));
notificationsButton.addEventListener("click", () => run(async () => { await controller.enableNotifications(COOLLEDX_ENDPOINT); }));
unlock.addEventListener("change", () => { unlock.checked ? controller.session.enableExperimentalTx() : controller.session.disableExperimentalTx(); render(); });
button("#plan-low").addEventListener("click", () => createPlan({ type: "SetBrightness", raw: 0x40 }));
button("#plan-high").addEventListener("click", () => createPlan({ type: "SetBrightness", raw: 0xc0 }));
for (const dryButton of document.querySelectorAll<HTMLButtonElement>("[data-dry]")) dryButton.addEventListener("click", () => createDryPlan(dryButton.dataset.dry ?? ""));
sendButton.addEventListener("click", () => run(async () => {
  if (!currentPlan) throw new Error("No TransmissionPlan is selected.");
  try {
    const result = await controller.send(currentPlan);
    hostResult = `Browser stack accepted ${result.receipts.length} packet(s). Device verification remains false until a separate observation is recorded.`;
  } catch (error) {
    hostResult = `Rejected or failed: ${error instanceof Error ? error.message : String(error)}`;
    throw error;
  }
}));
for (const observation of document.querySelectorAll<HTMLButtonElement>("[data-observation]")) observation.addEventListener("click", () => { controller.recordObservation(observation.dataset.observation ?? "Observation"); render(); });
button("#record-note").addEventListener("click", () => { const note = input("#observation-note"); controller.recordObservation(note.value); note.value = ""; render(); });
button("#probe").addEventListener("click", () => run(async () => { const hints = input("#service-hints").value.split(",").map((value) => value.trim()).filter(Boolean); await controller.connect("inspection", hints); openTab("inspect"); }));
button("#download-bundle").addEventListener("click", () => {
  const blob = new Blob([controller.exportBundle()], { type: "application/json" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `matrixsmith-diagnostic-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.json`; anchor.click(); URL.revokeObjectURL(url);
});
input("#import-bundle").addEventListener("change", () => run(async () => { const file = input("#import-bundle").files?.[0]; if (!file) return; controller.importBundle(await file.text()); currentPlan = null; unlock.checked = false; openTab("inspect"); }));
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch((error: unknown) => trace.record("error", { scope: "service-worker", message: String(error) })));
render();

function createPlan(operation: Parameters<MatrixController["plan"]>[0]): void { try { currentPlan = controller.plan(operation); hostResult = "Not sent. Browser acceptance never implies device verification."; render(); } catch (error) { reportError(error); } }
function createDryPlan(kind: string): void {
  const frame = orientationPattern(32, 16);
  if (kind === "mode") createPlan({ type: "SetDisplayMode", mode: "static" });
  if (kind === "speed") createPlan({ type: "SetScrollSpeed", raw: 0x10 });
  if (kind === "power") createPlan({ type: "SetPower", on: true });
  if (kind === "frame") createPlan({ type: "ShowFrame", frame });
  if (kind === "animation") { const second = new Framebuffer(32, 16); second.fill(0, 0, 255); createPlan({ type: "ShowAnimation", sequence: new FrameSequence([frame, second], [{ milliseconds: 500 }, { milliseconds: 500 }]) }); }
  if (kind === "text") createPlan({ type: "ShowText", text: "MatrixSmith", frame });
}

function render(): void {
  const connected = transport.state === "connected"; const fingerprint = controller.session.fingerprint; const profile = controller.session.profile; const selection = controller.session.selection;
  element("#connection-pill").textContent = controller.session.source === "imported" ? "Offline bundle" : connected ? "Connected" : titleCase(transport.state);
  connectButton.disabled = connected || transport.state === "selecting" || transport.state === "connecting" || !("bluetooth" in navigator); disconnectButton.disabled = !connected;
  safeReadButton.disabled = !connected || !endpointProperty(fingerprint, "read"); notificationsButton.disabled = !connected || !endpointProperty(fingerprint, "notify"); button("#download-bundle").disabled = !fingerprint;
  for (const id of ["#plan-low", "#plan-high"]) button(id).disabled = !profile; for (const dry of document.querySelectorAll<HTMLButtonElement>("[data-dry]")) dry.disabled = !profile;
  renderDl("#control-identity", [["Device", fingerprint?.name ?? "—"], ["Driver", selection?.selected?.family ?? "—"], ["Profile", profile?.name ?? "—"], ["Dimensions", profile ? `${profile.width}×${profile.height}` : "—"], ["Source", controller.session.source]]);
  renderDl("#fingerprint", [["Browser BLE", yesNo("bluetooth" in navigator)], ["Transport", fingerprint?.transportKind ?? "—"], ["Name", fingerprint?.name ?? "—"], ["Driver", selection?.selected?.family ?? "not selected"], ["Profile", profile?.id ?? "not resolved"], ["Geometry", fingerprint?.manuallyConfirmedGeometry ? `${fingerprint.manuallyConfirmedGeometry.width}×${fingerprint.manuallyConfirmedGeometry.height}` : "unknown"], ["Manufacturer", fingerprint?.manufacturerDataHex ?? "not browser-observable"], ["Advertisement", fingerprint?.rawAdvertisementHex ?? "not available in this session"]]);
  renderMatches(); renderGatt(); renderCapabilities();
  const decision = currentPlan ? controller.evaluate(currentPlan) : null; sendButton.disabled = !currentPlan || !decision?.allowed;
  element("#host-result").innerHTML = `<strong>HOST RESULT</strong> ${escapeHtml(hostResult)}`;
  const banner = element("#safety-banner"); banner.classList.toggle("unlocked", controller.session.experimentalTxEnabled); banner.querySelector("strong")!.textContent = controller.session.experimentalTxEnabled ? "Experimental TX unlocked" : "Live TX locked";
  banner.querySelector("span")!.textContent = currentPlan && decision && !decision.allowed ? decision.reasons.join(" ") : "Only a deliberate, session-unlocked iLedHat brightness experiment can pass policy.";
  if (currentPlan) renderPlan(currentPlan, decision!);
}

function renderMatches(): void { const matches = controller.session.selection?.matches ?? []; element("#matches").replaceChildren(...(matches.length ? matches.map((match) => card(`${match.driverId} · ${match.confidence} · ${match.score}`, [...match.reasons, ...match.contradictions.map((item) => `Contradiction: ${item}`)])) : [empty("No fingerprint available.")])); }
function renderGatt(): void { const services = controller.session.fingerprint?.services ?? []; element("#gatt").replaceChildren(...(services.length ? services.map((service) => card(service.uuid, service.characteristics.map((characteristic) => `${characteristic.uuid} · ${enabledProperties(characteristic.properties).join(", ") || "no reported properties"}`))) : [empty("No accessible GATT evidence. Browser permission limits may apply.")])); }
function renderCapabilities(): void { const driver = controller.session.selection?.selected; const profile = controller.session.profile; const capabilities = driver && profile ? driver.capabilities(profile) : []; element("#capabilities").replaceChildren(...(capabilities.length ? capabilities.map((capability) => card(capability.label, [`${capability.validation} · ${capability.risk} · persistence ${capability.persistence}`, capability.live ? "Lab live gate exists" : "Dry-run only"])) : [empty("No profile capabilities resolved.")])); }
function renderPlan(plan: TransmissionPlan, decision: ReturnType<MatrixController["authorize"]>): void {
  element("#plan-state").textContent = decision.allowed ? "Policy allows deliberate send" : "Blocked by policy";
  const summary = document.createElement("dl"); summary.className = "plan-summary";
  const rows: [string, string][] = [["Plan ID", plan.id], ["Operation", plan.operation.type], ["Driver / profile", `${plan.driverId} / ${plan.profileId}`], ["Risk", `${plan.risk} · persistence ${plan.persistence}`], ["Validation", plan.validation], ["ACK", plan.ackPolicy], ["Packets", String(plan.packets.length)]];
  for (const [label, value] of rows) addDlRow(summary, label, value);
  const packets = document.createElement("div"); packets.className = "packets";
  for (const packet of plan.packets) { const block = document.createElement("article"); block.innerHTML = `<strong>Packet ${packet.index + 1} · ${packet.bytes.length} bytes · ${escapeHtml(packet.writeMode)}</strong><small>${escapeHtml(packet.endpoint.serviceUuid)} / ${escapeHtml(packet.endpoint.characteristicUuid)}</small><code>${escapeHtml(packet.hex)}</code>`; packets.append(block); }
  const policy = document.createElement("p"); policy.className = decision.allowed ? "policy allow" : "policy block"; policy.textContent = decision.allowed ? "Authorized only when you tap Send this exact plan." : decision.reasons.join(" "); element("#plan-view").replaceChildren(summary, policy, packets);
}
function appendTrace(event: TraceEvent): void { const item = document.createElement("li"); const raw = event.rawBytes ? [...event.rawBytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ").toUpperCase() : ""; item.innerHTML = `<time>${escapeHtml(new Date(event.timestamp).toLocaleTimeString([], { hour12: false }))}</time><strong>${escapeHtml(event.type)}</strong><span>${escapeHtml(JSON.stringify(event.metadata))}${raw ? `<code>${raw}</code>` : ""}</span>`; element("#trace").prepend(item); element("#trace-count").textContent = `${trace.events.length} events`; }
async function run(action: () => Promise<void>): Promise<void> { try { await action(); } catch (error) { reportError(error); } finally { render(); } }
function reportError(error: unknown): void { trace.record("error", { scope: "ui", message: error instanceof Error ? error.message : String(error) }); }
function openTab(id: string): void { for (const surface of document.querySelectorAll<HTMLElement>(".surface")) { const active = surface.id === id; surface.hidden = !active; surface.classList.toggle("active", active); } for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) tab.classList.toggle("active", tab.dataset.tab === id); }
function renderDl(selector: string, rows: readonly (readonly [string, string])[]): void { const dl = element(selector); dl.replaceChildren(); for (const [label, value] of rows) addDlRow(dl, label, value); }
function addDlRow(dl: HTMLElement, label: string, value: string): void { const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; dl.append(dt, dd); }
function card(title: string, lines: readonly string[]): HTMLElement { const article = document.createElement("article"); article.className = "mini-card"; const heading = document.createElement("strong"); heading.textContent = title; article.append(heading); for (const line of lines) { const paragraph = document.createElement("p"); paragraph.textContent = line; article.append(paragraph); } return article; }
function empty(text: string): HTMLElement { const paragraph = document.createElement("p"); paragraph.className = "empty"; paragraph.textContent = text; return paragraph; }
function endpointProperty(fingerprint: DeviceFingerprint | null, property: "read" | "notify"): boolean { return fingerprint?.services.some((service) => service.uuid.toLowerCase() === COOLLEDX_ENDPOINT.serviceUuid && service.characteristics.some((characteristic) => characteristic.uuid.toLowerCase() === COOLLEDX_ENDPOINT.characteristicUuid && characteristic.properties[property])) ?? false; }
function enabledProperties(properties: DeviceFingerprint["services"][number]["characteristics"][number]["properties"]): string[] { return (Object.entries(properties) as [string, boolean][]).filter(([, enabled]) => enabled).map(([name]) => name); }
function yesNo(value: boolean): string { return value ? "yes" : "no"; } function titleCase(value: string): string { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
function element(selector: string): HTMLElement { const value = document.querySelector<HTMLElement>(selector); if (!value) throw new Error(`Missing ${selector}`); return value; }
function button(selector: string): HTMLButtonElement { const value = document.querySelector<HTMLButtonElement>(selector); if (!value) throw new Error(`Missing ${selector}`); return value; }
function input(selector: string): HTMLInputElement { const value = document.querySelector<HTMLInputElement>(selector); if (!value) throw new Error(`Missing ${selector}`); return value; }
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
