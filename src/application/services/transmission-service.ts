import { normalizeUuid } from "../../core/device";
import { discoveryCatalog, nextDiscoveryStep } from "./discovery-planner";
import {
  machineOutcome,
  ProbeStageError,
  type MachineOutcomeKind,
} from "../discovery-outcome";
import { RESPONSE_AMBIGUITY_MESSAGE } from "../../app/notifications";
import { SHARED_OPERATIONS } from "../../domain/device/assessment";
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
export type FamilyProbeExecution = ExecutionResult & {
  readonly transactionId: string;
  readonly outcome: MachineOutcomeKind;
  readonly identification: import("../../drivers/types").IdentificationResult & {
    readonly driverId: string;
    readonly probeId: string;
    readonly family: string;
  };
};

interface Ports {
  guidedTestCatalog(): Pick<
    import("./guided-test-catalog-service").GuidedTestCatalogService,
    "guidedTest" | "guidedTests" | "planGuidedTest"
  >;
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
    "getRegistry" | "_resolveProtocol" | "_proposeGeometry" | "assessment"
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
      () => this.ports.connection()._currentTargetBinding(),
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
      readonly onExecutionStarted?: () => void;
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
    const connectionId = this.ports.connection().getTransport().connectionId;
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
        options.onExecutionStarted,
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
      if (
        connectionId === this.ports.connection().getTransport().connectionId
      ) {
        this.authority.consumePersistentConfirmation();
        if (requiresExperimentalConfirmation && !experimentalWasEnabled)
          this.authority.disableExperimentalTx();
      }
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
      {
        ...rawPlan,
        metadata: {
          ...rawPlan.metadata,
          definitionIdentity: this.ports
            .identification()
            .getRegistry()
            .definitionIdentity(driver.id, profile),
        },
      },
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
    const capabilityId =
      SHARED_OPERATIONS[plan.operation.type as keyof typeof SHARED_OPERATIONS];
    const readinessReasons: string[] = [];
    if (capabilityId) {
      const assessment = this.ports.identification().assessment();
      const capability = assessment.capabilities[capabilityId];
      if (
        capability.confidence === "experimental" &&
        !this.authority.experimentalTxEnabled
      )
        readinessReasons.push(
          "Experimental operation availability still requires explicit per-session experimental permission.",
        );
      if (capability.availability !== "available")
        readinessReasons.push(capability.reason);
      const action = assessment.actions.find(
        ({ operationId }) => operationId === plan.operation.type,
      );
      if (!action || action.availability !== "available")
        readinessReasons.push(
          action?.reason ??
            "The selected driver does not offer this ordinary operation.",
        );
    }
    const decision = this.evaluatePolicy(plan);
    return readinessReasons.length
      ? { allowed: false, reasons: [...readinessReasons, ...decision.reasons] }
      : decision;
  }
  private evaluatePolicy(plan: TransmissionPlan): PolicyDecision {
    const session = this.ports.connection().getSession();
    if (plan.metadata.definitionIdentity !== undefined) {
      const profile =
        session.selection?.selected?.id === plan.driverId
          ? session.profile
          : session.fingerprint
            ? (this.ports
                .identification()
                .getRegistry()
                .drivers.find((driver) => driver.id === plan.driverId)
                ?.resolveProfile(session.fingerprint) ?? null)
            : null;
      const currentIdentity = this.ports
        .identification()
        .getRegistry()
        .definitionIdentity(plan.driverId, profile);
      if (plan.metadata.definitionIdentity !== currentIdentity)
        return {
          allowed: false,
          reasons: [
            "The accepted profile definition changed; prepare the operation again.",
          ],
        };
    }
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
  /** Accepts a registered id, never a caller-supplied plan or test definition. */
  async sendRegisteredQuery(testId: string): Promise<ExecutionResult> {
    const catalog = this.ports.guidedTestCatalog();
    const availability = catalog
      .guidedTests()
      .find(({ test }) => test.id === testId);
    if (!availability?.available)
      throw new Error(availability?.reason ?? "Unknown registered test.");
    const test = catalog.guidedTest(testId);
    const plan = catalog.planGuidedTest(testId);
    if (test.risk !== "read-only" || test.persistence !== "none")
      throw new Error(
        "Registered query execution requires a read-only, non-persistent test.",
      );
    const capabilityId =
      SHARED_OPERATIONS[plan.operation.type as keyof typeof SHARED_OPERATIONS];
    if (
      capabilityId &&
      this.ports.identification().assessment().capabilities[capabilityId]
        .confidence === "experimental" &&
      !this.authority.experimentalTxEnabled
    )
      throw new Error(
        "Registered experimental query execution requires explicit per-session unlock.",
      );
    return this.executeAuthorized(
      plan,
      "diagnostic",
      null,
      this.evaluatePolicy(plan),
    );
  }
  async _execute(
    plan: TransmissionPlan,
    source: TransactionSource,
    diagnosticRunIdValue: string | null,
    onProgress?: (progress: ExecutionProgress) => void,
    onExecutionStarted?: () => void,
  ): Promise<ExecutionResult> {
    return this.executeAuthorized(
      plan,
      source,
      diagnosticRunIdValue,
      this.authorize(plan),
      onProgress,
      onExecutionStarted,
    );
  }
  private async executeAuthorized(
    plan: TransmissionPlan,
    source: TransactionSource,
    diagnosticRunIdValue: string | null,
    decision: PolicyDecision,
    onProgress?: (progress: ExecutionProgress) => void,
    onExecutionStarted?: () => void,
  ): Promise<ExecutionResult> {
    const session = this.ports.connection().getSession();
    const connectionId = this.ports.connection().getTransport().connectionId;
    const fingerprint = session.fingerprint;
    const geometryRevision = session.geometryRevision;
    const current = () =>
      session.source === "live" &&
      session.fingerprint === fingerprint &&
      session.geometryRevision === geometryRevision &&
      connectionId === this.ports.connection().getTransport().connectionId;
    const startedAt = new Date().toISOString();
    const notificationStart = this.ports
      .protocolEvidence()
      .getNotificationRouter().receiveSequence;
    const sessionSource = session.source;
    if (!decision.allowed || !decision.authorized)
      throw new Error(decision.reasons.join(" "));
    const driver = this.ports
      .identification()
      .getRegistry()
      .drivers.find(({ id }) => id === plan.driverId);
    if (!driver) throw new Error(`Driver ${plan.driverId} is unavailable.`);
    await this.ports.connection().enableDriverNotifications(driver);
    if (!current())
      throw new Error("The connection changed during notification setup.");
    // A stored-program display holds exactly one program. Every persistent
    // write replaces it, so the belief about what is on the panel is settled
    // HERE — the one path all of them go through — rather than in each
    // caller, where "Create → Send image" was silently exempt.
    const replacesStoredProgram =
      plan.risk === "persistent" || plan.persistence === "persistent";
    const staged = this.ports.investigation().getStagedPanelProgram();
    if (replacesStoredProgram)
      this.ports.investigation().setStagedPanelProgram(null);
    try {
      onExecutionStarted?.();
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
          current()
            ? notificationStart
            : this.ports.protocolEvidence().getNotificationRouter()
                .receiveSequence,
          source,
          diagnosticRunIdValue,
          null,
          sessionSource,
        );
      if (current()) session.recordCorrelatedResponse(result.responseRecord);
      if (current() && replacesStoredProgram) {
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
        current() &&
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
      if (current() && replacesStoredProgram) {
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
          current()
            ? notificationStart
            : this.ports.protocolEvidence().getNotificationRouter()
                .receiveSequence,
          source,
          diagnosticRunIdValue,
          errorMessage(error),
          sessionSource,
        );
      throw error;
    }
  }
  async probe(
    driverId?: string,
    probeId?: string,
    options: {
      readonly automatic?: boolean;
      readonly beforePlan?: () => void;
      readonly reserve?: (plan: PreparedTransmission) => void;
      readonly canAdopt?: () => boolean;
    } = {},
  ): Promise<FamilyProbeExecution> {
    const session = this.ports.connection().getSession();
    if (session.source !== "live")
      throw new Error(
        "Imported and replay sessions cannot perform live probes.",
      );
    const connectionId = this.ports.connection().getTransport().connectionId;
    const fingerprint = session.fingerprint;
    const selection = session.selection;
    const geometryRevision = session.geometryRevision;
    if (!fingerprint)
      throw new Error(
        "The requested probe driver is not available for this connection.",
      );
    if (!driverId || !probeId) {
      const steps = discoveryCatalog(
        this.ports.identification().getRegistry(),
        {
          fingerprint,
          endpoints: candidateEndpoints(fingerprint),
          source: session.source,
        },
      );
      const selected = nextDiscoveryStep(
        steps.filter((step) => !driverId || step.driverId === driverId),
        new Set(),
        new Set(steps.map((step) => step.driverId)),
      );
      if (!selected)
        throw new ProbeStageError(
          "blocked",
          "No eligible registered discovery check. Open Protocol workbench or review a profile.",
        );
      driverId = selected.driverId;
      probeId = selected.probeId;
    }
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
    // A repeated probe cannot replace already established reviewed or provisional geometry.
    const profile =
      session.selection?.selected?.id === driver.id && session.profile
        ? session.profile
        : driver.resolveProfile(fingerprint);
    session.geometryProposal = null;
    const candidateContext = {
      fingerprint,
      endpoints: candidateEndpoints(fingerprint),
      source: session.source,
    } as const;
    const familyProbes = driver.familyProbes?.(candidateContext) ?? [];
    const selectedProbeId = probeId;
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
    const authoredTools =
      driver
        .diagnosticTools?.()
        .filter(
          (tool) =>
            tool.workflow === "family-identification" &&
            tool.probeId === selectedProbeId,
        ) ?? [];
    if (
      (authoredTools.length > 0 &&
        authoredTools.every((tool) => !tool.available)) ||
      familyProbe?.discovery?.available === false
    )
      throw new ProbeStageError(
        "blocked",
        "The authored identification check is unavailable.",
      );
    if (
      options.automatic &&
      (!familyProbe?.discovery ||
        familyProbe.safety.hazard !== "routine" ||
        familyProbe.safety.assurance !== "verified" ||
        familyProbe.safety.persistence !== "none")
    )
      throw new ProbeStageError(
        "blocked",
        "This check needs experimental review; interview permission does not unlock it.",
      );
    options.beforePlan?.();
    const rawPlan = familyProbe
      ? familyProbe.plan(candidateContext)
      : profileProbe!.plan(profileContext!);
    const plan = prepareTransmission(
      {
        ...rawPlan,
        metadata: {
          ...rawPlan.metadata,
          definitionIdentity: this.ports
            .identification()
            .getRegistry()
            .definitionIdentity(driver.id, profile),
        },
      },
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
    if (
      options.automatic &&
      (plan.operation.type !== "GetDeviceInfo" ||
        plan.purpose !== "probe" ||
        plan.risk !== "read-only" ||
        plan.persistence !== "none" ||
        plan.validation !== "verified")
    )
      throw new ProbeStageError(
        "blocked",
        "Machine discovery permits only reviewed read-only information probes.",
      );
    if (
      !this.ports
        .protocolEvidence()
        .getNotificationRouter()
        .canSchedule(plan.responseExpectation)
    )
      throw new ProbeStageError("ambiguous", RESPONSE_AMBIGUITY_MESSAGE);
    const characteristic = (
      endpoint: import("../../core/device").GattEndpoint,
    ) =>
      fingerprint.services
        .find(
          (service) =>
            normalizeUuid(service.uuid) === normalizeUuid(endpoint.serviceUuid),
        )
        ?.characteristics.find(
          (item) =>
            normalizeUuid(item.uuid) ===
            normalizeUuid(endpoint.characteristicUuid),
        );
    if (
      plan.packets.some((packet) => {
        const properties = characteristic(packet.endpoint)?.properties;
        return packet.writeMode === "without-response"
          ? !properties?.writeWithoutResponse
          : !properties?.write;
      }) ||
      (plan.responseExpectation.type === "notification" &&
        plan.responseExpectation.endpoints.some((endpoint) => {
          const properties = characteristic(endpoint)?.properties;
          return !properties?.notify && !properties?.indicate;
        }))
    )
      throw new ProbeStageError(
        "access",
        "Required command or response endpoint access is missing. Inspect accessible services before retrying.",
      );
    options.reserve?.(plan);
    let decision = this.evaluatePolicy(plan);
    if (!decision.allowed || !decision.authorized)
      throw new ProbeStageError("blocked", decision.reasons.join(" "));
    try {
      await this.ports.connection().enableDriverNotifications(driver);
    } catch (error) {
      throw new ProbeStageError("access", errorMessage(error));
    }
    if (
      connectionId !== this.ports.connection().getTransport().connectionId ||
      session.fingerprint !== fingerprint ||
      session.selection !== selection ||
      session.geometryRevision !== geometryRevision
    )
      throw new ProbeStageError(
        "retired",
        "The probe belongs to a retired connection or changed target.",
      );
    const startedAt = new Date().toISOString();
    const notificationStart = this.ports
      .protocolEvidence()
      .getNotificationRouter().receiveSequence;
    const sessionSource = session.source;
    options.beforePlan?.();
    decision = this.evaluatePolicy(plan);
    if (!decision.allowed || !decision.authorized)
      throw new ProbeStageError("blocked", decision.reasons.join(" "));
    let result: ExecutionResult;
    let transaction: import("../../diagnostics/transactions").ProtocolTransaction;
    try {
      result = await this._executor.execute(decision.authorized, driver);
      transaction = this.ports
        .protocolEvidence()
        ._recordTransaction(
          decision.authorized.plan,
          result,
          startedAt,
          connectionId === this.ports.connection().getTransport().connectionId
            ? notificationStart
            : this.ports.protocolEvidence().getNotificationRouter()
                .receiveSequence,
          "probe",
          null,
          null,
          sessionSource,
        );
    } catch (error) {
      const failedTransaction = this.ports
        .protocolEvidence()
        ._recordTransaction(
          decision.authorized.plan,
          null,
          startedAt,
          connectionId === this.ports.connection().getTransport().connectionId
            ? notificationStart
            : this.ports.protocolEvidence().getNotificationRouter()
                .receiveSequence,
          "probe",
          null,
          errorMessage(error),
          sessionSource,
        );
      throw new ProbeStageError(
        connectionId !== this.ports.connection().getTransport().connectionId ||
          session.fingerprint !== fingerprint
          ? "retired"
          : "transport",
        errorMessage(error),
        failedTransaction.id,
      );
    }
    const interpretation = result.responseAmbiguous
      ? {
          matched: false as const,
          reason: result.responseRecord?.interpretationAmbiguous
            ? "Multiple valid decoder interpretations remain; identity was not established. Review the exact evidence in Protocol workbench."
            : RESPONSE_AMBIGUITY_MESSAGE,
        }
      : familyProbe
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
    if (
      connectionId !== this.ports.connection().getTransport().connectionId ||
      session.fingerprint !== fingerprint ||
      session.selection !== selection ||
      session.geometryRevision !== geometryRevision
    )
      throw new ProbeStageError(
        "retired",
        "The probe belongs to a retired connection or changed target.",
        transaction.id,
      );
    const normalized: import("../../drivers/types").IdentificationResult =
      interpretation?.matched
        ? {
            matched: true,
            confidence: interpretation.confidence,
            summary: interpretation.summary,
          }
        : interpretation && "reason" in interpretation
          ? interpretation
          : { matched: false, reason: "Unmapped interpretation." };
    const interpretedOutcome = machineOutcome(result, normalized);
    const outcome =
      interpretedOutcome === "rejected" &&
      !normalized.matched &&
      normalized.rejection &&
      !(familyProbe?.discovery?.distinguishes ?? [driver.id]).includes(
        normalized.rejection.driverId,
      )
        ? "inconclusive"
        : interpretedOutcome;
    const identified = outcome === "identified" && normalized.matched;
    if (identified && (options.canAdopt?.() ?? true)) {
      session.recordCorrelatedResponse(result.responseRecord);
      this.ports
        .identification()
        ._resolveProtocol(
          driver,
          profile,
          selectedProbeId ?? familyProbe?.id ?? profileProbe!.id,
          normalized.matched ? normalized.summary : "",
          "live-probe",
        );
      if (transaction && !result.responseTimedOut && result.response)
        this.ports
          .identification()
          ._proposeGeometry(driver, transaction, connectionId!);
    } else
      this.ports
        .protocolEvidence()
        .getTrace()
        .record("protocol.probe.rejected", {
          driverId: driver.id,
          probeId: selectedProbeId ?? "unknown",
          responseTimedOut: result.responseTimedOut,
        });
    return {
      ...result,
      transactionId: transaction.id,
      outcome,
      identification: {
        ...(identified && interpretation?.matched
          ? {
              matched: true as const,
              confidence: interpretation.confidence,
              summary: interpretation.summary,
            }
          : {
              matched: false as const,
              ...(interpretation && "rejection" in interpretation
                ? { rejection: interpretation.rejection }
                : {}),
              reason:
                interpretation && "reason" in interpretation
                  ? interpretation.reason
                  : "No family match was established by this probe.",
            }),
        driverId: driver.id,
        probeId: selectedProbeId ?? "unknown",
        family: driver.family,
      },
    };
  }
}
