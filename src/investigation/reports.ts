import type { DeviceFingerprint, DeviceProfile } from "../core/device";
import type { ProtocolTransaction } from "../diagnostics/transactions";
import type { ContentCompilationRecord } from "../diagnostics/content-evidence";
import { analyzeStoredProgramUpload, describeUploadAnalysis, type NotificationDecoder } from "../diagnostics/upload-analysis";
import { CLAIM_DEFINITIONS, resolveClaims, type ClaimEvidence, type ClaimId, type ClaimState } from "./claims";
import type { CompletedGuidedTest, Investigation } from "./investigation";
import type { GuidedTestDefinition } from "./tests";
import { observationValueSummary } from "./observations";
import type { Recommendation } from "./recommendations";

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
  section("Physical observations", listOrNone(completed.observations.map((value) => observationValueSummary(test.observation.find((spec) => spec.id === value.fieldId), value))));
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
  section("Device identity", deviceText(device));
  section("Advertisement / manufacturer evidence", advertisementText(device));
  section("Transport / GATT", gattText(device.fingerprint));
  section("Protocol candidates", listOrNone(input.driverCandidates.map((candidate) => `${candidate.driverId}: score ${candidate.score}; evidence: ${candidate.reasons.join("; ") || "none"}; contradictions: ${candidate.contradictions.join("; ") || "none"}`)));
  section("Verified operations", claimText(["protocol.coolledux", "device-info.query", "brightness.control", "power.control"]));
  section("Stored-program behavior", claimText(["stored-program.upload", "stored-program.receipts"]));
  section("Geometry / orientation / tiling", claimText(["raster.tiling", "raster.orientation"]));
  section("Black / off behavior by content path", claimText(["graffiti.black-semantics", "animation.black-semantics"]));
  section("Pixel / channel mapping", claimText(["pixel.channel-map", "pixel.white-channel"]));
  section("Color observations", claimText(["graffiti.color-mapping", "pixel.color-calibration"]));
  section("Animation behavior", claimText(["animation.frames", "animation.timing", "animation.tile-sync", "animation.autonomous-loop", "animation.static-single-frame"]));
  section("Static behavior", claimText(["graffiti.initial-render", "graffiti.playback-stability", "static.strategy"]));
  section("Text / image / GIF support", claimText(["text.rendering", "image.rendering", "gif.playback"]));
  section("Controls", claimText(["brightness.control", "power.control"]));
  section("Persistence / recovery", claimText(["power-cycle.persistence", "recovery.manual-reset"]));
  section("Tests performed", listOrNone((investigation?.completedTests ?? []).map((test) => `${test.completedAt} — ${test.title} (\`${test.testId}\`): ${test.status.toUpperCase()} — ${test.summary}${test.parameters ? ` [${Object.entries(test.parameters).map(([key, value]) => `${key}=${String(value)}`).join(", ")}]` : ""}`)));
  section("Structured physical observations", structuredObservationsText(investigation, input.tests));
  section("Claims and confidence", claimsTable(claims));
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

function claimsTable(claims: readonly ClaimState[]): string {
  return ["| Claim | Status | Scope | Evidence |", "| --- | --- | --- | --- |",
    ...claims.map((claim) => `| \`${claim.id}\` | ${claim.status} | ${claim.decidedBy ? SCOPE_LABEL[claim.decidedBy.scope] : "—"} | ${claim.decidedBy?.summary.replaceAll("|", "\\|") ?? "No evidence."} |`),
  ].join("\n");
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
  return [
    `- Live advertisement bytes: ${fingerprint?.rawAdvertisementHex ?? "not exposed by this browser session (never fabricated)"}`,
    `- Live manufacturer data: ${fingerprint?.manufacturerDataHex ?? "not captured this session"}`,
    `- Profile advertisement evidence: ${profile?.metadata.companyId !== undefined ? `company id 0x${Number(profile.metadata.companyId).toString(16).toUpperCase()}` : "none"}`,
  ].join("\n");
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

function structuredObservationsText(investigation: Investigation | null, tests: readonly GuidedTestDefinition[]): string {
  const completed = investigation?.completedTests ?? [];
  if (completed.length === 0) return "None recorded.";
  return completed.map((test) => {
    const definition = tests.find(({ id }) => id === test.testId);
    return [`### ${test.title}`, "", ...test.observations.map((value) => `- ${observationValueSummary(definition?.observation.find((spec) => spec.id === value.fieldId), value)}`)].join("\n");
  }).join("\n\n");
}

function driverRecommendationsText(claims: readonly ClaimState[], device: DeviceReportContext): string {
  const lines: string[] = [];
  const status = (id: ClaimId): string => claims.find((claim) => claim.id === id)?.status ?? "unknown";
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
