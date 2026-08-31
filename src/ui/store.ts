import { useSyncExternalStore } from "preact/compat";
import type { Capability } from "../core/capabilities";
import type { GattEndpoint } from "../core/device";
import { MatrixController } from "../app/controller";
import type { ConnectionState, MatrixTransport } from "../transport/types";
import { DEFAULT_REPORT_OPTIONS, generateMarkdownReport, type ReportData, type ReportOptions } from "../diagnostics/report";
import type { ProtocolTransaction } from "../diagnostics/transactions";
import type { DiagnosticRun, DiagnosticTool } from "../diagnostics/workflows";

export type WorkspaceView = "control" | "diagnose" | "develop";
export type TransactionFilter = "all" | "txrx" | "queries" | "probes" | "diagnostics" | "errors";

export interface SupportRow { readonly label: string; readonly status: "Verified live" | "Experimental / gated" | "Dry-run only" | "Blocked" | "Unsupported"; readonly evidence: string; }
export interface GattCharacteristicView { readonly serviceUuid: string; readonly uuid: string; readonly properties: readonly string[]; readonly canRead: boolean; readonly canSubscribe: boolean; readonly subscribed: boolean; }
export interface DriverCandidateView { readonly id: string; readonly family: string; readonly state: string; readonly summary: string; readonly score: number; readonly reasons: readonly string[]; readonly contradictions: readonly string[]; readonly canIdentify: boolean; }

export interface AppSnapshot {
  readonly page: "home" | "workspace";
  readonly view: WorkspaceView;
  readonly connection: ConnectionState;
  readonly source: string;
  readonly liveConnected: boolean;
  readonly busy: string | null;
  readonly error: string | null;
  readonly info: string | null;
  readonly bluetoothSupported: boolean;
  readonly previouslyAuthorized: readonly { readonly id: string; readonly name: string }[];
  readonly device: { readonly name: string; readonly connectionLabel: string; readonly protocol: string; readonly support: string; readonly liveGeometry: string; readonly profileGeometry: string; readonly advertisementGeometry: string; readonly profileId: string | null } | null;
  readonly deviceState: { readonly brightness: number | null; readonly power: string; readonly payloadHex: string | null };
  readonly capabilities: readonly Capability[];
  readonly support: readonly SupportRow[];
  readonly recommended: { readonly title: string; readonly description: string; readonly action: "connect" | "identify" | "checks" | "none" };
  readonly diagnosticTools: readonly DiagnosticTool[];
  readonly diagnosticRuns: readonly DiagnosticRun[];
  readonly candidates: readonly DriverCandidateView[];
  readonly gatt: readonly { readonly uuid: string; readonly primary: boolean; readonly characteristics: readonly GattCharacteristicView[] }[];
  readonly transactions: readonly ProtocolTransaction[];
  readonly rawEvents: readonly import("../diagnostics/trace").TraceEvent[];
  readonly observations: readonly import("../core/evidence").ManualObservation[];
  readonly reportOpen: boolean;
  readonly reportOptions: ReportOptions;
  readonly reportMarkdown: string;
  readonly transactionFilter: TransactionFilter;
  readonly transactionSearch: string;
}

export class MatrixStore {
  readonly #listeners = new Set<() => void>();
  readonly #subscriptions = new Set<string>();
  #page: AppSnapshot["page"] = "home";
  #view: WorkspaceView = "control";
  #busy: string | null = null;
  #error: string | null = null;
  #info: string | null = null;
  #previouslyAuthorized: { id: string; name: string }[] = [];
  #reportOpen = false;
  #reportOptions: ReportOptions = DEFAULT_REPORT_OPTIONS;
  #transactionFilter: TransactionFilter = "all";
  #transactionSearch = "";
  #snapshot!: AppSnapshot;

