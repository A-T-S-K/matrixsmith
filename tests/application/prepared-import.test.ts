import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import {
  prepareDiagnosticBundleImport,
  readPreparedDiagnosticBundle,
  type PreparedDiagnosticBundleImport,
} from "../../src/diagnostics/bundle";
import { sanitizeInvestigation } from "../../src/investigation/serialization";
import validateStructure from "../../src/diagnostics/generated/bundle-validator.js";
import { FakeTransport } from "../../src/transport/fake";
import { ReplayTransport } from "../../src/transport/replay";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { setupStill, verifyStill } from "../helpers/still-runtime";
import { PresentationStore } from "../../src/presentation/store";
import { createBrowserEnvironment } from "../../src/adapters/presentation/browser-environment";

// These wrap the functions actually used by the lexical parser, not its public
// wrapper. Preserve the generated validator's errors and the real sanitizer.
vi.mock("../../src/diagnostics/generated/bundle-validator.js", async (load) => {
  const actual =
    await load<
      typeof import("../../src/diagnostics/generated/bundle-validator.js")
    >();
  const wrapped = vi.fn((value: unknown) => {
    const valid = actual.default(value);
    wrapped.errors = actual.default.errors;
    return valid;
  }) as unknown as typeof actual.default;
  wrapped.validateDateTime = actual.default.validateDateTime;
  return { default: wrapped };
});
vi.mock("../../src/investigation/serialization", async (load) => {
  const actual =
    await load<typeof import("../../src/investigation/serialization")>();
  return {
    ...actual,
    sanitizeInvestigation: vi.fn(actual.sanitizeInvestigation),
  };
});
const runtimes: ApplicationRuntime[] = [];
afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.dispose();
  vi.restoreAllMocks();
});
function consumer() {
  const t = new ReplayTransport(knownIledHatFingerprint());
  const r = new ApplicationRuntime(t);
  runtimes.push(r);
  return { r, t };
}
async function archive() {
  const t = new FakeTransport(knownIledHatFingerprint());
  const r = new ApplicationRuntime(t);
  runtimes.push(r);
  await r.connect();
  r.ensureInvestigation();
  return r.exportBundle();
}

it("validates once through direct and workspace strings, then adopts without any parsing/validation/sanitization", async () => {
  const json = await archive();
  const { r, t } = consumer();
  const factory = vi.fn((fingerprint) => {
    const transport = new ReplayTransport(fingerprint);
    return { transport, controller: new ApplicationRuntime(transport) };
  });
  const store = new PresentationStore(r, t, {
    ...createBrowserEnvironment(),
    createOfflineWorkspace: factory,
  });
  try {
    const parse = vi.spyOn(JSON, "parse");
    function reset() {
      parse.mockClear();
      vi.mocked(validateStructure).mockClear();
      vi.mocked(sanitizeInvestigation).mockClear();
    }
    function counts(passes: number) {
      expect(parse).toHaveBeenCalledTimes(passes);
      expect(validateStructure).toHaveBeenCalledTimes(passes);
      // Semantic investigation checking sanitizes once, and the returned graph
      // sanitizes once. Both actual calls remain present for each validated input.
      expect(sanitizeInvestigation).toHaveBeenCalledTimes(passes * 2);
    }
    reset();
    r.importBundle(json);
    counts(1);
    reset();
    store.importBundle(json);
    counts(1);
    expect(factory).toHaveBeenCalledOnce();
    reset();
    const token = prepareDiagnosticBundleImport(json);
    counts(1);
    reset();
    consumer().r.adoptPreparedBundle(token);
    counts(0);
  } finally {
    await store.dispose();
  }
});

