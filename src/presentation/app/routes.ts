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
type RouteSpec =
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

export type AppRoute = RouteSpec & { readonly reportGeneration?: string };

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
  navigate(
    route: AppRoute["id"],
    replace?: boolean,
    reportGeneration?: string,
  ): void;
  dispose(): void;
  subscribe(listener: (route: AppRoute) => void): () => void;
}

export function createHashRouter(
  browserWindow: Pick<
    Window,
    "location" | "history" | "addEventListener" | "removeEventListener"
  >,
): HashRouter {
  const readRoute = (): AppRoute => {
    const route = parseRoute(browserWindow.location.hash);
    const generation: unknown =
      browserWindow.history.state?.matrixsmithReportGeneration;
    return "context" in route &&
      route.context === "offline" &&
      typeof generation === "string"
      ? { ...route, reportGeneration: generation }
      : route;
  };
  let current = readRoute();
  const listeners = new Set<(route: AppRoute) => void>();
  const notify = (): void => {
    const next = readRoute();
    if (
      next.id === current.id &&
      next.reportGeneration === current.reportGeneration
    )
      return;
    current = next;
    for (const listener of listeners) listener(current);
  };
  browserWindow.addEventListener("hashchange", notify);
  browserWindow.addEventListener("popstate", notify);
  return {
    get current() {
      return current;
    },
    navigate(id, replace = false, reportGeneration) {
      const route = ROUTES.find((candidate) => candidate.id === id);
      if (!route) throw new Error(`Unknown route ${id}.`);
      if (
        route.id === current.id &&
        current.reportGeneration === reportGeneration
      )
        return;
      const state =
        reportGeneration === undefined
          ? null
          : { matrixsmithReportGeneration: reportGeneration };
      if (replace) browserWindow.history.replaceState(state, "", route.hash);
      else browserWindow.history.pushState(state, "", route.hash);
      current =
        reportGeneration === undefined ? route : { ...route, reportGeneration };
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
