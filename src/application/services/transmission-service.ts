import { TransmissionAuthorization } from "../../app/transmission-authorization";
import type { MatrixOperation } from "../../core/operations";
import type {
  PreparedTransmission,
  TransmissionPlan,
} from "../../core/transmission";
import {
  type ExecutionProgress,
  type ExecutionResult,
} from "../../app/executor";
import { type PolicyDecision } from "../../app/safety";
import {
  isPreparedTransmission,
  prepareTransmission,
} from "../../core/transmission";
import type { TransactionSource } from "../../diagnostics/transactions";
import { resolveSessionBehavior } from "../../investigation/session-behavior";
import { transitionConnection } from "../machines/connection-machine";
import { candidateEndpoints, errorMessage } from "./runtime-support";

import type { ContentCompilationRecord } from "../../diagnostics/content-evidence";

import { TransmissionExecutor } from "../../app/executor";
import { SafetyPolicy } from "../../app/safety";

import type { ConnectionService } from "./connection-service";
import type { ProtocolEvidenceService } from "./protocol-evidence-service";
import type { InvestigationService } from "./investigation-service";
import type { IdentificationService } from "./identification-service";
interface Ports {
  connection(): Pick<
    ConnectionService,
    | "getSession"
    | "_requireTargetBinding"
    | "_currentTargetBinding"
    | "enableDriverNotifications"
    | "getTransport"
    | "setConnectionState"
    | "getConnectionState"
  >;
  protocolEvidence(): Pick<
    ProtocolEvidenceService,
    | "getTransactions"
    | "_recordCompilation"
    | "getTrace"
    | "_recordTransaction"
    | "getNotificationRouter"
  >;
  investigation(): Pick<
    InvestigationService,
    | "allClaimEvidence"
    | "getStagedPanelProgram"
    | "setStagedPanelProgram"
    | "_setPanelProgram"
    | "_invalidatePanelProgram"
  >;
  identification(): Pick<
    IdentificationService,
    "getRegistry" | "_resolveProtocol"
  >;
}
export class TransmissionService {
  readonly authority = new TransmissionAuthorization();
  private readonly policy = new SafetyPolicy();
  private _executor!: TransmissionExecutor;
  constructor(private readonly ports: Ports) {}
  initialize(): void {
    this._executor = new TransmissionExecutor(
      this.ports.connection().getTransport(),
      this.ports.protocolEvidence().getTrace(),
      this.ports.protocolEvidence().getNotificationRouter(),
    );
  }
  getPolicy() {
    return this.policy;
  }
  async sendPersistentContent(
    plan: TransmissionPlan,
    options: {
      readonly confirmedConsequence?: boolean;
      readonly extras?: Partial<ContentCompilationRecord>;
      readonly onProgress?: (progress: ExecutionProgress) => void;
    } = {},
  ): Promise<ExecutionResult> {
    if (plan.risk !== "persistent" && plan.persistence !== "persistent")
      throw new Error(
        "sendPersistentContent is only for persistent content plans.",
      );
    const requiresExperimentalConfirmation = plan.validation !== "verified";
    if (requiresExperimentalConfirmation && !options.confirmedConsequence)
      throw new Error(
        "Experimental persistent content requires explicit confirmation of its exact consequence.",
      );
    if (!isPreparedTransmission(plan))
      throw new Error(
        "Persistent content must be prepared for the connected target before authorization.",
      );
    const experimentalWasEnabled = this.authority.experimentalTxEnabled;
    if (requiresExperimentalConfirmation) this.authority.enableExperimentalTx();
    if (requiresExperimentalConfirmation)
      this.authority.confirmPlanDigest(plan.digest);
    const transactionIndex = this.ports
      .protocolEvidence()
      .getTransactions().length;
    try {
      const result = await this._execute(
        plan,
        "operation",
        null,
        options.onProgress,
      );
      this.ports
        .protocolEvidence()
        ._recordCompilation(
          plan,
          options.extras,
          this.ports.protocolEvidence().getTransactions()[transactionIndex]
            ?.id ?? null,
        );
      return result;
    } finally {
      this.authority.consumePersistentConfirmation();
      if (requiresExperimentalConfirmation && !experimentalWasEnabled)
        this.authority.disableExperimentalTx();
    }
  }
  plan(operation: MatrixOperation): PreparedTransmission {
    const session = this.ports.connection().getSession();
    const driver = session.selection?.selected;
    const fingerprint = session.fingerprint;
    const profile = session.profile;
    if (!driver || !fingerprint || !profile)
      throw new Error(
        "A non-ambiguous driver and profile are required to create a plan.",
      );
    const rawPlan = driver.plan(operation, {
      profile,
      fingerprint,
      source: session.source,
      ...(session.validatedRasterStrategy
        ? { rasterStrategy: session.validatedRasterStrategy }
        : {}),
      resolvedBehavior: resolveSessionBehavior(
        this.ports.investigation().allClaimEvidence(),
      ),
    });
    const plan = prepareTransmission(
      rawPlan,
      this.ports.connection()._requireTargetBinding(),
    );
    this.ports.protocolEvidence().getTrace().record("tx.plan.created", {
      planId: plan.id,
      planDigest: plan.digest,
      connectionId: plan.targetBinding.connectionId,
      operation: operation.type,
      packetCount: plan.packets.length,
    });
    return plan;
  }
  authorize(plan: TransmissionPlan): PolicyDecision {
    const decision = this.evaluate(plan);
    this.ports
      .protocolEvidence()
      .getTrace()
      .record(decision.allowed ? "tx.plan.authorized" : "tx.plan.blocked", {
        planId: plan.id,
        reasons: decision.reasons.join(" | "),
      });
    return decision;
  }
  evaluate(plan: TransmissionPlan): PolicyDecision {
    const session = this.ports.connection().getSession();
    const bestMatch =
      session.selection?.matches.find(
        ({ driverId }) => driverId === plan.driverId,
      ) ?? null;
    return this.policy.authorize(plan, {
      source: session.source,
      fingerprint: session.fingerprint,
      selectedDriverId: session.selection?.selected?.id ?? null,
      selectedProfileId: session.profile?.id ?? null,
      driverMatch: bestMatch,
      ambiguous: session.selection?.ambiguous ?? false,
      experimentalSessionEnabled: session.experimentalTxEnabled,
      targetBinding: this.ports.connection()._currentTargetBinding(),
      confirmedPlanDigest: session.confirmedPlanDigest,
    });
  }
  async send(plan: TransmissionPlan): Promise<ExecutionResult> {
    return this._execute(plan, plan.purpose, null);
  }
  async _execute(
    plan: TransmissionPlan,
    source: TransactionSource,
    diagnosticRunIdValue: string | null,
    onProgress?: (progress: ExecutionProgress) => void,
  ): Promise<ExecutionResult> {
    const session = this.ports.connection().getSession();
    const startedAt = new Date().toISOString();
    const notificationStart = session.notifications.length;
    const decision = this.authorize(plan);
    if (!decision.allowed || !decision.authorized)
      throw new Error(decision.reasons.join(" "));
    const driver = this.ports
      .identification()
      .getRegistry()
      .drivers.find(({ id }) => id === plan.driverId);
    if (!driver) throw new Error(`Driver ${plan.driverId} is unavailable.`);
    await this.ports.connection().enableDriverNotifications(driver);
    // A stored-program display holds exactly one program. Every persistent
    // write replaces it, so the belief about what is on the panel is settled
    // HERE — the one path all of them go through — rather than in each
    // caller, where "Create → Send image" was silently exempt.
    const replacesStoredProgram =
      plan.risk === "persistent" || plan.persistence === "persistent";
    const staged = this.ports.investigation().getStagedPanelProgram();
    this.ports.investigation().setStagedPanelProgram(null);
    try {
      const result = await this._executor.execute(
        decision.authorized,
        driver,
        onProgress,
      );
      this.ports
        .protocolEvidence()
        ._recordTransaction(
          plan,
          result,
          startedAt,
          notificationStart,
          source,
          diagnosticRunIdValue,
          null,
        );
      if (replacesStoredProgram) {
        // "Written at" is the final host-accepted write, never the moment the
        // transfer began — a report that labels transfer-start as accepted is
        // reporting a time the panel had not yet been changed.
        const base = staged ?? {
          certainty: "known-replaced" as const,
          kind: "ordinary-content" as const,
          fingerprint: null,
          label: `${plan.operation.type} (${plan.purpose})`,
          startedAt,
          writtenAt: null,
          uncertaintyReason: null,
        };
        this.ports.investigation()._setPanelProgram({
          ...base,
          writtenAt: result.finalWriteAcceptedAt ?? new Date().toISOString(),
        });
      }
      return result;
    } catch (error) {
      if (
        this.ports.connection().getTransport().state === "quarantined" &&
        isPreparedTransmission(plan)
      ) {
        const value = (error as { packetIndex?: unknown }).packetIndex;
        this.ports.connection().setConnectionState(
          transitionConnection(this.ports.connection().getConnectionState(), {
            type: "WRITE_INDETERMINATE",
            reason: {
              planDigest: plan.digest,
              packetIndex: typeof value === "number" ? value : -1,
              message: errorMessage(error),
            },
          }),
        );
      }
      // A failed persistent write may still have landed packets. What is on
      // the panel is genuinely unknown, and saying otherwise in either
      // direction would be a guess.
      if (replacesStoredProgram) {
        this.ports
          .investigation()
          ._invalidatePanelProgram(
            "A persistent write failed part-way; what the display is showing was not established.",
          );
      }
      this.ports
        .protocolEvidence()
        ._recordTransaction(
          plan,
          null,
          startedAt,
          notificationStart,
          source,
          diagnosticRunIdValue,
          errorMessage(error),
        );
      throw error;
    }
  }
  async probe(driverId?: string, probeId?: string): Promise<ExecutionResult> {
    const session = this.ports.connection().getSession();
    if (session.source !== "live")
      throw new Error(
        "Imported and replay sessions cannot perform live probes.",
      );
    const fingerprint = session.fingerprint;
    if (!fingerprint)
      throw new Error(
        "The requested probe driver is not available for this connection.",
      );
    const driver = driverId
      ? this.ports
          .identification()
          .getRegistry()
          .drivers.find(({ id }) => id === driverId)
      : this.ports
          .identification()
          .getRegistry()
          .drivers.filter((candidate) => candidate.match(fingerprint).score > 0)
          .find((candidate) => candidate.familyProbes !== undefined);
    if (!driver)
      throw new Error(
        "The requested probe driver is not available for this connection.",
      );
    const profile = driver.resolveProfile(fingerprint);
    const candidateContext = {
      fingerprint,
      endpoints: candidateEndpoints(fingerprint),
      source: session.source,
    } as const;
    const familyProbes = driver.familyProbes?.(candidateContext) ?? [];
    const selectedProbeId = probeId ?? familyProbes[0]?.id;
    const familyProbe = familyProbes.find(({ id }) => id === selectedProbeId);
    const profileContext = profile
      ? ({ profile, fingerprint, source: session.source } as const)
      : null;
    const profileProbe = profileContext
      ? driver.probes?.(profileContext).find(({ id }) => id === selectedProbeId)
      : null;
    if (!familyProbe && !profileProbe)
      throw new Error(
        `Probe ${selectedProbeId ?? "(none)"} is unavailable for this device candidate.`,
      );
    const plan = prepareTransmission(
      familyProbe
        ? familyProbe.plan(candidateContext)
        : profileProbe!.plan(profileContext!),
      this.ports.connection()._requireTargetBinding(),
    );
    this.ports
      .protocolEvidence()
      .getTrace()
      .record("protocol.probe.started", {
        driverId: driver.id,
        probeId: selectedProbeId ?? "unknown",
        planId: plan.id,
      });
    const decision = this.authorize(plan);
    if (!decision.allowed || !decision.authorized)
      throw new Error(decision.reasons.join(" "));
    await this.ports.connection().enableDriverNotifications(driver);
    const startedAt = new Date().toISOString();
    const notificationStart = session.notifications.length;
    let result: ExecutionResult;
    try {
      result = await this._executor.execute(decision.authorized, driver);
      this.ports
        .protocolEvidence()
        ._recordTransaction(
          decision.authorized.plan,
          result,
          startedAt,
          notificationStart,
          "probe",
          null,
          null,
        );
    } catch (error) {
      this.ports
        .protocolEvidence()
        ._recordTransaction(
          decision.authorized.plan,
          null,
          startedAt,
          notificationStart,
          "probe",
          null,
          errorMessage(error),
        );
      throw error;
    }
    const interpretation = familyProbe
      ? familyProbe.identify(
          {
            response: result.response,
            responseTimedOut: result.responseTimedOut,
          },
          candidateContext,
        )
      : result.response
        ? profileProbe!.interpret(result.response)
        : null;
    if (interpretation?.matched)
      this.ports
        .identification()
        ._resolveProtocol(
          driver,
          profile,
          selectedProbeId ?? familyProbe?.id ?? profileProbe!.id,
          interpretation.summary,
          "live-probe",
        );
    else
      this.ports
        .protocolEvidence()
        .getTrace()
        .record("protocol.probe.rejected", {
          driverId: driver.id,
          probeId: selectedProbeId ?? "unknown",
          responseTimedOut: result.responseTimedOut,
        });
    return result;
  }
}
