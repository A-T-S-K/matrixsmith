import { expect, it } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { DriverRegistry } from "../../src/drivers/registry";
import { FakeTransport } from "../../src/transport/fake";
import { ReplayTransport } from "../../src/transport/replay";
import {
  createShareableBundle,
  parseDiagnosticBundle,
  serializeDiagnosticBundle,
} from "../../src/diagnostics/bundle";
import { projectReportPrivacy } from "../../src/diagnostics/report-privacy";
import {
  generateMarkdownReport,
  reportDataFromBundle,
  DEFAULT_REPORT_OPTIONS,
} from "../../src/diagnostics/report";
import {
  lumenFrame,
  syntheticDriver,
  syntheticFingerprint,
} from "../helpers/synthetic-driver";

const deviceId = "geometry-private-browser-781";
const deviceName = "Geometry private panel 592";
const manufacturerData = "A19E582CD460B37F";
const sentinels = [deviceId, deviceName, manufacturerData];

it("projects identifying geometry provenance without mutating archives, source state, or historical authority", async () => {
  const registry = new DriverRegistry([syntheticDriver]);
  const fingerprint = {
    ...syntheticFingerprint(),
    browserDeviceId: deviceId,
    name: deviceName,
    manufacturerDataHex: manufacturerData,
  };
  const transport = new FakeTransport(fingerprint);
  transport.notificationOnWrite = lumenFrame(0x91, [0x4c, 0x4d, 24, 8, 7]);
  const runtime = new ApplicationRuntime(transport, undefined, registry);
  const replay = new ReplayTransport(fingerprint);
  const imported = new ApplicationRuntime(replay, undefined, registry);
  try {
    await runtime.connect();
    runtime.session.enableExperimentalTx();
    await runtime.probe("test-lumen", "lumen-info");
    const proposal = runtime.geometryProposal()!;
    const profile = runtime.useReportedGeometry(proposal.id);
    // Exercise known identifiers repeated in driver interpretation rationale,
    // including in the trace projection used by Markdown reports.
    const rationale = `Pixel interpretation for ${sentinels.join(" / ")}`;
    runtime.session.profile = {
      ...profile,
      metadata: { ...profile.metadata, geometryRationale: rationale },
    };
    runtime.trace.record("device.provisional-target.created", {
      geometrySource: "device-info",
      geometryBrowserDeviceId: deviceId,
      geometryFingerprintKey: proposal.fingerprintKey,
      geometryConnectionId: proposal.connectionId,
      geometryRationale: rationale,
      geometryTransactionId: proposal.transactionId,
      geometryRecordedAt: proposal.recordedAt,
      driverId: profile.driverId,
      width: profile.width,
      height: profile.height,
    });
    runtime.ensureInvestigation();
    const oldPlan = runtime.plan({ type: "GetDeviceInfo" });
    runtime.session.confirmPlanDigest(oldPlan.digest);
    const before = JSON.stringify({
      fingerprint: runtime.session.fingerprint,
      profile: runtime.session.profile,
      proposal: runtime.geometryProposal(),
      transactions: runtime.transactions,
      trace: runtime.trace.events,
      investigation: runtime.investigation,
      unlocked: runtime.session.experimentalTxEnabled,
      confirmation: runtime.session.confirmedPlanDigest,
    });
    const archiveJson = runtime.exportBundle("full-local-archive");
    const archive = parseDiagnosticBundle(archiveJson);
    const archiveBefore = JSON.stringify(archive);
    const projected = createShareableBundle(archive);
    const shareableJson = runtime.exportBundle("shareable");
    const shareable = parseDiagnosticBundle(shareableJson);
    for (const output of [projected, shareable]) {
      const json = serializeDiagnosticBundle(output);
      for (const sentinel of sentinels) expect(json).not.toContain(sentinel);
      const metadata = output.provisionalProfile!.metadata;
      expect(metadata.geometryBrowserDeviceId).toBeUndefined();
      expect(metadata.geometryFingerprintKey).toMatch(
        /^\[redacted geometry key \d+\]$/,
      );
      expect(metadata.geometryConnectionId).toMatch(
        /^\[redacted geometry key \d+\]$/,
      );
      expect(metadata.geometryFingerprintKey).not.toBe(
        metadata.geometryConnectionId,
      );
      expect(metadata.geometryRationale).not.toContain(deviceName);
      expect(output.provisionalProfile).toMatchObject({
        width: 24,
        height: 8,
        driverId: "test-lumen",
        metadata: {
          geometrySource: "device-info",
          geometryTransactionId: proposal.transactionId,
          geometryRecordedAt: proposal.recordedAt,
        },
      });
      expect(
        output.transactions.find(
          (tx) => tx.id === metadata.geometryTransactionId,
        ),
      ).toMatchObject({
        driverId: "test-lumen",
        completedAt: proposal.recordedAt,
        decodedResponse: { fields: { width: 24, height: 8 } },
      });
      expect(parseDiagnosticBundle(json).privacy).toBe("shareable");
    }
    for (const sentinel of sentinels) expect(archiveJson).toContain(sentinel);
    expect(archive.provisionalProfile!.metadata).toMatchObject({
      geometryBrowserDeviceId: deviceId,
      geometryFingerprintKey: proposal.fingerprintKey,
      geometryConnectionId: proposal.connectionId,
      geometryRationale: rationale,
    });
    expect(JSON.stringify(archive)).toBe(archiveBefore);
    expect(runtime.exportBundle("full-local-archive")).toContain(
      proposal.fingerprintKey,
    );

    // Every Markdown route projects both profile and trace metadata before formatting.
    const reportInput = reportDataFromBundle(archive);
    for (const report of [
      generateMarkdownReport(reportInput, {
        ...DEFAULT_REPORT_OPTIONS,
        includeRawTrace: true,
      }),
      runtime.investigationReportMarkdown(),
      runtime.forensicReportMarkdown(),
    ]) {
      for (const sentinel of sentinels) expect(report).not.toContain(sentinel);
      expect(report).toContain("device-info");
      expect(report).toContain(proposal.transactionId);
      expect(report).toContain(proposal.recordedAt);
      expect(report).toContain("test-lumen");
    }
    expect(
      generateMarkdownReport(reportInput, {
        ...DEFAULT_REPORT_OPTIONS,
        includeIdentifiers: true,
        includeRawTrace: true,
      }),
    ).toContain(proposal.fingerprintKey);

    // Both archive modes import only historical geometry; neither creates a live proposal,
    // grants experimental permission, or accepts a previously prepared operation.
    for (const json of [archiveJson, shareableJson]) {
      imported.importBundle(json);
      expect(imported.session.profile!.metadata).toMatchObject({
        historical: true,
        geometrySource: "device-info",
        geometryTransactionId: proposal.transactionId,
      });
      expect(imported.geometryProposal()).toBeNull();
      expect(imported.assessment().readiness).toBe("offline");
      expect(imported.session.experimentalTxEnabled).toBe(false);
      expect(imported.session.confirmedPlanDigest).toBeNull();
      expect(() => imported.useReportedGeometry(proposal.id)).toThrow(
        /expired/,
      );
      expect(() => imported.confirmProvisionalGeometry(24, 8)).toThrow(
        /current live/,
      );
      await expect(imported.send(oldPlan)).rejects.toThrow();
      // Re-export keeps a useful, validating historical source record in either mode.
      expect(
        parseDiagnosticBundle(imported.exportBundle("full-local-archive"))
          .provisionalProfile!.metadata.geometryTransactionId,
      ).toBe(proposal.transactionId);
    }
    expect(
      JSON.stringify({
        fingerprint: runtime.session.fingerprint,
        profile: runtime.session.profile,
        proposal: runtime.geometryProposal(),
        transactions: runtime.transactions,
        trace: runtime.trace.events,
        investigation: runtime.investigation,
        unlocked: runtime.session.experimentalTxEnabled,
        confirmation: runtime.session.confirmedPlanDigest,
      }),
    ).toBe(before);
  } finally {
    await runtime.dispose();
    await imported.dispose();
  }
});

