import type { DeviceFingerprint, DeviceProfile } from "../core/device";
import type { ProtocolTransaction } from "../diagnostics/transactions";
import type { ContentCompilationRecord } from "../diagnostics/content-evidence";
import { analyzeStoredProgramUpload, describeUploadAnalysis, type NotificationDecoder } from "../diagnostics/upload-analysis";
import { CLAIM_DEFINITIONS, operationalTrust, resolveClaims, type ClaimEvidence, type ClaimId, type ClaimState } from "./claims";
import type { CompletedGuidedTest, Investigation } from "./investigation";
import type { GuidedTestDefinition } from "./tests";
import { formatDuration, observationValueSummary, type ObservationValue } from "./observations";
import { approximateSeconds, describeAttempt } from "./timing";
import type { Recommendation } from "./recommendations";
import type { DiagnosticRegion } from "./regions";
import type { CorePlanProgress } from "./core-plan";
import { classifyTransfers, TRANSFER_REASON_LABELS, type ExperimentRun, type TransferRecord } from "./orchestration";
import { evaluateStaticViability, MINIMUM_STATIC_HOLD_MS } from "./static-viability";

/**
 * AI/human-ready report generation. Test reports are scoped to one guided
 * test; investigation reports carry enough evidence for an AI to implement
 * or repair driver support without the original chat history. Defaults are
 * compact: representative packet exemplars instead of full dumps (the
 * forensic report keeps everything).
 */

export interface DeviceReportContext {
  readonly fingerprint: DeviceFingerprint | null;
  readonly profile: DeviceProfile | null;
  readonly matrixsmithVersion: string;
  readonly liveConnected: boolean;
}

export interface TestReportInput {
  readonly device: DeviceReportContext;
  readonly test: GuidedTestDefinition;
  readonly completed: CompletedGuidedTest;
  /** Claim evidence that existed BEFORE this test ran, for context. */
  readonly priorEvidence: readonly ClaimEvidence[];
  readonly why: string;
  readonly transactions: readonly ProtocolTransaction[];
  readonly compilation: ContentCompilationRecord | null;
  readonly decoder: NotificationDecoder | null;
  readonly nextRecommendation: Recommendation | null;
  /** Labelled zones of this test's diagnostic, so observations name a place. */
  readonly regions?: readonly DiagnosticRegion[];
}

const SCOPE_LABEL: Readonly<Record<ClaimEvidence["scope"], string>> = {
  "current-session": "current physical session",
  "previous-local-session": "previous local session",
  "imported-external": "imported external evidence",
  "built-in-profile": "built-in profile evidence",
  "source-reference": "source/reference evidence",
};

export function generateTestReport(input: TestReportInput): string {
  const { device, test, completed } = input;
  const lines: string[] = ["# MatrixSmith Hardware Test Report", ""];
  const section = (title: string, body: string): void => { lines.push(`## ${title}`, "", body, ""); };

  section("Question", test.about.question);
  section("Device", deviceText(device));
  const relevantEvidence = input.priorEvidence.filter((entry) => test.targetClaims.includes(entry.claimId) || test.prerequisites.some((requirement) => requirement.claimId === entry.claimId));
  section("Existing relevant evidence", listOrNone(relevantEvidence.map((entry) => `${claimLabel(entry.claimId)} — ${entry.status} (${SCOPE_LABEL[entry.scope]}): ${entry.summary}`)));
  section("Why this test was run", input.why);
  section("Test performed", [
    `- Test: ${test.title} (\`${test.id}\`)`,
    `- Ran: ${completed.startedAt} → ${completed.completedAt}`,
    `- What MatrixSmith did: ${test.about.whatMatrixSmithDoes}`,
    ...(completed.parameters ? [`- Parameters: ${Object.entries(completed.parameters).map(([key, value]) => `${key}=${String(value)}`).join(", ")}`] : []),
  ].join("\n"));
  section("Safety / side effects", `- Risk: ${test.risk}; persistence: ${test.persistence}\n- ${test.consequence}`);
  section("Protocol operation", test.about.technicalDetails.map((detail) => `- ${detail}`).join("\n"));
  section("Compiler / transmission summary", compilationText(input.compilation));
  section("Automatic observations", automaticObservationsText(input));
  const timing = physicalTimingText(completed, input.transactions);
  if (timing) section("Physical timing", timing);
  section("Physical observations", listOrNone(completed.observations.map((value) => {
    const spec = test.observation.find((candidate) => candidate.id === value.fieldId);
    const region = spec?.regionId ? input.regions?.find((candidate) => candidate.id === spec.regionId) : undefined;
    return observationValueSummary(spec, value, region?.displayLabel);
  })));
  section("Result", `**${completed.status.toUpperCase()}** — ${completed.summary}`);
  section("What this establishes", listOrNone(completed.established));
  section("What this rejects", listOrNone(completed.rejected));
  section("What remains unknown", listOrNone(completed.unknowns));
  section("Recommended next discriminator", input.nextRecommendation
    ? `${input.nextRecommendation.title} — ${input.nextRecommendation.why} (~${input.nextRecommendation.estimatedObservationTime})`
    : "No further discriminator is currently recommended.");
  section("Relevant transactions", transactionSummaryText(input.transactions, completed.transactionIds));
  section("Relevant packet exemplars", packetExemplarText(input.transactions, completed.transactionIds));
  section("Reproduction information", reproductionText(device, completed));
  section("Requested AI task", `Interpret this single test result in the context of the existing evidence, update the claim model for \`${test.targetClaims.join("`, `")}\`, and propose the highest-information safe next test. Distinguish facts observed on this exact device from source-derived behavior.`);
  return `${lines.join("\n").trimEnd()}\n`;
}

