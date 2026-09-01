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
import { findImporter, type ImportedEvidence } from "../diagnostics/importers";
import { chooseTestBrightness, COOLLEDUX_DIAGNOSTIC_TOOLS, diagnosticRunId } from "../diagnostics/workflows";
import { CONTENT_VALIDATION_WORKFLOWS, evaluateValidationAnswers, sessionValidationId, type ContentValidationWorkflow, type ValidationAnswer } from "../diagnostics/validation";
import { contentCompilationId } from "../diagnostics/content-evidence";
import { diagnosticAnimation, orientationPattern } from "../render/patterns";

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
    return fingerprint;
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
