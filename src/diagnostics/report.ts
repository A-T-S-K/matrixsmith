import type { Capability } from "../core/capabilities";
import type { DeviceFingerprint, DeviceProfile } from "../core/device";
import type { DriverMatch } from "../drivers/types";
import type { DiagnosticBundle } from "./bundle";
import type { TraceEvent } from "./trace";
import type { ProtocolTransaction } from "./transactions";
import type { DiagnosticRun } from "./workflows";
import type { ManualObservation } from "../core/evidence";
import type { ContentCompilationRecord } from "./content-evidence";
import {
  assessDevice,
  type DeviceAssessment,
} from "../domain/device/assessment";

export interface ReportOptions {
  readonly goal: string;
  readonly includeSummary: boolean;
  readonly includeFingerprint: boolean;
  readonly includeGatt: boolean;
  readonly includeDriverResolution: boolean;
  readonly includeCapabilities: boolean;
  readonly includeDiagnosticRuns: boolean;
  readonly includeTransactions: boolean;
  readonly includeRawPacketHex: boolean;
  readonly includeEvidence: boolean;
  readonly includeObservations: boolean;
  readonly includeIdentifiers: boolean;
  readonly includeRawTrace: boolean;
  /** Include user-entered text content (e.g. rendered text messages) in the report. */
  readonly includeTextContent: boolean;
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = Object.freeze({
  goal: "",
  includeSummary: true,
  includeFingerprint: true,
  includeGatt: true,
  includeDriverResolution: true,
  includeCapabilities: true,
  includeDiagnosticRuns: true,
  includeTransactions: true,
  includeRawPacketHex: true,
  includeEvidence: true,
  includeObservations: true,
  includeIdentifiers: false,
  includeRawTrace: false,
  includeTextContent: false,
});

export interface ReportData {
  readonly createdAt: string;
  readonly matrixsmithVersion: string;
  readonly fingerprint: DeviceFingerprint;
  readonly profile: DeviceProfile | null;
  readonly selectedDriver: string | null;
  readonly driverMatches: readonly DriverMatch[];
  readonly capabilities: readonly Capability[];
  readonly transactions: readonly ProtocolTransaction[];
  readonly diagnosticRuns: readonly DiagnosticRun[];
  readonly observations: readonly ManualObservation[];
  readonly trace: readonly TraceEvent[];
  readonly protocolResolution: {
    readonly summary: string;
    readonly source: string;
  } | null;
  readonly contentCompilations: readonly ContentCompilationRecord[];
  readonly importedEvidence: readonly {
    readonly provenance: string;
    readonly transactionCount: number;
    readonly warnings: readonly string[];
  }[];
  readonly liveConnected: boolean;
  readonly source: string;
  /** Canonical product truth used by every report projection. */
  readonly assessment?: DeviceAssessment;
  /** Whether a guided investigation is active in the source workspace. */
  readonly investigationActive?: boolean;
}

export function reportDataFromBundle(bundle: DiagnosticBundle): ReportData {
  return {
    createdAt: bundle.createdAt,
    matrixsmithVersion: bundle.matrixsmithVersion,
    fingerprint: bundle.fingerprint,
    profile: null,
    selectedDriver: bundle.selectedDriver,
    driverMatches: bundle.driverMatches,
    capabilities: bundle.capabilities,
    transactions: bundle.transactions ?? [],
    diagnosticRuns: bundle.diagnosticRuns ?? [],
    observations: bundle.observations,
    trace: deserializeTrace(bundle.trace),
    protocolResolution: null,
    contentCompilations: bundle.contentCompilations ?? [],
    importedEvidence: bundle.importedEvidence ?? [],
    liveConnected: false,
    source: "imported diagnostic bundle",
    assessment: bundle.assessment,
  };
}

export function generateMarkdownReport(
  data: ReportData,
  options: ReportOptions = DEFAULT_REPORT_OPTIONS,
): string {
  const lines: string[] = [
    "# MatrixSmith Device Report",
    "",
    `- Generated: ${data.createdAt}`,
    `- MatrixSmith: ${data.matrixsmithVersion}`,
    `- Session source: ${data.source}`,
    `- Identifying information: ${options.includeIdentifiers ? "included by user choice" : "excluded by default"}`,
    "",
  ];
  section(lines, "Goal / question", options.goal.trim() || "Not provided.");
  if (options.includeSummary)
    section(lines, "Executive summary", executiveSummary(data));
  section(lines, "Support status", supportTable(data));
  if (options.includeFingerprint)
    section(
      lines,
      "Device fingerprint",
      fingerprintText(data, options.includeIdentifiers),
    );
  if (options.includeGatt) section(lines, "GATT", gattText(data.fingerprint));
  section(
    lines,
    "Advertisement / manufacturer evidence",
    advertisementText(data, options.includeIdentifiers),
  );
  if (options.includeDriverResolution)
    section(lines, "Driver resolution", driverText(data));
  section(lines, "Device state", deviceStateText(data));
  if (options.includeCapabilities)
    section(lines, "Capabilities", capabilitiesText(data.capabilities));
  if (options.includeDiagnosticRuns)
    section(lines, "Diagnostic runs", diagnosticText(data.diagnosticRuns));
  if (data.contentCompilations.length)
    section(
      lines,
      "Content compiler evidence",
      compilationText(data.contentCompilations, options.includeTextContent),
    );
  if (data.importedEvidence.length)
    section(
      lines,
      "Imported external evidence",
      importedEvidenceText(data.importedEvidence),
    );
  if (options.includeTransactions)
    section(
      lines,
      "Protocol transactions",
      transactionText(data.transactions, options.includeRawPacketHex),
    );
  if (options.includeObservations)
    section(
      lines,
      "Observations",
      listOrNone(
        data.observations.map(
          (value) =>
            `${value.recordedAt} — ${value.summary} (${value.confidence})`,
        ),
      ),
    );
  const facts = evidenceGroups(data);
  section(lines, "Verified facts", listOrNone(facts.verified));
  section(lines, "Inferred facts", listOrNone(facts.inferred));
  section(lines, "Unknowns", listOrNone(facts.unknowns));
  section(lines, "Rejected hypotheses", listOrNone(facts.rejected));
  const assessment = reportAssessment(data);
  const recommended = assessment.recommendedActionId
    ? assessment.actions.find(({ id }) => id === assessment.recommendedActionId)
    : null;
  section(
    lines,
    "Suggested next step",
    recommended
      ? `- ${recommended.label}: ${recommended.reason}`
      : "No additional action is currently recommended.",
  );
  section(
    lines,
    "Reproduction environment",
    `- Transport: ${data.fingerprint.transportKind}\n- Profile: ${data.profile?.id ?? "not available"}\n- Browser/device identifiers: ${options.includeIdentifiers ? (data.fingerprint.browserDeviceId ?? "not recorded") : "omitted"}`,
  );
  section(
    lines,
    "Protocol transcript",
    transcript(data.transactions, options.includeRawPacketHex),
  );
  if (options.includeRawTrace)
    section(
      lines,
      "Raw event trace",
      traceText(data.trace, options.includeIdentifiers),
    );
  section(
    lines,
    "Analysis request",
    options.goal.trim() ||
      "Review the evidence, distinguish verified facts from inference, and suggest only safe next tests.",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

function section(lines: string[], title: string, body: string): void {
  lines.push(`## ${title}`, "", body, "");
}
function executiveSummary(data: ReportData): string {
  const family =
    data.selectedDriver ??
    (data.driverMatches.length
      ? "ambiguous protocol candidates"
      : "unknown protocol");
  return `${data.fingerprint.name ?? "Unnamed BLE display"}; ${family}; ${data.transactions.length} protocol transaction(s); ${data.diagnosticRuns.length} diagnostic run(s).`;
}
function supportTable(data: ReportData): string {
  return [
    "| Capability | Availability | Confidence | Reason |",
    "| --- | --- | --- | --- |",
    ...Object.values(reportAssessment(data).capabilities).map(
      (row) =>
        `| ${row.label} | ${row.availability} | ${row.confidence} | ${row.reason} |`,
    ),
  ].join("\n");
}
function reportAssessment(data: ReportData): DeviceAssessment {
  return (
    data.assessment ??
    assessDevice({
      target: {
        kind: "unresolved",
        fingerprint: data.fingerprint,
        candidates: data.driverMatches,
      },
      evidence: [],
      capabilities: data.capabilities,
      live: data.liveConnected,
    })
  );
}
function fingerprintText(data: ReportData, identifiers: boolean): string {
  const f = data.fingerprint;
  const advertisedGeometry = profileGeometryFromAdvertisement(data.profile);
  const rows = [
    `- Product name: ${f.name ?? "unknown"}`,
    `- Transport: ${f.transportKind}`,
    `- Browser opaque device ID: ${identifiers ? (f.browserDeviceId ?? "not recorded") : "omitted"}`,
    `- Live-session geometry: ${f.manuallyConfirmedGeometry ? `${f.manuallyConfirmedGeometry.width}×${f.manuallyConfirmedGeometry.height} (manually confirmed)` : "unknown"}`,
    `- Physical/profile geometry: ${data.profile ? `${data.profile.width}×${data.profile.height} (${data.profile.id})` : "unknown"}`,
    `- Captured/profile advertisement geometry: ${advertisedGeometry ?? "not embedded in this session"}`,
  ];
  return rows.join("\n");
}
function profileGeometryFromAdvertisement(
  profile: DeviceProfile | null,
): string | null {
  if (!profile) return null;
  const width = profile.metadata.width;
  const height = profile.metadata.height;
  if (typeof width !== "number" || typeof height !== "number") return null;
  return `${width}×${height} (from captured advertisement evidence)`;
}
function gattText(fingerprint: DeviceFingerprint): string {
  if (!fingerprint.services.length)
    return "No accessible GATT hierarchy recorded.";
  return fingerprint.services
    .flatMap((service) => [
      `- Service \`${service.uuid}\` (${service.isPrimary ? "primary" : "secondary"})`,
      ...service.characteristics.map(
        (c) =>
          `  - Characteristic \`${c.uuid}\`: ${
            Object.entries(c.properties)
              .filter(([, on]) => on)
              .map(([name]) => name)
              .join(", ") || "no reported properties"
          }`,
      ),
    ])
    .join("\n");
}
function advertisementText(data: ReportData, identifiers: boolean): string {
  const f = data.fingerprint;
  const manufacturer = identifiers
    ? (f.manufacturerDataHex ?? "not recorded")
    : redactAddresses(f.manufacturerDataHex ?? "not recorded");
  const advertisedGeometry = profileGeometryFromAdvertisement(data.profile);
  return [
    `- Live-session advertisement: ${f.rawAdvertisementHex ?? "not available (Web Bluetooth does not expose advertisement bytes)"}`,
    `- Live-session manufacturer data: ${manufacturer}`,
    `- Captured/profile advertisement evidence: ${advertisedGeometry ?? "not embedded in this session"}`,
    `- Profile evidence: ${
      data.profile?.evidence
        .filter((item) => item.disposition !== "rejects")
        .map((item) => `${item.id}: ${item.summary}`)
        .join("; ") ?? "not embedded in this session"
    }`,
  ].join("\n");
}
function driverText(data: ReportData): string {
  return (
    data.driverMatches
      .map((match) => {
        const profileRejections = (data.profile?.evidence ?? []).filter(
          (item) =>
            item.disposition === "rejects" &&
            mentionsDriver(item.summary + item.id, match.driverId),
        );
        const state =
          match.driverId === data.selectedDriver
            ? "VERIFIED ON THIS SESSION"
            : profileRejections.length > 0
              ? "Protocol hypothesis rejected for this profile (static transport shape remains compatible)"
              : match.score <= 0
                ? "Rejected for this profile"
                : "Candidate";
        return [
          `### ${match.driverId}`,
          "",
          `- State: ${state}`,
          `- Static transport match: score ${match.score}; confidence ${match.confidence}${match.score > 0 ? " (shared FFF0/FFF1 GATT shape)" : ""}`,
          `- Static-match evidence: ${match.reasons.join("; ") || "none"}`,
          `- Profile protocol evidence: ${profileRejections.length > 0 ? profileRejections.map((item) => `REJECTED — ${item.summary}`).join("; ") : match.driverId === data.selectedDriver ? (data.protocolResolution?.summary ?? "resolved by session evidence") : "none recorded"}`,
          `- Session contradictions: ${match.contradictions.join("; ") || "none"}`,
        ].join("\n");
      })
      .join("\n\n") || "No driver candidates recorded."
  );
}
function mentionsDriver(text: string, driverId: string): boolean {
  const value = text.toLowerCase();
  if (driverId === "coolledx")
    return /coolledx|classic/.test(value) && !value.includes("coolledux");
  return value.includes(driverId.toLowerCase());
}
function deviceStateText(data: ReportData): string {
  const last = [...data.transactions]
    .reverse()
    .find((t) => t.decodedResponse?.kind === "device-info")?.decodedResponse;
  return last
    ? Object.entries(last.fields)
        .map(([key, value]) => `- ${key}: ${String(value)}`)
        .join("\n")
    : "No verified device-state readback recorded.";
}
function labelCapability(value: Capability): string {
  if (value.validation === "rejected") return "Rejected";
  if (value.validation === "verified" && value.live) return "Verified live";
  if (value.validation === "verified")
    return "Verified (dry-run only this session)";
  if (value.validation === "experimental")
    return value.live
      ? "Experimental / gated"
      : "Experimental / not tested here";
  return "Not tested";
}
function capabilitiesText(values: readonly Capability[]): string {
  return values.length
    ? [
        "| Capability | State | Risk | Persistence |",
        "| --- | --- | --- | --- |",
        ...values.map(
          (c) =>
            `| ${c.label} | ${labelCapability(c)} | ${c.risk} | ${c.persistence} |`,
        ),
      ].join("\n")
    : "No resolved capabilities.";
}
function diagnosticText(runs: readonly DiagnosticRun[]): string {
  return (
    runs
      .map(
        (run) =>
          `### ${run.purpose}\n\n- Safety: ${run.safety.risk}; ${run.safety.explanation}\n- Result: ${run.status}\n- Steps:\n${run.steps.map((s) => `  - ${s.status}: ${s.label} — ${s.summary}`).join("\n")}\n- Findings: ${run.findings.join("; ") || "none"}`,
      )
      .join("\n\n") || "No diagnostic runs recorded."
  );
}
function compilationText(
  values: readonly ContentCompilationRecord[],
  includeText: boolean,
): string {
  return values
    .map((record) =>
      [
        `### ${record.operation} (${record.contentType})`,
        "",
        `- Logical dimensions: ${record.width}×${record.height}`,
        `- Tiles: ${record.tileCount} (tile width ${record.tileWidth})`,
        `- Program size: ${record.programBytes} bytes uncompressed`,
        `- CRC32 (custom): 0x${record.crc32.toString(16).padStart(8, "0").toUpperCase()}`,
        `- Compressed size: ${record.compressedBytes} bytes (${record.compression})`,
        `- Chunks: ${record.chunkCount} data packet(s) + 1 announce`,
        `- Pacing: ${record.pacingMs} ms between packets`,
        ...(record.frameCount !== undefined
          ? [
              `- Frames: ${record.frameCount}${record.frameDelaysMs ? `; delays ${record.frameDelaysMs.join("/")} ms` : ""}`,
            ]
          : []),
        ...(record.sourceDimensions
          ? [
              `- Source image: ${record.sourceDimensions}${record.fitMode ? `; fit mode ${record.fitMode}` : ""}`,
            ]
          : []),
        ...(record.textContent !== undefined
          ? [
              `- Text content: ${includeText ? JSON.stringify(record.textContent) : "omitted (enable text content to include)"}${record.textRendering ? `; rendering ${record.textRendering}` : ""}`,
            ]
          : []),
      ].join("\n"),
    )
    .join("\n\n");
}
function importedEvidenceText(
  values: readonly ReportData["importedEvidence"][number][],
): string {
  return values
    .map(
      (entry) =>
        `- Source: ${entry.provenance}; ${entry.transactionCount} parsed transaction(s); warnings: ${entry.warnings.length ? entry.warnings.join("; ") : "none"}`,
    )
    .join("\n");
}
function transactionText(
  values: readonly ProtocolTransaction[],
  raw: boolean,
): string {
  return (
    values
      .map(
        (t) =>
          `### ${t.operation}\n\n- Source: ${sourceLabel(t)}\n- Driver: ${t.driverId ?? "none"}\n- Risk: ${t.safety.risk}; ${t.safety.validation}\n- Status: host=${t.hostAccepted}; protocol=${String(t.protocolAcknowledged)}; device verified=${t.deviceStateVerified}; timeout=${t.responseTimedOut}${t.error ? `; error=${t.error}` : ""}\n${
            raw
              ? `- TX: ${
                  t.packets
                    .filter((p) => p.direction === "TX")
                    .map((p) => p.hex)
                    .join(" | ") || "none"
                }\n- RX: ${
                  t.packets
                    .filter((p) => p.direction === "RX")
                    .map((p) => p.hex)
                    .join(" | ") || "none"
                }`
              : "- Raw packet hex: excluded"
          }\n- Decoded: ${t.decodedResponse ? `${t.decodedResponse.summary}; fields=${JSON.stringify(t.decodedResponse.fields)}` : "none"}`,
      )
      .join("\n\n") || "No protocol transactions recorded."
  );
}
function sourceLabel(t: ProtocolTransaction): string {
  if (t.sessionSource === "imported")
    return t.source === "external-import"
      ? "nRF Connect import"
      : "imported bundle";
  if (t.sessionSource === "live") return "live MatrixSmith";
  if (t.sessionSource === "replay") return "fixture/replay";
  return t.sessionSource;
}
function evidenceGroups(data: ReportData): {
  verified: string[];
  inferred: string[];
  unknowns: string[];
  rejected: string[];
} {
  const supporting = (data.profile?.evidence ?? []).filter(
    (e) => e.disposition !== "rejects",
  );
  const verified = supporting
    .filter(
      (e) => e.confidence === "observed" || e.confidence === "corroborated",
    )
    .map((e) => e.summary);
  const inferred = supporting
    .filter(
      (e) => e.confidence === "inferred" || e.confidence === "speculative",
    )
    .map((e) => e.summary);
  const rejected = [
    ...(data.profile?.evidence ?? [])
      .filter((e) => e.disposition === "rejects")
      .map((e) => e.summary),
    ...data.driverMatches.flatMap((m) => m.contradictions),
  ];
  const unknowns = reportAssessment(data).unresolvedClaims.map(
    (claim) =>
      `${claim.label}: ${claim.status} — ${claim.decidedBy?.summary ?? "No decisive evidence."}`,
  );
  return { verified, inferred, rejected, unknowns };
}
function transcript(
  values: readonly ProtocolTransaction[],
  raw: boolean,
): string {
  if (!values.length) return "No protocol transcript.";
  return [
    "| Timestamp | Operation | Direction | Packet | Result |",
    "| --- | --- | --- | --- | --- |",
    ...values.flatMap((t) =>
      t.packets.map(
        (p) =>
          `| ${p.timestamp} | ${t.operation} | ${p.direction} | ${raw ? `\`${p.hex}\`` : "excluded"} | ${t.error ?? (t.deviceStateVerified ? "device verified" : t.protocolAcknowledged ? "protocol acknowledged" : t.hostAccepted ? "host accepted" : "not accepted")} |`,
      ),
    ),
  ].join("\n");
}
function traceText(
  values: readonly TraceEvent[],
  identifiers: boolean,
): string {
  return (
    values
      .map(
        (e) =>
          `- ${e.timestamp} ${e.type} ${JSON.stringify(sanitizeMetadata(e.metadata, identifiers))}${
            e.rawBytes
              ? ` raw=${[...e.rawBytes]
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join(" ")
                  .toUpperCase()}`
              : ""
          }`,
      )
      .join("\n") || "No raw events."
  );
}
function listOrNone(values: readonly string[]): string {
  return values.length
    ? values.map((value) => `- ${value}`).join("\n")
    : "None recorded.";
}
function sanitizeMetadata(
  metadata: Readonly<Record<string, string | number | boolean | null>>,
  identifiers: boolean,
): Readonly<Record<string, string | number | boolean | null>> {
  if (identifiers) return metadata;
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => !/deviceid|browserdeviceid|mac|address|location/i.test(key),
    ),
  );
}
function redactAddresses(value: string): string {
  return value.replace(
    /\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi,
    "[redacted address]",
  );
}
function deserializeTrace(
  values: readonly Record<string, unknown>[],
): TraceEvent[] {
  return values
    .filter(
      (v) => typeof v.timestamp === "string" && typeof v.type === "string",
    )
    .map((v) => ({
      timestamp: String(v.timestamp),
      type: v.type as TraceEvent["type"],
      metadata:
        typeof v.metadata === "object" && v.metadata
          ? (v.metadata as TraceEvent["metadata"])
          : {},
      ...(typeof v.rawHex === "string"
        ? {
            rawBytes: Uint8Array.from(v.rawHex.match(/../g) ?? [], (pair) =>
              Number.parseInt(pair, 16),
            ),
          }
        : {}),
    }));
}
