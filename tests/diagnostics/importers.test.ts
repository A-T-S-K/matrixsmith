import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_IMPORTERS,
  findImporter,
  nrfConnectTextLogImporter,
} from "../../src/diagnostics/importers";
import { builtInDrivers } from "../../src/drivers/registry";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import {
  generateMarkdownReport,
  type ReportData,
} from "../../src/diagnostics/report";
import infoCc from "../fixtures/iledhat/coolledux-device-info-cc.json";
import brightness40 from "../fixtures/iledhat/coolledux-brightness-40.json";
import rejection from "../fixtures/iledhat/coolledx-brightness-rejection.json";

const FIXTURE = readFileSync(
  new URL("../fixtures/nrf/iledhat-session.txt", import.meta.url),
  "utf8",
);
const dash = (hex: string): string => hex.toUpperCase().match(/../g)!.join(" ");

function parseFixture() {
  return nrfConnectTextLogImporter.parse(FIXTURE, { drivers: builtInDrivers });
}

describe("nRF Connect text log importer", () => {
  it("registers and sniffs the format", () => {
    expect(EVIDENCE_IMPORTERS).toHaveLength(1);
    expect(findImporter(FIXTURE)?.id).toBe("nrf-connect-text-log");
    expect(findImporter("random unrelated text")).toBeNull();
  });

  it("extracts the device name and keeps the BLE address out of the fingerprint", () => {
    const result = parseFixture();
    expect(result.deviceName).toBe("iLedHat");
    expect(result.bleAddress).toBe("01:00:00:21:CC:99");
    expect(JSON.stringify(result.fingerprint)).not.toContain(
      "01:00:00:21:CC:99",
    );
  });

  it("extracts the GATT hierarchy with normalized UUIDs and properties", () => {
    const result = parseFixture();
    const fff0 = result.fingerprint?.services.find(
      (service) => service.uuid === "0000fff0-0000-1000-8000-00805f9b34fb",
    );
    expect(fff0).toBeDefined();
    const fff1 = fff0?.characteristics.find(
      (c) => c.uuid === "0000fff1-0000-1000-8000-00805f9b34fb",
    );
    expect(fff1?.properties).toEqual({
      read: true,
      write: false,
      writeWithoutResponse: true,
      notify: true,
      indicate: false,
    });
    const genericAccess = result.fingerprint?.services.find(
      (service) => service.uuid === "00001800-0000-1000-8000-00805f9b34fb",
    );
    expect(
      genericAccess?.characteristics.some(
        (c) => c.uuid === "00002a00-0000-1000-8000-00805f9b34fb",
      ),
    ).toBe(true);
  });

  it("records connection, notification-enable, error, and disconnect events with timestamps", () => {
    const result = parseFixture();
    const kinds = result.gattEvents.map((event) => event.kind);
    expect(kinds).toContain("connect");
    expect(kinds).toContain("notifications-enabled");
    expect(kinds).toContain("service-discovery");
    expect(kinds).toContain("error");
    expect(kinds).toContain("disconnect");
    const connect = result.gattEvents.find((event) => event.kind === "connect");
    expect(connect?.timestamp).toBe("2026-08-31T20:15:02.311Z");
  });

  it("extracts TX writes and RX notifications with exact bytes and timestamps", () => {
    const result = parseFixture();
    const deviceInfo = result.transactions.find(
      (t) => t.operation === "GetDeviceInfo (imported)",
    );
    expect(deviceInfo).toBeDefined();
    expect(deviceInfo?.packets.find((p) => p.direction === "TX")?.hex).toBe(
      dash(infoCc.txHex),
    );
    expect(deviceInfo?.packets.find((p) => p.direction === "RX")?.hex).toBe(
      dash(infoCc.rxHex),
    );
    expect(deviceInfo?.startedAt).toBe("2026-08-31T20:15:30.090Z");
    expect(deviceInfo?.completedAt).toBe("2026-08-31T20:15:30.242Z");
    expect(deviceInfo?.durationMs).toBeGreaterThan(0);
  });

  it("parses characteristic reads, including empty read responses", () => {
    const result = parseFixture();
    const read = result.transactions.find((t) => t.source === "gatt-read");
    expect(read).toBeDefined();
    expect(read?.packets[0]?.hex).toBe("");
  });

  it("correlates TX and RX by endpoint, timing, and envelope opcode", () => {
    const result = parseFixture();
    const brightness = result.transactions.find(
      (t) => t.operation === "SetBrightness (imported)",
    );
    expect(brightness?.protocolAcknowledged).toBe(true);
    expect(brightness?.packets.map((p) => p.direction)).toEqual(["TX", "RX"]);
    expect(brightness?.packets[1]?.hex).toBe(dash(brightness40.rxHex));
  });

  it("decodes imported packets with installed drivers", () => {
    const result = parseFixture();
    const deviceInfos = result.transactions.filter(
      (t) => t.decodedResponse?.kind === "device-info",
    );
    expect(deviceInfos).toHaveLength(2);
    expect(deviceInfos[0]?.decodedResponse?.fields.brightnessRaw).toBe(0xcc);
    expect(deviceInfos[1]?.decodedResponse?.fields.brightnessRaw).toBe(0x40);
    const rejected = result.transactions.find((t) =>
      t.packets.some((p) => p.hex === dash(rejection.rxHex)),
    );
    expect(rejected?.decodedResponse).not.toBeNull();
  });

  it("classifies imported program uploads as persistent without inventing semantics", () => {
    const log = [
      "nRF Connect, 2026-08-31",
      "V\t10:00:00.000\tWriting command to characteristic 0000fff1-0000-1000-8000-00805f9b34fb",
      "I\t10:00:00.050\tData written to 0000fff1-0000-1000-8000-00805f9b34fb, value: (0x) 01-00-0C-02-06-AA-BB-CC-DD-00-00-00-0C-00-04-04-03",
    ].join("\n");
    const result = nrfConnectTextLogImporter.parse(log, {
      drivers: builtInDrivers,
    });
    const announce = result.transactions.find(
      (t) => t.operation === "Program announce (imported)",
    );
    expect(announce?.safety.risk).toBe("persistent");
  });

  it("keeps unmatched TX and RX instead of dropping them", () => {
    const log = [
      "nRF Connect, 2026-08-31",
      "I\t10:00:00.000\tData written to 0000fff1-0000-1000-8000-00805f9b34fb, value: (0x) 01-00-02-06-04-40-03",
      "I\t10:01:30.000\tNotification received from 0000fff1-0000-1000-8000-00805f9b34fb, value: (0x) 01-00-02-05-1F-03",
    ].join("\n");
    const result = nrfConnectTextLogImporter.parse(log, {
      drivers: builtInDrivers,
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.protocolAcknowledged).toBeNull();
    expect(result.transactions[1]?.operation).toBe("Unsolicited notification");
  });

  it("warns on malformed hex without aborting the import", () => {
    const log = [
      "nRF Connect, 2026-08-31",
      "I\t10:00:00.000\tData written to 0000fff1-0000-1000-8000-00805f9b34fb, value: (0x) ZZ-XX",
      "I\t10:00:01.000\tData written to 0000fff1-0000-1000-8000-00805f9b34fb, value: (0x) 01-00-02-05-1F-03",
    ].join("\n");
    const result = nrfConnectTextLogImporter.parse(log, {
      drivers: builtInDrivers,
    });
    expect(
      result.warnings.some((warning) => warning.includes("parseable bytes")),
    ).toBe(true);
    expect(result.transactions).toHaveLength(1);
  });

  it("counts unknown lines instead of silently discarding them", () => {
    const log = `${FIXTURE}\ncompletely unrecognizable line without structure\nanother strange line`;
    const result = nrfConnectTextLogImporter.parse(log, {
      drivers: builtInDrivers,
    });
    expect(result.unparsedLineCount).toBeGreaterThanOrEqual(2);
    expect(result.totalLineCount).toBeGreaterThan(0);
  });

  it("returns an explicit warning for content with nothing recognizable", () => {
    const result = nrfConnectTextLogImporter.parse(
      "just some text\nmore text",
      {},
    );
    expect(result.fingerprint).toBeNull();
    expect(result.transactions).toHaveLength(0);
    expect(result.warnings[0]).toContain("No recognizable");
  });

  it("redacts BLE addresses in imported error details", () => {
    const log = [
      "nRF Connect, 2026-08-31",
      "E\t10:00:00.000\tError 133 (0x85): GATT ERROR from AA:BB:CC:DD:EE:FF",
      "I\t10:00:01.000\tData written to 0000fff1-0000-1000-8000-00805f9b34fb, value: (0x) 01-00-02-05-1F-03",
    ].join("\n");
    const result = nrfConnectTextLogImporter.parse(log, {});
    expect(
      result.gattEvents.find((event) => event.kind === "error")?.detail,
    ).not.toContain("AA:BB:CC:DD:EE:FF");
  });

  it("preserves the raw log only when requested", () => {
    expect(nrfConnectTextLogImporter.parse(FIXTURE, {}).rawLog).toBeUndefined();
    expect(
      nrfConnectTextLogImporter.parse(FIXTURE, { keepRawLog: true }).rawLog,
    ).toBe(FIXTURE);
  });
});

describe("controller external import", () => {
  it("opens an offline imported session that cannot transmit", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const controller = new ApplicationRuntime(transport, new TraceRecorder());
    const evidence = controller.importExternalLog(FIXTURE);
    expect(evidence.transactions.length).toBeGreaterThan(0);
    expect(controller.session.source).toBe("imported");
    expect(
      controller.transactions.some((t) => t.sessionSource === "imported"),
    ).toBe(true);
    expect(controller.importedEvidence).toHaveLength(1);
    // Imported sessions must never transmit.
    await expect(controller.probe()).rejects.toThrow(
      /cannot perform live probes/,
    );
  });

  it("merges imported evidence into an active live session without clearing it", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const controller = new ApplicationRuntime(transport, new TraceRecorder());
    await controller.connect();
    await controller.probe();
    const before = controller.transactions.length;
    controller.importExternalLog(FIXTURE);
    expect(controller.session.source).toBe("live");
    expect(controller.transactions.length).toBeGreaterThan(before);
    expect(
      controller.transactions.some((t) => t.sessionSource === "imported"),
    ).toBe(true);
    expect(
      controller.transactions.some((t) => t.sessionSource === "live"),
    ).toBe(true);
  });

  it("labels imported transactions distinctly in the Markdown report", () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const controller = new ApplicationRuntime(transport, new TraceRecorder());
    controller.importExternalLog(FIXTURE);
    const data: ReportData = {
      createdAt: "2026-08-31T21:00:00.000Z",
      matrixsmithVersion: "0.1.0",
      fingerprint: controller.session.fingerprint!,
      profile: controller.session.profile,
      selectedDriver: controller.session.selection?.selected?.id ?? null,
      driverMatches: controller.session.selection?.matches ?? [],
      capabilities: [],
      transactions: controller.transactions,
      diagnosticRuns: [],
      observations: controller.observations,
      trace: [],
      protocolResolution: null,
      contentCompilations: [],
      importedEvidence: controller.importedEvidence,
      liveConnected: false,
      source: "imported",
    };
    const markdown = generateMarkdownReport(data);
    expect(markdown).toContain("nRF Connect import");
    expect(markdown).toContain("## Imported external evidence");
    expect(markdown).not.toContain("01:00:00:21:CC:99");
  });
});
