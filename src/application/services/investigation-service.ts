import {
  emptyOrchestration,
  invalidatePanelProgram,
  UNKNOWN_PANEL_PROGRAM,
  type InvestigationOrchestration,
  type PanelProgramState,
} from "../../investigation/orchestration";
import {
  resolveClaims,
  resolveOperationalTrust,
  type ClaimEvidence,
  type ClaimState,
  type OperationalTrust,
} from "../../investigation/claims";
import {
  createInvestigation,
  demoteInvestigationEvidence,
  resumeInvestigation,
  stopInvestigation,
  withOrchestration,
  type Investigation,
  type InvestigationGoal,
} from "../../investigation/investigation";
import {
  bindingAllowsSessionContinuity,
  deviceIdentityBinding,
} from "../../investigation/device-identity";
import {
  evaluateStaticViability,
  type StaticViabilityAssessment,
} from "../../investigation/static-viability";

import type { ConnectionService } from "./connection-service";
import type { ProtocolEvidenceService } from "./protocol-evidence-service";
interface Ports {
  connection(): Pick<
    ConnectionService,
    "setConnectionEpoch" | "getConnectionEpoch" | "getSession"
  >;
  protocolEvidence(): Pick<ProtocolEvidenceService, "getTrace">;
}
export class InvestigationService {
  private _investigation: Investigation | null = null;
  private _stagedPanelProgram: PanelProgramState | null = null;
  private _unownedPanelProgram: PanelProgramState | null = null;
  private _detachedInvestigation: Investigation | null = null;
  private _investigationEpoch = -1;

