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
  connection(): Pick<
    ConnectionService,
    "getSession" | "patchSession" | "getConnectionState" | "setConnectionState"
  >;
  identification(): Pick<IdentificationService, "deviceTarget" | "getRegistry">;
  protocolEvidence(): Pick<
    ProtocolEvidenceService,
    "getTrace" | "getTransactions"
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
    const session = this.ports.connection().getSession();
    const fingerprint = session.fingerprint;
    const driver = session.selection?.selected;
    if (!fingerprint || !driver || !session.protocolResolution)
      throw new Error(
        "Identify the protocol family before confirming geometry.",
      );
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 512 ||
      height > 512 ||
      width * height > 65_536
    ) {
      throw new Error(
        "Display geometry is outside the supported 1..512 dimension and 65,536-pixel budget.",
      );
    }
    const geometry = { width, height };
    this.ports.connection().patchSession({
      fingerprint: {
        ...fingerprint,
        manuallyConfirmedGeometry: geometry,
      },
    });
    const profile: import("../../core/device").DeviceProfile = {
      id: `provisional:${driver.id}:${width}x${height}`,
      name: `${fingerprint.name ?? driver.family} (${width}×${height}, provisional)`,
      driverId: driver.id,
      width,
      height,
      validation: "experimental",
      evidence: [],
      metadata: { provisional: true, geometrySource: "user-confirmed" },
    };
    this.ports.connection().patchSession({ profile: profile });
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
        geometrySource: "user-confirmed",
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
        available: session.source === "live",
        ...(session.source !== "live"
          ? { unavailableReason: "Imported reports are read-only." }
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
        const result = await this.ports
          .transmission()
          .probe(tool.driverId, tool.probeId ?? "get-device-info");
        step(
          "identify",
          "Get Device Info",
          Boolean(result.response),
          result.response?.summary ?? "No matching structured response.",
          transactionIndex,
        );
        if (!result.response)
          throw new Error(
            "Safe identification did not receive a matching structured response.",
          );
      } else if (tool.workflow === "refresh-device-info") {
        const from = this.ports.protocolEvidence().getTransactions().length;
        const result = await this.ports
          .transmission()
          ._execute(
            this.ports.transmission().plan({ type: "GetDeviceInfo" }),
            "diagnostic",
            id,
          );
        step(
          "refresh",
          "Refresh Device Info",
          Boolean(result.response),
          result.response?.summary ?? "No matching response.",
          from,
        );
        if (!result.response) throw new Error("Device-info refresh timed out.");
      } else if (tool.workflow === "brightness-round-trip") {
        let from = this.ports.protocolEvidence().getTransactions().length;
        const baselineResult = await this.ports
          .transmission()
          ._execute(
            this.ports.transmission().plan({ type: "GetDeviceInfo" }),
            "diagnostic",
            id,
          );
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
        const setResult = await this.ports
          .transmission()
          ._execute(
            this.ports
              .transmission()
              .plan({ type: "SetBrightness", raw: test }),
            "diagnostic",
            id,
          );
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
        const verify = await this.ports
          .transmission()
          ._execute(
            this.ports.transmission().plan({ type: "GetDeviceInfo" }),
            "diagnostic",
            id,
          );
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
      testWasAttempted
    ) {
      restorationAttempted = true;
      try {
        let from = this.ports.protocolEvidence().getTransactions().length;
        const restore = await this.ports
          .transmission()
          ._execute(
            this.ports
              .transmission()
              .plan({ type: "SetBrightness", raw: baseline }),
            "diagnostic",
            id,
          );
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
        const verifyRestore = await this.ports
          .transmission()
          ._execute(
            this.ports.transmission().plan({ type: "GetDeviceInfo" }),
            "diagnostic",
            id,
          );
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
  }
  get diagnosticRuns(): readonly DiagnosticRun[] {
    return this._diagnosticRuns;
  }
}