it("rejects forgeries before retiring a response context or touching a connected runtime", async () => {
  const t = new FakeTransport(knownIledHatFingerprint());
  const r = new ApplicationRuntime(t);
  runtimes.push(r);
  await r.connect();
  const token = prepareDiagnosticBundleImport(r.exportBundle());
  const fingerprint = r.session.fingerprint;
  const trace = [...r.trace.events];
  const subscribe = vi.spyOn(t, "subscribe");
  const write = vi.spyOn(t, "write");
  const read = vi.spyOn(t, "read");
  for (const forged of [
    {},
    { ...token },
    structuredClone(token),
    readPreparedDiagnosticBundle(token),
    { validated: true },
  ])
    expect(() =>
      r.adoptPreparedBundle(forged as PreparedDiagnosticBundleImport),
    ).toThrow(/Invalid prepared/);
  expect(r.session.fingerprint).toBe(fingerprint);
  expect(r.session.source).toBe("live");
  expect(r.trace.events).toEqual(trace);
  expect(subscribe).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it("reuses immutable provisional history with independently editable runtime collections and no live authority", async () => {
  const { runtime: source, transport } = await setupStill();
  runtimes.push(source);
  await verifyStill(source);
  source.recordObservation("Historical manual note");
  const json = source.exportBundle();
  const token = prepareDiagnosticBundleImport(json);
  const bundle = readPreparedDiagnosticBundle(token);
  const before = JSON.stringify(bundle);
  const a = consumer(),
    b = consumer();
  const read = vi.spyOn(a.t, "read"),
    write = vi.spyOn(a.t, "write"),
    subscribe = vi.spyOn(a.t, "subscribe");
  a.r.adoptPreparedBundle(token);
  b.r.adoptPreparedBundle(token);
  expect(a.r.session.fingerprint).not.toBe(bundle.fingerprint);
  expect(a.r.session.profile).not.toBe(bundle.provisionalProfile);
  expect(a.r.observations).toEqual(bundle.observations);
  expect(a.r.transactions).toEqual(bundle.transactions);
  expect(a.r.contentCompilations).toEqual(bundle.contentCompilations);
  expect(a.r.investigation!.completedTests).toEqual(
    bundle.investigation!.completedTests,
  );
  expect(
    a.r.investigation!.claimEvidence.every(
      (e) => e.scope === "imported-external",
    ),
  ).toBe(true);
  expect(a.r.session.source).toBe("imported");
  expect(a.r.session.confirmedPlanDigest).toBeNull();
  expect(a.r.session.experimentalTxEnabled).toBe(false);
  expect(a.r.panelProgram().certainty).toBe("unknown");
  Object.assign(
    a.r.session.fingerprint!.services[0]!.characteristics[0]!.properties,
    { read: false },
  );
  Object.assign(a.r.session.profile!.metadata, { injected: true });
  Object.assign(a.r.observations[0]!, { summary: "edited" });
  Object.assign(a.r.transactions[0]!, { summary: "edited" });
  Object.assign(a.r.contentCompilations[0]!, { id: "edited" });
  Object.assign(a.r.investigation!.completedTests[0]!.observations[0]!, {
    fieldId: "edited",
  });
  Object.assign(
    a.r.trace.events.find((e) => Object.keys(e.metadata).length > 0)!.metadata,
    { injected: true },
  );
  expect(JSON.stringify(bundle)).toBe(before);
  expect(b.r.observations).toEqual(bundle.observations);
  expect(b.r.transactions).toEqual(bundle.transactions);
  expect(b.r.contentCompilations).toEqual(bundle.contentCompilations);
  expect(b.r.investigation!.completedTests).toEqual(
    bundle.investigation!.completedTests,
  );
  expect(b.r.session.fingerprint).toEqual(bundle.fingerprint);
  expect(b.r.session.profile!.metadata).not.toHaveProperty("injected");
  a.r.exportBundle();
  expect(JSON.parse(b.r.exportBundle()).observations).toEqual(
    bundle.observations,
  );
  const spoofed = JSON.parse(json);
  for (const entry of spoofed.investigation.claimEvidence)
    entry.scope = "built-in-profile";
  const hostile = consumer().r;
  hostile.adoptPreparedBundle(
    prepareDiagnosticBundleImport(JSON.stringify(spoofed)),
  );
  expect(
    hostile.investigation!.claimEvidence.every(
      (entry) => entry.scope === "imported-external",
    ),
  ).toBe(true);
  expect(hostile.staticViability().selected).toBeNull();
  spoofed.provisionalProfile.id = "iledhat-31ae-32x16";
  spoofed.selectedProfile = spoofed.provisionalProfile.id;
  expect(() => prepareDiagnosticBundleImport(JSON.stringify(spoofed))).toThrow(
    /must match pattern "\^provisional:/,
  );
  expect(JSON.stringify(bundle)).toBe(before);
  expect(source.exportBundle()).not.toContain('"injected"');
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  expect(transport.state).toBe("connected");
});
