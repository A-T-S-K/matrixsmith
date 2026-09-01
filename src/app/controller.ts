import type { DeviceFingerprint } from "../core/device";
import type { GattEndpoint } from "../core/device";
import type { ManualObservation } from "../core/evidence";
import type { MatrixOperation } from "../core/operations";
import type { TransmissionPlan } from "../core/transmission";
import { createDiagnosticBundle, notificationPacketsFromBundle, parseDiagnosticBundle, serializeDiagnosticBundle, type DiagnosticBundle, type ImportedEvidenceSummary } from "../diagnostics/bundle";
import type { SessionValidationResult } from "../diagnostics/validation";
import type { ContentCompilationRecord } from "../diagnostics/content-evidence";
import { TraceRecorder } from "../diagnostics/trace";
import { builtInDrivers, DriverRegistry } from "../drivers/registry";
import type { DecodedNotification, MatrixDriver } from "../drivers/types";
import type { MatrixTransport } from "../transport/types";
import { TransmissionExecutor, type ExecutionResult } from "./executor";
import { SafetyPolicy, type PolicyDecision } from "./safety";
import { MatrixSession } from "./session";
import { NotificationRouter, type NotificationRecord } from "./notifications";
import { packetHex } from "../core/transmission";
import type { ProtocolTransaction, TransactionSource } from "../diagnostics/transactions";
import { transactionId } from "../diagnostics/transactions";
import type { DiagnosticRun, DiagnosticStepResult } from "../diagnostics/workflows";
import type { ObservationAttempt } from "../investigation/timing";
import { findImporter, type ImportedEvidence } from "../diagnostics/importers";
import { chooseTestBrightness, COOLLEDUX_DIAGNOSTIC_TOOLS, diagnosticRunId } from "../diagnostics/workflows";
import { CONTENT_VALIDATION_WORKFLOWS, evaluateValidationAnswers, sessionValidationId, type ContentValidationWorkflow, type ValidationAnswer } from "../diagnostics/validation";
import { contentCompilationId } from "../diagnostics/content-evidence";
import { diagnosticAnimation, orientationPattern } from "../render/patterns";
import { resolveClaims, resolveOperationalTrust, type ClaimEvidence, type ClaimState, type EvidenceScope, type OperationalTrust } from "../investigation/claims";
import { claimEvidenceFromValidation } from "../investigation/legacy-bridge";
import {
  createInvestigation, demoteInvestigationEvidence, recordCompletedTest, resumeInvestigation, stopInvestigation,
  type CompletedGuidedTest, type Investigation, type InvestigationGoal,
} from "../investigation/investigation";
import { bindingAllowsSessionContinuity, deviceIdentityBinding } from "../investigation/device-identity";
import { evaluateTestAvailability, resolveGuidedOperation, type GuidedTestAvailability, type GuidedTestDefinition } from "../investigation/tests";
import { validateObservations, type ObservationValue } from "../investigation/observations";
import { rankRecommendations, type Recommendation } from "../investigation/recommendations";
import { generateForensicAppendix, generateInvestigationReport, generateTestReport } from "../investigation/reports";
import { allContentGates, contentPathGate, type ContentGate, type ContentPathId } from "../investigation/gating";
import { evaluateStaticViability, type StaticViabilityAssessment } from "../investigation/static-viability";
import { resolveSessionBehavior } from "../investigation/session-behavior";

export class MatrixController {
  readonly session = new MatrixSession();
  readonly trace: TraceRecorder;
  readonly registry: DriverRegistry;
  readonly policy = new SafetyPolicy();
  readonly #executor: TransmissionExecutor;
  readonly #notificationRouter = new NotificationRouter();
  readonly #observations: ManualObservation[] = [];
  readonly #transactions: ProtocolTransaction[] = [];
  readonly #diagnosticRuns: DiagnosticRun[] = [];
  readonly #validations: SessionValidationResult[] = [];
  readonly #contentCompilations: ContentCompilationRecord[] = [];
  readonly #importedEvidence: ImportedEvidenceSummary[] = [];
  readonly #notificationSubscriptions = new Map<string, () => Promise<void>>();

  constructor(readonly transport: MatrixTransport, trace = new TraceRecorder(), registry = new DriverRegistry(builtInDrivers)) {
    this.trace = trace;
    this.registry = registry;
    this.#executor = new TransmissionExecutor(transport, trace, this.#notificationRouter);
  }

