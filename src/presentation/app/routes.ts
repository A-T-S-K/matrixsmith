export type AppRoute =
  | { readonly id: "home"; readonly hash: "#/home" }
  | { readonly id: "create"; readonly hash: "#/device/create" }
  | { readonly id: "investigate"; readonly hash: "#/device/investigate" }
  | {
      readonly id: "develop-transactions";
      readonly hash: "#/device/develop/transactions";
    }
  | { readonly id: "develop-gatt"; readonly hash: "#/device/develop/gatt" }
  | { readonly id: "offline-report"; readonly hash: "#/offline/report" };

export const ROUTES: readonly AppRoute[] = Object.freeze([
  { id: "home", hash: "#/home" },
  { id: "create", hash: "#/device/create" },
  { id: "investigate", hash: "#/device/investigate" },
  { id: "develop-transactions", hash: "#/device/develop/transactions" },
  { id: "develop-gatt", hash: "#/device/develop/gatt" },
  { id: "offline-report", hash: "#/offline/report" },
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
