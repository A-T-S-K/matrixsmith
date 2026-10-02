export const WORKBENCH_SECTIONS = [
  "candidates",
  "tools",
  "gatt",
  "transactions",
  "raw",
  "evidence",
  "orchestration",
] as const;
export type WorkbenchSection = (typeof WORKBENCH_SECTIONS)[number];
export type WorkspaceContext = "live" | "offline";
type WorkbenchRoute = {
  readonly id:
    `develop-${WorkbenchSection}` | `offline-develop-${WorkbenchSection}`;
  readonly hash: string;
  readonly context: WorkspaceContext;
  readonly section: WorkbenchSection;
};
export type AppRoute =
  | { readonly id: "home"; readonly hash: "#/home" }
  | {
      readonly id: "create";
      readonly hash: "#/device/create";
      readonly context: "live";
    }
  | {
      readonly id: "investigate";
      readonly hash: "#/device/investigate";
      readonly context: "live";
    }
  | {
      readonly id: "offline-report";
      readonly hash: "#/offline/report";
      readonly context: "offline";
    }
  | WorkbenchRoute;

export function workbenchRoute(
  context: WorkspaceContext,
  section: WorkbenchSection,
): WorkbenchRoute["id"] {
  return context === "live"
    ? `develop-${section}`
    : `offline-develop-${section}`;
}
export const ROUTES: readonly AppRoute[] = Object.freeze([
  { id: "home", hash: "#/home" },
  { id: "create", hash: "#/device/create", context: "live" },
  { id: "investigate", hash: "#/device/investigate", context: "live" },
  ...WORKBENCH_SECTIONS.map((section): WorkbenchRoute => ({
    id: workbenchRoute("live", section),
    hash: `#/device/develop/${section}`,
    context: "live",
    section,
  })),
  { id: "offline-report", hash: "#/offline/report", context: "offline" },
  ...WORKBENCH_SECTIONS.map((section): WorkbenchRoute => ({
    id: workbenchRoute("offline", section),
    hash: `#/offline/report/develop/${section}`,
    context: "offline",
    section,
  })),
]);

export function parseRoute(hash: string): AppRoute {
  const normalized = hash.startsWith("#") ? hash : `#${hash}`;
  return ROUTES.find((route) => route.hash === normalized) ?? ROUTES[0]!;
}

export interface HashRouter {
  readonly current: AppRoute;
  navigate(route: AppRoute["id"], replace?: boolean): void;
  dispose(): void;
  subscribe(listener: (route: AppRoute) => void): () => void;
}

export function createHashRouter(
  browserWindow: Pick<
    Window,
    "location" | "history" | "addEventListener" | "removeEventListener"
  >,
): HashRouter {
  let current = parseRoute(browserWindow.location.hash);
  const listeners = new Set<(route: AppRoute) => void>();
  const notify = (): void => {
    const next = parseRoute(browserWindow.location.hash);
    if (next.id === current.id) return;
    current = next;
    for (const listener of listeners) listener(current);
  };
  browserWindow.addEventListener("hashchange", notify);
  browserWindow.addEventListener("popstate", notify);
  return {
    get current() {
      return current;
    },
    navigate(id, replace = false) {
      const route = ROUTES.find((candidate) => candidate.id === id);
      if (!route) throw new Error(`Unknown route ${id}.`);
      if (route.id === current.id) return;
      if (replace) browserWindow.history.replaceState(null, "", route.hash);
      else browserWindow.history.pushState(null, "", route.hash);
      current = route;
      for (const listener of listeners) listener(current);
    },
    dispose() {
      browserWindow.removeEventListener("hashchange", notify);
      browserWindow.removeEventListener("popstate", notify);
      listeners.clear();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