  get observations(): readonly ManualObservation[] { return this.#observations; }
  get transactions(): readonly ProtocolTransaction[] { return this.#transactions; }
  get diagnosticRuns(): readonly DiagnosticRun[] { return this.#diagnosticRuns; }
  get validations(): readonly SessionValidationResult[] { return this.#validations; }
  get contentCompilations(): readonly ContentCompilationRecord[] { return this.#contentCompilations; }
  get importedEvidence(): readonly ImportedEvidenceSummary[] { return this.#importedEvidence; }

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
    this.#enrichAdvertisementEvidence();
    return fingerprint;
  }

  /** Reconnect a previously browser-authorized device without a chooser; the caller falls back to connect() on failure. */
  async reconnectAuthorized(deviceId: string): Promise<DeviceFingerprint> {
    if (!this.transport.reconnectAuthorized) throw new Error("This transport cannot reconnect without the device chooser.");
    this.session.clearConnection();
    this.session.source = "live";
    const fingerprint = await this.transport.reconnectAuthorized(deviceId, { mode: "registered", hints: this.registry.discoveryHints() });
    this.applyFingerprint(fingerprint, "live");
    this.#enrichAdvertisementEvidence();
    return fingerprint;
  }

  /**
   * Fire-and-forget structured advertisement enrichment. Failure or lack of
   * browser support must never affect the connection; a successful
   * observation updates the session fingerprint in place.
   */
  #enrichAdvertisementEvidence(): void {
    const observe = this.transport.observeAdvertisements?.bind(this.transport);
    if (!observe) return;
    void observe().then((observation) => {
      if (!observation) return;
      const updated = this.transport.fingerprint;
      if (updated && this.session.source === "live") this.session.fingerprint = updated;
    }).catch(() => undefined);
  }

  async disconnect(): Promise<void> {
    await Promise.all([...this.#notificationSubscriptions.values()].map((unsubscribe) => unsubscribe().catch(() => undefined)));
    this.#notificationSubscriptions.clear();
    await this.transport.disconnect();
    this.session.clearConnection();
  }

  async read(endpoint: GattEndpoint): Promise<Uint8Array> {
    const startedAt = new Date().toISOString();
    try {
      const bytes = await this.transport.read(endpoint);
      const completedAt = new Date().toISOString();
      this.#transactions.push({ id: transactionId("read"), startedAt, completedAt, durationMs: duration(startedAt, completedAt), sessionSource: this.session.source, source: "gatt-read", driverId: this.session.selection?.selected?.id ?? null, profileId: this.session.profile?.id ?? null, operation: "GATT Read", safety: { risk: "read-only", persistence: "none", validation: "verified" }, endpoint, packets: [{ timestamp: completedAt, direction: "RX", hex: packetHex(bytes), endpoint }], decodedResponse: null, hostAccepted: true, protocolAcknowledged: null, deviceStateVerified: false, responseTimedOut: false, error: null, findings: ["Characteristic read completed; raw bytes preserved."], observationIds: [], diagnosticRunId: null });
      return bytes;
    } catch (error) {
      const completedAt = new Date().toISOString();
      this.#transactions.push({ id: transactionId("read"), startedAt, completedAt, durationMs: duration(startedAt, completedAt), sessionSource: this.session.source, source: "gatt-read", driverId: this.session.selection?.selected?.id ?? null, profileId: this.session.profile?.id ?? null, operation: "GATT Read", safety: { risk: "read-only", persistence: "none", validation: "verified" }, endpoint, packets: [], decodedResponse: null, hostAccepted: false, protocolAcknowledged: null, deviceStateVerified: false, responseTimedOut: false, error: errorMessage(error), findings: [], observationIds: [], diagnosticRunId: null });
      throw error;
    }
  }

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
    this.#reconcileDeviceBoundary();
    for (const match of this.session.selection.matches) this.trace.record("driver.match", { driverId: match.driverId, score: match.score, confidence: match.confidence });
    if (driver) this.trace.record("driver.selected", { driverId: driver.id, profileId: this.session.profile?.id ?? null });
  }

  /**
   * Enforce the physical device/session evidence boundary whenever a new
   * fingerprint is applied. Only a matching browser-authorized device id
   * proves the SAME physical unit; anything else — a different device, an
   * identical-looking unit without a stable id, or an imported fingerprint —
   * detaches the active investigation: its current-session evidence is
   * structurally demoted to a historical scope and it stops accumulating.
   * Legacy validation evidence obeys the exact same boundary.
   */
  #reconcileDeviceBoundary(): void {
    this.#connectionEpoch += 1;
    const current = deviceIdentityBinding(this.session.fingerprint, this.session.profile?.id ?? null);
    const investigation = this.#investigation;
    if (investigation) {
      if (this.session.source === "live" && bindingAllowsSessionContinuity(investigation.deviceBinding, current)) {
        // Same browser-authorized physical device reconnected: the
        // investigation resumes with its current-session evidence intact.
        this.#investigationEpoch = this.#connectionEpoch;
        this.trace.record("investigation.device-resumed", { id: investigation.id });
      } else {
        this.#investigation = null;
        this.#detachedInvestigation = stopInvestigation(demoteInvestigationEvidence(investigation, "previous-local-session"));
        this.trace.record("investigation.device-detached", { id: investigation.id });
      }
    }
    const sameLiveDevice = this.session.source === "live" && bindingAllowsSessionContinuity(this.#liveBinding, current);
    if (!sameLiveDevice) {
      for (const [id, scope] of this.#validationScopes) {
        if (scope === "current-session") this.#validationScopes.set(id, "previous-local-session");
      }
    }
    this.#liveBinding = this.session.source === "live" ? current : null;
  }

  /**
   * An investigation detached by a device change, already demoted and
   * stopped. The store persists it to local history; taking it clears it.
   */
  takeDetachedInvestigation(): Investigation | null {
    const detached = this.#detachedInvestigation;
    this.#detachedInvestigation = null;
    return detached;
  }

  plan(operation: MatrixOperation): TransmissionPlan {
    const driver = this.session.selection?.selected;
    const fingerprint = this.session.fingerprint;
    const profile = this.session.profile;
    if (!driver || !fingerprint || !profile) throw new Error("A non-ambiguous driver and profile are required to create a plan.");
    const plan = driver.plan(operation, {
      profile, fingerprint, source: this.session.source,
      ...(this.session.validatedRasterStrategy ? { rasterStrategy: this.session.validatedRasterStrategy } : {}),
      resolvedBehavior: resolveSessionBehavior(this.allClaimEvidence()),
    });
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
      confirmedPersistentPlanId: this.session.confirmedPersistentPlanId,
    });
  }

  async send(plan: TransmissionPlan): Promise<ExecutionResult> {
    return this.#execute(plan, plan.purpose, null);
  }

  async #execute(plan: TransmissionPlan, source: TransactionSource, diagnosticRunIdValue: string | null): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString();
    const notificationStart = this.session.notifications.length;
    const decision = this.authorize(plan);
    if (!decision.allowed || !decision.authorized) throw new Error(decision.reasons.join(" "));
    const driver = this.registry.drivers.find(({ id }) => id === plan.driverId);
    if (!driver) throw new Error(`Driver ${plan.driverId} is unavailable.`);
    await this.enableDriverNotifications(driver);
    try {
      const result = await this.#executor.execute(decision.authorized, driver);
      this.#recordTransaction(plan, result, startedAt, notificationStart, source, diagnosticRunIdValue, null);
      return result;
    } catch (error) {
      this.#recordTransaction(plan, null, startedAt, notificationStart, source, diagnosticRunIdValue, errorMessage(error));
      throw error;
    }
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
    const startedAt = new Date().toISOString();
    const notificationStart = this.session.notifications.length;
    let result: ExecutionResult;
    try {
      result = await this.#executor.execute(decision.authorized, driver);
      this.#recordTransaction(decision.authorized.plan, result, startedAt, notificationStart, "probe", null, null);
    } catch (error) {
      this.#recordTransaction(decision.authorized.plan, null, startedAt, notificationStart, "probe", null, errorMessage(error));
      throw error;
    }
    const interpretation = result.response ? probe.interpret(result.response) : null;
    if (interpretation?.matched) this.#resolveProtocol(driver, profile, probe.id, interpretation.summary, "live-probe");
    else this.trace.record("protocol.probe.rejected", { driverId, probeId, responseTimedOut: result.responseTimedOut });
    return result;
  }

  diagnosticTools(): readonly import("../diagnostics/workflows").DiagnosticTool[] {
    const fingerprint = this.session.fingerprint;
    if (!fingerprint) return [];
    const canUseCoolLedUx = this.registry.drivers.some((driver) => driver.id === "coolledux" && driver.match(fingerprint).score > 0);
    return canUseCoolLedUx ? COOLLEDUX_DIAGNOSTIC_TOOLS.map((tool) => ({ ...tool, available: this.session.source === "live", ...(this.session.source !== "live" ? { unavailableReason: "Imported reports are read-only." } : {}) })) : [];
  }

  async runDiagnostic(toolId: string): Promise<DiagnosticRun> {
    const tool = this.diagnosticTools().find((candidate) => candidate.id === toolId);
    if (!tool?.available) throw new Error(tool?.unavailableReason ?? "This driver family has no verified safe diagnostic tool for the current device.");
    const id = diagnosticRunId();
    const startedAt = new Date().toISOString();
    const steps: DiagnosticStepResult[] = [];
    const transactionIndex = this.#transactions.length;
    let restorationAttempted = false;
    let restorationVerified = false;
    let status: DiagnosticRun["status"] = "running";
    let error: string | null = null;
    const step = (stepId: string, label: string, passed: boolean, summary: string, from: number): void => { steps.push({ id: stepId, label, status: passed ? "passed" : "failed", summary, transactionIds: this.#transactions.slice(from).map((value) => value.id) }); };
    let baseline: number | null = null;
    let testWasAttempted = false;
    try {
      if (toolId === "coolledux-identify") {
        const result = await this.probe("coolledux", "get-device-info");
        step("identify", "Get Device Info", Boolean(result.response), result.response?.summary ?? "No matching structured response.", transactionIndex);
        if (!result.response) throw new Error("Safe identification did not receive a matching structured response.");
      } else if (toolId === "coolledux-refresh-info") {
        const from = this.#transactions.length; const result = await this.#execute(this.plan({ type: "GetDeviceInfo" }), "diagnostic", id);
        step("refresh", "Refresh Device Info", Boolean(result.response), result.response?.summary ?? "No matching response.", from);
        if (!result.response) throw new Error("Device-info refresh timed out.");
      } else if (toolId === "coolledux-brightness-round-trip") {
        let from = this.#transactions.length; const baselineResult = await this.#execute(this.plan({ type: "GetDeviceInfo" }), "diagnostic", id);
        baseline = numberField(baselineResult.response, "brightnessRaw");
        step("baseline", "Record baseline brightness", baseline !== null, baseline === null ? "Brightness was absent from device info." : `Baseline is ${baseline}.`, from);
        if (baseline === null) throw new Error("Cannot validate brightness without a baseline readback.");
        const test = chooseTestBrightness(baseline);
        from = this.#transactions.length; testWasAttempted = true; const setResult = await this.#execute(this.plan({ type: "SetBrightness", raw: test }), "diagnostic", id);
        step("set-test", "Set test brightness", setResult.protocolAcknowledged === true, `Command response ${setResult.protocolAcknowledged ? "matched" : "did not match"}; test value ${test}.`, from);
        if (!setResult.protocolAcknowledged) throw new Error("Test brightness command did not receive the required matching response.");
        from = this.#transactions.length; const verify = await this.#execute(this.plan({ type: "GetDeviceInfo" }), "diagnostic", id); const actual = numberField(verify.response, "brightnessRaw");
        step("verify-test", "Verify test brightness", actual === test, `Expected ${test}; read back ${actual ?? "unknown"}.`, from);
        if (actual !== test) throw new Error(`Test brightness readback mismatch: expected ${test}, received ${actual ?? "unknown"}.`);
      } else throw new Error(`Unknown diagnostic tool ${toolId}.`);
      status = "passed";
    } catch (caught) {
      error = errorMessage(caught); status = "failed";
    }
    if (toolId === "coolledux-brightness-round-trip" && baseline !== null && testWasAttempted) {
      restorationAttempted = true;
      try {
        let from = this.#transactions.length; const restore = await this.#execute(this.plan({ type: "SetBrightness", raw: baseline }), "diagnostic", id);
        step("restore", "Restore baseline brightness", restore.protocolAcknowledged === true, `Restore response ${restore.protocolAcknowledged ? "matched" : "did not match"}.`, from);
        if (!restore.protocolAcknowledged) throw new Error("Restore command did not receive the required matching response.");
        from = this.#transactions.length; const verifyRestore = await this.#execute(this.plan({ type: "GetDeviceInfo" }), "diagnostic", id); const restored = numberField(verifyRestore.response, "brightnessRaw");
        restorationVerified = restored === baseline;
        step("verify-restore", "Verify restoration", restorationVerified, `Expected baseline ${baseline}; read back ${restored ?? "unknown"}.`, from);
        if (!restorationVerified) throw new Error(`RESTORE FAILED: expected ${baseline}, read back ${restored ?? "unknown"}.`);
      } catch (restoreError) {
        status = "restore-failed"; error = `${error ? `${error} ` : ""}${errorMessage(restoreError)}`;
      }
    }
    const completedAt = new Date().toISOString();
    const run: DiagnosticRun = { id, toolId, driverId: tool.driverId, startedAt, completedAt, purpose: tool.purpose, safety: { risk: tool.risk, persistence: tool.persistence, validation: tool.validation, explanation: tool.explanation }, status, steps, findings: status === "passed" ? [toolId === "coolledux-brightness-round-trip" ? "Brightness response and readback were validated; baseline restoration was verified." : "The expected structured read-only response was received."] : [error ?? "Diagnostic failed."], error, restorationAttempted, restorationVerified, observationIds: [] };
    this.#diagnosticRuns.push(run);
    return run;
  }

  // ---- Guided investigation engine ---------------------------------------

  #investigation: Investigation | null = null;
  #detachedInvestigation: Investigation | null = null;
  /** Increments on every applied fingerprint; ties an investigation to one unbroken (or same-authorized-device) session. */
  #connectionEpoch = 0;
  #investigationEpoch = -1;
  #liveBinding: ReturnType<typeof deviceIdentityBinding> = null;
  /**
   * Trust scope of each legacy validation's bridged claim evidence. The
   * decision is controller-side state, never read from serialized data:
   * live-recorded validations are current-session until the physical device
   * session ends; bundle-imported validations are always imported-external.
   */
  readonly #validationScopes = new Map<string, EvidenceScope>();

  get investigation(): Investigation | null { return this.#investigation; }

  /** Baseline claim evidence: driver-shipped profile/source facts plus bridged legacy validations. */
  baselineClaimEvidence(): readonly ClaimEvidence[] {
    const driver = this.session.selection?.selected;
    const profile = this.session.profile;
    const shipped = driver?.claimEvidence && profile ? driver.claimEvidence(profile) : [];
    const bridged = this.#validations.flatMap((validation) =>
      claimEvidenceFromValidation(validation, this.#validationScopes.get(validation.id) ?? "previous-local-session"));
    return [...shipped, ...bridged];
  }

  /** Every piece of claim evidence visible to this session. */
  allClaimEvidence(): readonly ClaimEvidence[] {
    return [...this.baselineClaimEvidence(), ...(this.#investigation?.claimEvidence ?? [])];
  }

  /** Every claim's effective/investigative state for the current session. */
  claims(): readonly ClaimState[] {
    return resolveClaims(this.allClaimEvidence());
  }

  /** Operational trust per claim — the authorization basis for normal operations. */
  operationalTrust(): readonly OperationalTrust[] {
    return resolveOperationalTrust(this.allClaimEvidence());
  }

  /** Derived static-image strategy viability over the current evidence. */
  staticViability(): StaticViabilityAssessment {
    return evaluateStaticViability(this.allClaimEvidence());
  }

  startInvestigation(goal: InvestigationGoal): Investigation {
    // An active investigation is retargeted, never discarded: troubleshooting
    // keeps every completed test and claim as evidence toward the new goal.
    // Retargeting requires the investigation to still belong to THIS physical
    // device session; #reconcileDeviceBoundary maintains that invariant on
    // every connect, and the epoch check enforces it defensively here.
    if (this.#investigation && this.#investigation.status === "active" && this.#investigationEpoch === this.#connectionEpoch) {
      this.#investigation = { ...this.#investigation, goal, updatedAt: new Date().toISOString() };
    } else {
      if (this.#investigation) this.#detachedInvestigation = stopInvestigation(demoteInvestigationEvidence(this.#investigation, "previous-local-session"));
      this.#investigation = createInvestigation({
        profileId: this.session.profile?.id ?? null,
        deviceName: this.session.fingerprint?.name ?? null,
        deviceBinding: deviceIdentityBinding(this.session.fingerprint, this.session.profile?.id ?? null),
        goal,
      });
      this.#investigationEpoch = this.#connectionEpoch;
    }
    this.trace.record("investigation.started", { goal: goal.kind, symptom: goal.symptomId ?? null });
    return this.#investigation;
  }

  /** Returns the active investigation, creating a default develop-goal one if needed. */
  ensureInvestigation(): Investigation {
    if (!this.#investigation || this.#investigation.status === "stopped") {
      if (this.#investigation?.status === "stopped" && this.#investigationEpoch === this.#connectionEpoch) this.#investigation = resumeInvestigation(this.#investigation);
      else this.startInvestigation({ kind: "develop", description: "Characterize and develop support for this display." });
    }
    return this.#investigation!;
  }

  stopActiveInvestigation(): Investigation | null {
    if (this.#investigation && this.#investigation.status === "active") this.#investigation = stopInvestigation(this.#investigation);
    return this.#investigation;
  }

  /**
   * Adopt a previously persisted investigation. ALL of its claim evidence is
   * structurally demoted to "previous-local-session" here — the serialized
   * scope field is never trusted, so a poisoned local record cannot smuggle
   * in built-in-profile or current-session authority. The investigation is
   * rebound to the currently connected device: its future evidence belongs
   * to this session, its past evidence stays labeled historical.
   */
  adoptInvestigation(investigation: Investigation): void {
    const rebound: Investigation = {
      ...demoteInvestigationEvidence(investigation, "previous-local-session"),
      deviceBinding: deviceIdentityBinding(this.session.fingerprint, this.session.profile?.id ?? null) ?? investigation.deviceBinding,
    };
    this.#investigation = resumeInvestigation(rebound);
    this.#investigationEpoch = this.#connectionEpoch;
    this.trace.record("investigation.resumed", { id: investigation.id, completedTests: investigation.completedTests.length });
  }

  guidedTestDefinitions(): readonly GuidedTestDefinition[] {
    const driver = this.session.selection?.selected;
    const profile = this.session.profile;
    if (!driver?.guidedTests || !profile) return [];
    return driver.guidedTests(profile);
  }

  guidedTests(): readonly GuidedTestAvailability[] {
    const evidence = [...this.baselineClaimEvidence(), ...(this.#investigation?.claimEvidence ?? [])];
    const completed = this.#investigation?.completedTests.map((test) => test.testId) ?? [];
    return this.guidedTestDefinitions().map((test) => evaluateTestAvailability(test, evidence, completed));
  }

  /** Ranked deterministic next-test recommendations for the current evidence and goal. */
  recommendations(): readonly Recommendation[] {
    return rankRecommendations({
      goal: this.#investigation?.goal ?? null,
      evidence: [...this.baselineClaimEvidence(), ...(this.#investigation?.claimEvidence ?? [])],
      availabilities: this.guidedTests(),
      completedTests: this.#investigation?.completedTests ?? [],
    });
  }

  /** Path-specific content gates derived from operationally trusted claims. */
  contentGates(): readonly ContentGate[] {
    return allContentGates(this.allClaimEvidence());
  }

  contentGate(path: ContentPathId): ContentGate {
    return contentPathGate(path, this.allClaimEvidence());
  }

  guidedTest(testId: string): GuidedTestDefinition {
    const test = this.guidedTestDefinitions().find(({ id }) => id === testId);
    if (!test) throw new Error(`Unknown guided test ${testId}.`);
    return test;
  }

  /** The exact operation a guided test will transmit, resolved against current evidence. */
  guidedTestOperation(testId: string): MatrixOperation {
    const profile = this.session.profile;
    if (!profile) throw new Error("A resolved device profile is required for guided tests.");
    return resolveGuidedOperation(this.guidedTest(testId), { profile, evidence: this.allClaimEvidence() });
  }

  planGuidedTest(testId: string): TransmissionPlan {
    return this.plan(this.guidedTestOperation(testId));
  }

  /**
   * Transmit a guided test's fixed diagnostic program. Requires explicit
   * consequence confirmation like every persistent send; returns the
   * transaction ids and the real timestamp of the final host-accepted write
   * so observation stopwatches measure from the correct moment.
   */
  async runGuidedTestTransfer(testId: string, options: { readonly confirmedConsequence: boolean }): Promise<{ readonly transactionIds: readonly string[]; readonly finalWriteAcceptedAt: string | null }> {
    const test = this.guidedTest(testId);
    if (!options.confirmedConsequence) throw new Error(`Explicit confirmation required. ${test.consequence}`);
    if (this.session.source !== "live") throw new Error("Guided hardware tests require a live connection.");
    const availability = this.guidedTests().find((entry) => entry.test.id === testId);
    if (availability && !availability.available) throw new Error(availability.reason ?? "This test's prerequisites are not met.");
    this.ensureInvestigation();
    const plan = this.planGuidedTest(testId);
    const transactionIndex = this.#transactions.length;
    const result = await this.sendPersistentContent(plan, { confirmedConsequence: true });
    const transactionIds = this.#transactions.slice(transactionIndex).map(({ id }) => id);
    this.trace.record("guided-test.transferred", { testId, transactionCount: transactionIds.length, finalWriteAcceptedAt: result.finalWriteAcceptedAt });
    return { transactionIds, finalWriteAcceptedAt: result.finalWriteAcceptedAt };
  }

  /**
   * Record the structured physical observations for a guided test: the
   * driver's interpreter turns them into atomic claim evidence scoped to the
   * current session, and the investigation advances. A validated raster
   * strategy from the outcome is applied to this session only.
   */
  recordGuidedTestObservations(
    testId: string,
    values: readonly ObservationValue[],
    transactionIds: readonly string[] = [],
    startedAt = new Date().toISOString(),
    /**
     * Human-timed attempts behind this result. Only valid attempts supplied
     * the values above; invalid ones ride along so a report can show what was
     * measured and what was discarded, without ever establishing a claim.
     */
    attempts: readonly ObservationAttempt[] = [],
  ): CompletedGuidedTest {
    const test = this.guidedTest(testId);
    // Domain-layer validation: UI checks are never relied on. Invalid or
    // incomplete submissions are rejected before any evidence is produced,
    // and only a live physical session can produce current-session evidence.
    if (this.session.source !== "live" || !this.session.fingerprint) throw new Error("Guided test observations require a live physical device session.");
    const validationErrors = [...validateObservations(test.observation, values), ...(test.validate?.(values) ?? [])];
    if (validationErrors.length > 0) throw new Error(`Invalid guided-test observations: ${validationErrors.join(" ")}`);
    const interpretation = test.interpret(values);
    const completedAt = new Date().toISOString();
    const evidence: ClaimEvidence[] = interpretation.claimUpdates.map((update) => ({
      claimId: update.claimId, status: update.status, scope: "current-session",
      provenance: update.provenance ?? "observed", summary: update.summary,
      recordedAt: completedAt, testId, transactionIds,
      ...(update.metrics ? { metrics: update.metrics } : {}),
      ...(update.details ? { details: update.details } : {}),
    }));
    const resolvedOperation = this.guidedTestOperation(testId);
    const parameters = resolvedOperation.type === "ShowDiagnostic" && resolvedOperation.parameters ? { ...resolvedOperation.parameters } : undefined;
    const completed: CompletedGuidedTest = {
      testId, title: test.title, startedAt, completedAt,
      status: interpretation.status, observations: [...values],
      established: interpretation.established, rejected: interpretation.rejected, unknowns: interpretation.unknowns,
      summary: interpretation.summary, transactionIds: [...transactionIds],
      ...(parameters ? { parameters } : {}),
      ...(attempts.length > 0 ? { attempts: [...attempts] } : {}),
    };
    this.#investigation = recordCompletedTest(this.ensureInvestigation(), completed, evidence, completedAt);
    this.#deriveSessionRasterStrategy(testId);
    this.trace.record("guided-test.recorded", { testId, status: interpretation.status, claimUpdates: evidence.length });
    return completed;
  }

  /**
   * The session's static-raster strategy is DERIVED from the viability
   * evaluator over the full trusted evidence, never asserted by a single
   * passing test.
   */
  #deriveSessionRasterStrategy(testId: string | null): void {
    const selected = evaluateStaticViability(this.allClaimEvidence()).selected;
    if (selected !== this.session.validatedRasterStrategy) {
      this.session.validatedRasterStrategy = selected;
      if (selected) this.trace.record("raster-strategy.validated", { strategy: selected, testId });
    }
  }

  /**
   * A guided test whose diagnostic program WAS transmitted but whose
   * physical observation is being abandoned. The device was changed, so this
   * is never a silent cancel: an "abandoned" result is recorded with the
   * exact operation, transaction ids, and any partial observations — but no
   * claim conclusions beyond automatic capture. A partial test report stays
   * available; failed or abandoned tests are still evidence.
   */
  abandonGuidedTest(testId: string, values: readonly ObservationValue[], transactionIds: readonly string[], startedAt = new Date().toISOString(), attempts: readonly ObservationAttempt[] = []): CompletedGuidedTest {
    const test = this.guidedTest(testId);
    if (transactionIds.length === 0) throw new Error("Nothing was transmitted; close the test instead of abandoning it.");
    const completedAt = new Date().toISOString();
    const resolvedOperation = this.guidedTestOperation(testId);
    const parameters = resolvedOperation.type === "ShowDiagnostic" && resolvedOperation.parameters ? { ...resolvedOperation.parameters } : undefined;
    const completed: CompletedGuidedTest = {
      testId, title: test.title, startedAt, completedAt,
      status: "abandoned",
      // Keep only structurally valid partial observations; nothing is required.
      observations: values.filter((value) => value && typeof value === "object"),
      established: [], rejected: [],
      unknowns: ["Physical observation was abandoned before completion; no conclusions were drawn beyond the automatic capture."],
      summary: "The diagnostic program was transmitted and the stored display content was replaced, but the physical observation was abandoned.",
      transactionIds: [...transactionIds],
      ...(parameters ? { parameters } : {}),
      ...(attempts.length > 0 ? { attempts: [...attempts] } : {}),
    };
    this.#investigation = recordCompletedTest(this.ensureInvestigation(), completed, [], completedAt);
    this.trace.record("guided-test.abandoned", { testId, transactionCount: transactionIds.length });
    return completed;
  }

  // ---- Investigation reports ---------------------------------------------

  #deviceReportContext(): import("../investigation/reports").DeviceReportContext {
    return {
      fingerprint: this.session.fingerprint,
      profile: this.session.profile,
      matrixsmithVersion: "0.1.0",
      liveConnected: this.session.source === "live" && this.transport.state === "connected",
    };
  }

  #notificationDecoder(): ((bytes: Uint8Array) => DecodedNotification | null) | null {
    const driver = this.session.selection?.selected;
    const fingerprint = this.session.fingerprint;
    if (!driver?.decodeNotification || !fingerprint) return null;
    return (bytes) => driver.decodeNotification!(bytes, { profile: this.session.profile, fingerprint, source: this.session.source });
  }

  /** Scoped report for one completed guided test (the latest run of it). */
  testReportMarkdown(testId: string): string {
    const investigation = this.#investigation;
    const completed = [...(investigation?.completedTests ?? [])].reverse().find((test) => test.testId === testId);
    if (!completed) throw new Error(`No completed run of guided test ${testId} to report.`);
    const test = this.guidedTest(testId);
    const priorEvidence = [...this.baselineClaimEvidence(), ...(investigation?.claimEvidence ?? [])].filter((entry) => entry.testId !== testId);
    const compilation = this.#contentCompilations.find((record) => record.transactionId !== undefined && completed.transactionIds.includes(record.transactionId)) ?? null;
    return generateTestReport({
      device: this.#deviceReportContext(), test, completed, priorEvidence,
      why: test.about.whyRelevant, transactions: this.#transactions, compilation,
      decoder: this.#notificationDecoder(), nextRecommendation: this.recommendations()[0] ?? null,
    });
  }

  /** Full investigation report, sufficient for an AI to implement or repair support. */
  investigationReportMarkdown(): string {
    return generateInvestigationReport({
      device: this.#deviceReportContext(),
      investigation: this.#investigation,
      baselineEvidence: this.baselineClaimEvidence(),
      tests: this.guidedTestDefinitions(),
      transactions: this.#transactions,
      compilations: this.#contentCompilations,
      nextRecommendation: this.recommendations()[0] ?? null,
      driverCandidates: this.session.selection?.matches ?? [],
    });
  }

  /** Investigation report plus the full packet/timing forensic appendix. */
  forensicReportMarkdown(): string {
    return generateForensicAppendix({
      base: this.investigationReportMarkdown(),
      transactions: this.#transactions,
      decoder: this.#notificationDecoder(),
      compilations: this.#contentCompilations,
    });
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
      transactions: this.#transactions,
      diagnosticRuns: this.#diagnosticRuns,
      validations: this.#validations,
      contentCompilations: this.#contentCompilations,
      importedEvidence: this.#importedEvidence,
      investigation: this.#investigation,
    });
    return serializeDiagnosticBundle(bundle);
  }

  importBundle(json: string): DiagnosticBundle {
    const bundle = parseDiagnosticBundle(json);
    this.session.clearConnection();
    this.applyFingerprint(bundle.fingerprint, "imported");
    this.trace.importSerialized(bundle.trace);
    for (const packet of notificationPacketsFromBundle(bundle)) this.#recordIncoming(packet, false);
    this.#transactions.splice(0, this.#transactions.length, ...(bundle.transactions ?? []));
    this.#diagnosticRuns.splice(0, this.#diagnosticRuns.length, ...(bundle.diagnosticRuns ?? []));
    this.#validations.splice(0, this.#validations.length, ...(bundle.validations ?? []));
    this.#contentCompilations.splice(0, this.#contentCompilations.length, ...(bundle.contentCompilations ?? []));
    this.#importedEvidence.splice(0, this.#importedEvidence.length, ...(bundle.importedEvidence ?? []));
    // Bundle-imported validations can never bridge as trusted live evidence.
    this.#validationScopes.clear();
    for (const validation of this.#validations) this.#validationScopes.set(validation.id, "imported-external");
    // An imported investigation is external historical evidence in its
    // entirety; the serialized scope fields are never trusted.
    this.#investigation = bundle.investigation
      ? demoteInvestigationEvidence(bundle.investigation, "imported-external")
      : null;
    this.#investigationEpoch = this.#connectionEpoch;
    return bundle;
  }

  /**
   * Transmit a persistent stored-program content plan. Requires the caller
   * to have shown the exact consequence and received explicit confirmation;
   * the confirmation is single-use and scoped to this exact plan. Records a
   * structured content-compilation evidence entry alongside the transaction.
   */
  async sendPersistentContent(plan: TransmissionPlan, options: { readonly confirmedConsequence: boolean; readonly extras?: Partial<ContentCompilationRecord> }): Promise<ExecutionResult> {
    if (plan.risk !== "persistent" && plan.persistence !== "persistent") throw new Error("sendPersistentContent is only for persistent content plans.");
    if (!options.confirmedConsequence) throw new Error("Persistent content requires explicit confirmation of its exact consequence.");
    const experimentalWasEnabled = this.session.experimentalTxEnabled;
    this.session.enableExperimentalTx();
    this.session.confirmPersistentPlan(plan.id);
    const transactionIndex = this.#transactions.length;
    try {
      const result = await this.#execute(plan, "operation", null);
      this.#recordCompilation(plan, options.extras, this.#transactions[transactionIndex]?.id ?? null);
      return result;
    } finally {
      this.session.consumePersistentConfirmation();
      if (!experimentalWasEnabled) this.session.disableExperimentalTx();
    }
  }

  contentValidationWorkflows(): readonly ContentValidationWorkflow[] {
    const driverId = this.session.selection?.selected?.id;
    if (!driverId || this.session.source !== "live") return [];
    return CONTENT_VALIDATION_WORKFLOWS.filter((workflow) => workflow.driverId === driverId);
  }

  /** Build (without transmitting) the diagnostic content plan for a validation workflow. */
  planValidationContent(workflowId: string): TransmissionPlan {
    const workflow = CONTENT_VALIDATION_WORKFLOWS.find(({ id }) => id === workflowId);
    const profile = this.session.profile;
    if (!workflow || !profile) throw new Error("The validation workflow or device profile is unavailable.");
    const operation: MatrixOperation = workflowId === "coolledux-validate-animation"
      ? { type: "ShowAnimation", sequence: diagnosticAnimation(profile.width, profile.height) }
      : { type: "ShowFrame", frame: orientationPattern(profile.width, profile.height) };
    return this.plan(operation);
  }

  /**
   * Transmit the diagnostic content for a guided hardware-validation
   * workflow. The transfer result is recorded; the structured answers are
   * submitted separately once the user has looked at the physical panel.
   */
  async runContentValidation(workflowId: string, options: { readonly confirmedConsequence: boolean }): Promise<{ readonly plan: TransmissionPlan; readonly result: ExecutionResult; readonly transactionIds: readonly string[] }> {
    const workflow = CONTENT_VALIDATION_WORKFLOWS.find(({ id }) => id === workflowId);
    if (!workflow) throw new Error(`Unknown validation workflow ${workflowId}.`);
    if (!options.confirmedConsequence) throw new Error(`Explicit confirmation required. ${workflow.consequence}`);
    const plan = this.planValidationContent(workflowId);
    const transactionIndex = this.#transactions.length;
    const result = await this.sendPersistentContent(plan, { confirmedConsequence: true });
    const transactionIds = this.#transactions.slice(transactionIndex).map(({ id }) => id);
    return { plan, result, transactionIds };
  }

  /**
   * Record the user's structured observations for a validation workflow as
   * session-scoped evidence. Profile metadata is never silently promoted;
   * the result feeds the support matrix and reports for this session only.
   */
  recordValidationAnswers(workflowId: string, answers: readonly ValidationAnswer[], transactionIds: readonly string[] = []): import("../diagnostics/validation").SessionValidationResult {
    const workflow = CONTENT_VALIDATION_WORKFLOWS.find(({ id }) => id === workflowId);
    if (!workflow) throw new Error(`Unknown validation workflow ${workflowId}.`);
    const outcome = evaluateValidationAnswers(workflow, answers);
    const validation = {
      id: sessionValidationId(), workflowId, recordedAt: new Date().toISOString(),
      profileId: this.session.profile?.id ?? null, status: outcome.status,
      validatedAreas: outcome.validatedAreas, rejectedAreas: outcome.rejectedAreas,
      answers: [...answers], transactionIds: [...transactionIds], findings: outcome.findings,
    };
    this.#validations.push(validation);
    // Trust is decided here, from live controller state — never from
    // serialized data. Only a live physical session earns current-session.
    this.#validationScopes.set(validation.id, this.session.source === "live" ? "current-session" : "imported-external");
    this.trace.record("validation.recorded", { workflowId, status: outcome.status, validated: outcome.validatedAreas.join(","), rejected: outcome.rejectedAreas.join(",") });
    return validation;
  }

  #recordCompilation(plan: TransmissionPlan, extras: Partial<ContentCompilationRecord> | undefined, transactionId: string | null): void {
    const metadata = plan.metadata;
    const number = (key: string): number => typeof metadata[key] === "number" ? metadata[key] as number : 0;
    const record: ContentCompilationRecord = {
      id: contentCompilationId(), createdAt: new Date().toISOString(), operation: plan.operation.type,
      contentType: (metadata.contentType as ContentCompilationRecord["contentType"]) ?? "graffiti",
      profileId: plan.profileId, width: number("width"), height: number("height"),
      tileWidth: number("tileWidth"), tileCount: number("tileCount"), programBytes: number("programBytes"),
      crc32: typeof metadata.crc32 === "string" ? Number.parseInt(metadata.crc32, 16) : 0,
      compressedBytes: number("compressedBytes"),
      compression: metadata.compression === "lzss" ? "lzss" : "lzss-safe",
      chunkCount: number("chunkCount"), pacingMs: number("pacingMs"),
      ...(typeof metadata.frameCount === "number" ? { frameCount: metadata.frameCount } : {}),
      ...(transactionId ? { transactionId } : {}),
      ...extras,
    };
    this.#contentCompilations.push(record);
    this.trace.record("content.compiled", { operation: plan.operation.type, programBytes: record.programBytes, chunkCount: record.chunkCount, crc32: metadata.crc32 ?? null });
  }

  /**
   * Import an external capture (currently nRF Connect text logs). When a live
   * session is active the imported transactions join it as labeled evidence;
   * otherwise an offline imported session opens. Imported evidence never
   * transmits: the safety policy blocks every non-live source.
   */
  importExternalLog(content: string): ImportedEvidence {
    const importer = findImporter(content);
    if (!importer) throw new Error("No importer recognizes this capture format. nRF Connect text logs are supported.");
    const evidence = importer.parse(content, { drivers: this.registry.drivers });
    if (!evidence.fingerprint && evidence.transactions.length === 0) throw new Error(evidence.warnings[0] ?? "The capture contained no recognizable evidence.");
    const liveSessionActive = this.session.source === "live" && this.session.fingerprint !== null;
    if (!liveSessionActive) {
      this.session.clearConnection();
      if (evidence.fingerprint) this.applyFingerprint(evidence.fingerprint, "imported");
      else this.session.source = "imported";
    }
    this.#transactions.push(...evidence.transactions);
    this.#observations.push(...evidence.observations);
    this.#importedEvidence.push({ provenance: evidence.provenance, transactionCount: evidence.transactions.length, warnings: evidence.warnings });
    this.trace.record("evidence.imported", { importer: importer.id, transactions: evidence.transactions.length, warnings: evidence.warnings.length, unparsedLines: evidence.unparsedLineCount });
    return evidence;
  }

  #recordTransaction(plan: TransmissionPlan, result: ExecutionResult | null, startedAt: string, notificationStart: number, source: TransactionSource, diagnosticRunIdValue: string | null, error: string | null): void {
    const completedAt = result?.completedAt ?? new Date().toISOString();
    const endpoint = plan.packets[0]?.endpoint ?? null;
    const timingByIndex = new Map((result?.packetTimings ?? []).map((timing) => [timing.index, timing]));
    // Real per-write timestamps: every packet keeps its measured write time,
    // never the transaction's start time or the plan's requested pacing.
    const tx = plan.packets.map((packet) => {
      const timing = timingByIndex.get(packet.index);
      return {
        timestamp: timing?.writeStartedAt ?? startedAt, direction: "TX" as const, hex: packet.hex, endpoint: packet.endpoint,
        ...(timing ? { hostAcceptedAt: timing.hostAcceptedAt, scheduledDelayMs: timing.scheduledDelayMs } : {}),
        ...(timing?.gapSincePreviousTxMs !== null && timing?.gapSincePreviousTxMs !== undefined ? { gapSincePreviousTxMs: timing.gapSincePreviousTxMs } : {}),
      };
    });
    const rx = this.session.notifications.slice(notificationStart).map((record) => ({ timestamp: record.timestamp, direction: "RX" as const, hex: record.rawHex, ...(endpoint ? { endpoint } : {}) }));
    this.#transactions.push({ id: transactionId(), startedAt, completedAt, durationMs: duration(startedAt, completedAt), sessionSource: this.session.source, source, driverId: plan.driverId, profileId: plan.profileId, operation: plan.operation.type, safety: { risk: plan.risk, persistence: plan.persistence, validation: plan.validation }, endpoint, packets: [...tx, ...rx], decodedResponse: result?.response ?? null, hostAccepted: result?.hostAccepted ?? false, protocolAcknowledged: result?.protocolAcknowledged ?? null, deviceStateVerified: result?.deviceStateVerified ?? false, responseTimedOut: result?.responseTimedOut ?? false, error, findings: result?.response ? [result.response.summary] : [], observationIds: [], diagnosticRunId: diagnosticRunIdValue });
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

function duration(startedAt: string, completedAt: string): number { return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function numberField(notification: DecodedNotification | null, key: string): number | null { const value = notification?.fields[key]; return typeof value === "number" ? value : null; }
