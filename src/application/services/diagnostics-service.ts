import {
  captureWorkflowContext,
  type WorkflowContext,
} from "../workflow-context";
import { validateGeometry } from "../../domain/device/geometry";
import type {
  DiagnosticRun,
  DiagnosticStepResult,
} from "../../diagnostics/workflows";
import {
  chooseTestBrightness,
  diagnosticRunId,
} from "../../diagnostics/workflows";
import { errorMessage, numberField } from "./runtime-support";

import type { ConnectionService } from "./connection-service";
import type { IdentificationService } from "./identification-service";
import type { ProtocolEvidenceService } from "./protocol-evidence-service";
import type { TransmissionService } from "./transmission-service";
interface Ports {
  reserve(context: WorkflowContext): () => void;
  connection(): Pick<
    ConnectionService,
    | "getSession"
    | "patchSession"
    | "getConnectionState"
    | "setConnectionState"
    | "getTransport"
    | "getConnectionGeneration"
    | "_requireTargetBinding"
    | "_currentTargetBinding"
  >;
  identification(): Pick<
    IdentificationService,
    "deviceTarget" | "getRegistry" | "geometryProposal"
  >;
  protocolEvidence(): Pick<
    ProtocolEvidenceService,
    "getTrace" | "getTransactions"
  >;
  investigation(): Pick<
    import("./investigation-service").InvestigationService,
    "_reconcileDeviceBoundary"
  >;
  transmission(): Pick<TransmissionService, "probe" | "_execute" | "plan">;
}
export class DiagnosticsService {
  private readonly _diagnosticRuns: DiagnosticRun[] = [];
  constructor(private readonly ports: Ports) {}
  getDiagnosticRuns(): Readonly<DiagnosticsService["_diagnosticRuns"]> {
    return this._diagnosticRuns;
  }
  editDiagnosticRuns(
    edit: (value: DiagnosticsService["_diagnosticRuns"]) => unknown,
  ): void {
    edit(this._diagnosticRuns);
  }
  confirmProvisionalGeometry(
    width: number,
    height: number,
  ): import("../../core/device").DeviceProfile {
    return this.adoptGeometry(width, height, "user-confirmed");
  }
  useReportedGeometry(
    proposalId: string,
  ): import("../../core/device").DeviceProfile {
    const proposal = this.ports.identification().geometryProposal();
    if (!proposal || proposal.id !== proposalId)
      throw new Error(
        "This reported size has expired. Identify display again on the current connection.",
      );
    return this.adoptGeometry(proposal.width, proposal.height, "device-info", {
      geometryTransactionId: proposal.transactionId,
      geometryRecordedAt: proposal.recordedAt,
      geometryConnectionId: proposal.connectionId,
      geometryFingerprintKey: proposal.fingerprintKey,
      geometryBrowserDeviceId: proposal.browserDeviceId ?? "",
      geometryRationale: proposal.rationale,
    });
  }
  private adoptGeometry(
    width: number,
    height: number,
    source: "user-confirmed" | "device-info",
    provenance: import("../../core/device").DeviceProfile["metadata"] = {},
  ): import("../../core/device").DeviceProfile {
    const session = this.ports.connection().getSession();
    const fingerprint = session.fingerprint;
    const driver = session.selection?.selected;
    if (
      !fingerprint ||
      !driver ||
      !session.protocolResolution ||
      session.source !== "live" ||
      session.protocolResolution.driverId !== driver.id ||
      this.ports.connection().getConnectionState().value !== "connected"
    )
      throw new Error(
        "Identify the protocol family on the current live connection before using geometry.",
      );
    const geometry = validateGeometry(width, height);
    if (session.profile && !session.profile.id.startsWith("provisional:"))
      throw new Error(
        "Reviewed profile geometry is retained. A conflicting reported size is evidence to investigate, not a replacement model match.",
      );
    const { manuallyConfirmedGeometry: _manual, ...base } = fingerprint;
    this.ports.connection().patchSession({
      fingerprint:
        source === "user-confirmed"
          ? { ...base, manuallyConfirmedGeometry: geometry }
          : base,
    });
    const profile: import("../../core/device").DeviceProfile = {
      id: `provisional:${driver.id}:${width}x${height}`,
      name: `${fingerprint.name ?? driver.family} (${width}×${height}, provisional)`,
      driverId: driver.id,
      width,
      height,
      validation: "experimental",
      evidence: [],
      metadata: { provisional: true, geometrySource: source, ...provenance },
    };
    session.geometryRevision += 1;
    session.consumePersistentConfirmation();
    this.ports
      .connection()
      .patchSession({ profile, validatedRasterStrategy: null });
    this.ports.investigation()._reconcileDeviceBoundary();
    const target = this.ports.identification().deviceTarget();
    const connectionState = this.ports.connection().getConnectionState();
    if (target && connectionState.value === "connected")
      this.ports
        .connection()
        .setConnectionState({ ...connectionState, target });
    this.ports
      .protocolEvidence()
      .getTrace()
      .record("device.provisional-target.created", {
        driverId: driver.id,
        width,
        height,
        geometrySource: source,
        ...provenance,
      });
    return profile;
  }
  diagnosticTools(): readonly import("../../diagnostics/workflows").DiagnosticTool[] {
    const session = this.ports.connection().getSession();
    const fingerprint = session.fingerprint;
    if (!fingerprint) return [];
    return this.ports
      .identification()
      .getRegistry()
      .drivers.filter((driver) => driver.match(fingerprint).score > 0)
      .flatMap((driver) => driver.diagnosticTools?.() ?? [])
      .map((tool) => ({
        ...tool,
        available: tool.available && session.source === "live",
        ...(session.source !== "live"
          ? { unavailableReason: "Imported reports are read-only." }
          : !tool.available && !tool.unavailableReason
            ? {
                unavailableReason:
                  "This diagnostic is unavailable for this driver.",
              }
            : {}),
      }));
  }
  async runDiagnostic(toolId: string): Promise<DiagnosticRun> {
    const tool = this.diagnosticTools().find(
      (candidate) => candidate.id === toolId,
    );
    if (!tool?.available)
      throw new Error(
        tool?.unavailableReason ??
          "This driver family has no verified safe diagnostic tool for the current device.",
      );
    const context = captureWorkflowContext(
      this.ports.connection(),
      tool.workflow !== "family-identification",
    );
    const release = this.ports.reserve(context);
    try {
      const execute = async (
        operation: import("../../core/operations").MatrixOperation,
      ) => {
        context.assertCurrent();
        const result = await this.ports
          .transmission()
          ._execute(
            this.ports.transmission().plan(operation),
            "diagnostic",
            id,
          );
        context.assertCurrent();
        return result;
      };
      const id = diagnosticRunId();
      const startedAt = new Date().toISOString();
      const steps: DiagnosticStepResult[] = [];
      const transactionIndex = this.ports
        .protocolEvidence()
        .getTransactions().length;
      let restorationAttempted = false;
      let restorationVerified = false;
      let status: DiagnosticRun["status"];
      let error: string | null = null;
      const step = (
        stepId: string,
        label: string,
        passed: boolean,
        summary: string,
        from: number,
      ): void => {
        steps.push({
          id: stepId,
          label,
          status: passed ? "passed" : "failed",
          summary,
          transactionIds: this.ports
            .protocolEvidence()
            .getTransactions()
            .slice(from)
            .map((value) => value.id),
        });
      };
      let baseline: number | null = null;
      let testWasAttempted = false;
      try {
        if (tool.workflow === "family-identification") {
          context.assertCurrent();
          const result = await this.ports
            .transmission()
            .probe(tool.driverId, tool.probeId ?? "get-device-info", {
              beforePlan: () => context.assertCurrent(),
              canAdopt: () => context.current(),
            });
          context.assertCurrent();
          step(
            "identify",
            "Get Device Info",
            result.identification.matched,
            result.identification.matched
              ? result.identification.summary
              : result.identification.reason,
            transactionIndex,
          );
          if (!result.identification.matched)
            throw new Error(result.identification.reason);
        } else if (tool.workflow === "refresh-device-info") {
          const from = this.ports.protocolEvidence().getTransactions().length;
          const result = await execute({ type: "GetDeviceInfo" });
          step(
            "refresh",
            "Refresh Device Info",
            Boolean(result.response),
            result.response?.summary ?? "No matching response.",
            from,
          );
          if (!result.response)
            throw new Error("Device-info refresh timed out.");
        } else if (tool.workflow === "brightness-round-trip") {
          let from = this.ports.protocolEvidence().getTransactions().length;
          const baselineResult = await execute({ type: "GetDeviceInfo" });
          baseline = numberField(baselineResult.response, "brightnessRaw");
          step(
            "baseline",
            "Record baseline brightness",
            baseline !== null,
            baseline === null
              ? "Brightness was absent from device info."
              : `Baseline is ${baseline}.`,
            from,
          );
          if (baseline === null)
            throw new Error(
              "Cannot validate brightness without a baseline readback.",
            );
          const test = chooseTestBrightness(baseline);
          from = this.ports.protocolEvidence().getTransactions().length;
          testWasAttempted = true;
          const setResult = await execute({ type: "SetBrightness", raw: test });
          step(
            "set-test",
            "Set test brightness",
            setResult.protocolAcknowledged === true,
            `Command response ${setResult.protocolAcknowledged ? "matched" : "did not match"}; test value ${test}.`,
            from,
          );
          if (!setResult.protocolAcknowledged)
            throw new Error(
              "Test brightness command did not receive the required matching response.",
            );
          from = this.ports.protocolEvidence().getTransactions().length;
          const verify = await execute({ type: "GetDeviceInfo" });
          const actual = numberField(verify.response, "brightnessRaw");
          step(
            "verify-test",
            "Verify test brightness",
            actual === test,
            `Expected ${test}; read back ${actual ?? "unknown"}.`,
            from,
          );
          if (actual !== test)
            throw new Error(
              `Test brightness readback mismatch: expected ${test}, received ${actual ?? "unknown"}.`,
            );
        } else throw new Error(`Unknown diagnostic tool ${toolId}.`);
        status = "passed";
      } catch (caught) {
        error = errorMessage(caught);
        status = "failed";
      }
      if (
        tool.workflow === "brightness-round-trip" &&
        baseline !== null &&
        testWasAttempted &&
        context.current()
      ) {
        restorationAttempted = true;
        try {
          let from = this.ports.protocolEvidence().getTransactions().length;
          const restore = await execute({
            type: "SetBrightness",
            raw: baseline,
          });
          step(
            "restore",
            "Restore baseline brightness",
            restore.protocolAcknowledged === true,
            `Restore response ${restore.protocolAcknowledged ? "matched" : "did not match"}.`,
            from,
          );
          if (!restore.protocolAcknowledged)
            throw new Error(
              "Restore command did not receive the required matching response.",
            );
          from = this.ports.protocolEvidence().getTransactions().length;
          const verifyRestore = await execute({ type: "GetDeviceInfo" });
          const restored = numberField(verifyRestore.response, "brightnessRaw");
          restorationVerified = restored === baseline;
          step(
            "verify-restore",
            "Verify restoration",
            restorationVerified,
            `Expected baseline ${baseline}; read back ${restored ?? "unknown"}.`,
            from,
          );
          if (!restorationVerified)
            throw new Error(
              `RESTORE FAILED: expected ${baseline}, read back ${restored ?? "unknown"}.`,
            );
        } catch (restoreError) {
          status = "restore-failed";
          error = `${error ? `${error} ` : ""}${errorMessage(restoreError)}`;
        }
      }
      const completedAt = new Date().toISOString();
      const run: DiagnosticRun = {
        id,
        toolId,
        driverId: tool.driverId,
        startedAt,
        completedAt,
        purpose: tool.purpose,
        safety: {
          risk: tool.risk,
          persistence: tool.persistence,
          validation: tool.validation,
          explanation: tool.explanation,
        },
        status,
        steps,
        findings:
          status === "passed"
            ? [
                tool.workflow === "brightness-round-trip"
                  ? "Brightness response and readback were validated; baseline restoration was verified."
                  : tool.workflow === "family-identification"
                    ? steps[0]!.summary
                    : "The expected structured read-only response was received.",
              ]
            : [error ?? "Diagnostic failed."],
        error,
        restorationAttempted,
        restorationVerified,
        observationIds: [],
      };
      this._diagnosticRuns.push(run);
      return run;
    } finally {
      release();
    }
  }
  get diagnosticRuns(): readonly DiagnosticRun[] {
    return this._diagnosticRuns;
  }
}
