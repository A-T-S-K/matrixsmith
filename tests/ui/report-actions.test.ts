import { expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { createPresentationStore } from "../helpers/presentation-fixture";

async function setup() {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport, new TraceRecorder());
  const files = { download: vi.fn(), copyText: vi.fn(async () => true) };
  const store = createPresentationStore(runtime, transport, files);
  await store.connect();
  store.setReportKind("device");
  store.openReport();
  return { store, runtime, files };
}

it.each([false, true])(
  "keeps the current workspace on a deep import failure (unknown field: %s)",
  async (unknownField) => {
    const { store, runtime } = await setup();
    runtime.recordObservation("Preserve current workspace evidence");
    const previous = store.controller;
    const fingerprint = runtime.session.fingerprint;
    const investigation = runtime.investigation;
    const before = JSON.parse(runtime.exportBundle());
    const json = JSON.stringify({
      ...before,
      advertisementEvidence: null,
      ...(unknownField ? { unknown: true } : {}),
    }).replace(
      '"advertisementEvidence":null',
      `"advertisementEvidence":${'{"child":'.repeat(10_000)}null${"}".repeat(10_000)}`,
    );
    expect(() => store.importBundle(json)).not.toThrow();
    expect(store.getSnapshot().error).toContain("nesting limit");
    expect(store.controller).toBe(previous);
    expect(runtime.session.fingerprint).toBe(fingerprint);
    expect(runtime.investigation).toBe(investigation);
    expect(JSON.parse(runtime.exportBundle())).toEqual({
      ...before,
      createdAt: expect.any(String),
    });
    await store.dispose();
  },
);

it("keeps valid preview and choices on generation failures, disables error-placeholder actions and retries", async () => {
  const { store, runtime, files } = await setup();
  const valid = store.getSnapshot().reportMarkdown;
  const generation = vi
    .spyOn(runtime, "forensicReportMarkdown")
    .mockImplementation(() => {
      throw new Error("Synthetic generation failure");
    });
  store.setReportKind("forensic");
  expect(store.getSnapshot()).toMatchObject({
    reportPreviewFailed: true,
    reportError: "Synthetic generation failure",
    reportMarkdown: valid,
    reportOpen: true,
  });
  await store.copyReport();
  await store.downloadReport("report.md");
  expect(files.copyText).not.toHaveBeenCalled();
  expect(files.download).not.toHaveBeenCalled();
  expect(store.getSnapshot().reportKind).toBe("forensic");
  generation.mockRestore();
  store.retryReport();
  expect(store.getSnapshot()).toMatchObject({
    reportPreviewFailed: false,
    reportError: null,
  });
  await store.downloadReport("report.md");
  expect(files.download.mock.calls[0]?.[1]).toContain("# MatrixSmith");
  await store.dispose();
});

it("catches export, download, clipboard false and rejection failures locally and recovers", async () => {
  const { store, runtime, files } = await setup();
  const fingerprint = runtime.session.fingerprint;
  const exportSpy = vi
    .spyOn(runtime, "exportBundle")
    .mockImplementationOnce(() => {
      throw new Error("Bundle exceeds byte limit");
    });
  await store.downloadReport("full.json", "full-local-archive");
  expect(store.getSnapshot().reportError).toBe("Bundle exceeds byte limit");
  expect(files.download).not.toHaveBeenCalled();
  exportSpy.mockRestore();
  files.download.mockImplementationOnce(() => {
    throw new Error("Download adapter failed");
  });
  await store.downloadReport("report.md");
  expect(store.getSnapshot().reportError).toBe("Download adapter failed");
  files.download.mockImplementationOnce(() =>
    Promise.reject(new Error("Async download failed")),
  );
  await store.downloadReport("report.md");
  expect(store.getSnapshot().reportError).toBe("Async download failed");
  files.copyText.mockResolvedValueOnce(false);
  await store.copyReport();
  expect(store.getSnapshot().reportError).toContain(
    "Clipboard access was denied",
  );
  files.copyText.mockRejectedValueOnce(new Error("Clipboard rejected"));
  await store.copyReport();
  expect(store.getSnapshot().reportError).toBe("Clipboard rejected");
  expect(store.getSnapshot().info).not.toBe("Copied to clipboard.");
  await store.copyReport();
  expect(store.getSnapshot().reportError).toBeNull();
  expect(store.getSnapshot().info).toBe("Copied to clipboard.");
  files.copyText.mockResolvedValueOnce(false);
  await store.copyReport();
  expect(store.getSnapshot().info).toBeNull();
  expect(runtime.session.fingerprint).toBe(fingerprint);
  await store.dispose();
});

it("ignores a pending copy completion after workspace replacement and keeps JSON modes independent", async () => {
  const { store, runtime, files } = await setup();
  const archive = runtime.exportBundle();
  store.setReportOptions({
    ...store.getSnapshot().reportOptions,
    includeIdentifiers: true,
    includeTransactions: false,
  });
  await store.downloadReport("share.json", "shareable");
  expect(
    JSON.parse(files.download.mock.calls[0]![1]).fingerprint.name,
  ).toBeUndefined();
  store.setReportOptions({
    ...store.getSnapshot().reportOptions,
    includeIdentifiers: false,
  });
  await store.downloadReport("archive.json", "full-local-archive");
  expect(
    JSON.parse(files.download.mock.calls[1]![1]).fingerprint.browserDeviceId,
  ).toBeTruthy();
  let resolve!: (value: boolean) => void;
  files.copyText.mockImplementationOnce(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  const pending = store.copyReport();
  store.importBundle(archive);
  const info = store.getSnapshot().info;
  resolve(true);
  await pending;
  expect(store.getSnapshot().info).toBe(info);
  expect(store.getSnapshot().reportError).toBeNull();
  const previous = store.controller;
  const invalid = JSON.parse(archive);
  invalid.extra = "unknown";
  store.importBundle(JSON.stringify(invalid));
  expect(store.controller).toBe(previous);
  expect(store.controller.session.source).toBe("imported");
  await store.dispose();
});

it("surfaces the real full-archive byte-budget failure without downloading or mutating evidence", async () => {
  const { store, runtime, files } = await setup();
  runtime.session.fingerprint = {
    ...runtime.session.fingerprint!,
    notes: ["x".repeat(10 * 1024 * 1024)],
  };
  const fingerprint = runtime.session.fingerprint;
  await store.downloadReport("oversized.json", "full-local-archive");
  expect(store.getSnapshot().reportError).toContain("byte limit");
  expect(files.download).not.toHaveBeenCalled();
  expect(runtime.session.fingerprint).toBe(fingerprint);
  expect(store.getSnapshot().reportOpen).toBe(true);
  await store.dispose();
});