export interface InvestigationReportInput {
  readonly device: DeviceReportContext;
  readonly investigation: Investigation | null;
  readonly baselineEvidence: readonly ClaimEvidence[];
  readonly tests: readonly GuidedTestDefinition[];
  readonly transactions: readonly ProtocolTransaction[];
  readonly compilations: readonly ContentCompilationRecord[];
  readonly nextRecommendation: Recommendation | null;
  readonly driverCandidates: readonly { readonly driverId: string; readonly score: number; readonly reasons: readonly string[]; readonly contradictions: readonly string[] }[];
  /** Labelled zones per test id, so observations name a place rather than repeat a prompt. */
  readonly regionsByTest?: ReadonlyMap<string, readonly DiagnosticRegion[]>;
  /** Where the bounded core plan stands, so progress and loops are visible. */
  readonly coreProgress?: CorePlanProgress | null;
  /** Semantic experiment runs, with their attempts. */
  readonly experiments?: readonly ExperimentRun[];
  /** Every guided transmission and why it happened. */
  readonly transfers?: readonly TransferRecord[];
  /** The current engine's next step — the single source of truth for "what next?". */
  readonly cycleDetail?: string | null;
}

export function generateInvestigationReport(input: InvestigationReportInput): string {
  const { device, investigation } = input;
  const allEvidence = [...input.baselineEvidence, ...(investigation?.claimEvidence ?? [])];
  const claims = resolveClaims(allEvidence);
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const lines: string[] = ["# MatrixSmith Hardware Investigation Report", ""];
  const section = (title: string, body: string): void => { lines.push(`## ${title}`, "", body, ""); };
  const claimText = (ids: readonly ClaimId[]): string => listOrNone(ids.map((id) => formatClaim(byId.get(id))));

  section("Objective", investigation
    ? `${investigation.goal.kind === "troubleshoot" ? "Troubleshooting" : "Guided development"}: ${investigation.goal.description}${investigation.goal.symptomId ? ` (symptom: ${investigation.goal.symptomId})` : ""}`
    : "Characterize and develop support for this display.");
  if (input.coreProgress) section("Investigation progress", coreProgressText(input.coreProgress));
  if (input.cycleDetail) section("Workflow warning", `MatrixSmith detected a recommendation loop: ${input.cycleDetail}`);
  section("Next step", input.nextRecommendation
    ? `${input.nextRecommendation.title} — ${input.nextRecommendation.why} (~${input.nextRecommendation.estimatedObservationTime})`
    : input.coreProgress?.complete
      ? "Core characterization is complete. Remaining work is optional characterization."
      : "No further test is currently recommended.");
  if (input.experiments && input.experiments.length > 0) {
    section("Experiments and attempts", experimentsText(input.experiments, input.coreProgress ?? null));
  }
  if (input.transfers && input.transfers.length > 0) section("Diagnostic transfer summary", transferSummaryText(input.transfers));
  section("Device identity", deviceText(device));
  section("Advertisement / manufacturer evidence", advertisementText(device));
  section("Transport / GATT", gattText(device.fingerprint));
  section("Protocol candidates", listOrNone(input.driverCandidates.map((candidate) => `${candidate.driverId}: score ${candidate.score}; evidence: ${candidate.reasons.join("; ") || "none"}; contradictions: ${candidate.contradictions.join("; ") || "none"}`)));
  section("Verified operations", claimText(["protocol.coolledux", "device-info.query", "brightness.control", "power.control"]));
  section("Stored-program behavior", claimText(["stored-program.upload", "stored-program.receipts"]));
  section("Geometry / orientation / tiling", claimText(["raster.tiling", "raster.orientation"]));
  section("Black / off behavior by content path", claimText(["graffiti.black-semantics", "animation.black-semantics"]));
  section("Pixel / channel mapping", claimText(["pixel.channel-map", "pixel.encoder-correctness", "pixel.fourth-channel", "pixel.white-channel"]));
  section("Color observations", claimText(["graffiti.color-mapping", "pixel.color-calibration"]));
  section("Animation behavior", claimText(["animation.frames", "animation.timing", "animation.tile-sync", "animation.autonomous-loop", "animation.static-single-frame", "animation.static-identical-pair"]));
  section("Static behavior", claimText(["graffiti.initial-render", "graffiti.playback-stability", "static.strategy"]));
  section("Static image strategy assessment", staticStrategyAssessmentText(allEvidence, investigation));
  section("Text / image / GIF support", claimText(["text.rendering", "image.rendering", "gif.playback"]));
  section("Controls", claimText(["brightness.control", "power.control"]));
  section("Persistence / recovery", claimText(["power-cycle.persistence", "recovery.manual-reset"]));
  section("Tests performed", listOrNone((investigation?.completedTests ?? []).map((test) => `${test.completedAt} — ${test.title} (\`${test.testId}\`): ${test.status.toUpperCase()} — ${test.summary}${test.parameters ? ` [${Object.entries(test.parameters).map(([key, value]) => `${key}=${String(value)}`).join(", ")}]` : ""}`)));
  section("Structured physical observations", structuredObservationsText(investigation, input.tests, input.regionsByTest ?? new Map()));
  section("Claims and confidence", claimsTable(claims, allEvidence));
  section("Evidence trust and conflicts", trustAndConflictsText(allEvidence));
  section("Rejected hypotheses", listOrNone(claims.filter((claim) => claim.status === "rejected").map((claim) => formatClaim(claim))));
  section("Open hypotheses", listOrNone(claims.filter((claim) => claim.status === "unresolved" || claim.status === "unknown" || claim.status === "source-supported").map((claim) => formatClaim(claim))));
  section("Known limitations", listOrNone([...(device.profile?.quirks?.contentLimits ?? []), ...(device.profile?.quirks?.graffitiPlaybackNotes ?? [])]));
  section("Driver / profile recommendations", driverRecommendationsText(claims, device));
  section("Relevant transactions", transactionSummaryText(input.transactions, (investigation?.completedTests ?? []).flatMap((test) => test.transactionIds)));
  section("Reproduction environment", reproductionText(device, null));
  section("Requested AI task", "Implement or fix MatrixSmith support for this device using the claims above. Treat only claims marked verified on the current physical session or built-in profile as device facts; treat source-reference claims as behavior of OTHER hardware. Propose driver/profile changes, and list the discriminating physical tests still needed for anything unresolved. This report is designed to be sufficient without the original conversation history.");
  return `${lines.join("\n").trimEnd()}\n`;
}

