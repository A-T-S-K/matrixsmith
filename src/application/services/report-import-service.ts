import type { ManualObservation } from "../../core/evidence";

import {
  createDiagnosticBundle,
  notificationPacketsFromBundle,
  parseDiagnosticBundle,
  serializeDiagnosticBundle,
  type BundlePrivacy,
  type DiagnosticBundle,
} from "../../diagnostics/bundle";

import {
  findImporter,
  type ImportedEvidence,
} from "../../diagnostics/importers";

import { demoteInvestigationEvidence } from "../../investigation/investigation";
import {
  generateForensicAppendix,
  generateInvestigationReport,
  generateTestReport,
} from "../../investigation/reports";
import { MATRIXSMITH_VERSION } from "../version";

import type { ConnectionService } from "./connection-service";
import type { InvestigationService } from "./investigation-service";
import type { GuidedTestCatalogService } from "./guided-test-catalog-service";
import type { ProtocolEvidenceService } from "./protocol-evidence-service";
import type { GuidedOrchestrationService } from "./guided-orchestration-service";
import type { DiagnosticsService } from "./diagnostics-service";
import type { IdentificationService } from "./identification-service";
interface Ports {
  connection(): Pick<
    ConnectionService,
    "getSession" | "getTransport" | "getConnectionEpoch" | "patchSession"
  >;
  investigation(): Pick<
    InvestigationService,
    | "getInvestigation"
    | "baselineClaimEvidence"
    | "orchestration"
    | "panelProgram"
    | "setInvestigation"
    | "setInvestigationEpoch"
  >;
  guidedTestCatalog(): Pick<
    GuidedTestCatalogService,
    | "guidedTest"
    | "recommendations"
    | "guidedTestRegions"
    | "guidedTestDefinitions"
  >;
  protocolEvidence(): Pick<
    ProtocolEvidenceService,
    | "getContentCompilations"
    | "getTransactions"
    | "_notificationDecoder"
    | "getObservations"
    | "editObservations"
    | "getTrace"
    | "getImportedEvidence"
    | "_recordIncoming"
    | "editTransactions"
    | "editContentCompilations"
    | "editImportedEvidence"
    | "_trimTransactions"
  >;
  guidedOrchestration(): Pick<GuidedOrchestrationService, "corePlanProgress">;
  diagnostics(): Pick<
    DiagnosticsService,
    "getDiagnosticRuns" | "editDiagnosticRuns"
  >;
  identification(): Pick<
    IdentificationService,
    "assessment" | "applyFingerprint" | "getRegistry"
  >;
}
export class ReportImportService {
  constructor(private readonly ports: Ports) {}
  _deviceReportContext(): import("../../investigation/reports").DeviceReportContext {
    const session = this.ports.connection().getSession();
    return {
      fingerprint: session.fingerprint,
      profile: session.profile,
      matrixsmithVersion: MATRIXSMITH_VERSION,
      liveConnected:
        session.source === "live" &&
        this.ports.connection().getTransport().state === "connected",
    };
  }
  testReportMarkdown(testId: string): string {
    const investigation = this.ports.investigation().getInvestigation();
    const completed = [...(investigation?.completedTests ?? [])]
      .reverse()
      .find((test) => test.testId === testId);
    if (!completed)
      throw new Error(`No completed run of guided test ${testId} to report.`);
    const test = this.ports.guidedTestCatalog().guidedTest(testId);
    const priorEvidence = [
      ...this.ports.investigation().baselineClaimEvidence(),
      ...(investigation?.claimEvidence ?? []),
    ].filter((entry) => entry.testId !== testId);
    const compilation =
      this.ports
        .protocolEvidence()
        .getContentCompilations()
        .find(
          (record) =>
            record.transactionId !== undefined &&
            completed.transactionIds.includes(record.transactionId),
        ) ?? null;
    return generateTestReport({
      device: this._deviceReportContext(),
      test,
      completed,
      priorEvidence,
      why: test.about.whyRelevant,
      transactions: this.ports.protocolEvidence().getTransactions(),
      compilation,
      decoder: this.ports.protocolEvidence()._notificationDecoder(),
      nextRecommendation:
        this.ports.guidedTestCatalog().recommendations()[0] ?? null,
      regions: this.ports.guidedTestCatalog().guidedTestRegions(testId),
    });
  }
  investigationReportMarkdown(): string {
    const session = this.ports.connection().getSession();
    return generateInvestigationReport({
      device: this._deviceReportContext(),
      investigation: this.ports.investigation().getInvestigation(),
      baselineEvidence: this.ports.investigation().baselineClaimEvidence(),
      tests: this.ports.guidedTestCatalog().guidedTestDefinitions(),
      transactions: this.ports.protocolEvidence().getTransactions(),
      compilations: this.ports.protocolEvidence().getContentCompilations(),
      nextRecommendation:
        this.ports.guidedTestCatalog().recommendations()[0] ?? null,
      driverCandidates: session.selection?.matches ?? [],
      regionsByTest: new Map(
        this.ports
          .guidedTestCatalog()
          .guidedTestDefinitions()
          .map((test) => [
            test.id,
            this.ports.guidedTestCatalog().guidedTestRegions(test.id),
          ]),
      ),
      coreProgress: this.ports.guidedOrchestration().corePlanProgress(),
      experiments: this.ports.investigation().orchestration.experiments,
      transfers: this.ports.investigation().orchestration.transfers,
      cycleDetail: this.ports.investigation().orchestration.cycleVerdict.cycling
        ? this.ports.investigation().orchestration.cycleVerdict.detail
        : null,
      panelProgram: this.ports.investigation().panelProgram(),
      liveSession:
        session.source === "live" &&
        this.ports.connection().getTransport().state === "connected",
      recommendationTrail:
        this.ports.investigation().orchestration.recommendationTrail,
    });
  }
  forensicReportMarkdown(): string {
    return generateForensicAppendix({
      base: this.investigationReportMarkdown(),
      transactions: this.ports.protocolEvidence().getTransactions(),
      decoder: this.ports.protocolEvidence()._notificationDecoder(),
      compilations: this.ports.protocolEvidence().getContentCompilations(),
    });
  }
  recordObservation(
    summary: string,
    confidence: ManualObservation["confidence"] = "observed",
  ): ManualObservation {
    if (!summary.trim()) throw new Error("Observation cannot be empty.");
    const observation = {
      id: `observation:${Date.now()}:${this.ports.protocolEvidence().getObservations().length}`,
      recordedAt: new Date().toISOString(),
      summary: summary.trim(),
      confidence,
    } as const;
    this.ports
      .protocolEvidence()
      .editObservations((value) => value.push(observation));
    this.ports.protocolEvidence().getTrace().record("observation.recorded", {
      observationId: observation.id,
      summary: observation.summary,
    });
    return observation;
  }
  exportBundle(privacy: BundlePrivacy = "full-local-archive"): string {
    const session = this.ports.connection().getSession();
    const fingerprint = session.fingerprint;
    if (!fingerprint) throw new Error("No fingerprint is available to export.");
    const driver = session.selection?.selected;
    const profile = session.profile;
    const bundle = createDiagnosticBundle({
      fingerprint,
      driverMatches: session.selection?.matches ?? [],
      selectedDriver: driver?.id ?? null,
      selectedProfile: profile?.id ?? null,
      capabilities: driver && profile ? driver.capabilities(profile) : [],
      trace: this.ports.protocolEvidence().getTrace().events,
      observations: this.ports.protocolEvidence().getObservations(),
      advertisementEvidence: fingerprint.rawAdvertisementHex
        ? { rawHex: fingerprint.rawAdvertisementHex }
        : null,
      transactions: this.ports.protocolEvidence().getTransactions(),
      diagnosticRuns: this.ports.diagnostics().getDiagnosticRuns(),
      contentCompilations: this.ports
        .protocolEvidence()
        .getContentCompilations(),
      importedEvidence: this.ports.protocolEvidence().getImportedEvidence(),
      investigation: this.ports.investigation().getInvestigation(),
      privacy,
      assessment: this.ports.identification().assessment(),
    });
    return serializeDiagnosticBundle(bundle);
  }
  importBundle(json: string): DiagnosticBundle {
    const session = this.ports.connection().getSession();
    const bundle = parseDiagnosticBundle(json);
    session.clearConnection();
    this.ports
      .identification()
      .applyFingerprint(bundle.fingerprint, "imported");
    this.ports.protocolEvidence().getTrace().importSerialized(bundle.trace);
    for (const packet of notificationPacketsFromBundle(bundle))
      this.ports.protocolEvidence()._recordIncoming(packet, false, null);
    this.ports
      .protocolEvidence()
      .editTransactions((value) =>
        value.splice(
          0,
          this.ports.protocolEvidence().getTransactions().length,
          ...(bundle.transactions ?? []),
        ),
      );
    this.ports
      .diagnostics()
      .editDiagnosticRuns((value) =>
        value.splice(
          0,
          this.ports.diagnostics().getDiagnosticRuns().length,
          ...(bundle.diagnosticRuns ?? []),
        ),
      );
    this.ports
      .protocolEvidence()
      .editContentCompilations((value) =>
        value.splice(
          0,
          this.ports.protocolEvidence().getContentCompilations().length,
          ...(bundle.contentCompilations ?? []),
        ),
      );
    this.ports
      .protocolEvidence()
      .editImportedEvidence((value) =>
        value.splice(
          0,
          this.ports.protocolEvidence().getImportedEvidence().length,
          ...(bundle.importedEvidence ?? []),
        ),
      );
    // An imported investigation is external historical evidence in its
    // entirety; the serialized scope fields are never trusted.
    this.ports
      .investigation()
      .setInvestigation(
        bundle.investigation
          ? demoteInvestigationEvidence(
              bundle.investigation,
              "imported-external",
            )
          : null,
      );
    this.ports
      .investigation()
      .setInvestigationEpoch(this.ports.connection().getConnectionEpoch());
    return bundle;
  }
  importExternalLog(content: string): ImportedEvidence {
    const session = this.ports.connection().getSession();
    const importer = findImporter(content);
    if (!importer)
      throw new Error(
        "No importer recognizes this capture format. nRF Connect text logs are supported.",
      );
    const evidence = importer.parse(content, {
      drivers: this.ports.identification().getRegistry().drivers,
    });
    if (!evidence.fingerprint && evidence.transactions.length === 0)
      throw new Error(
        evidence.warnings[0] ??
          "The capture contained no recognizable evidence.",
      );
    const liveSessionActive =
      session.source === "live" && session.fingerprint !== null;
    if (!liveSessionActive) {
      session.clearConnection();
      if (evidence.fingerprint)
        this.ports
          .identification()
          .applyFingerprint(evidence.fingerprint, "imported");
      else this.ports.connection().patchSession({ source: "imported" });
    }
    this.ports
      .protocolEvidence()
      .editTransactions((value) => value.push(...evidence.transactions));
    this.ports.protocolEvidence()._trimTransactions();
    this.ports
      .protocolEvidence()
      .editObservations((value) => value.push(...evidence.observations));
    this.ports.protocolEvidence().editImportedEvidence((value) =>
      value.push({
        provenance: evidence.provenance,
        transactionCount: evidence.transactions.length,
        warnings: evidence.warnings,
      }),
    );
    this.ports.protocolEvidence().getTrace().record("evidence.imported", {
      importer: importer.id,
      transactions: evidence.transactions.length,
      warnings: evidence.warnings.length,
      unparsedLines: evidence.unparsedLineCount,
    });
    return evidence;
  }
}
