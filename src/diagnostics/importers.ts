import type {
  DeviceFingerprint,
  GattCharacteristicFingerprint,
  GattServiceFingerprint,
} from "../core/device";
import { normalizeUuid } from "../core/device";
import type { ManualObservation } from "../core/evidence";
import { packetHex } from "../core/transmission";
import type { MatrixDriver, DecodedNotification } from "../drivers/types";
import type { ProtocolTransaction } from "./transactions";
import { transactionId } from "./transactions";
import { decodeEnvelope } from "../drivers/coolled/common/envelope";

/**
 * External-capture importers turn a foreign capture into MatrixSmith's own
 * evidence model without ever replaying traffic: imported sessions stay
 * read-only. The importer extracts bytes and structure conservatively and
 * never invents packet semantics; semantic decoding is delegated to the
 * installed drivers afterwards.
 */
export interface EvidenceImporter {
  readonly id: string;
  readonly label: string;
  /** Human-readable source format, e.g. "nRF Connect text log". */
  readonly format: string;
  /** Cheap sniff so the UI can route a pasted/opened file to an importer. */
  canImport(content: string): boolean;
  parse(content: string, options?: ImportOptions): ImportedEvidence;
}

export interface ImportOptions {
  /** Drivers used to decode extracted packets. No decoding when empty. */
  readonly drivers?: readonly MatrixDriver[];
  /** Preserve the original log text as imported evidence. */
  readonly keepRawLog?: boolean;
}

export interface ImportedGattEvent {
  readonly timestamp: string | null;
  readonly kind:
    | "connect"
    | "disconnect"
    | "service-discovery"
    | "descriptor-write"
    | "notifications-enabled"
    | "error";
  readonly detail: string;
}

export interface ImportedEvidence {
  readonly fingerprint: DeviceFingerprint | null;
  readonly deviceName: string | null;
  /**
   * BLE/MAC address seen in the capture. Identifying information: kept out
   * of the fingerprint and out of shareable Markdown by default; surfaced
   * only in the local import summary.
   */
  readonly bleAddress: string | null;
  readonly transactions: readonly ProtocolTransaction[];
  readonly gattEvents: readonly ImportedGattEvent[];
  readonly observations: readonly ManualObservation[];
  readonly warnings: readonly string[];
  readonly unparsedLineCount: number;
  readonly totalLineCount: number;
  /** Provenance note shown wherever this evidence is surfaced. */
  readonly provenance: string;
  readonly rawLog?: string;
}

interface RawPacketEvent {
  readonly timestamp: string;
  readonly kind: "tx" | "rx" | "read";
  readonly characteristicUuid: string;
  readonly bytes: Uint8Array;
}

const TIMESTAMP_PATTERN = /^([VDIWEA])\t(\d{2}:\d{2}:\d{2}\.\d{3})\t(.*)$/;
const ADDRESS_PATTERN = /\b((?:[0-9A-F]{2}:){5}[0-9A-F]{2})\b/i;
const UUID_PATTERN =
  /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|0x[0-9a-fA-F]{4})/;
const RX_CORRELATION_WINDOW_MS = 3000;

