import { expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { createPresentationStore } from "../helpers/presentation-fixture";
import { projectReportPrivacy } from "../../src/diagnostics/report-privacy";
import { redactIdentifyingText } from "../../src/diagnostics/shareable-text";

it("scopes legacy visual targets and protects standalone provenance and explanatory repeats", () => {
  const binding = "standalone-private-visual-binding";
  const input = {
    claimEvidence: [
      {
        claimId: "stored-program.upload",
        testId: "coolledux-still-bootstrap",
        details: { target: binding, attemptId: "attempt:1" },
        summary: `Observed on ${binding}`,
      },
      {
        claimId: "stored-program.upload",
        testId: "coolledux-still-encoder",
        details: { physicalDeviceKey: binding, attemptId: "attempt:2" },
      },
      {
        claimId: "other",
        testId: "unrelated-test",
        details: { target: "semantic-target" },
      },
    ],
    operation: { target: "semantic-target" },
    trace: [{ metadata: { fingerprint: `device:${binding}|diagnostic` } }],
  };
  const before = JSON.stringify(input);
  for (const projection of [
    projectReportPrivacy(input),
    redactIdentifyingText(input, []),
  ]) {
    expect(projection.claimEvidence[0]!.details).toEqual({
      attemptId: "attempt:1",
    });
    expect(projection.claimEvidence[1]!.details).toEqual({
      attemptId: "attempt:2",
    });
    expect(projection.claimEvidence[0]!.summary).not.toContain(binding);
    expect(projection.claimEvidence[2]!.details.target).toBe("semantic-target");
    expect(projection.operation.target).toBe("semantic-target");
  }
  expect(JSON.stringify(projectReportPrivacy(input))).not.toContain(binding);
  expect(projectReportPrivacy(input, true)).toBe(input);
  expect(JSON.stringify(input)).toBe(before);
});

const identities = [
  "SYNTHETIC-DEVICE-WAVE-THREE",
  "browser-private-three",
  "OBSERVED-NAME-THREE",
  "AABB1234FECDEF98",
  "DEAD11223344BEEF",
  "private-binding-wave-three",
];
it("redacts all report kinds and direct copies without erasing protocol evidence or changing live input", async () => {
  const fingerprint = {
    ...knownIledHatFingerprint(),
    name: identities[0]!,
    browserDeviceId: identities[1]!,
    rawAdvertisementHex: identities[3]!,
    manufacturerDataHex: identities[4]!,
    notes: [identities.join(" / ")],
    advertisementObservation: {
      source: "web-bluetooth-watch" as const,
      capturedAt: "2026-10-01T00:00:00Z",
      name: identities[2]!,
      advertisedServiceUuids: ["fff0"],
      manufacturerData: [{ companyId: 123, dataHex: identities[4]! }],
      serviceData: [],
    },
  };
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport, new TraceRecorder());
  const files = {
    download: vi.fn(),
    copyText: vi.fn(async (_text: string) => true),
  };
  const store = createPresentationStore(runtime, transport, files);
  await store.connect();
  await runtime.probe();
  await runtime.runGuidedTestTransfer("coolledux-graffiti-timing", {
    confirmedConsequence: true,
    reason: "initial-experiment",
    attemptId: "attempt:privacy",
  });
  runtime.recordGuidedTestObservations(
    "coolledux-graffiti-timing",
    [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      {
        kind: "duration",
        fieldId: "image-visible",
        milliseconds: 1234,
        measuredBy: "matrixsmith-timer",
      },
    ],
    runtime.transactions.slice(-1).map((tx) => tx.id),
  );
  runtime.session.fingerprint = fingerprint;
  const investigation = runtime.investigation!;
  runtime.adoptInvestigation({
    ...investigation,
    deviceBinding: {
      profileId: investigation.profileId,
      fingerprintKey: identities[5]!,
    },
    goal: { ...investigation.goal, description: identities.join(" / ") },
    notes: [identities.join(" / ")],
  });
  Object.assign(runtime.investigation!, {
    deviceBinding: {
      profileId: investigation.profileId,
      fingerprintKey: identities[5]!,
    },
  });
  const before = JSON.stringify({
    fingerprint: runtime.session.fingerprint,
    investigation: runtime.investigation,
    transactions: runtime.transactions,
  });
  const reports = [
    store.markdown(),
    runtime.investigationReportMarkdown(),
    runtime.forensicReportMarkdown(),
    runtime.testReportMarkdown("coolledux-graffiti-timing"),
  ];
  for (const report of reports) {
    for (const identity of identities) expect(report).not.toContain(identity);
    expect(report).toContain("Known identifiers omitted by default");
    expect(report).toContain("still need manual review");
    expect(report).toContain("iledhat-31ae-32x16");
    expect(report).toContain("coolledux");
  }
  expect(reports[2]).toContain(runtime.transactions[0]!.packets[0]!.hex);
  expect(reports[2]).toContain(runtime.transactions[0]!.packets[0]!.timestamp);
  expect(reports[1]).toMatch(/1\.2|1234/);
  store.setReportOptions({
    ...store.getSnapshot().reportOptions,
    includeIdentifiers: true,
  });
  for (const report of [
    store.markdown(),
    runtime.investigationReportMarkdown(true),
    runtime.forensicReportMarkdown(true),
    runtime.testReportMarkdown("coolledux-graffiti-timing", true),
  ]) {
    expect(report).toContain(identities[0]);
    expect(report).toContain("Identifiers included by explicit choice");
  }
  await store.copyTestReport("coolledux-graffiti-timing");
  await store.copyInvestigationReport();
  await store.copyForensicReport();
  for (const [report] of files.copyText.mock.calls)
    for (const identity of identities) expect(report).not.toContain(identity);
  expect(
    JSON.stringify({
      fingerprint: runtime.session.fingerprint,
      investigation: runtime.investigation,
      transactions: runtime.transactions,
    }),
  ).toBe(before);
  await store.dispose();
});

