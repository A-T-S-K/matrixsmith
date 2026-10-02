import { describe, expect, it, vi } from "vitest";
import {
  createHashRouter,
  parseRoute,
} from "../../src/presentation/app/routes";

describe("static hash routes", () => {
  it("parses deep links and safely falls back home", () => {
    expect(parseRoute("#/device/investigate").id).toBe("investigate");
    expect(parseRoute("#/missing").id).toBe("home");
  });

  it("uses browser history without changing any connection state", () => {
    const listeners = new Map<string, () => void>();
    const location = { hash: "#/home" } as Location;
    const history = {
      pushState: vi.fn((_state, _unused, url) => {
        location.hash = String(url);
      }),
      replaceState: vi.fn((_state, _unused, url) => {
        location.hash = String(url);
      }),
    } as unknown as History;
    const router = createHashRouter({
      location,
      history,
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => listeners.set(type, listener as () => void),
      removeEventListener: vi.fn(),
    });
    const visited: string[] = [];
    router.subscribe(({ id }) => visited.push(id));
    router.navigate("create");
    expect(history.pushState).toHaveBeenCalledWith(null, "", "#/device/create");
    expect(visited).toEqual(["create"]);
  });
});

import { ROUTES, WORKBENCH_SECTIONS } from "../../src/presentation/app/routes";
import { ApplicationRuntime } from "../../src/application/runtime";
import { FakeTransport } from "../../src/transport/fake";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { PresentationStore } from "../../src/presentation/store";
import { createBrowserEnvironment } from "../../src/adapters/presentation/browser-environment";

it("projects every workbench section from navigation and retains it on reentry", async () => {
  const transport = new FakeTransport(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport);
  await runtime.connect();
  let route = parseRoute("#/device/develop/gatt");
  let changed!: (next: typeof route) => void;
  const router = {
    get current() {
      return route;
    },
    navigate(id: typeof route.id) {
      route = ROUTES.find((r) => r.id === id)!;
      changed(route);
    },
    dispose() {},
    subscribe(listener: typeof changed) {
      changed = listener;
      return () => {};
    },
  };
  const store = new PresentationStore(runtime, transport, {
    ...createBrowserEnvironment(),
    router,
  });
  // Initialization projects before the next snapshot publication.
  await store.initialize();
  expect(store.getSnapshot().workbenchSection).toBe("gatt");
  for (const section of WORKBENCH_SECTIONS) {
    store.setWorkbenchSection(section);
    expect(route.hash).toBe(`#/device/develop/${section}`);
    expect(store.getSnapshot()).toMatchObject({
      view: "develop",
      workbenchSection: section,
      missingContext: null,
    });
    store.setView("diagnose");
    store.setView("develop");
    expect(store.getSnapshot().workbenchSection).toBe(section);
    // A browser history publication is also canonical.
    changed(parseRoute(`#/device/develop/${section}`));
    expect(store.getSnapshot().workbenchSection).toBe(section);
  }
  store.importBundle(runtime.exportBundle());
  for (const section of WORKBENCH_SECTIONS) {
    store.setWorkbenchSection(section);
    expect(route.hash).toBe(`#/offline/report/develop/${section}`);
    expect(store.getSnapshot().workbenchSection).toBe(section);
  }
  changed(parseRoute("#/device/create"));
  expect(store.getSnapshot().missingContext).toBeNull();
  expect(store.controller).toBe(runtime);
  await store.dispose();
});

it("keeps aliases accurate and missing offline data unavailable", async () => {
  expect(parseRoute("#/device/develop/gatt")).toMatchObject({
    context: "live",
    section: "gatt",
  });
  expect(parseRoute("#/device/develop/transactions")).toMatchObject({
    context: "live",
    section: "transactions",
  });
  expect(parseRoute("#/offline/report").id).toBe("offline-report");
  const transport = new FakeTransport();
  const runtime = new ApplicationRuntime(transport);
  const route = parseRoute("#/offline/report");
  const store = new PresentationStore(runtime, transport, {
    ...createBrowserEnvironment(),
    router: {
      current: route,
      navigate() {},
      dispose() {},
      subscribe() {
        return () => {};
      },
    },
  });
  await store.initialize();
  expect(store.getSnapshot().missingContext).toBe("offline");
  expect(transport.state).toBe("idle");
  await store.dispose();
});