it("uses report-local geometry aliases consistently with other fingerprint bindings and redacts known identifiers repeated in interpretation rationale", () => {
  const fingerprintKey = `fake|${deviceName}|${manufacturerData}`;
  const input = {
    fingerprint: { name: deviceName, manufacturerDataHex: manufacturerData },
    profile: {
      metadata: {
        geometryBrowserDeviceId: deviceId,
        geometryFingerprintKey: fingerprintKey,
        geometryConnectionId: "connection:private-geometry",
        geometryRationale: sentinels.join(" / "),
        geometryTransactionId: "transaction:geometry",
        geometryRecordedAt: "2026-10-02T12:00:00Z",
        geometrySource: "device-info",
      },
    },
    trace: [
      {
        metadata: {
          geometryFingerprintKey: fingerprintKey,
          geometryConnectionId: "connection:private-geometry",
        },
      },
    ],
    binding: { fingerprintKey },
  };
  const before = JSON.stringify(input);
  const safe = projectReportPrivacy(input);
  for (const sentinel of sentinels)
    expect(JSON.stringify(safe)).not.toContain(sentinel);
  expect(safe.profile.metadata.geometryBrowserDeviceId).toBeUndefined();
  expect(safe.profile.metadata.geometryFingerprintKey).toBe(
    safe.binding.fingerprintKey,
  );
  expect(safe.profile.metadata.geometryFingerprintKey).toBe(
    safe.trace[0]!.metadata.geometryFingerprintKey,
  );
  expect(safe.profile.metadata.geometryConnectionId).toBe(
    safe.trace[0]!.metadata.geometryConnectionId,
  );
  expect(safe.profile.metadata.geometryConnectionId).not.toContain(
    "connection:private-geometry",
  );
  expect(safe.profile.metadata.geometryTransactionId).toBe(
    "transaction:geometry",
  );
  expect(projectReportPrivacy(input, true)).toBe(input);
  expect(JSON.stringify(input)).toBe(before);
});