export interface ForensicReportInput {
  readonly base: string;
  readonly transactions: readonly ProtocolTransaction[];
  readonly decoder: NotificationDecoder | null;
  readonly compilations: readonly ContentCompilationRecord[];
}

/** Full-detail appendix: every packet with real timestamps and timing analysis. */
export function generateForensicAppendix(input: ForensicReportInput): string {
  const lines: string[] = ["# MatrixSmith Forensic Appendix", "", "All packets, receipts, and measured timing. Timestamps are actual per-write times, never planned pacing.", ""];
  for (const transaction of input.transactions) {
    lines.push(`## ${transaction.operation} (${transaction.id})`, "");
    lines.push(`- ${transaction.startedAt} → ${transaction.completedAt} (${transaction.durationMs} ms); host=${transaction.hostAccepted}; protocol=${String(transaction.protocolAcknowledged)}; error=${transaction.error ?? "none"}`);
    const chunkCount = compilationChunkCount(input.compilations, transaction.id);
    if (chunkCount !== null && input.decoder) {
      const analysis = analyzeStoredProgramUpload(transaction, chunkCount, input.decoder);
      for (const line of describeUploadAnalysis(analysis)) lines.push(`- ${line}`);
    }
    lines.push("", "| Time | Dir | Gap ms | Host accepted | Bytes |", "| --- | --- | --- | --- | --- |");
    for (const packet of transaction.packets) {
      lines.push(`| ${packet.timestamp} | ${packet.direction} | ${packet.gapSincePreviousTxMs ?? ""} | ${packet.hostAcceptedAt ?? ""} | \`${packet.hex}\` |`);
    }
    lines.push("");
  }
  return `${input.base.trimEnd()}\n\n${lines.join("\n").trimEnd()}\n`;
}

// ---------------------------------------------------------------------------

function claimLabel(id: ClaimId): string {
  return CLAIM_DEFINITIONS.find((definition) => definition.id === id)?.label ?? id;
}

function formatClaim(claim: ClaimState | undefined): string {
  if (!claim) return "unknown claim";
  const basis = claim.decidedBy ? ` — ${SCOPE_LABEL[claim.decidedBy.scope]}: ${claim.decidedBy.summary}` : " — no evidence recorded";
  const blocked = claim.blockedByPrerequisite ? ` [prerequisite ${claim.blockedByPrerequisite} rejected]` : "";
  return `\`${claim.id}\` (${claim.label}): **${claim.status}**${blocked}${basis}`;
}