  constructor(readonly controller: MatrixController, readonly transport: MatrixTransport) {
    controller.trace.subscribe(() => this.#emit());
    const subscribable = transport as MatrixTransport & { subscribeState?: (listener: () => void) => () => void };
    subscribable.subscribeState?.(() => this.#emit());
    this.#rebuild();
  }

  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };
  getSnapshot = (): AppSnapshot => this.#snapshot;

  async initialize(): Promise<void> {
    const bluetooth = (navigator as Navigator & { bluetooth?: Bluetooth & { getDevices?: () => Promise<readonly BluetoothDevice[]> } }).bluetooth;
    if (!bluetooth?.getDevices) return;
    try { this.#previouslyAuthorized = (await bluetooth.getDevices()).map((device) => ({ id: device.id, name: device.name ?? "Unnamed display" })); } catch { this.#previouslyAuthorized = []; }
    this.#emit();
  }

  setView(view: WorkspaceView): void { this.#view = view; this.#emit(); }
  goHome(): void { this.#page = "home"; this.#emit(); }
  clearMessage(): void { this.#error = null; this.#info = null; this.#emit(); }
  openReport(): void { this.#reportOpen = true; this.#emit(); }
  closeReport(): void { this.#reportOpen = false; this.#emit(); }
  setReportOptions(options: ReportOptions): void { this.#reportOptions = options; this.#emit(); }
  setTransactionFilter(value: TransactionFilter): void { this.#transactionFilter = value; this.#emit(); }
  setTransactionSearch(value: string): void { this.#transactionSearch = value; this.#emit(); }

  async connect(mode: "registered" | "inspection" = "registered", serviceHints: readonly BluetoothServiceUUID[] = []): Promise<void> {
    await this.#run(mode === "registered" ? "Connecting display…" : "Opening BLE explorer…", async () => {
      await this.controller.connect(mode, serviceHints);
      await this.controller.enableDriverNotifications().catch(() => undefined);
      this.#page = "workspace";
      this.#view = mode === "registered" ? "diagnose" : "develop";
      this.#info = "Display connected. Review the recommended next action.";
    });
  }

  async disconnect(): Promise<void> { await this.#run("Disconnecting…", async () => { await this.controller.disconnect(); this.#page = "home"; this.#view = "control"; }); }
  async identify(): Promise<void> { await this.#run("Running safe identification…", async () => { const run = await this.controller.runDiagnostic("coolledux-identify"); this.#info = run.status === "passed" ? "CoolLEDUX identified from a valid structured 0x1F response." : run.error; }); }
  async runDiagnostic(id: string): Promise<void> { await this.#run("Running diagnostic…", async () => { const run = await this.controller.runDiagnostic(id); this.#info = run.status === "passed" ? "Diagnostic passed." : run.error; }); }
  async refreshInfo(): Promise<void> { await this.runDiagnostic("coolledux-refresh-info"); }
  async applyBrightness(raw: number): Promise<void> { await this.#run("Applying brightness…", async () => { const command = await this.controller.send(this.controller.plan({ type: "SetBrightness", raw })); if (!command.protocolAcknowledged) throw new Error("Brightness response did not match the command."); const readback = await this.controller.send(this.controller.plan({ type: "GetDeviceInfo" })); const actual = readback.response?.fields.brightnessRaw; if (actual !== raw) throw new Error(`Brightness readback mismatch: expected ${raw}; received ${String(actual)}.`); this.#info = `Brightness ${raw} verified by device-info readback.`; }); }
  async readCharacteristic(endpoint: GattEndpoint): Promise<void> { await this.#run("Reading characteristic…", async () => { const value = await this.controller.read(endpoint); this.#info = `Read ${value.length} byte(s). The transaction retains exact bytes.`; }); }
  async toggleSubscription(endpoint: GattEndpoint): Promise<void> { const key = endpointKey(endpoint); await this.#run(this.#subscriptions.has(key) ? "Unsubscribing…" : "Subscribing…", async () => { if (this.#subscriptions.has(key)) throw new Error("Unsubscribe is available after disconnect in this transport adapter."); await this.controller.enableNotifications(endpoint); this.#subscriptions.add(key); this.#info = "Notifications subscribed."; }); }
  recordObservation(summary: string): void { this.controller.recordObservation(summary); this.#info = "Observation recorded for this session."; this.#emit(); }
  importBundle(json: string): void { this.controller.importBundle(json); this.#page = "workspace"; this.#view = "diagnose"; this.#info = "Diagnostic report opened offline. Live operations remain blocked."; this.#emit(); }
  exportBundle(): string { return this.controller.exportBundle(); }
  markdown(): string { return generateMarkdownReport(this.#reportData(), this.#reportOptions); }

  async copy(text: string): Promise<void> {
    let copied = false;
    if (navigator.clipboard?.writeText) copied = await navigator.clipboard.writeText(text).then(() => true, () => false);
    if (!copied) {
      const area = document.createElement("textarea");
      area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
      document.body.append(area); area.select();
      try { copied = document.execCommand("copy"); } catch { copied = false; }
      area.remove();
    }
    if (copied) this.#info = "Copied to clipboard.";
    else this.#error = "Clipboard access was denied. Use Download instead.";
    this.#emit();
  }
  download(filename: string, content: string, type: string): void { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }

  async #run(label: string, action: () => Promise<void>): Promise<void> { this.#busy = label; this.#error = null; this.#emit(); try { await action(); } catch (error) { this.#error = error instanceof Error ? error.message : String(error); } finally { this.#busy = null; this.#emit(); } }
  #emit(): void { this.#rebuild(); for (const listener of this.#listeners) listener(); }
  #rebuild(): void {
    const session = this.controller.session; const fingerprint = session.fingerprint; const driver = session.selection?.selected; const profile = session.profile; const info = session.latestDeviceInfo;
    const capabilities = driver && profile ? driver.capabilities(profile) : [];
    const transactions = filterTransactions(this.controller.transactions, this.#transactionFilter, this.#transactionSearch);
    const liveConnected = session.source === "live" && this.transport.state === "connected";
    this.#snapshot = Object.freeze({ page: this.#page, view: this.#view, connection: this.transport.state, source: session.source, liveConnected, busy: this.#busy, error: this.#error, info: this.#info, bluetoothSupported: "bluetooth" in navigator, previouslyAuthorized: this.#previouslyAuthorized, device: fingerprint ? { name: fingerprint.name ?? "Unnamed display", connectionLabel: session.source === "imported" ? "Offline report" : this.transport.state === "connected" ? "Connected" : this.transport.state, protocol: driver?.family ?? (session.selection?.ambiguous ? "Ambiguous protocol" : "Unknown protocol"), support: driver ? "Supported" : session.selection?.ambiguous ? "Identification required" : "Support unknown", liveGeometry: fingerprint.manuallyConfirmedGeometry ? `${fingerprint.manuallyConfirmedGeometry.width}×${fingerprint.manuallyConfirmedGeometry.height} · manually confirmed` : "Unknown", profileGeometry: profile ? `${profile.width}×${profile.height} · ${profile.id}` : "Unknown", advertisementGeometry: "Not derived in this session", profileId: profile?.id ?? null } : null, deviceState: { brightness: typeof info?.fields.brightnessRaw === "number" ? info.fields.brightnessRaw : null, power: info ? info.fields.powerOn === true ? "On" : `Raw ${String(info.fields.powerRaw)}` : "Unknown", payloadHex: info?.payloadHex ?? null }, capabilities, support: supportRows(Boolean(fingerprint), Boolean(driver), capabilities), recommended: recommendedAction(Boolean(fingerprint), Boolean(driver), session.selection?.ambiguous ?? false, liveConnected), diagnosticTools: this.controller.diagnosticTools(), diagnosticRuns: this.controller.diagnosticRuns, candidates: (session.selection?.matches ?? []).map((match) => ({ id: match.driverId, family: this.controller.registry.drivers.find((d) => d.id === match.driverId)?.family ?? match.driverId, state: match.driverId === driver?.id ? "VERIFIED ON THIS SESSION" : match.score <= 0 ? "Rejected for this profile" : "Candidate", summary: match.driverId === "coolledux" ? match.driverId === driver?.id ? session.protocolResolution?.summary ?? "Resolved by evidence." : "Shared FFF0/F1 transport" : match.contradictions[0] ?? "Shared FFF0/F1 transport; no verified read-only discriminator available", score: match.score, reasons: match.reasons, contradictions: match.contradictions, canIdentify: match.driverId === "coolledux" && !driver && this.transport.state === "connected" })), gatt: (fingerprint?.services ?? []).map((service) => ({ uuid: service.uuid, primary: service.isPrimary, characteristics: service.characteristics.map((c) => ({ serviceUuid: service.uuid, uuid: c.uuid, properties: Object.entries(c.properties).filter(([, enabled]) => enabled).map(([key]) => key), canRead: c.properties.read, canSubscribe: c.properties.notify || c.properties.indicate, subscribed: this.#subscriptions.has(endpointKey({ serviceUuid: service.uuid, characteristicUuid: c.uuid })) })) })), transactions, rawEvents: this.controller.trace.events, observations: this.controller.observations, reportOpen: this.#reportOpen, reportOptions: this.#reportOptions, reportMarkdown: fingerprint ? this.markdown() : "", transactionFilter: this.#transactionFilter, transactionSearch: this.#transactionSearch });
  }
  #reportData(): ReportData { const session = this.controller.session; const fingerprint = session.fingerprint; if (!fingerprint) throw new Error("No device evidence is available for a report."); const driver = session.selection?.selected; return { createdAt: new Date().toISOString(), matrixsmithVersion: "0.1.0", fingerprint, profile: session.profile, selectedDriver: driver?.id ?? null, driverMatches: session.selection?.matches ?? [], capabilities: driver && session.profile ? driver.capabilities(session.profile) : [], transactions: this.controller.transactions, diagnosticRuns: this.controller.diagnosticRuns, observations: this.controller.observations, trace: this.controller.trace.events, protocolResolution: session.protocolResolution, source: session.source }; }
}

export function useMatrixSnapshot(store: MatrixStore): AppSnapshot { return useSyncExternalStore(store.subscribe, store.getSnapshot); }
function endpointKey(endpoint: GattEndpoint): string { return `${endpoint.serviceUuid.toLowerCase()}/${endpoint.characteristicUuid.toLowerCase()}`; }
function stateOf(capability: Capability | undefined): SupportRow["status"] { if (!capability?.supported) return "Unsupported"; if (!capability.live) return capability.validation === "experimental" ? "Experimental / gated" : "Dry-run only"; return capability.validation === "verified" ? "Verified live" : "Experimental / gated"; }
function supportRows(connected: boolean, resolved: boolean, capabilities: readonly Capability[]): SupportRow[] { return [{ label: "Bluetooth transport", status: connected ? "Verified live" : "Blocked", evidence: connected ? "GATT fingerprint captured" : "No active or imported device" }, { label: "Protocol identity", status: resolved ? "Verified live" : connected ? "Experimental / gated" : "Blocked", evidence: resolved ? "Session resolution evidence" : "Safe identification required" }, { label: "Read-only status", status: stateOf(capabilities.find((c) => c.id === "device-info")), evidence: "Driver capability metadata" }, { label: "Transient control", status: stateOf(capabilities.find((c) => c.id === "brightness")), evidence: "Driver capability metadata" }, { label: "Persistence", status: "Experimental / gated", evidence: "Behavior unknown" }, { label: "Static framebuffer", status: "Dry-run only", evidence: "No verified live command" }, { label: "Pixel orientation", status: "Unsupported", evidence: "Not validated" }, { label: "Color encoding", status: "Unsupported", evidence: "Not validated" }, { label: "Stored programs", status: "Unsupported", evidence: "Outside this branch" }, { label: "Animation", status: "Dry-run only", evidence: "No verified live command" }, { label: "Recovery", status: resolved ? "Experimental / gated" : "Blocked", evidence: "Brightness workflow verifies restoration" }]; }
export function recommendedAction(connected: boolean, resolved: boolean, ambiguous: boolean, live = true): AppSnapshot["recommended"] { if (!connected) return { title: "Connect display", description: "Connect a supported display or open an existing diagnostic report.", action: "connect" }; if (!live) return { title: "Review imported evidence", description: "This is an offline report. Explore Diagnose and Develop; live operations remain blocked.", action: "none" }; if (ambiguous && !resolved) return { title: "Run safe identification", description: "Use the verified read-only CoolLEDUX device-info query to resolve this shared GATT profile.", action: "identify" }; if (resolved) return { title: "Run safe device checks", description: "Refresh device info, or explicitly validate brightness with automatic restoration.", action: "checks" }; return { title: "Collect GATT evidence", description: "No safe family probe is available. Inspect services without writing.", action: "none" }; }
function filterTransactions(values: readonly ProtocolTransaction[], filter: TransactionFilter, search: string): ProtocolTransaction[] { const query = search.trim().toLowerCase(); return values.filter((t) => { const matchesFilter = filter === "all" || filter === "txrx" && t.packets.length > 0 || filter === "queries" && /get|read/i.test(t.operation) || filter === "probes" && t.source === "probe" || filter === "diagnostics" && t.source === "diagnostic" || filter === "errors" && Boolean(t.error || t.responseTimedOut); if (!matchesFilter) return false; if (!query) return true; return [t.operation, t.driverId, t.decodedResponse?.summary, ...t.packets.map((p) => p.hex), t.decodedResponse?.opcode === undefined ? "" : `0x${t.decodedResponse.opcode.toString(16)}`].some((value) => String(value ?? "").toLowerCase().includes(query)); }); }
