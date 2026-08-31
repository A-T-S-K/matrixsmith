import type { Capability } from "../core/capabilities";
import type { DeviceFingerprint, DeviceProfile } from "../core/device";
import type { DriverMatch } from "../drivers/types";
import type { DiagnosticBundleV1 } from "./bundle";
import type { TraceEvent } from "./trace";
import type { ProtocolTransaction } from "./transactions";
import type { DiagnosticRun } from "./workflows";
import type { ManualObservation } from "../core/evidence";

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
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = Object.freeze({
  goal: "", includeSummary: true, includeFingerprint: true, includeGatt: true, includeDriverResolution: true,
  includeCapabilities: true, includeDiagnosticRuns: true, includeTransactions: true, includeRawPacketHex: true,
  includeEvidence: true, includeObservations: true, includeIdentifiers: false, includeRawTrace: false,
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
  readonly protocolResolution: { readonly summary: string; readonly source: string } | null;
  readonly source: string;
}

export function reportDataFromBundle(bundle: DiagnosticBundleV1): ReportData {
  return {
    createdAt: bundle.createdAt, matrixsmithVersion: bundle.matrixsmithVersion, fingerprint: bundle.fingerprint,
    profile: null, selectedDriver: bundle.selectedDriver, driverMatches: bundle.driverMatches, capabilities: bundle.capabilities,
    transactions: bundle.transactions ?? [], diagnosticRuns: bundle.diagnosticRuns ?? [], observations: bundle.observations,
    trace: deserializeTrace(bundle.trace), protocolResolution: null, source: "imported diagnostic bundle",
  };
}

export function generateMarkdownReport(data: ReportData, options: ReportOptions = DEFAULT_REPORT_OPTIONS): string {
  const lines: string[] = ["# MatrixSmith Device Report", "", `- Generated: ${data.createdAt}`, `- MatrixSmith: ${data.matrixsmithVersion}`, `- Session source: ${data.source}`, `- Identifying information: ${options.includeIdentifiers ? "included by user choice" : "excluded by default"}`, ""];
  section(lines, "Goal / question", options.goal.trim() || "Not provided.");
  if (options.includeSummary) section(lines, "Executive summary", executiveSummary(data));
  section(lines, "Support status", supportTable(data));
  if (options.includeFingerprint) section(lines, "Device fingerprint", fingerprintText(data, options.includeIdentifiers));
  if (options.includeGatt) section(lines, "GATT", gattText(data.fingerprint));
  section(lines, "Advertisement / manufacturer evidence", advertisementText(data, options.includeIdentifiers));
  if (options.includeDriverResolution) section(lines, "Driver resolution", driverText(data));
  section(lines, "Device state", deviceStateText(data));
  if (options.includeCapabilities) section(lines, "Capabilities", capabilitiesText(data.capabilities));
  if (options.includeDiagnosticRuns) section(lines, "Diagnostic runs", diagnosticText(data.diagnosticRuns));
  if (options.includeTransactions) section(lines, "Protocol transactions", transactionText(data.transactions, options.includeRawPacketHex));
  if (options.includeObservations) section(lines, "Observations", listOrNone(data.observations.map((value) => `${value.recordedAt} — ${value.summary} (${value.confidence})`)));
  const facts = evidenceGroups(data);
  section(lines, "Verified facts", listOrNone(facts.verified));
  section(lines, "Inferred facts", listOrNone(facts.inferred));
  section(lines, "Unknowns", listOrNone(facts.unknowns));
  section(lines, "Rejected hypotheses", listOrNone(facts.rejected));
  section(lines, "Suggested next tests", listOrNone(suggestedTests(data)));
  section(lines, "Reproduction environment", `- Transport: ${data.fingerprint.transportKind}\n- Profile: ${data.profile?.id ?? "not available"}\n- Browser/device identifiers: ${options.includeIdentifiers ? data.fingerprint.browserDeviceId ?? "not recorded" : "omitted"}`);
  section(lines, "Protocol transcript", transcript(data.transactions, options.includeRawPacketHex));
  if (options.includeRawTrace) section(lines, "Raw event trace", traceText(data.trace, options.includeIdentifiers));
  section(lines, "Analysis request", options.goal.trim() || "Review the evidence, distinguish verified facts from inference, and suggest only safe next tests.");
  return `${lines.join("\n").trimEnd()}\n`;
}

function section(lines: string[], title: string, body: string): void { lines.push(`## ${title}`, "", body, ""); }
function executiveSummary(data: ReportData): string {
  const family = data.selectedDriver ?? (data.driverMatches.length ? "ambiguous protocol candidates" : "unknown protocol");
  return `${data.fingerprint.name ?? "Unnamed BLE display"}; ${family}; ${data.transactions.length} protocol transaction(s); ${data.diagnosticRuns.length} diagnostic run(s).`;
}
function supportTable(data: ReportData): string {
  const selected = Boolean(data.selectedDriver);
  const capability = (id: string): string => labelCapability(data.capabilities.find((item) => item.id === id));
  return ["| Area | Status | Evidence |", "| --- | --- | --- |", `| Bluetooth transport | ${data.fingerprint.services.length ? "Verified live" : "Blocked"} | ${data.fingerprint.services.length} accessible service(s) |`, `| Protocol identity | ${selected ? "Verified live" : "Experimental / gated"} | ${data.protocolResolution?.summary ?? "Static candidate evidence only"} |`, `| Read-only status | ${capability("device-info")} | Capability metadata |`, `| Transient control | ${capability("brightness")} | Capability metadata |`, "| Persistence | Experimental / gated | Persistence behavior is unknown |", "| Static framebuffer | Dry-run only | No verified live capability |", "| Pixel orientation | Unsupported | Not validated in this branch |", "| Color encoding | Unsupported | Not validated in this branch |", "| Stored programs | Unsupported | Explicit non-goal |", "| Animation | Dry-run only | No verified live capability |", "| Recovery | Experimental / gated | Brightness workflow restores baseline |"].join("\n");
}
function labelCapability(value: Capability | undefined): string { if (!value?.supported) return "Unsupported"; if (!value.live) return value.validation === "experimental" ? "Experimental / gated" : "Dry-run only"; return value.validation === "verified" ? "Verified live" : "Experimental / gated"; }
function fingerprintText(data: ReportData, identifiers: boolean): string {
  const f = data.fingerprint; const rows = [`- Product name: ${f.name ?? "unknown"}`, `- Transport: ${f.transportKind}`, `- Browser opaque device ID: ${identifiers ? f.browserDeviceId ?? "not recorded" : "omitted"}`, `- Live-session geometry: ${f.manuallyConfirmedGeometry ? `${f.manuallyConfirmedGeometry.width}×${f.manuallyConfirmedGeometry.height} (manually confirmed)` : "unknown"}`, `- Profile geometry: ${data.profile ? `${data.profile.width}×${data.profile.height} (${data.profile.id})` : "unknown"}`, "- Advertisement-derived geometry: unknown unless explicitly present in observed advertisement evidence"];
  return rows.join("\n");
}
function gattText(fingerprint: DeviceFingerprint): string { if (!fingerprint.services.length) return "No accessible GATT hierarchy recorded."; return fingerprint.services.flatMap((service) => [`- Service \`${service.uuid}\` (${service.isPrimary ? "primary" : "secondary"})`, ...service.characteristics.map((c) => `  - Characteristic \`${c.uuid}\`: ${Object.entries(c.properties).filter(([, on]) => on).map(([name]) => name).join(", ") || "no reported properties"}`)]).join("\n"); }
function advertisementText(data: ReportData, identifiers: boolean): string { const f = data.fingerprint; const manufacturer = identifiers ? f.manufacturerDataHex ?? "not recorded" : redactAddresses(f.manufacturerDataHex ?? "not recorded"); return `- Observed raw advertisement: ${f.rawAdvertisementHex ?? "not available"}\n- Observed manufacturer data: ${manufacturer}\n- Imported/profile evidence: ${data.profile?.evidence.map((item) => `${item.id}: ${item.summary}`).join("; ") ?? "not embedded in this session"}`; }
function driverText(data: ReportData): string { return data.driverMatches.map((match) => `### ${match.driverId}\n\n- State: ${match.driverId === data.selectedDriver ? "VERIFIED ON THIS SESSION" : match.score <= 0 ? "Rejected for this profile" : "Candidate"}\n- Evidence: ${match.reasons.join("; ") || "none"}\n- Rejected/contradicting evidence: ${match.contradictions.join("; ") || "none"}\n- Details: score ${match.score}; confidence ${match.confidence}`).join("\n\n") || "No driver candidates recorded."; }
function deviceStateText(data: ReportData): string { const last = [...data.transactions].reverse().find((t) => t.decodedResponse?.kind === "device-info")?.decodedResponse; return last ? Object.entries(last.fields).map(([key, value]) => `- ${key}: ${String(value)}`).join("\n") : "No verified device-state readback recorded."; }
function capabilitiesText(values: readonly Capability[]): string { return values.length ? ["| Capability | State | Risk | Persistence |", "| --- | --- | --- | --- |", ...values.map((c) => `| ${c.label} | ${labelCapability(c)} | ${c.risk} | ${c.persistence} |`)].join("\n") : "No resolved capabilities."; }
function diagnosticText(runs: readonly DiagnosticRun[]): string { return runs.map((run) => `### ${run.purpose}\n\n- Safety: ${run.safety.risk}; ${run.safety.explanation}\n- Result: ${run.status}\n- Steps:\n${run.steps.map((s) => `  - ${s.status}: ${s.label} — ${s.summary}`).join("\n")}\n- Findings: ${run.findings.join("; ") || "none"}`).join("\n\n") || "No diagnostic runs recorded."; }
function transactionText(values: readonly ProtocolTransaction[], raw: boolean): string { return values.map((t) => `### ${t.operation}\n\n- Driver: ${t.driverId ?? "none"}\n- Risk: ${t.safety.risk}; ${t.safety.validation}\n- Status: host=${t.hostAccepted}; protocol=${String(t.protocolAcknowledged)}; device verified=${t.deviceStateVerified}; timeout=${t.responseTimedOut}${t.error ? `; error=${t.error}` : ""}\n${raw ? `- TX: ${t.packets.filter((p) => p.direction === "TX").map((p) => p.hex).join(" | ") || "none"}\n- RX: ${t.packets.filter((p) => p.direction === "RX").map((p) => p.hex).join(" | ") || "none"}` : "- Raw packet hex: excluded"}\n- Decoded: ${t.decodedResponse ? `${t.decodedResponse.summary}; fields=${JSON.stringify(t.decodedResponse.fields)}` : "none"}`).join("\n\n") || "No protocol transactions recorded."; }
function evidenceGroups(data: ReportData): { verified: string[]; inferred: string[]; unknowns: string[]; rejected: string[] } { const verified = data.profile?.evidence.filter((e) => e.confidence === "observed" || e.confidence === "corroborated").map((e) => e.summary) ?? []; const inferred = data.profile?.evidence.filter((e) => e.confidence === "inferred" || e.confidence === "speculative").map((e) => e.summary) ?? []; const rejected = data.driverMatches.flatMap((m) => m.contradictions); return { verified, inferred, rejected, unknowns: ["Persistence behavior is not established.", "Pixel orientation and color encoding are not validated here.", "Stored-program/content behavior is outside this branch."] }; }
function suggestedTests(data: ReportData): string[] { if (!data.fingerprint.services.length) return ["Connect a display and enumerate browser-authorized GATT services."]; if (!data.selectedDriver) return data.driverMatches.some((m) => m.driverId === "coolledux" && m.score > 0) ? ["Run safe CoolLEDUX identification (verified read-only 0x1F query)."] : ["No verified safe family probe is available; collect GATT evidence without writing."]; return data.selectedDriver === "coolledux" ? ["Refresh device info.", "Optionally run the explicit reversible brightness round-trip."] : ["Review driver support metadata before any live command."]; }
function transcript(values: readonly ProtocolTransaction[], raw: boolean): string { if (!values.length) return "No protocol transcript."; return ["| Timestamp | Operation | Direction | Packet | Result |", "| --- | --- | --- | --- | --- |", ...values.flatMap((t) => t.packets.map((p) => `| ${p.timestamp} | ${t.operation} | ${p.direction} | ${raw ? `\`${p.hex}\`` : "excluded"} | ${t.error ?? (t.deviceStateVerified ? "device verified" : t.protocolAcknowledged ? "protocol acknowledged" : t.hostAccepted ? "host accepted" : "not accepted")} |`))].join("\n"); }
function traceText(values: readonly TraceEvent[], identifiers: boolean): string { return values.map((e) => `- ${e.timestamp} ${e.type} ${JSON.stringify(sanitizeMetadata(e.metadata, identifiers))}${e.rawBytes ? ` raw=${[...e.rawBytes].map((b) => b.toString(16).padStart(2, "0")).join(" ").toUpperCase()}` : ""}`).join("\n") || "No raw events."; }
function listOrNone(values: readonly string[]): string { return values.length ? values.map((value) => `- ${value}`).join("\n") : "None recorded."; }
function sanitizeMetadata(metadata: Readonly<Record<string, string | number | boolean | null>>, identifiers: boolean): Readonly<Record<string, string | number | boolean | null>> { if (identifiers) return metadata; return Object.fromEntries(Object.entries(metadata).filter(([key]) => !/deviceid|browserdeviceid|mac|address|location/i.test(key))); }
function redactAddresses(value: string): string { return value.replace(/\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi, "[redacted address]"); }
function deserializeTrace(values: readonly Record<string, unknown>[]): TraceEvent[] { return values.filter((v) => typeof v.timestamp === "string" && typeof v.type === "string").map((v) => ({ timestamp: String(v.timestamp), type: v.type as TraceEvent["type"], metadata: typeof v.metadata === "object" && v.metadata ? v.metadata as TraceEvent["metadata"] : {}, ...(typeof v.rawHex === "string" ? { rawBytes: Uint8Array.from(v.rawHex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16)) } : {}) })); }
