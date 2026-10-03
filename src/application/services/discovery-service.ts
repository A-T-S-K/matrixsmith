import { executeReviewedRead } from "./reviewed-read-service";
import { transactionId as newTransactionId } from "../../diagnostics/transactions";
import type { ReadDiscoveryStep } from "./discovery-planner";
import type { ConnectionService } from "./connection-service";
import type { IdentificationService } from "./identification-service";
import type { TransmissionService } from "./transmission-service";
import type { ProtocolEvidenceService } from "./protocol-evidence-service";
import { candidateEndpoints } from "./runtime-support";
import { fingerprintIdentityKey } from "../../investigation/device-identity";
import {
  discoveryCatalog,
  nextDiscoveryStep,
  type DiscoveryStep,
} from "./discovery-planner";
import { ProbeStageError, type MachineOutcomeKind } from "../discovery-outcome";

/** Small read-only interview: at most four fixed checks, no retries or budget refill. */
export const DISCOVERY_LIMITS = Object.freeze({
  attempts: 4,
  packets: 8,
  reads: 4,
  bytes: 2048,
  elapsedMs: 30_000,
});
export interface DiscoveryAttempt {
  readonly stepId: string;
  readonly definitionIdentity: string;
  readonly connectionId: string;
  readonly connectionGeneration: number;
  readonly fingerprintKey: string;
  readonly transactionId: string | null;
  readonly responseSequence: number | null;
  readonly outcome: MachineOutcomeKind;
  readonly summary: string;
  readonly sources: readonly string[];
  readonly readValue?: {
    readonly timestamp: string;
    readonly source: "live";
    readonly pixels: readonly number[];
    readonly hex: string;
    readonly interpretation: string;
  };
  readonly failureStage?:
    "authorization" | "read" | "deadline" | "value" | "ownership";
}
export interface DiscoveryHypothesis {
  readonly driverId: string;
  readonly support: readonly string[];
  readonly contradictions: readonly {
    stepId: string;
    configurationId?: string;
    summary: string;
  }[];
  readonly unanswered: readonly string[];
}
export interface DiscoveryState {
  readonly pendingRead: boolean;
  readonly status: "running" | "stopping" | "complete" | "retired";
  readonly question: string | null;
  readonly summary: string;
  readonly terminal:
    | "service-observed"
    | "geometry"
    | "dimensions"
    | "configuration"
    | "multiple"
    | "access"
    | "review"
    | "interrupted"
    | "no-check"
    | "budget"
    | null;
  readonly attempts: readonly DiscoveryAttempt[];
  readonly hypotheses: readonly DiscoveryHypothesis[];
  readonly steps: readonly DiscoveryStep[];
  readonly remaining: {
    readonly attempts: number;
    readonly packets: number;
    readonly reads: number;
    readonly bytes: number;
    readonly elapsedMs: number;
  };
}
interface Ports {
  connection(): Pick<
    ConnectionService,
    | "getSession"
    | "getTransport"
    | "getConnectionGeneration"
    | "read"
    | "pendingGattOperation"
  >;
  identification(): Pick<
    IdentificationService,
    "getRegistry" | "geometryProposal" | "_resolveProtocol" | "_proposeGeometry"
  >;
  transmission(): Pick<TransmissionService, "probe" | "executionBusy">;
  evidence(): Pick<
    ProtocolEvidenceService,
    "getTrace" | "getTransactions" | "editTransactions"
  >;
}
export class DiscoveryService {
  private state: DiscoveryState | null = null;
  private owned = false;
  private pendingRead: object | null = null;
  private runGeneration = 0;
  /** Called only after explicit transport disconnect has completed. Old work may settle as evidence. */
  connectionRetired(): void {
    if (!this.pendingRead) return;
    this.pendingRead = null;
    this.owned = false;
    this.publish({ pendingRead: false });
  }
  private stopped = false;
  private disposed = false;
  private adopting = false;
  private binding: (() => boolean) | null = null;
  constructor(private readonly ports: Ports) {}
  get busy() {
    return this.owned;
  }
  snapshot(): DiscoveryState | null {
    if (
      this.state &&
      this.binding &&
      !this.adopting &&
      !this.binding() &&
      this.state.status !== "retired"
    )
      this.retire();
    return this.state;
  }
  private publish(patch: Partial<DiscoveryState>): void {
    if (!this.state) return;
    this.state = { ...this.state, ...patch };
    this.ports.evidence().getTrace().record("discovery.progress", {
      status: this.state.status,
      completed: this.state.attempts.length,
    });
  }
  stop(): void {
    if (!this.owned) return;
    this.stopped = true;
    this.publish({
      status: "stopping",
      summary:
        "Stopping. The dispatched check is still supervised until it settles.",
    });
  }
  retire(): void {
    this.stopped = true;
    this.publish({
      status: "retired",
      terminal: "interrupted",
      question: null,
      summary:
        "Setup retired because the display context changed. Review the connection before starting again, after any pending check settles.",
    });
  }
  dispose(): void {
    this.disposed = true;
    this.retire();
  }
  async start(): Promise<void> {
    if (this.owned)
      throw new Error(
        "Display setup owns the current execution. Wait for it to settle.",
      );
    if (
      this.ports.connection().pendingGattOperation ||
      this.ports.transmission().executionBusy
    )
      throw new Error(
        "Another GATT operation owns execution. Wait for it to settle before setup.",
      );
    const session = this.ports.connection().getSession();
    const transport = this.ports.connection().getTransport();
    const fingerprint = session.fingerprint;
    const connectionId = transport.connectionId;
    const connectionGeneration = this.ports
      .connection()
      .getConnectionGeneration();
    if (
      this.disposed ||
      session.source !== "live" ||
      transport.state !== "connected" ||
      !fingerprint ||
      !connectionId
    )
      throw new Error(
        "Connect a live display before setup. Imported and historical evidence cannot authorize discovery.",
      );
    const runGeneration = ++this.runGeneration;
    const registry = this.ports.identification().getRegistry();
    const revision = session.geometryRevision;
    let profile = session.profile;
    let selection = session.selection;
    const fingerprintKey = fingerprintIdentityKey(fingerprint);
    this.binding = () =>
      !this.disposed &&
      transport.state === "connected" &&
      transport.connectionId === connectionId &&
      this.ports.connection().getConnectionGeneration() ===
        connectionGeneration &&
      session.source === "live" &&
      session.fingerprint === fingerprint &&
      session.geometryRevision === revision &&
      session.profile === profile &&
      session.selection === selection &&
      registry === this.ports.identification().getRegistry();
    const binding = this.binding;
    const current = () => runGeneration === this.runGeneration && binding();
    const steps = discoveryCatalog(registry, {
      fingerprint,
      source: session.source,
      endpoints: candidateEndpoints(fingerprint),
    }).slice(0, 32);
    this.stopped = false;
    this.owned = true;
    const started = Date.now();
    const exhausted = new Set<string>();
    const completed = new Set<string>();
    const candidates = new Set(
      registry.drivers
        .filter((driver) => driver.match(fingerprint).score > 0)
        .map((driver) => driver.id),
    );
    this.state = {
      pendingRead: false,
      status: "running",
      question: null,
      terminal: null,
      summary:
        "Reviewing accessible evidence and registered read-only checks. Displayed content is retained.",
      attempts: [],
      steps,
      remaining: { ...DISCOVERY_LIMITS },
      hypotheses: [...candidates].sort().map((driverId) => ({
        driverId,
        support: [],
        contradictions: [],
        unanswered: steps
          .filter((step) => step.metadata.distinguishes.includes(driverId))
          .map((step) => step.metadata.question),
      })),
    };
    this.publish({});
    const deadline = setTimeout(() => {
      if (!this.owned || this.stopped) return;
      this.stopped = true;
      this.publish({
        status: "stopping",
        terminal: "budget",
        summary:
          "Elapsed setup budget reached. No further check will run; the pending browser operation remains supervised until it settles.",
      });
    }, DISCOVERY_LIMITS.elapsedMs);
    try {
      while (!this.stopped && current()) {
        const step = nextDiscoveryStep(steps, exhausted, candidates, completed);
        if (!step) {
          const review = steps.some(
            (item) => item.blocked === "review" && !exhausted.has(item.id),
          );
          const access = steps.find(
            (item) => item.kind === "characteristic-read" && item.blocked,
          );
          this.finish(
            access
              ? "access"
              : review
                ? "review"
                : candidates.size > 1 && this.state.attempts.length > 0
                  ? "multiple"
                  : "no-check",
            access?.kind === "characteristic-read"
              ? access.accessReason!
              : review
                ? "Experimental review needed. Setup does not grant or restore experimental permission."
                : candidates.size > 1 && this.state.attempts.length > 0
                  ? "Multiple candidates remain. No further registered check can answer this question. Review candidates in Protocol workbench or export a report; this does not mean the display is unsupported."
                  : "No further registered check can answer this question. Review candidates in Protocol workbench or export a report; this does not mean the display is unsupported.",
          );
          break;
        }
        const remaining = this.state.remaining;
        if (
          remaining.attempts < 1 ||
          (step.kind === "characteristic-read" &&
            remaining.reads < step.read.cost.reads) ||
          remaining.packets < step.metadata.cost.packets ||
          remaining.bytes < step.metadata.cost.bytes ||
          remaining.elapsedMs < step.metadata.cost.elapsedMs ||
          Date.now() - started + step.metadata.cost.elapsedMs >
            DISCOVERY_LIMITS.elapsedMs
        ) {
          this.finish(
            "budget",
            "The bounded setup budget is exhausted. Review the partial evidence before starting another session.",
          );
          break;
        }
        exhausted.add(step.id);
        this.publish({
          question: step.metadata.question,
          remaining: { ...remaining, attempts: remaining.attempts - 1 },
        });
        if (step.kind === "characteristic-read") {
          await this.runRead(
            step,
            registry,
            () => !this.stopped && current(),
            remaining,
            connectionId,
            connectionGeneration,
            fingerprintKey,
          );
          if (runGeneration !== this.runGeneration) return;
          break;
        }
        let outcome: MachineOutcomeKind;
        let summary: string;
        let transactionId: string | null = null;
        let responseSequence: number | null = null;
        let sources: readonly string[] = [];
        let rejection:
          { driverId: string; configurationId?: string } | undefined;
        try {
          const result = await this.ports
            .transmission()
            .probe(step.driverId, step.probeId, {
              automatic: true,
              beforePlan: () => {
                if (this.stopped || !current())
                  throw new ProbeStageError(
                    "retired",
                    "Setup was stopped or retired before planning.",
                  );
              },
              reserve: (plan) => {
                sources = plan.evidenceRefs.slice(0, 16);
                if (
                  plan.metadata.definitionIdentity !== step.definitionIdentity
                )
                  throw new ProbeStageError(
                    "retired",
                    "The selected discovery definition changed before execution.",
                  );
                const packets = plan.packets.length;
                const bytes = plan.packets.reduce(
                  (sum, packet) => sum + packet.bytes.length,
                  0,
                );
                const elapsedMs =
                  packets * plan.timeoutMs +
                  plan.packets.reduce(
                    (sum, packet) => sum + (packet.delayAfterMs ?? 0),
                    0,
                  ) +
                  (plan.responseExpectation.type === "none"
                    ? 0
                    : plan.responseExpectation.timeoutMs);
                if (
                  packets > step.metadata.cost.packets ||
                  bytes > step.metadata.cost.bytes ||
                  elapsedMs > step.metadata.cost.elapsedMs ||
                  Date.now() - started + elapsedMs > DISCOVERY_LIMITS.elapsedMs
                )
                  throw new ProbeStageError(
                    "blocked",
                    "Compiled check exceeds its reviewed bounds or remaining elapsed budget.",
                  );
                this.publish({
                  remaining: {
                    ...this.state!.remaining,
                    packets: remaining.packets - packets,
                    bytes: remaining.bytes - bytes,
                    elapsedMs: remaining.elapsedMs - elapsedMs,
                  },
                });
              },
              canAdopt: () => false,
            });
          outcome = result.outcome;
          summary = result.identification.matched
            ? result.identification.summary
            : result.identification.reason;
          transactionId = result.transactionId;
          responseSequence = result.responseRecord?.receiveSequence ?? null;
          rejection = !result.identification.matched
            ? result.identification.rejection
            : undefined;
          // Adoption belongs to the existing identification owner, after stop/context checks.
          if (
            outcome === "identified" &&
            result.identification.matched &&
            !this.stopped &&
            current() &&
            step.metadata.stopping === "identity" &&
            !this.state.hypotheses.some(
              (hypothesis) =>
                hypothesis.driverId !== step.driverId &&
                hypothesis.support.length > 0,
            )
          ) {
            this.adopting = true;
            session.recordCorrelatedResponse(result.responseRecord);
            const driver = registry.drivers.find(
              (driver) => driver.id === step.driverId,
            )!;
            this.ports
              .identification()
              ._resolveProtocol(
                driver,
                driver.resolveProfile(fingerprint),
                step.probeId,
                result.identification.summary,
                "live-probe",
              );
            const transaction = this.ports
              .evidence()
              .getTransactions()
              .find((transaction) => transaction.id === transactionId);
            if (transaction)
              this.ports
                .identification()
                ._proposeGeometry(driver, transaction, connectionId);
            profile = session.profile;
            selection = session.selection;
            this.adopting = false;
          }
        } catch (error) {
          this.adopting = false;
          outcome =
            error instanceof ProbeStageError ? error.kind : "inconclusive";
          summary = error instanceof Error ? error.message : String(error);
          transactionId =
            error instanceof ProbeStageError ? error.transactionId : null;
        }
        if (!current() && this.state.status !== "retired") this.retire();
        const attempt: DiscoveryAttempt = {
          stepId: step.id,
          definitionIdentity: step.definitionIdentity,
          connectionId,
          connectionGeneration,
          fingerprintKey,
          transactionId,
          responseSequence,
          sources,
          outcome,
          summary,
        };
        this.publish({
          attempts: [...this.state.attempts, attempt],
          hypotheses: this.state.hypotheses.map((hypothesis) => ({
            ...hypothesis,
            support:
              outcome === "identified" && hypothesis.driverId === step.driverId
                ? [...hypothesis.support, step.id]
                : hypothesis.support,
            contradictions:
              outcome === "rejected" &&
              rejection?.driverId === hypothesis.driverId &&
              step.metadata.distinguishes.includes(rejection.driverId)
                ? [
                    ...hypothesis.contradictions,
                    {
                      stepId: step.id,
                      configurationId: rejection.configurationId,
                      summary,
                    },
                  ]
                : hypothesis.contradictions,
            unanswered:
              (outcome === "identified" &&
                hypothesis.driverId === step.driverId) ||
              (outcome === "rejected" &&
                rejection?.driverId === hypothesis.driverId &&
                !rejection.configurationId &&
                step.metadata.distinguishes.includes(rejection.driverId))
                ? hypothesis.unanswered.filter(
                    (question) => question !== step.metadata.question,
                  )
                : hypothesis.unanswered,
          })),
        });
        if (
          outcome === "rejected" &&
          rejection &&
          !rejection.configurationId &&
          step.metadata.distinguishes.includes(rejection.driverId)
        )
          candidates.delete(rejection.driverId);
        if (outcome === "identified" || outcome === "rejected")
          completed.add(step.id);
        if (this.stopped || !current()) break;
        if (outcome === "identified" && step.metadata.stopping === "identity") {
          if (
            this.state.hypotheses.filter(
              (hypothesis) => hypothesis.support.length > 0,
            ).length > 1
          ) {
            this.finish(
              "multiple",
              "Multiple reviewed family interpretations remain. No family or geometry was adopted. Review the correlated checks in Protocol workbench.",
            );
            break;
          }
          this.finish(
            this.ports.identification().geometryProposal()
              ? "geometry"
              : profile
                ? "configuration"
                : "dimensions",
            this.ports.identification().geometryProposal()
              ? "Family identified. Sourced dimensions are available for explicit review. Physical capabilities remain unverified."
              : profile
                ? "Profile/configuration described. Physical capabilities remain unverified."
                : "Family identified; dimensions are still needed. Physical capabilities remain unverified.",
          );
          break;
        }
        if (
          outcome === "access" ||
          outcome === "transport" ||
          outcome === "retired"
        ) {
          this.finish(
            outcome === "access" ? "access" : "interrupted",
            outcome === "access"
              ? "Response access/setup failed. Review accessible services in Protocol workbench before trying again."
              : "Setup interrupted. Reconnect before any further check; there is no automatic retry.",
          );
          break;
        }
      }
      if (this.state.status === "running" || this.state.status === "stopping")
        this.finish(
          this.state.terminal === "budget" ? "budget" : "interrupted",
          this.state.terminal === "budget"
            ? "Elapsed setup budget reached. The pending attempt has settled; review partial evidence before starting again."
            : "Setup stopped. The dispatched attempt has settled and its evidence is retained. Start again only with explicit intent.",
        );
    } finally {
      clearTimeout(deadline);
      if (runGeneration === this.runGeneration) {
        this.owned = this.pendingRead !== null;
        this.publish({ question: null });
      }
    }
  }
  private async runRead(
    step: ReadDiscoveryStep,
    registry: ReturnType<
      Ports["identification"]
    >["getRegistry"] extends () => infer R
      ? R
      : never,
    current: () => boolean,
    remaining: DiscoveryState["remaining"],
    connectionId: string,
    connectionGeneration: number,
    fingerprintKey: string,
  ): Promise<void> {
    const runGeneration = this.runGeneration;
    const transactionId = newTransactionId("read");
    const token = {};
    let dispatched = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: MachineOutcomeKind;
    let summary: string;
    let failureStage: DiscoveryAttempt["failureStage"];
    let readValue: DiscoveryAttempt["readValue"];
    let terminalFindings: readonly string[] | null = null;
    const annotate = () => {
      if (!terminalFindings) return;
      this.ports.evidence().editTransactions((transactions) => {
        const index = transactions.findIndex((t) => t.id === transactionId);
        if (index >= 0)
          transactions[index] = {
            ...transactions[index]!,
            findings: [...transactions[index]!.findings, ...terminalFindings!],
          };
      });
    };
    try {
      const work = executeReviewedRead(
        this.ports.connection(),
        registry,
        step.read,
        step.definitionIdentity,
        {
          current,
          reserve: () => {
            if (
              this.state!.remaining.reads < step.read.cost.reads ||
              this.state!.remaining.bytes < step.read.cost.bytes ||
              this.state!.remaining.elapsedMs < step.read.cost.elapsedMs
            )
              throw new ProbeStageError(
                "blocked",
                "Reviewed read budget exhausted.",
              );
            this.publish({
              remaining: {
                ...this.state!.remaining,
                reads: remaining.reads - step.read.cost.reads,
                bytes: remaining.bytes - step.read.cost.bytes,
                elapsedMs: remaining.elapsedMs - step.read.cost.elapsedMs,
              },
            });
            dispatched = true;
            this.pendingRead = token;
            this.publish({ pendingRead: true });
          },
        },
        transactionId,
      );
      const supervised = work
        .then(
          (bytes) => ({ bytes }),
          (error) => ({ error }),
        )
        .finally(() => {
          annotate();
          if (this.pendingRead === token) {
            this.pendingRead = null;
            this.publish({ pendingRead: false });
            if (
              this.state?.status !== "running" &&
              this.state?.status !== "stopping"
            )
              this.owned = false;
          }
        });
      const result = await Promise.race([
        supervised,
        new Promise<{ timeout: true }>((resolve) => {
          timer = setTimeout(
            () => resolve({ timeout: true }),
            step.read.timeoutMs,
          );
        }),
      ]);
      if ("timeout" in result) {
        outcome = "timeout";
        failureStage = "deadline";
        summary =
          "Read deadline reached. The browser operation may still be pending; its cancellation is unconfirmed. Disconnect to retire this connection before reconnecting. No automatic retry; protocol support remains unknown.";
      } else if (
        !current() ||
        `${step.read.definitionIdentity}/${registry.definitionIdentity(step.driverId, null)}` !==
          step.definitionIdentity
      ) {
        outcome = "retired";
        failureStage = "ownership";
        summary =
          "Read evidence belongs to a stopped or replaced context. No current value was adopted.";
      } else if ("error" in result) {
        outcome = "transport";
        failureStage = "read";
        summary =
          "Characteristic read failed. Browser access, firmware security and connection causes remain ambiguous. Disconnect and review access before retrying explicitly.";
      } else {
        // Reject bounds before decoder or preview allocation. Raw bounded evidence is already recorded.
        const decoded =
          result.bytes.length === step.read.valueBytes
            ? step.read.decode(result.bytes)
            : {
                conforming: false,
                pixels: [],
                summary:
                  "Malformed LED Matrix State length; expected exactly five bytes. Raw evidence retained. Review firmware applicability before retrying.",
              };
        summary = decoded.summary;
        outcome = decoded.conforming ? "service-observed" : "inconclusive";
        if (decoded.conforming) {
          const transaction = this.ports
            .evidence()
            .getTransactions()
            .find((t) => t.id === transactionId)!;
          readValue = {
            timestamp: transaction.completedAt,
            source: "live",
            pixels: decoded.pixels,
            hex: transaction.packets[0]!.hex,
            interpretation: step.read.interpretation,
          };
        } else failureStage = "value";
      }
    } catch (error) {
      outcome = error instanceof ProbeStageError ? error.kind : "inconclusive";
      failureStage = "authorization";
      summary = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
    terminalFindings = [
      `Reviewed read outcome: ${outcome}. Failure stage: ${failureStage ?? "none"}.`,
      summary,
    ];
    annotate();
    if (runGeneration !== this.runGeneration) return;
    if (!current() && this.state!.status !== "retired") this.retire();
    this.publish({
      attempts: [
        ...this.state!.attempts,
        {
          stepId: step.id,
          definitionIdentity: step.definitionIdentity,
          connectionId,
          connectionGeneration,
          fingerprintKey,
          transactionId: dispatched ? transactionId : null,
          responseSequence: null,
          sources: step.read.sources,
          outcome,
          summary,
          failureStage,
          readValue,
        },
      ],
    });
    if (this.state!.status !== "retired")
      this.finish(
        outcome === "service-observed"
          ? "service-observed"
          : outcome === "access"
            ? "access"
            : "interrupted",
        summary,
      );
  }
  private finish(terminal: DiscoveryState["terminal"], summary: string): void {
    this.publish({ status: "complete", terminal, question: null, summary });
  }
}
