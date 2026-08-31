import type { DeviceFingerprint } from "../core/device";
import type { GattEndpoint } from "../core/device";
import type { ManualObservation } from "../core/evidence";
import type { MatrixOperation } from "../core/operations";
import type { TransmissionPlan } from "../core/transmission";
import { createDiagnosticBundle, parseDiagnosticBundle, serializeDiagnosticBundle, type DiagnosticBundleV1 } from "../diagnostics/bundle";
import { TraceRecorder } from "../diagnostics/trace";
import { DriverRegistry } from "../drivers/registry";
import { coolLedXDriver } from "../drivers/coolledx";
import type { MatrixTransport } from "../transport/types";
import { TransmissionExecutor, type ExecutionResult } from "./executor";
import { SafetyPolicy, type PolicyDecision } from "./safety";
import { MatrixSession } from "./session";

export class MatrixController {
  readonly session = new MatrixSession();
  readonly trace: TraceRecorder;
  readonly registry: DriverRegistry;
  readonly policy = new SafetyPolicy();
  readonly #executor: TransmissionExecutor;
  readonly #observations: ManualObservation[] = [];
  #unsubscribeNotifications: (() => Promise<void>) | null = null;

  constructor(readonly transport: MatrixTransport, trace = new TraceRecorder(), registry = new DriverRegistry([coolLedXDriver])) {
    this.trace = trace;
    this.registry = registry;
    this.#executor = new TransmissionExecutor(transport, trace);
  }

  get observations(): readonly ManualObservation[] { return this.#observations; }

  async connect(mode: "registered" | "inspection" = "registered", serviceHints: readonly BluetoothServiceUUID[] = []): Promise<DeviceFingerprint> {
    this.session.clearConnection();
    this.session.source = "live";
    const fingerprint = await this.transport.selectAndConnect({ mode, hints: this.registry.discoveryHints(), serviceHints });
    this.applyFingerprint(fingerprint, "live");
    return fingerprint;
  }

  async disconnect(): Promise<void> {
    if (this.#unsubscribeNotifications) await this.#unsubscribeNotifications().catch(() => undefined);
    this.#unsubscribeNotifications = null;
    await this.transport.disconnect();
    this.session.clearConnection();
  }

  async read(endpoint: GattEndpoint): Promise<Uint8Array> { return this.transport.read(endpoint); }

  async enableNotifications(endpoint: GattEndpoint): Promise<void> {
    if (this.#unsubscribeNotifications) return;
    this.#unsubscribeNotifications = await this.transport.subscribe(endpoint, (packet) => {
      const driver = this.session.selection?.selected;
      const profile = this.session.profile;
      const fingerprint = this.session.fingerprint;
      if (!driver?.decodeNotification || !profile || !fingerprint) return;
      const decoded = driver.decodeNotification(packet, { profile, fingerprint, source: this.session.source });
      if (decoded) this.trace.record("notification.decoded", { kind: decoded.kind, summary: decoded.summary, success: decoded.success ?? null, code: decoded.code ?? null });
    });
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
    return this.#executor.execute(decision.authorized);
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
    return bundle;
  }
}