/**
 * Investigative state AND operational trust per claim. The investigative
 * status includes historical/imported contradictions; the operational basis
 * says whether a normal operation currently has a trusted authorization and
 * from which scope it comes.
 */
function claimsTable(claims: readonly ClaimState[], evidence: readonly ClaimEvidence[]): string {
  return ["| Claim | Investigative status | Operational basis | Evidence |", "| --- | --- | --- | --- |",
    ...claims.map((claim) => {
      const trust = operationalTrust(claim.id, evidence);
      const basis = claim.id === "static.strategy"
        ? (trust.trusted ? "derived (viable strategy)" : "derived (no viable strategy)")
        : trust.trusted
          ? `trusted (${SCOPE_LABEL[trust.basis!.scope]})${trust.historicalConflict ? " · CONFLICT with historical evidence" : ""}`
          : trust.trustedStatus === "rejected" ? "revoked (trusted rejection)" : "none";
      const summary = claim.decidedBy?.summary ?? claim.derivedSummary ?? "No evidence.";
      return `| \`${claim.id}\` | ${claim.status} | ${basis} | ${summary.replaceAll("|", "\\|")} |`;
    }),
  ].join("\n");
}

/**
 * Per-scope breakdown for every claim whose evidence spans scopes or whose
 * trusted basis is contradicted, so an AI never has to infer scope conflicts
 * from a flat list.
 */
function trustAndConflictsText(evidence: readonly ClaimEvidence[]): string {
  const lines: string[] = [];
  for (const definition of CLAIM_DEFINITIONS) {
    const entries = evidence.filter((entry) => entry.claimId === definition.id);
    const scopes = new Set(entries.map((entry) => entry.scope));
    const trust = operationalTrust(definition.id, evidence);
    if (scopes.size <= 1 && !trust.historicalConflict) continue;
    lines.push(`### \`${definition.id}\` (${definition.label})`, "");
    for (const entry of entries) lines.push(`- ${SCOPE_LABEL[entry.scope]}: ${entry.status.toUpperCase()} — ${entry.summary}`);
    lines.push(`- Operational basis: ${trust.trusted ? `${SCOPE_LABEL[trust.basis!.scope]} (trusted)` : trust.trustedStatus === "rejected" ? "revoked by trusted rejection" : "none"}`);
    if (trust.historicalConflict) lines.push("- Effective investigative state: CONFLICT — historical/imported evidence contradicts the trusted basis; revalidation on the current physical session is recommended.");
    lines.push("");
  }
  return lines.length ? lines.join("\n").trimEnd() : "No cross-scope evidence or conflicts.";
}

/**
 * Derived static-strategy assessment from the same evaluator that powers
 * normal-operation gating and session strategy selection — no duplicated
 * logic. Includes the measured timing comparison across Graffiti runs.
 */
