import type { DeviceFingerprint } from "../core/device";
import type { GattEndpoint } from "../core/device";
import type { ManualObservation } from "../core/evidence";
import type { MatrixOperation } from "../core/operations";
import type { TransmissionPlan } from "../core/transmission";
import { createDiagnosticBundle, notificationPacketsFromBundle, parseDiagnosticBundle, serializeDiagnosticBundle, type DiagnosticBundleV1 } from "../diagnostics/bundle";
import { TraceRecorder } from "../diagnostics/trace";
import { builtInDrivers, DriverRegistry } from "../drivers/registry";
import type { DecodedNotification, MatrixDriver } from "../drivers/types";
import type { MatrixTransport } from "../transport/types";
import { TransmissionExecutor, type ExecutionResult } from "./executor";
import { SafetyPolicy, type PolicyDecision } from "./safety";
import { MatrixSession } from "./session";
import { NotificationRouter, type NotificationRecord } from "./notifications";
import { packetHex } from "../core/transmission";

export class MatrixController {
  readonly session = new MatrixSession();
  readonly trace: TraceRecorder;
  readonly registry: DriverRegistry;
  readonly policy = new SafetyPolicy();
  readonly #executor: TransmissionExecutor;
  readonly #notificationRouter = new NotificationRouter();
  readonly #observations: ManualObservation[] = [];
  readonly #notificationSubscriptions = new Map<string, () => Promise<void>>();

  constructor(readonly transport: MatrixTransport, trace = new TraceRecorder(), registry = new DriverRegistry(builtInDrivers)) {
    this.trace = trace;
    this.registry = registry;
    this.#executor = new TransmissionExecutor(transport, trace, this.#notificationRouter);
  }