it("redacts binding keys and explanatory repeats while preserving enums, IDs, packet bytes and typed byte arrays", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const input = {
    fingerprint: { name: "private-name", browserDeviceId: "private-browser" },
    binding: {
      physicalDeviceKey: "private-physical",
      key: "private-physical-key",
      profileId: "public-profile",
    },
    summary: "private-physical-key private-name private-browser",
    driverId: "public-driver",
    scope: "imported-external",
    packets: [{ hex: "AABBCC" }],
    rawBytes: bytes,
  };
  const before = JSON.stringify(input);
  const safe = projectReportPrivacy(input);
  expect(safe.summary).toBe("[redacted] [redacted] [redacted]");
  expect(safe.binding.key).toBe("[redacted binding key 1]");
  expect(safe.binding.physicalDeviceKey).toBeNull();
  expect(safe).toMatchObject({
    driverId: "public-driver",
    scope: "imported-external",
    packets: [{ hex: "AABBCC" }],
  });
  expect(safe.rawBytes).toBe(bytes);
  expect(JSON.stringify(input)).toBe(before);
});

it("preserves duplicate-analysis equality classes while masking identifying execution keys", () => {
  const input = {
    transfers: [
      {
        fingerprint: {
          key: "private-key-A",
          physicalDeviceKey: "private-unit",
          testId: "test-a",
        },
      },
      {
        fingerprint: {
          key: "private-key-B",
          physicalDeviceKey: "private-unit",
          testId: "test-b",
        },
      },
      {
        fingerprint: {
          key: "private-key-A",
          physicalDeviceKey: "private-unit",
          testId: "test-a",
        },
      },
    ],
  };
  const safe = projectReportPrivacy(input);
  expect(safe.transfers[0]!.fingerprint.key).toBe(
    safe.transfers[2]!.fingerprint.key,
  );
  expect(safe.transfers[0]!.fingerprint.key).not.toBe(
    safe.transfers[1]!.fingerprint.key,
  );
  expect(JSON.stringify(safe)).not.toContain("private-");
});