function staticStrategyAssessmentText(evidence: readonly ClaimEvidence[], investigation: Investigation | null): string {
  const assessment = evaluateStaticViability(evidence);
  const lines: string[] = [];
  for (const strategy of assessment.strategies) {
    lines.push(`### ${strategy.strategy}`, "");
    for (const requirement of strategy.requirements) {
      const marker = requirement.state === "met" ? "✓" : requirement.state === "failed" ? "✕" : "?";
      lines.push(`- ${marker} ${requirement.label} (\`${requirement.claimId}\`): ${requirement.trustedStatus} — ${requirement.detail}`);
    }
    lines.push(`- **Overall: ${strategy.verdict === "viable" ? "VIABLE" : strategy.verdict === "not-viable" ? "NOT VIABLE" : "NOT YET DECIDED"}** — ${strategy.summary}`, "");
  }
  lines.push(`Selected usable strategy: ${assessment.selected ?? "none"}. Characterization currently pursues: ${assessment.pursued ?? "none"}${assessment.nextOpenRequirement ? ` (next open requirement: \`${assessment.nextOpenRequirement}\`)` : ""}. Stability verification requires a MatrixSmith-measured visibly-static hold of at least ${MINIMUM_STATIC_HOLD_MS / 1000}s from full-raster-visible (T1).`);
  const timingRuns = (investigation?.completedTests ?? []).filter((test) => test.testId === "coolledux-graffiti-timing" || test.testId === "coolledux-graffiti-staytime");
  if (timingRuns.length > 0) {
    lines.push("", "#### Measured Graffiti timing runs", "");
    for (const run of timingRuns) {
      const t1 = measuredObservationMs(run.observations, "image-visible");
      const t2 = measuredObservationMs(run.observations, "movement-start");
      const end = measuredObservationMs(run.observations, "observation-end");
      const hold = t1 !== null && t2 !== null ? t2 - t1 : t1 !== null && end !== null ? end - t1 : null;
      // The comparison is between VALID attempts only; a discarded human
      // measurement must never dilute or contradict what a good one showed.
      const attempts = run.attempts ?? [];
      const discarded = attempts.filter((attempt) => attempt.validity !== "valid").length;
      lines.push(`- stayTime=${run.parameters?.stayTime ?? "?"} (${run.status}): render latency ${t1 !== null ? approximateSeconds(t1) : "not measured"}; visible static hold ${hold !== null ? approximateSeconds(Math.max(0, hold)) : "not measured"}; movement ${t2 !== null ? `began at +${approximateSeconds(t2)}` : end !== null ? "not observed within the window" : "not measured"}.${discarded > 0 ? ` ${discarded} invalid attempt(s) excluded from this conclusion.` : ""}`);
    }
  }
  return lines.join("\n").trimEnd();
}

function measuredObservationMs(observations: readonly ObservationValue[], fieldId: string): number | null {
  const value = observations.find((observation) => observation.fieldId === fieldId);
  return value?.kind === "duration" && value.measuredBy === "matrixsmith-timer" ? value.milliseconds : null;
}

function physicalTimingText(completed: CompletedGuidedTest, transactions: readonly ProtocolTransaction[]): string | null {
  const t1 = measuredObservationMs(completed.observations, "image-visible");
  const t2 = measuredObservationMs(completed.observations, "movement-start");
  const end = measuredObservationMs(completed.observations, "observation-end");
  if (t1 === null && t2 === null && end === null) return null;
  const relevant = transactions.filter((transaction) => completed.transactionIds.includes(transaction.id));
  const finalWrite = relevant.flatMap((transaction) => transaction.packets.filter((packet) => packet.direction === "TX")).map((packet) => packet.hostAcceptedAt ?? packet.timestamp).sort().at(-1) ?? null;
  const attempts = completed.attempts ?? [];
  const invalid = attempts.filter((attempt) => attempt.validity !== "valid");
  return [
    "**Transport event (automatically measured)**",
    `- Upload final write accepted (T0): ${finalWrite ?? "not captured"}`,
    "",
    "**Physical observation (human observed)**",
    ...(t1 !== null ? [`- Full raster visible (T1): +${formatDuration(t1)} — ${approximateSeconds(t1)}, human observed`] : []),
    ...(t2 !== null ? [`- Movement began (T2): +${formatDuration(t2)} — ${approximateSeconds(t2)}, human observed`] : []),
    ...(end !== null ? [`- Observation ended, still static: +${formatDuration(end)} — ${approximateSeconds(end)}, human observed`] : []),
    "",
    "**Derived**",
    ...(t1 !== null ? [`- Render latency (T1 − T0): ${approximateSeconds(t1)} (exact ${formatDuration(t1)})`] : []),
    ...(t1 !== null && t2 !== null ? [`- Visible static hold (T2 − T1): ${approximateSeconds(Math.max(0, t2 - t1))} (exact ${formatDuration(Math.max(0, t2 - t1))})`] : []),
    ...(t1 !== null && t2 === null && end !== null ? [`- Visible static hold (still static at stop): ${approximateSeconds(Math.max(0, end - t1))} (exact ${formatDuration(Math.max(0, end - t1))})`] : []),
    "",
    // T0 comes off the transport and is precise within that model. T1/T2 are
    // a person watching a panel and tapping a phone; reporting them to the
    // millisecond as though a sensor caught the transition would overstate
    // what was actually measured.
    "- Measurement basis: T0 is the final host-accepted transport write, measured automatically. T1 and T2 are human observations and carry human reaction delay — the approximate values are the honest reading, and the exact marks are retained for forensic use. Per-packet transport timing lives in the transactions/forensic appendix.",
    ...(attempts.length > 0 ? ["", `**Attempts (${attempts.length}; ${attempts.length - invalid.length} valid)**`, ...attempts.flatMap((attempt) => describeAttempt(attempt).map((line) => `- ${line}`))] : []),
    ...(invalid.length > 0 ? ["", "Invalid attempts are recorded above for completeness. They establish nothing about the hardware: a missed or mistimed mark means the measurement failed, not that the display behaved differently."] : []),
  ].join("\n");
}

/** The bounded plan, including what was skipped and why. */
function coreProgressText(progress: CorePlanProgress): string {
  const lines: string[] = [`Core plan: ${progress.completed} / ${progress.total} complete${progress.complete ? " — COMPLETE" : ""}`, ""];
  let position = 0;
  for (const entry of progress.steps) {
    if (entry.state !== "skipped") position += 1;
    const label = entry.state === "skipped" ? "SKIPPED" : entry.state.toUpperCase();
    lines.push(`${entry.state === "skipped" ? "–" : `${position}.`} ${entry.step.title} — ${label}${entry.skipReason ? ` — not needed because ${entry.skipReason}` : ""}`);
  }
  return lines.join("\n");
}

/**
 * Experiments with their attempts.
 *
 * The distinction this section exists to preserve: three attempts at one
 * experiment are one experiment. Flattening them into unrelated transmissions
 * is what made a retry-heavy session unreadable.
 */
function experimentsText(experiments: readonly ExperimentRun[], progress: CorePlanProgress | null): string {
  const positions = new Map<string, number>();
  let position = 0;
  for (const entry of progress?.steps ?? []) {
    if (entry.state === "skipped") continue;
    position += 1;
    positions.set(entry.step.id, position);
  }
  const blocks = experiments.map((run) => {
    const number = run.corePlanStepId ? positions.get(run.corePlanStepId) : undefined;
    const heading = `### ${number ? `Test ${number} of ${progress?.total ?? "?"} — ` : ""}${run.title}`;
    const lines: string[] = [heading, ""];
    if (run.variant) lines.push(`Variant: ${run.variant}`);
    lines.push(`Status: ${run.status}${run.conclusion ? ` — ${run.conclusion}` : ""}`);
    if (run.reopenReason) lines.push(`Reopened deliberately: ${run.reopenReason}`);
    lines.push(`Execution identity: \`${run.fingerprint.key}\`${run.fingerprint.programCrc32 ? ` (program CRC ${run.fingerprint.programCrc32})` : ""}`);
    lines.push("");
    for (const attempt of run.attempts) {
      lines.push(`Attempt ${attempt.attemptNumber}`);
      lines.push(`- transfer reason: ${TRANSFER_REASON_LABELS[attempt.reason]}`);
      lines.push(`- ${attempt.validity === "valid" ? "valid" : attempt.validity === "invalid" ? "INVALID" : "in progress"}`);
      if (attempt.invalidationReason) lines.push(`- reason: ${attempt.invalidationReason}`);
      if (attempt.validity === "invalid") lines.push("- excluded from conclusions");
      if (attempt.timing) lines.push(...describeAttempt(attempt.timing).slice(1).map((line) => `- ${line.trim()}`));
      lines.push("");
    }
    return lines.join("\n").trimEnd();
  });
  return blocks.join("\n\n");
}