  get observations(): readonly ManualObservation[] { return this.#observations; }

  availableEndpoints(): readonly GattEndpoint[] {
    const fingerprint = this.session.fingerprint;
    if (!fingerprint) return [];
    const drivers = this.session.selection?.selected ? [this.session.selection.selected] : this.registry.drivers.filter((driver) => driver.match(fingerprint).score > 0);
    const endpoints = new Map<string, GattEndpoint>();
    for (const driver of drivers) {
      const profile = driver.resolveProfile(fingerprint);
      if (!profile) continue;
      for (const endpoint of driver.endpoints(profile)) endpoints.set(`${endpoint.serviceUuid}/${endpoint.characteristicUuid}`, endpoint);
    }
    return [...endpoints.values()];
  }

  async connect(mode: "registered" | "inspection" = "registered", serviceHints: readonly BluetoothServiceUUID[] = []): Promise<DeviceFingerprint> {
    this.session.clearConnection();
    this.session.source = "live";
    const fingerprint = await this.transport.selectAndConnect({ mode, hints: this.registry.discoveryHints(), serviceHints });
    this.applyFingerprint(fingerprint, "live");
    return fingerprint;
  }

  async disconnect(): Promise<void> {
    await Promise.all([...this.#notificationSubscriptions.values()].map((unsubscribe) => unsubscribe().catch(() => undefined)));
    this.#notificationSubscriptions.clear();
    await this.transport.disconnect();
    this.session.clearConnection();
  }

  async read(endpoint: GattEndpoint): Promise<Uint8Array> { return this.transport.read(endpoint); }

  async enableNotifications(endpoint: GattEndpoint): Promise<void> {
    const key = `${endpoint.serviceUuid.toLowerCase()}/${endpoint.characteristicUuid.toLowerCase()}`;
    if (this.#notificationSubscriptions.has(key)) return;
    this.#notificationSubscriptions.set(key, await this.transport.subscribe(endpoint, (packet) => this.#recordIncoming(packet, true)));
  }

  async enableDriverNotifications(driver = this.session.selection?.selected ?? null): Promise<void> {
    const fingerprint = this.session.fingerprint;
    if (!fingerprint) throw new Error("No fingerprint is connected.");
    const drivers = driver ? [driver] : this.session.selection?.matches.filter(({ score }) => score > 0).map(({ driverId }) => this.registry.drivers.find(({ id }) => id === driverId)).filter((value): value is MatrixDriver => Boolean(value)) ?? [];
    const endpoints = new Map<string, GattEndpoint>();
    for (const candidate of drivers) {
      const profile = candidate.resolveProfile(fingerprint);
      if (!profile) continue;
      for (const endpoint of candidate.endpoints(profile)) endpoints.set(`${endpoint.serviceUuid}/${endpoint.characteristicUuid}`, endpoint);
    }
    for (const endpoint of endpoints.values()) await this.enableNotifications(endpoint);
  }

  applyFingerprint(fingerprint: DeviceFingerprint, source: MatrixSession["source"]): void {
    this.session.fingerprint = fingerprint;
    this.session.source = source;
    this.session.selection = this.registry.match(fingerprint);
    const driver = this.session.selection.selected;
    this.session.profile = driver?.resolveProfile(fingerprint) ?? null;
    for (const match of this.session.selection.matches) this.trace.record("driver.match", { driverId: match.driverId, score: match.score, confidence: match.confidence });
    if (driver) this.trace.record("driver.selected", { driverId: driver.id, profileId: this.session.profile?.id ?? null });
  }

  plan(operation: MatrixOperation): TransmissionPlan {
    const driver = this.session.selection?.selected;
    const fingerprint = this.session.fingerprint;
    const profile = this.session.profile;
    if (!driver || !fingerprint || !profile) throw new Error("A non-ambiguous driver and profile are required to create a plan.");
    const plan = driver.plan(operation, { profile, fingerprint, source: this.session.source });
    this.trace.record("tx.plan.created", { planId: plan.id, operation: operation.type, packetCount: plan.packets.length });
    return plan;
  }

  authorize(plan: TransmissionPlan): PolicyDecision {
    const decision = this.evaluate(plan);
    this.trace.record(decision.allowed ? "tx.plan.authorized" : "tx.plan.blocked", { planId: plan.id, reasons: decision.reasons.join(" | ") });
    return decision;
  }

  evaluate(plan: TransmissionPlan): PolicyDecision {
    const bestMatch = this.session.selection?.matches.find(({ driverId }) => driverId === plan.driverId) ?? null;
    return this.policy.authorize(plan, {
      source: this.session.source,
      fingerprint: this.session.fingerprint,
      selectedDriverId: this.session.selection?.selected?.id ?? null,
      selectedProfileId: this.session.profile?.id ?? null,
      driverMatch: bestMatch,
      ambiguous: this.session.selection?.ambiguous ?? false,
      experimentalSessionEnabled: this.session.experimentalTxEnabled,
    });
  }

  async send(plan: TransmissionPlan): Promise<ExecutionResult> {
    const decision = this.authorize(plan);
    if (!decision.allowed || !decision.authorized) throw new Error(decision.reasons.join(" "));
    const driver = this.registry.drivers.find(({ id }) => id === plan.driverId);
    if (!driver) throw new Error(`Driver ${plan.driverId} is unavailable.`);
    await this.enableDriverNotifications(driver);
    return this.#executor.execute(decision.authorized, driver);
  }

  async probe(driverId = "coolledux", probeId = "get-device-info"): Promise<ExecutionResult> {
    if (this.session.source !== "live") throw new Error("Imported and replay sessions cannot perform live probes.");
    const fingerprint = this.session.fingerprint;
    const driver = this.registry.drivers.find(({ id }) => id === driverId);
    if (!fingerprint || !driver) throw new Error("The requested probe driver is not available for this connection.");
    const profile = driver.resolveProfile(fingerprint);
    if (!profile) throw new Error("The requested driver has no compatible profile for this fingerprint.");
    const context = { profile, fingerprint, source: this.session.source } as const;
    const probe = driver.probes?.(context).find(({ id }) => id === probeId);
    if (!probe) throw new Error(`Probe ${probeId} is unavailable.`);
    const plan = probe.plan(context);
    this.trace.record("protocol.probe.started", { driverId, probeId, planId: plan.id });
    const decision = this.authorize(plan);
    if (!decision.allowed || !decision.authorized) throw new Error(decision.reasons.join(" "));
    await this.enableDriverNotifications(driver);
    const result = await this.#executor.execute(decision.authorized, driver);
    const interpretation = result.response ? probe.interpret(result.response) : null;
    if (interpretation?.matched) this.#resolveProtocol(driver, profile, probe.id, interpretation.summary, "live-probe");
    else this.trace.record("protocol.probe.rejected", { driverId, probeId, responseTimedOut: result.responseTimedOut });
    return result;
  }

  recordObservation(summary: string, confidence: ManualObservation["confidence"] = "observed"): ManualObservation {
    if (!summary.trim()) throw new Error("Observation cannot be empty.");
    const observation = { id: `observation:${Date.now()}:${this.#observations.length}`, recordedAt: new Date().toISOString(), summary: summary.trim(), confidence } as const;
    this.#observations.push(observation);
    this.trace.record("observation.recorded", { observationId: observation.id, summary: observation.summary });
    return observation;
  }

  exportBundle(): string {
    const fingerprint = this.session.fingerprint;
    if (!fingerprint) throw new Error("No fingerprint is available to export.");
    const driver = this.session.selection?.selected;
    const profile = this.session.profile;
    const bundle = createDiagnosticBundle({
      fingerprint,
      driverMatches: this.session.selection?.matches ?? [],
      selectedDriver: driver?.id ?? null,
      selectedProfile: profile?.id ?? null,
      capabilities: driver && profile ? driver.capabilities(profile) : [],
      trace: this.trace.events,
      observations: this.#observations,
      advertisementEvidence: fingerprint.rawAdvertisementHex ? { rawHex: fingerprint.rawAdvertisementHex } : null,
    });
    return serializeDiagnosticBundle(bundle);
  }

  importBundle(json: string): DiagnosticBundleV1 {
    const bundle = parseDiagnosticBundle(json);
    this.session.clearConnection();
    this.applyFingerprint(bundle.fingerprint, "imported");
    this.trace.importSerialized(bundle.trace);
    for (const packet of notificationPacketsFromBundle(bundle)) this.#recordIncoming(packet, false);
    return bundle;
  }

  #recordIncoming(packet: Uint8Array, recordTrace: boolean): NotificationRecord {
    const raw = packet.slice();
    if (recordTrace) this.trace.record("notification.raw", { byteLength: raw.length }, raw);
    const fingerprint = this.session.fingerprint;
    const candidates: DecodedNotification[] = [];
    if (fingerprint) for (const driver of this.registry.drivers) {
      if (!driver.decodeNotification || driver.match(fingerprint).score <= 0) continue;
      const decoded = driver.decodeNotification(raw, { profile: driver.resolveProfile(fingerprint), fingerprint, source: this.session.source });
      if (decoded) candidates.push(decoded);
    }
    const decoded = candidates.sort((a, b) => decodePriority(b) - decodePriority(a))[0] ?? null;
    const record = { timestamp: new Date().toISOString(), raw, rawHex: packetHex(raw), decoded };
    this.session.recordNotification(record);
    if (decoded) this.trace.record("notification.decoded", { family: decoded.family, kind: decoded.kind, opcode: decoded.opcode ?? null, summary: decoded.summary, payloadHex: decoded.payloadHex, success: decoded.success ?? null, status: decoded.status ?? null });
    this.#notificationRouter.publish(record);
    if (decoded?.family === "CoolLEDUX" && decoded.kind === "device-info") this.#resolveReplayEvidence(decoded);
    return record;
  }

  #resolveReplayEvidence(notification: DecodedNotification): void {
    if (this.session.source === "live" || this.session.protocolResolution) return;
    const fingerprint = this.session.fingerprint;
    const driver = this.registry.drivers.find(({ id }) => id === "coolledux");
    const profile = fingerprint && driver?.resolveProfile(fingerprint);
    if (!fingerprint || !driver || !profile) return;
    const probe = driver.probes?.({ profile, fingerprint, source: this.session.source }).find(({ id }) => id === "get-device-info");
    const interpreted = probe?.interpret(notification);
    if (probe && interpreted?.matched) this.#resolveProtocol(driver, profile, probe.id, interpreted.summary, "replay");
  }

  #resolveProtocol(driver: MatrixDriver, profile: import("../core/device").DeviceProfile, probeId: string, summary: string, source: "live-probe" | "replay"): void {
    const fingerprint = this.session.fingerprint;
    if (!fingerprint) return;
    this.session.selection = this.registry.resolve(driver.id, fingerprint, `protocol probe evidence: ${summary}`);
    this.session.profile = profile;
    this.session.protocolResolution = { driverId: driver.id, probeId, summary, source };
    this.trace.record("protocol.probe.resolved", { driverId: driver.id, probeId, source, profileId: profile.id });
  }
}

function decodePriority(notification: DecodedNotification): number {
  if (notification.kind === "device-info") return 100;
  if (notification.family === "CoolLEDX" && notification.opcode === 0x08 && notification.status === 0xfe) return 90;
  if (notification.kind === "command-echo") return 80;
  if (notification.kind.startsWith("malformed")) return 0;
  return 20;
}