  constructor(private readonly ports: Ports) {}
  setStagedPanelProgram(
    value: InvestigationService["_stagedPanelProgram"],
  ): void {
    this._stagedPanelProgram = value;
  }
  getInvestigation() {
    return this._investigation;
  }
  setInvestigation(value: InvestigationService["_investigation"]): void {
    this._investigation = value;
  }
  setInvestigationEpoch(
    value: InvestigationService["_investigationEpoch"],
  ): void {
    this._investigationEpoch = value;
  }
  getStagedPanelProgram() {
    return this._stagedPanelProgram;
  }
  _reconcileDeviceBoundary(): void {
    const session = this.ports.connection().getSession();
    this.ports
      .connection()
      .setConnectionEpoch(this.ports.connection().getConnectionEpoch() + 1);
    const current = deviceIdentityBinding(
      session.fingerprint,
      session.profile?.id ?? null,
    );
    const investigation = this._investigation;
    if (investigation) {
      if (
        session.source === "live" &&
        bindingAllowsSessionContinuity(investigation.deviceBinding, current)
      ) {
        // Same browser-authorized physical device reconnected: the
        // investigation resumes with its evidence and its whole orchestration
        // history intact. What is CURRENTLY on the panel is a different
        // question — the link dropped, and nothing in this session has
        // observed the display since.
        this._investigationEpoch = this.ports.connection().getConnectionEpoch();
        this._invalidatePanelProgram(
          "The display reconnected; what it is showing now was not observed across the disconnect.",
        );
        this.ports
          .protocolEvidence()
          .getTrace()
          .record("investigation.device-resumed", {
            id: investigation.id,
          });
      } else {
        // The investigation detaches and takes its ENTIRE orchestration
        // history with it — experiments, attempts, transfers, reopen state,
        // recommendation trail. A different physical display starts with
        // nothing: same-model is not same-unit, and inheriting one panel's
        // execution history would let it speak for another's.
        this._investigation = null;
        this._detachedInvestigation = stopInvestigation(
          demoteInvestigationEvidence(investigation, "previous-local-session"),
        );
        this.ports
          .protocolEvidence()
          .getTrace()
          .record("investigation.device-detached", {
            id: investigation.id,
            experiments: investigation.orchestration?.experiments.length ?? 0,
          });
      }
    }
    // Nothing staged for, or believed about, a previous connection may
    // describe this one.
    this._stagedPanelProgram = null;
    this._unownedPanelProgram = null;
  }
  takeDetachedInvestigation(): Investigation | null {
    const detached = this._detachedInvestigation;
    this._detachedInvestigation = null;
    return detached;
  }
  get investigation(): Investigation | null {
    return this._investigation;
  }
  get orchestration(): InvestigationOrchestration {
    return this._investigation?.orchestration ?? emptyOrchestration();
  }
  _updateOrchestration(
    mutate: (current: InvestigationOrchestration) => InvestigationOrchestration,
  ): void {
    const investigation = this._investigation;
    if (!investigation) return;
    const current = investigation.orchestration ?? emptyOrchestration();
    this._investigation = withOrchestration(investigation, mutate(current));
  }
  panelProgram(): PanelProgramState {
    return (
      this._investigation?.orchestration?.panelProgram ??
      this._unownedPanelProgram ??
      UNKNOWN_PANEL_PROGRAM
    );
  }
  _setPanelProgram(state: PanelProgramState): void {
    if (this._investigation)
      this._updateOrchestration((current) => ({
        ...current,
        panelProgram: state,
      }));
    else this._unownedPanelProgram = state;
  }
  _invalidatePanelProgram(reason: string): void {
    if (this._investigation)
      this._updateOrchestration((current) => ({
        ...current,
        panelProgram: invalidatePanelProgram(current.panelProgram, reason),
      }));
    else if (this._unownedPanelProgram)
      this._unownedPanelProgram = invalidatePanelProgram(
        this._unownedPanelProgram,
        reason,
      );
  }
  baselineClaimEvidence(): readonly ClaimEvidence[] {
    const session = this.ports.connection().getSession();
    const driver = session.selection?.selected;
    const profile = session.profile;
    const shipped =
      driver?.claimEvidence && profile ? driver.claimEvidence(profile) : [];
    return shipped;
  }
  allClaimEvidence(): readonly ClaimEvidence[] {
    return [
      ...this.baselineClaimEvidence(),
      ...(this._investigation?.claimEvidence ?? []),
    ];
  }
  claims(): readonly ClaimState[] {
    return resolveClaims(this.allClaimEvidence());
  }
  operationalTrust(): readonly OperationalTrust[] {
    return resolveOperationalTrust(this.allClaimEvidence());
  }
  staticViability(): StaticViabilityAssessment {
    return evaluateStaticViability(this.allClaimEvidence());
  }
  profileReady(): boolean {
    const session = this.ports.connection().getSession();
    if (!session.selection?.selected || !session.profile) return false;
    return this.staticViability().selected !== null;
  }
  startInvestigation(goal: InvestigationGoal): Investigation {
    const session = this.ports.connection().getSession();
    // An active investigation is retargeted, never discarded: troubleshooting
    // keeps every completed test and claim as evidence toward the new goal.
    // Retargeting requires the investigation to still belong to THIS physical
    // device session; _reconcileDeviceBoundary maintains that invariant on
    // every connect, and the epoch check enforces it defensively here.
    if (
      this._investigation &&
      this._investigation.status === "active" &&
      this._investigationEpoch === this.ports.connection().getConnectionEpoch()
    ) {
      this._investigation = {
        ...this._investigation,
        goal,
        updatedAt: new Date().toISOString(),
      };
    } else {
      if (this._investigation)
        this._detachedInvestigation = stopInvestigation(
          demoteInvestigationEvidence(
            this._investigation,
            "previous-local-session",
          ),
        );
      // A new investigation begins with empty orchestration and no claim
      // about the panel: whatever the previous one established belongs to it.
      this._stagedPanelProgram = null;
      this._unownedPanelProgram = null;
      this._investigation = createInvestigation({
        profileId: session.profile?.id ?? null,
        deviceName: session.fingerprint?.name ?? null,
        deviceBinding: deviceIdentityBinding(
          session.fingerprint,
          session.profile?.id ?? null,
        ),
        goal,
      });
      this._investigationEpoch = this.ports.connection().getConnectionEpoch();
    }
    this.ports
      .protocolEvidence()
      .getTrace()
      .record("investigation.started", {
        goal: goal.kind,
        symptom: goal.symptomId ?? null,
      });
    return this._investigation;
  }
  ensureInvestigation(): Investigation {
    if (!this._investigation || this._investigation.status === "stopped") {
      if (
        this._investigation?.status === "stopped" &&
        this._investigationEpoch ===
          this.ports.connection().getConnectionEpoch()
      )
        this._investigation = resumeInvestigation(this._investigation);
      else
        this.startInvestigation({
          kind: "develop",
          description: "Characterize and develop support for this display.",
        });
    }
    return this._investigation!;
  }
  stopActiveInvestigation(): Investigation | null {
    if (this._investigation && this._investigation.status === "active")
      this._investigation = stopInvestigation(this._investigation);
    return this._investigation;
  }
  adoptInvestigation(investigation: Investigation): void {
    const session = this.ports.connection().getSession();
    const current = deviceIdentityBinding(
      session.fingerprint,
      session.profile?.id ?? null,
    );
    const demoted = demoteInvestigationEvidence(
      investigation,
      "previous-local-session",
    );
    // Orchestration is an execution history of ONE physical display: run ids,
    // attempt numbering, transfers, what is believed to be on the panel. If
    // the record was made on a different unit — same model, same profile, a
    // different display — resuming it here would let that unit's history
    // continue accumulating against this one. The evidence stays as demoted
    // history; the execution state does not come across.
    const sameDevice = bindingAllowsSessionContinuity(
      investigation.deviceBinding,
      current,
    );
    const rebound: Investigation = {
      ...demoted,
      deviceBinding: current ?? investigation.deviceBinding,
      orchestration: sameDevice ? demoted.orchestration : emptyOrchestration(),
    };
    this._investigation = resumeInvestigation(rebound);
    this._investigationEpoch = this.ports.connection().getConnectionEpoch();
    this._stagedPanelProgram = null;
    this._unownedPanelProgram = null;
    this.ports
      .protocolEvidence()
      .getTrace()
      .record("investigation.resumed", {
        id: investigation.id,
        completedTests: investigation.completedTests.length,
        sameAuthorizedDevice: sameDevice,
        orchestrationCarried: sameDevice
          ? (investigation.orchestration?.experiments.length ?? 0)
          : 0,
      });
  }
}