/**
 * Repeated payloads, classified.
 *
 * Identical bytes are expected when a human asks to measure the same thing
 * again, so a repeat is only flagged when its stated reason claims novelty the
 * bytes contradict.
 */
function transferSummaryText(transfers: readonly TransferRecord[]): string {
  const summary = classifyTransfers(transfers);
  const lines: string[] = [`Total diagnostic transfers: ${summary.total}`, ""];
  for (const [reason, count] of Object.entries(summary.byReason)) {
    if (count > 0) lines.push(`- ${TRANSFER_REASON_LABELS[reason as keyof typeof TRANSFER_REASON_LABELS]}: ${count}`);
  }
  lines.push(`- Unclassified duplicate transfers: ${summary.unclassifiedDuplicates}`);
  if (summary.repeatedExecutions.length > 0) {
    lines.push("", "Repeated payloads:");
    for (const group of summary.repeatedExecutions) {
      const reasons = Object.entries(group.byReason).map(([reason, count]) => `${count} × ${TRANSFER_REASON_LABELS[reason as keyof typeof TRANSFER_REASON_LABELS] ?? reason}`).join(", ");
      lines.push(`- \`${group.testId}\`${group.programCrc32 ? ` (CRC ${group.programCrc32})` : ""}: ${group.transfers} transfers — ${reasons}`);
    }
    lines.push("", "Repeated identical payloads are expected when a measurement is retried; only unclassified duplicates indicate a workflow problem.");
  }
  if (summary.unclassifiedDuplicates > 0) {
    lines.push("", `POSSIBLE WORKFLOW ISSUE: ${summary.unclassifiedDuplicates} transmission(s) repeated an execution while claiming to be a new experiment.`);
  }
  return lines.join("\n");
}

function deviceText(device: DeviceReportContext): string {
  const profile = device.profile;
  return [
    `- Name: ${device.fingerprint?.name ?? "unknown"}`,
    `- Profile: ${profile ? `${profile.id} (${profile.width}×${profile.height}, driver ${profile.driverId})` : "unresolved"}`,
    `- Session: ${device.liveConnected ? "live physical connection" : "not live"}`,
    ...(profile?.quirks ? [`- Unexplained raw metadata: ${Object.entries(profile.quirks.unexplained).map(([key, value]) => `${key}=${String(value)} (semantics unknown)`).join(", ") || "none"}`] : []),
  ].join("\n");
}

