import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync(
  new URL("../../src/main.tsx", import.meta.url),
  "utf8",
);
const home = readFileSync(
  new URL("../../src/ui/pages/Home.tsx", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../scripts/verify-static-output.mjs", import.meta.url),
  "utf8",
);
const worker = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);

describe("cold Home loading boundary", () => {
  it("keeps the hardware/application graph behind a user-driven import", () => {
    expect(main).toContain('import("./application-bootstrap")');
    expect(main).not.toMatch(
      /^import .*\/(?:application\/runtime|presentation\/store|transport\/web-bluetooth)/m,
    );
    expect(home).toContain('from "../../presentation/service-hints"');
  });

  it("enforces the 90 KiB static dependency closure", () => {
    expect(verifier).toContain("const INITIAL_ROUTE_JS_GZIP_LIMIT = 90 * 1024");
    expect(verifier).toContain("collectInitialJavascript");
    expect(verifier).toContain("modulepreload");
  });

  it("pre-caches lazy build assets so the boundary remains offline-capable", () => {
    expect(worker).toContain("__MATRIXSMITH_ASSETS__");
    expect(worker).toContain("ASSETS.map");
    expect(worker).toContain("assets.addAll");
  });
});

// Exercise the actual entrypoint with lightweight boundary ports. No browser
// chooser or hardware graph is constructed by these tests.
async function entrypoint(importGate?: Promise<void>) {
  const { vi } = await import("vitest");
  const { UpdateManager } = await import("../../src/app/update-manager");
  vi.resetModules();
  const manager = new UpdateManager({
    hasWaiting: () => true,
    check: async () => {},
    activate: vi.fn(async () => {}),
    reload: vi.fn(),
    subscribe: () => () => {},
  });
  const rendered: unknown[] = [];
  const selection = deferred<BluetoothDevice>();
  const choose = vi.fn(() => {
    expect(manager.blockingReason).toMatch(/opening the workspace/);
    return selection.promise;
  });
  const start = vi.fn(async () => {});
  vi.stubEnv("PROD", true);
  vi.stubEnv("DEV", false);
  vi.stubGlobal("document", { querySelector: () => ({}) });
  vi.stubGlobal("navigator", { serviceWorker: {} });
  vi.stubGlobal("location", { search: "", hash: "#/home" });
  vi.stubGlobal("window", { location: { reload: vi.fn() } });
  vi.doMock("preact", async () => ({
    ...(await vi.importActual<typeof import("preact")>("preact")),
    render: (vnode: unknown) => rendered.push(vnode),
  }));
  vi.doMock("../../src/ui/pages/BootstrapHome", () => ({
    BootstrapHome: () => null,
  }));
  vi.doMock("../../src/adapters/browser-home", () => ({
    createHomeCapabilities: () => ({}),
  }));
  vi.doMock("../../src/adapters/home-selection", () => ({
    selectFromHome: choose,
  }));
  vi.doMock("../../src/adapters/updates/browser-updates", () => ({
    createBrowserUpdates: () => manager,
  }));
  vi.doMock("../../src/application-bootstrap", async () => {
    await importGate;
    return { startApplication: start };
  });
  await import("../../src/main");
  const home = rendered[0] as {
    props: { start: (action: { kind: "connect" }) => Promise<void> };
  };
  return {
    manager,
    choose,
    start,
    selection,
    rendered,
    open: () => home.props.start({ kind: "connect" }),
  };
}

import { afterEach, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const module of [
    "preact",
    "../../src/ui/pages/BootstrapHome",
    "../../src/adapters/browser-home",
    "../../src/adapters/home-selection",
    "../../src/adapters/updates/browser-updates",
    "../../src/application-bootstrap",
  ])
    vi.doUnmock(module);
  vi.resetModules();
});

it("owns a synchronous chooser through delayed import and completed bootstrap", async () => {
  const gate = deferred<void>();
  const app = await entrypoint(gate.promise);
  const opening = app.open();
  expect(app.choose).toHaveBeenCalledOnce();
  expect(app.manager.blockingReason).toMatch(/opening/);
  expect(app.start).not.toHaveBeenCalled();
  gate.resolve();
  await vi.waitFor(() => expect(app.start).toHaveBeenCalledOnce());
  // Even a completed mock runtime cannot release an outstanding native chooser.
  expect(app.manager.blockingReason).toMatch(/opening/);
  app.selection.resolve({} as BluetoothDevice);
  await opening;
  expect(app.manager.blockingReason).toBeNull();
  app.manager.dispose();
});