export const nrfConnectTextLogImporter: EvidenceImporter = {
  id: "nrf-connect-text-log",
  label: "nRF Connect text log",
  format: "nRF Connect for Android exported text log",
  canImport(content: string): boolean {
    return (
      /nRF Connect/i.test(content) ||
      /gatt\.writeCharacteristic\(/.test(content) ||
      /Notification received from/.test(content) ||
      /Data written to/.test(content)
    );
  },
  parse(content: string, options: ImportOptions = {}): ImportedEvidence {
    return parseNrfConnectLog(content, options);
  },
};

export const EVIDENCE_IMPORTERS: readonly EvidenceImporter[] = Object.freeze([
  nrfConnectTextLogImporter,
]);

export function findImporter(content: string): EvidenceImporter | null {
  return (
    EVIDENCE_IMPORTERS.find((importer) => importer.canImport(content)) ?? null
  );
}

function parseNrfConnectLog(
  content: string,
  options: ImportOptions,
): ImportedEvidence {
  const lines = content.split(/\r?\n/);
  const warnings: string[] = [];
  const gattEvents: ImportedGattEvent[] = [];
  const packets: RawPacketEvent[] = [];
  const services = new Map<
    string,
    {
      isPrimary: boolean;
      characteristics: Map<string, GattCharacteristicFingerprint>;
    }
  >();
  let deviceName: string | null = null;
  let bleAddress: string | null = null;
  let baseDate = "1970-01-01";
  let currentServiceUuid: string | null = null;
  let unparsedLineCount = 0;
  let parsedAnything = false;

  const noteService = (uuid: string): void => {
    const normalized = normalizeUuid(uuid);
    if (!services.has(normalized))
      services.set(normalized, { isPrimary: true, characteristics: new Map() });
    currentServiceUuid = normalized;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) continue;
    // Header lines have no level/timestamp prefix.
    const headerDate = /^nRF Connect(?:,| -)?\s*(\d{4}-\d{2}-\d{2})?/.exec(
      line,
    );
    if (headerDate && index < 5) {
      if (headerDate[1]) baseDate = headerDate[1];
      parsedAnything = true;
      continue;
    }
    const headerDevice =
      /^([^\t]+?)\s*\(((?:[0-9A-F]{2}:){5}[0-9A-F]{2})\)\s*$/i.exec(line);
    if (headerDevice && index < 5) {
      deviceName = headerDevice[1] ?? null;
      bleAddress = headerDevice[2] ?? null;
      parsedAnything = true;
      continue;
    }
    // GATT hierarchy continuation lines: "- Name [PROPS] (uuid)" and indented descriptors.
    const characteristicLine =
      /^-\s+(.+?)\s+\[([A-Z\s]+)\]\s+\((.+?)\)\s*$/.exec(line.trim());
    if (characteristicLine && currentServiceUuid) {
      const props = (characteristicLine[2] ?? "").trim().split(/\s+/);
      const uuid = normalizeUuid(shortUuid(characteristicLine[3] ?? ""));
      const service = services.get(currentServiceUuid);
      service?.characteristics.set(uuid, {
        uuid,
        properties: {
          read: props.includes("R"),
          write: props.includes("W"),
          writeWithoutResponse: props.includes("WNR"),
          notify: props.includes("N"),
          indicate: props.includes("I"),
        },
      });
      parsedAnything = true;
      continue;
    }
    if (/^\s+\S/.test(line) && currentServiceUuid) {
      parsedAnything = true;
      continue;
    } // descriptor listing under a characteristic

    const match = TIMESTAMP_PATTERN.exec(line);
    if (!match) {
      unparsedLineCount += 1;
      continue;
    }
    const [, level, time, message] = match as unknown as [
      string,
      string,
      string,
      string,
    ];
    const timestamp = `${baseDate}T${time}Z`;
    parsedAnything = true;

    if (/^Connecting to/.test(message) || /^Connected to/.test(message)) {
      const address = ADDRESS_PATTERN.exec(message)?.[1];
      if (address) bleAddress = bleAddress ?? address;
      if (/^Connected to/.test(message))
        gattEvents.push({ timestamp, kind: "connect", detail: "Connected" });
      continue;
    }
    if (/^Disconnected/.test(message)) {
      gattEvents.push({
        timestamp,
        kind: "disconnect",
        detail: "Disconnected",
      });
      continue;
    }
    if (level === "E" || /^Error/.test(message)) {
      gattEvents.push({
        timestamp,
        kind: "error",
        detail: redactAddress(message),
      });
      continue;
    }
    if (/^Services discovered/.test(message)) {
      gattEvents.push({
        timestamp,
        kind: "service-discovery",
        detail: "Services discovered",
      });
      continue;
    }
    const serviceHeading = /^(.+?)\s+\((.+?)\)\s*$/.exec(message);
    if (
      serviceHeading &&
      /Service|Access|Attribute/i.test(serviceHeading[1] ?? "") &&
      UUID_PATTERN.test(serviceHeading[2] ?? "")
    ) {
      noteService(shortUuid(serviceHeading[2] ?? ""));
      continue;
    }
    if (
      /writeDescriptor\(.*2902.*value=0x0100\)/i.test(message) ||
      /"Notifications enabled" sent/.test(message)
    ) {
      gattEvents.push({
        timestamp,
        kind: "notifications-enabled",
        detail:
          "Client Characteristic Configuration written (notifications enabled)",
      });
      continue;
    }
    if (/Data written to descr\./.test(message)) {
      gattEvents.push({
        timestamp,
        kind: "descriptor-write",
        detail: redactAddress(message),
      });
      continue;
    }

    // TX evidence. The "Data written" confirmation is authoritative; the
    // preceding gatt.writeCharacteristic value is a fallback when the
    // confirmation is missing (e.g. truncated logs).
    const dataWritten = /^Data written to ([0-9a-fA-F-]+),/.exec(message);
    if (dataWritten) {
      const bytes = extractHexValue(message);
      if (bytes) {
        const uuid = normalizeUuid(dataWritten[1] ?? "");
        const previous = packets[packets.length - 1];
        if (
          previous &&
          previous.kind === "tx" &&
          previous.characteristicUuid === uuid &&
          sameBytes(previous.bytes, bytes) &&
          previous.timestamp >= `${baseDate}T00:00:00.000Z`
        ) {
          // Confirmation of the immediately preceding writeCharacteristic; keep one event with the confirmed timestamp.
          packets[packets.length - 1] = { ...previous, timestamp };
        } else {
          packets.push({
            timestamp,
            kind: "tx",
            characteristicUuid: uuid,
            bytes,
          });
        }
      } else
        warnings.push(
          `Line ${index + 1}: TX confirmation without parseable bytes.`,
        );
      continue;
    }
    const writeCall =
      /gatt\.writeCharacteristic\(([0-9a-fA-F-]+),\s*value=0x([0-9A-Fa-f]+)/.exec(
        message,
      );
    if (writeCall) {
      const bytes = fromPlainHex(writeCall[2] ?? "");
      if (bytes)
        packets.push({
          timestamp,
          kind: "tx",
          characteristicUuid: normalizeUuid(writeCall[1] ?? ""),
          bytes,
        });
      else
        warnings.push(
          `Line ${index + 1}: writeCharacteristic without parseable bytes.`,
        );
      continue;
    }
    const notification = /^Notification received from ([0-9a-fA-F-]+),/.exec(
      message,
    );
    if (notification) {
      const bytes = extractHexValue(message);
      if (bytes)
        packets.push({
          timestamp,
          kind: "rx",
          characteristicUuid: normalizeUuid(notification[1] ?? ""),
          bytes,
        });
      else
        warnings.push(
          `Line ${index + 1}: notification without parseable bytes.`,
        );
      continue;
    }
    const readResponse = /^Read Response received from ([0-9a-fA-F-]+),/.exec(
      message,
    );
    if (readResponse) {
      const bytes = extractHexValue(message) ?? new Uint8Array(0);
      packets.push({
        timestamp,
        kind: "read",
        characteristicUuid: normalizeUuid(readResponse[1] ?? ""),
        bytes,
      });
      continue;
    }
    if (
      /^(Writing command|Reading characteristic|Enabling notifications|Discovering services)/.test(
        message,
      ) ||
      /gatt\.(setCharacteristicNotification|discoverServices|readCharacteristic)/.test(
        message,
      ) ||
      /^"(.*)" (sent|received)$/.test(message) ||
      /^gatt = /.test(message)
    )
      continue;
    unparsedLineCount += 1;
  }

  if (!parsedAnything) {
    return {
      fingerprint: null,
      deviceName: null,
      bleAddress: null,
      transactions: [],
      gattEvents: [],
      observations: [],
      warnings: ["No recognizable nRF Connect log content found."],
      unparsedLineCount,
      totalLineCount: lines.length,
      provenance: "nRF Connect text log import (empty)",
    };
  }

  const fingerprint = buildFingerprint(deviceName, services);
  const drivers = options.drivers ?? [];
  const transactions = correlate(packets, fingerprint, drivers, warnings);
  const observations: ManualObservation[] = [
    {
      id: `observation:import:${Date.now()}`,
      recordedAt: new Date().toISOString(),
      summary: `Imported nRF Connect text log: ${transactions.length} transaction(s), ${gattEvents.length} GATT event(s), ${unparsedLineCount} unparsed line(s).`,
      confidence: "observed",
    },
  ];
  return {
    fingerprint,
    deviceName,
    bleAddress,
    transactions,
    gattEvents,
    observations,
    warnings,
    unparsedLineCount,
    totalLineCount: lines.length,
    provenance: "nRF Connect text log import",
    ...(options.keepRawLog ? { rawLog: content } : {}),
  };
}

function buildFingerprint(
  deviceName: string | null,
  services: Map<
    string,
    {
      isPrimary: boolean;
      characteristics: Map<string, GattCharacteristicFingerprint>;
    }
  >,
): DeviceFingerprint | null {
  if (services.size === 0 && !deviceName) return null;
  const serviceFingerprints: GattServiceFingerprint[] = [
    ...services.entries(),
  ].map(([uuid, entry]) => ({
    uuid,
    isPrimary: entry.isPrimary,
    characteristics: [...entry.characteristics.values()],
  }));
  return {
    schemaVersion: 1,
    transportKind: "web-bluetooth",
    ...(deviceName ? { name: deviceName } : {}),
    advertisedServices: [],
    services: serviceFingerprints,
    evidenceRefs: ["nrf-connect-import"],
    // The BLE address is deliberately not stored on the fingerprint: it is
    // identifying information and stays out of shareable evidence by default.
    notes: [
      "Imported from an nRF Connect text log. This session cannot transmit.",
    ],
  };
}

function correlate(
  packets: readonly RawPacketEvent[],
  fingerprint: DeviceFingerprint | null,
  drivers: readonly MatrixDriver[],
  warnings: string[],
): ProtocolTransaction[] {
  const transactions: ProtocolTransaction[] = [];
  const consumed = new Set<number>();
  const decodeRx = (bytes: Uint8Array): DecodedNotification | null => {
    const candidates: DecodedNotification[] = [];
    for (const driver of drivers) {
      if (!driver.decodeNotification) continue;
      const decoded = driver.decodeNotification(bytes, {
        profile: fingerprint ? driver.resolveProfile(fingerprint) : null,
        fingerprint: fingerprint ?? emptyImportedFingerprint(),
        source: "imported",
      });
      if (decoded && !decoded.kind.startsWith("malformed"))
        candidates.push(decoded);
    }
    return (
      candidates.sort((a, b) => decodePriority(b) - decodePriority(a))[0] ??
      null
    );
  };

  for (let index = 0; index < packets.length; index += 1) {
    const packet = packets[index]!;
    if (consumed.has(index)) continue;
    if (packet.kind === "read") {
      transactions.push(
        importedTransaction({
          operation: "GATT Read",
          source: "gatt-read",
          startedAt: packet.timestamp,
          completedAt: packet.timestamp,
          risk: "read-only",
          packets: [
            {
              timestamp: packet.timestamp,
              direction: "RX",
              hex: packetHex(packet.bytes),
              endpoint: endpointOf(packet),
            },
          ],
          decodedResponse: null,
          findings: ["Characteristic read imported; raw bytes preserved."],
        }),
      );
      continue;
    }
    if (packet.kind === "rx") {
      const decoded = decodeRx(packet.bytes);
      transactions.push(
        importedTransaction({
          operation: "Unsolicited notification",
          source: "external-import",
          startedAt: packet.timestamp,
          completedAt: packet.timestamp,
          risk: "read-only",
          packets: [
            {
              timestamp: packet.timestamp,
              direction: "RX",
              hex: packetHex(packet.bytes),
              endpoint: endpointOf(packet),
            },
          ],
          decodedResponse: decoded,
          findings: decoded
            ? [decoded.summary]
            : ["Unmatched RX preserved without invented semantics."],
        }),
      );
      continue;
    }
    // TX: correlate following RX on the same endpoint inside the window,
    // preferring an opcode-level match from the shared envelope layout.
    const txOpcode = envelopeOpcode(packet.bytes);
    let matchedRxIndex = -1;
    let matchedDecoded: DecodedNotification | null = null;
    for (let rxIndex = index + 1; rxIndex < packets.length; rxIndex += 1) {
      const candidate = packets[rxIndex]!;
      if (consumed.has(rxIndex)) continue;
      if (candidate.kind === "tx") break; // a later TX owns later notifications
      if (
        candidate.kind !== "rx" ||
        candidate.characteristicUuid !== packet.characteristicUuid
      )
        continue;
      if (
        millisBetween(packet.timestamp, candidate.timestamp) >
        RX_CORRELATION_WINDOW_MS
      )
        break;
      const decoded = decodeRx(candidate.bytes);
      const rxOpcode = decoded?.opcode ?? envelopeOpcode(candidate.bytes);
      if (txOpcode !== null && rxOpcode !== null && txOpcode !== rxOpcode) {
        warnings.push(
          `RX opcode 0x${rxOpcode.toString(16)} does not match TX opcode 0x${txOpcode.toString(16)}; left uncorrelated.`,
        );
        continue;
      }
      matchedRxIndex = rxIndex;
      matchedDecoded = decoded;
      break;
    }
    const txEntry = {
      timestamp: packet.timestamp,
      direction: "TX" as const,
      hex: packetHex(packet.bytes),
      endpoint: endpointOf(packet),
    };
    if (matchedRxIndex >= 0) {
      consumed.add(matchedRxIndex);
      const rx = packets[matchedRxIndex]!;
      transactions.push(
        importedTransaction({
          operation: operationLabel(txOpcode, matchedDecoded),
          source: "external-import",
          startedAt: packet.timestamp,
          completedAt: rx.timestamp,
          risk: riskOf(txOpcode),
          packets: [
            txEntry,
            {
              timestamp: rx.timestamp,
              direction: "RX",
              hex: packetHex(rx.bytes),
              endpoint: endpointOf(rx),
            },
          ],
          decodedResponse: matchedDecoded,
          protocolAcknowledged: true,
          findings: matchedDecoded
            ? [matchedDecoded.summary]
            : ["TX/RX correlated by endpoint, timing, and envelope opcode."],
        }),
      );
    } else {
      transactions.push(
        importedTransaction({
          operation: operationLabel(txOpcode, null),
          source: "external-import",
          startedAt: packet.timestamp,
          completedAt: packet.timestamp,
          risk: riskOf(txOpcode),
          packets: [txEntry],
          decodedResponse: null,
          protocolAcknowledged: null,
          findings: [
            "TX preserved; no correlated RX inside the correlation window.",
          ],
        }),
      );
    }
  }
  return transactions;
}

function importedTransaction(input: {
  operation: string;
  source: ProtocolTransaction["source"];
  startedAt: string;
  completedAt: string;
  risk: ProtocolTransaction["safety"]["risk"];
  packets: ProtocolTransaction["packets"];
  decodedResponse: DecodedNotification | null;
  findings: readonly string[];
  protocolAcknowledged?: boolean | null;
}): ProtocolTransaction {
  return {
    id: transactionId("imported"),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Math.max(0, millisBetween(input.startedAt, input.completedAt)),
    sessionSource: "imported",
    source: input.source,
    driverId: null,
    profileId: null,
    operation: input.operation,
    safety: {
      risk: input.risk,
      persistence: input.risk === "persistent" ? "persistent" : "unknown",
      validation: "unverified",
    },
    endpoint: input.packets[0]?.endpoint ?? null,
    packets: input.packets,
    decodedResponse: input.decodedResponse,
    hostAccepted: true,
    protocolAcknowledged: input.protocolAcknowledged ?? null,
    deviceStateVerified: false,
    responseTimedOut: false,
    error: null,
    findings: [...input.findings],
    observationIds: [],
    diagnosticRunId: null,
  };
}

function operationLabel(
  opcode: number | null,
  decoded: DecodedNotification | null,
): string {
  if (decoded?.kind === "device-info") return "GetDeviceInfo (imported)";
  if (opcode === null) return "TX (imported)";
  if (opcode === 0x1f) return "GetDeviceInfo (imported)";
  if (opcode === 0x04) return "SetBrightness (imported)";
  if (opcode === 0x05) return "SetPower (imported)";
  if (opcode === 0x02) return "Program announce (imported)";
  if (opcode === 0x03) return "Program data chunk (imported)";
  return `Command 0x${opcode.toString(16).padStart(2, "0").toUpperCase()} (imported)`;
}

function riskOf(opcode: number | null): ProtocolTransaction["safety"]["risk"] {
  if (opcode === 0x1f || opcode === 0x0b) return "read-only";
  if (opcode === 0x02 || opcode === 0x03) return "persistent";
  return "transient";
}

function envelopeOpcode(bytes: Uint8Array): number | null {
  try {
    return decodeEnvelope(bytes).payload[0] ?? null;
  } catch {
    return null;
  }
}

function endpointOf(packet: RawPacketEvent): {
  serviceUuid: string;
  characteristicUuid: string;
} {
  // nRF Connect logs identify characteristics but not their parent service on
  // packet lines; the CoolLED convention places FFF1 under FFF0. Fall back to
  // the characteristic UUID itself when the service is unknown.
  const characteristic = packet.characteristicUuid;
  const serviceUuid = characteristic.includes("fff1")
    ? characteristic.replace("fff1", "fff0")
    : characteristic;
  return { serviceUuid, characteristicUuid: characteristic };
}

function decodePriority(notification: DecodedNotification): number {
  if (notification.kind === "device-info") return 100;
  if (
    notification.family === "CoolLEDX" &&
    notification.opcode === 0x08 &&
    notification.status === 0xfe
  )
    return 90;
  if (notification.kind === "command-echo") return 80;
  return 20;
}

function extractHexValue(message: string): Uint8Array | null {
  const marker = message.indexOf("(0x)");
  if (marker < 0) return null;
  const value = message.slice(marker + 4).trim();
  if (value === "") return new Uint8Array(0);
  if (!/^[0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2})*$/.test(value)) return null;
  return fromPlainHex(value.replaceAll("-", ""));
}

function fromPlainHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9A-Fa-f]*$/.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

function shortUuid(value: string): string {
  const match = /^0x([0-9a-fA-F]{4})$/.exec(value.trim());
  return match ? match[1]! : value.trim();
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function millisBetween(a: string, b: string): number {
  return Date.parse(b) - Date.parse(a);
}

function redactAddress(value: string): string {
  return value.replace(
    /\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi,
    "[redacted address]",
  );
}

function emptyImportedFingerprint(): DeviceFingerprint {
  return {
    schemaVersion: 1,
    transportKind: "web-bluetooth",
    advertisedServices: [],
    services: [],
    evidenceRefs: [],
    notes: [],
  };
}