function advertisementText(device: DeviceReportContext): string {
  const fingerprint = device.fingerprint;
  const profile = device.profile;
  const lines = [
    `- Live advertisement bytes: ${fingerprint?.rawAdvertisementHex ?? "not exposed by this browser session (never fabricated)"}`,
    `- Live manufacturer data: ${fingerprint?.manufacturerDataHex ?? "not captured this session"}`,
    `- Profile advertisement evidence: ${profile?.metadata.companyId !== undefined ? `company id 0x${Number(profile.metadata.companyId).toString(16).toUpperCase()}` : "none"}`,
  ];
  const observation = fingerprint?.advertisementObservation;
  if (observation) {
    // The browser exposes parsed advertisement fields, never the original
    // byte stream; the source is labeled and raw bytes are never fabricated.
    lines.push(
      `- Structured advertisement observation (source: ${observation.source}, captured ${observation.capturedAt}):`,
      ...(observation.name !== undefined ? [`  - Advertised name: ${observation.name}`] : []),
      ...(observation.rssi !== undefined ? [`  - RSSI: ${observation.rssi} dBm`] : []),
      ...(observation.txPower !== undefined ? [`  - TX power: ${observation.txPower} dBm`] : []),
      `  - Advertised service UUIDs: ${observation.advertisedServiceUuids.length ? observation.advertisedServiceUuids.join(", ") : "none observed"}`,
      ...(observation.manufacturerData.length
        ? observation.manufacturerData.map((entry) => `  - Manufacturer data: company id 0x${entry.companyId.toString(16).toUpperCase().padStart(4, "0")}, data ${entry.dataHex || "(empty)"}`)
        : ["  - Manufacturer data: none observed"]),
      ...(observation.serviceData.length
        ? observation.serviceData.map((entry) => `  - Service data ${entry.uuid}: ${entry.dataHex || "(empty)"}`)
        : []),
    );
  } else {
    lines.push("- Structured advertisement observation: not captured (watchAdvertisements unsupported or nothing received; never fabricated)");
  }
  return lines.join("\n");
}

function gattText(fingerprint: DeviceFingerprint | null): string {
  if (!fingerprint?.services.length) return "No accessible GATT hierarchy recorded.";
  return fingerprint.services.flatMap((service) => [
    `- Service \`${service.uuid}\`${service.isPrimary ? " (primary)" : ""}`,
    ...service.characteristics.map((characteristic) => `  - \`${characteristic.uuid}\`: ${Object.entries(characteristic.properties).filter(([, enabled]) => enabled).map(([name]) => name).join(", ")}`),
  ]).join("\n");
}

function compilationText(record: ContentCompilationRecord | null): string {
  if (!record) return "No compiled program is associated with this test.";
  return [
    `- Program: ${record.width}×${record.height}, ${record.tileCount} tile(s) of width ${record.tileWidth}, ${record.programBytes} bytes uncompressed`,
    `- CRC32 (custom): 0x${record.crc32.toString(16).padStart(8, "0").toUpperCase()}; compressed ${record.compressedBytes} bytes (${record.compression})`,
    `- Transmission: 1 announce + ${record.chunkCount} chunk packet(s), ${record.pacingMs} ms requested pacing`,
    ...(record.frameCount !== undefined ? [`- Frames: ${record.frameCount}`] : []),
  ].join("\n");
}

function automaticObservationsText(input: TestReportInput): string {
  const relevant = input.transactions.filter((transaction) => input.completed.transactionIds.includes(transaction.id));
  if (relevant.length === 0) return "No transactions captured for this test.";
  const lines: string[] = [];
  for (const transaction of relevant) {
    lines.push(`- ${transaction.operation}: host accepted=${transaction.hostAccepted}${transaction.error ? `; error=${transaction.error}` : ""}`);
    const chunkCount = input.compilation?.transactionId === transaction.id ? input.compilation.chunkCount : null;
    if (chunkCount !== null && input.decoder) {
      for (const line of describeUploadAnalysis(analyzeStoredProgramUpload(transaction, chunkCount, input.decoder))) lines.push(`- ${line}`);
    }
  }
  return lines.join("\n");
}

function structuredObservationsText(investigation: Investigation | null, tests: readonly GuidedTestDefinition[], regionsByTest: ReadonlyMap<string, readonly DiagnosticRegion[]>): string {
  const completed = investigation?.completedTests ?? [];
  if (completed.length === 0) return "None recorded.";
  return completed.map((test) => {
    const definition = tests.find(({ id }) => id === test.testId);
    return [`### ${test.title}`, "", ...test.observations.map((value) => {
      const spec = definition?.observation.find((candidate) => candidate.id === value.fieldId);
      const region = spec?.regionId ? regionsByTest.get(test.testId)?.find((candidate) => candidate.id === spec.regionId) : undefined;
      return `- ${observationValueSummary(spec, value, region?.displayLabel)}`;
    })].join("\n");
  }).join("\n\n");
}