it("keeps chooser ownership after import rejection and exposes safe recovery without replay", async () => {
  const gate = deferred<void>();
  const app = await entrypoint(gate.promise);
  const opening = app.open();
  const failed = expect(opening).rejects.toMatchObject({
    cause: { message: "download failed" },
  });
  gate.reject(new Error("download failed"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(app.manager.blockingReason).toMatch(/opening/);
  app.selection.reject(new Error("chooser cancelled"));
  await failed;
  expect(app.manager.blockingReason).toBeNull();
  expect(app.start).not.toHaveBeenCalled();
  expect(app.choose).toHaveBeenCalledOnce();
  expect(app.rendered).toHaveLength(2);
  app.manager.dispose();
});

it("does not invoke a chooser after another tab reserves an update", async () => {
  const app = await entrypoint();
  app.manager.setActivationLock(true);
  await expect(app.open()).rejects.toThrow(/update is being applied/);
  expect(app.choose).not.toHaveBeenCalled();
  app.manager.dispose();
});

async function bootstrapFixture(constructionFailure = false) {
  vi.resetModules();
  vi.stubEnv("DEV", false);
  vi.stubGlobal("navigator", {});
  const events = new EventTarget();
  vi.stubGlobal("window", events);
  const initialize = deferred<void>();
  const connect = deferred<void>();
  const disposal = deferred<void>();
  const store = {
    initialize: vi.fn(() => initialize.promise),
    connect: vi.fn(() => connect.promise),
    getSnapshot: () => ({
      busy: null,
      contextTransitionReason: null,
      guidedFlow: null,
    }),
    dispose: vi.fn(() => disposal.promise),
  };
  const controller = { dispose: vi.fn(async () => {}) };
  const render = vi.fn();
  vi.doMock("preact", async () => ({
    ...(await vi.importActual<typeof import("preact")>("preact")),
    render,
  }));
  vi.doMock("../../src/ui/App", () => ({ App: () => null }));
  vi.doMock("../../src/adapters/presentation/browser-environment", () => ({
    createBrowserEnvironment: () => ({}),
  }));
  vi.doMock("../../src/diagnostics/trace", () => ({
    TraceRecorder: class {
      record() {}
    },
  }));
  vi.doMock("../../src/transport/web-bluetooth", () => ({
    WebBluetoothTransport: class {},
  }));
  vi.doMock("../../src/application/runtime", () => ({
    ApplicationRuntime: class {
      constructor() {
        return controller;
      }
    },
  }));
  vi.doMock("../../src/presentation/store", () => ({
    PresentationStore: class {
      constructor() {
        if (constructionFailure) throw new Error("construction failed");
        return store;
      }
    },
  }));
  const { startApplication } = await import("../../src/application-bootstrap");
  return {
    startApplication,
    store,
    controller,
    initialize,
    connect,
    disposal,
    render,
  };
}

afterEach(() => {
  for (const module of [
    "../../src/ui/App",
    "../../src/adapters/presentation/browser-environment",
    "../../src/diagnostics/trace",
    "../../src/transport/web-bluetooth",
    "../../src/application/runtime",
    "../../src/presentation/store",
  ])
    vi.doUnmock(module);
});

it("waits for initial action settlement and disposal after initialization failure", async () => {
  const fixture = await bootstrapFixture();
  const { UpdateManager } = await import("../../src/app/update-manager");
  const manager = new UpdateManager({
    hasWaiting: () => false,
    check: async () => {},
    activate: async () => {},
    reload() {},
    subscribe: () => () => {},
  });
  const startupRelease = manager.beginActivity("Opening workspace");
  const attempt = fixture
    .startApplication({} as HTMLElement, { kind: "connect" }, manager)
    .finally(startupRelease);
  const failure = expect(attempt).rejects.toThrow("initialization failed");
  fixture.initialize.reject(new Error("initialization failed"));
  await Promise.resolve();
  expect(fixture.store.dispose).not.toHaveBeenCalled();
  expect(manager.blockingReason).toBe("Opening workspace");
  fixture.connect.resolve();
  await vi.waitFor(() => expect(fixture.store.dispose).toHaveBeenCalledOnce());
  expect(manager.blockingReason).toBe("Opening workspace");
  fixture.disposal.resolve();
  await failure;
  expect(manager.blockingReason).toBeNull();
  expect(fixture.render).not.toHaveBeenCalled();
  manager.dispose();
});

it("disposes the controller if store construction fails", async () => {
  const fixture = await bootstrapFixture(true);
  await expect(fixture.startApplication({} as HTMLElement)).rejects.toThrow(
    "construction failed",
  );
  expect(fixture.controller.dispose).toHaveBeenCalledOnce();
  expect(fixture.render).not.toHaveBeenCalled();
});

it("preserves initialization failure when cleanup rejects and releases only its owner", async () => {
  const fixture = await bootstrapFixture();
  const { UpdateManager } = await import("../../src/app/update-manager");
  const manager = new UpdateManager({
    hasWaiting: () => false,
    check: async () => {},
    activate: async () => {},
    reload() {},
    subscribe: () => () => {},
  });
  const peer = manager.beginActivity("Peer import");
  const attempt = fixture.startApplication(
    {} as HTMLElement,
    undefined,
    manager,
  );
  const failed = expect(attempt).rejects.toThrow(
    "original initialization failure",
  );
  fixture.initialize.reject(new Error("original initialization failure"));
  await vi.waitFor(() => expect(fixture.store.dispose).toHaveBeenCalledOnce());
  fixture.disposal.reject(new Error("secondary cleanup failure"));
  await failed;
  expect(manager.blockingReason).toBe("Peer import");
  peer();
  expect(manager.blockingReason).toBeNull();
  manager.dispose();
});

it("cleans up successful workspace ownership on actual page disposal", async () => {
  const fixture = await bootstrapFixture();
  const { UpdateManager } = await import("../../src/app/update-manager");
  const manager = new UpdateManager({
    hasWaiting: () => false,
    check: async () => {},
    activate: async () => {},
    reload() {},
    subscribe: () => () => {},
  });
  const attempt = fixture.startApplication(
    {} as HTMLElement,
    undefined,
    manager,
  );
  fixture.initialize.resolve();
  await attempt;
  expect(fixture.render).toHaveBeenCalledOnce();
  window.dispatchEvent(
    Object.assign(new Event("pagehide"), { persisted: false }),
  );
  expect(fixture.store.dispose).toHaveBeenCalledOnce();
  fixture.disposal.resolve();
  await Promise.resolve();
  expect(manager.blockingReason).toBeNull();
  manager.dispose();
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("supervises disposal before initialization finishes and preserves a bfcache return", async () => {
  const fixture = await bootstrapFixture();
  const attempt = fixture.startApplication({} as HTMLElement);
  window.dispatchEvent(
    Object.assign(new Event("pagehide"), { persisted: true }),
  );
  expect(fixture.store.dispose).not.toHaveBeenCalled();
  window.dispatchEvent(
    Object.assign(new Event("pagehide"), { persisted: false }),
  );
  expect(fixture.store.dispose).toHaveBeenCalledOnce();
  fixture.disposal.resolve();
  fixture.initialize.resolve();
  await attempt;
  expect(fixture.render).not.toHaveBeenCalled();
  window.dispatchEvent(
    Object.assign(new Event("pagehide"), { persisted: false }),
  );
  expect(fixture.store.dispose).toHaveBeenCalledOnce();
});

it("coalesces pending native entry loads and retains a successful namespace", async () => {
  const { retryableImport } =
    await import("../../src/ui/components/module-recovery");
  const gate = deferred<{ retained: boolean }>();
  const original = vi.fn(() => gate.promise);
  const load = retryableImport("DevelopView", original);
  const first = load();
  expect(load()).toBe(first);
  gate.resolve({ retained: true });
  const module = await first;
  expect(await load()).toBe(module);
  expect(original).toHaveBeenCalledOnce();
  expect(load.canRetry()).toBe(false);
});

it("does not spend the explicit native retry when a failed route remounts", async () => {
  const { retryableImport } =
    await import("../../src/ui/components/module-recovery");
  const error = new TypeError(
    "Failed to fetch dynamically imported module: fixture",
  );
  const original = vi.fn(async () => {
    throw error;
  });
  const load = retryableImport("DevelopView", original);
  await expect(load()).rejects.toBe(error);
  await expect(load()).rejects.toBe(error);
  expect(original).toHaveBeenCalledOnce();
  expect(load.canRetry()).toBe(true);
});

it("keeps programming errors outside native download recovery", async () => {
  const { retryableImport } =
    await import("../../src/ui/components/module-recovery");
  const error = new Error("invalid workbench state");
  const original = vi.fn(async () => {
    throw error;
  });
  const load = retryableImport("DevelopView", original);
  await expect(load()).rejects.toBe(error);
  expect(load.canRetry()).toBe(false);
  load.retry();
  await expect(load()).rejects.toBe(error);
  expect(original).toHaveBeenCalledOnce();
});