function driverRecommendationsText(claims: readonly ClaimState[], device: DeviceReportContext): string {
  const lines: string[] = [];
  const status = (id: ClaimId): string => claims.find((claim) => claim.id === id)?.status ?? "unknown";
  const encoder = claims.find((claim) => claim.id === "pixel.encoder-correctness");
  if (encoder?.status === "rejected") {
    const details = encoder.decidedBy?.details;
    lines.push(`ENCODER CORRECTION REQUIRED: the raw channel map is characterized but MatrixSmith's encoder maps logical channels incorrectly. Observed: ${String(details?.observedMap ?? "see pixel.channel-map evidence")}. Encoder emits: ${String(details?.expectedMap ?? "RGB444 (byte0 low nibble=R, byte1 high nibble=G, byte1 low nibble=B)")}. Implement the corrected ordering in the driver/profile, then re-run the channel verification; the profile is never mutated at runtime and normal image/text sending stays gated until re-verified.`);
  }
  if (status("static.strategy") !== "verified") lines.push("No static-raster strategy is validated; images/text must stay gated until one is (candidates: graffiti, animation-single-frame, animation-identical-frames).");
  if (status("graffiti.black-semantics") === "source-supported") lines.push("The Graffiti 0x0004 off workaround is inherited from reference hardware and untested here; run the black probe before changing it.");
  if (status("pixel.white-channel") === "unknown") lines.push("The unused high nibble may drive a physical emitter (hypothesis only); do not claim RGBW without the channel probe evidence.");
  if (device.profile?.quirks?.preferredRasterStrategy === "unresolved") lines.push("Profile preferredRasterStrategy is unresolved by design; session validation selects the current strategy.");
  return listOrNone(lines);
}

function transactionSummaryText(transactions: readonly ProtocolTransaction[], relevantIds: readonly string[]): string {
  const relevant = relevantIds.length > 0 ? transactions.filter((transaction) => relevantIds.includes(transaction.id)) : [];
  if (relevant.length === 0) return "No transactions referenced.";
  return relevant.map((transaction) => {
    const tx = transaction.packets.filter((packet) => packet.direction === "TX");
    const rx = transaction.packets.filter((packet) => packet.direction === "RX");
    return `- ${transaction.startedAt} ${transaction.operation}: ${tx.length} TX / ${rx.length} RX packet(s); host=${transaction.hostAccepted}; duration ${transaction.durationMs} ms${transaction.error ? `; error=${transaction.error}` : ""} (id ${transaction.id})`;
  }).join("\n");
}

/** A few representative packets, never the full stream: announce, first data chunk, and first receipts. */
function packetExemplarText(transactions: readonly ProtocolTransaction[], relevantIds: readonly string[]): string {
  const relevant = transactions.filter((transaction) => relevantIds.includes(transaction.id));
  const lines: string[] = [];
  for (const transaction of relevant) {
    const tx = transaction.packets.filter((packet) => packet.direction === "TX");
    const rx = transaction.packets.filter((packet) => packet.direction === "RX");
    if (tx[0]) lines.push(`- ${transaction.operation} first TX (announce): \`${tx[0].hex}\``);
    if (tx[1]) lines.push(`- ${transaction.operation} second TX (first data chunk): \`${truncateHex(tx[1].hex)}\``);
    for (const packet of rx.slice(0, 3)) lines.push(`- ${transaction.operation} RX: \`${packet.hex}\``);
    if (tx.length > 2 || rx.length > 3) lines.push(`- (${tx.length} TX / ${rx.length} RX total; full bytes available in the forensic report)`);
  }
  return lines.length ? lines.join("\n") : "No packet exemplars available.";
}

function truncateHex(hex: string, maxBytes = 24): string {
  const bytes = hex.split(" ");
  return bytes.length <= maxBytes ? hex : `${bytes.slice(0, maxBytes).join(" ")} … (${bytes.length} bytes)`;
}

function reproductionText(device: DeviceReportContext, completed: CompletedGuidedTest | null): string {
  return [
    `- MatrixSmith ${device.matrixsmithVersion}; Web Bluetooth transport`,
    `- Profile: ${device.profile?.id ?? "unresolved"}`,
    ...(completed ? [`- Re-run: guided test \`${completed.testId}\`${completed.parameters ? ` with ${Object.entries(completed.parameters).map(([key, value]) => `${key}=${String(value)}`).join(", ")}` : ""}`] : []),
    "- No vendor app, external BLE tools, or cloud services were involved.",
  ].join("\n");
}

function compilationChunkCount(compilations: readonly ContentCompilationRecord[], transactionId: string): number | null {
  const record = compilations.find((compilation) => compilation.transactionId === transactionId);
  return record ? record.chunkCount : null;
}

function listOrNone(values: readonly string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "None recorded.";
}
