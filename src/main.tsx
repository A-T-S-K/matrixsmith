import { selectFromHome } from "./adapters/home-selection";
import { createHomeCapabilities } from "./adapters/browser-home";
import { fileActivity } from "./application/file-input";
import { createBrowserUpdates } from "./adapters/updates/browser-updates";
import "./style.css";
import { render } from "preact";
import { BootstrapHome } from "./ui/pages/BootstrapHome";
import { retryableImport } from "./ui/components/module-recovery";
import type { ApplicationCommand } from "./application/commands";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root");
const appRoot = root;

function startupStatus(
  label: string,
  failed = false,
  retry = () => window.location.reload(),
  exhausted = false,
): void {
  render(
    <main class="workspace">
      <h1
        tabIndex={-1}
        ref={(heading) => {
          if (failed) heading?.focus();
        }}
      >
        {failed ? `${label} unavailable` : `Loading ${label}…`}
      </h1>
      <p role={failed ? "alert" : "status"}>
        {failed
          ? "Could not open this workspace. Retry or return to Home."
          : "Opening your workspace…"}
      </p>
      {failed && exhausted && (
        <p role="alert">Retry failed. Return to Home to continue.</p>
      )}
      {failed && !exhausted && (
        <button onClick={retry}>Retry loading {label}</button>
      )}
      <a href={import.meta.env.BASE_URL}>Go to Home</a>
    </main>,
    appRoot,
  );
}

// Presentation mode uses the real framebuffer preview without constructing a
// transport, loading a workspace, or consulting persisted device state.
const query = new URLSearchParams(location.search);
if (query.has("offline")) {
  const initialReference =
    query.get("reference") ??
    (query.get("offline") === "1" ? "lsled" : query.get("offline") || "lsled");
  render(
    <main class="offline-legacy">
      <p role="status">Loading offline protocol explorer…</p>
    </main>,
    appRoot,
  );
  void import("./ui/pages/OfflineLegacy")
    .then(({ OfflineLegacy }) =>
      render(<OfflineLegacy initialReference={initialReference} />, appRoot),
    )
    .catch(() =>
      render(
        <main class="offline-legacy">
          <a href={import.meta.env.BASE_URL}>← MatrixSmith home</a>
          <h1>Offline preview unavailable</h1>
          <p role="alert">Could not load the offline protocol explorer.</p>
          <button onClick={() => window.location.reload()}>
            Retry offline preview
          </button>
        </main>,
        appRoot,
      ),
    );
} else if (new URLSearchParams(location.search).get("demo") === "1") {
  startupStatus("demo");
  void import("./ui/pages/Demo")
    .then(({ Demo }) => render(<Demo />, appRoot))
    .catch(() => startupStatus("demo", true));
} else {
  const updates =
    import.meta.env.PROD && "serviceWorker" in navigator
      ? createBrowserUpdates(navigator.serviceWorker, () =>
          window.location.reload(),
        )
      : undefined;

  updates?.addBlocker(() =>
    fileActivity.active ? "Finish importing the file before updating." : null,
  );

  let applicationPromise: Promise<void> | null = null;
  const loadApplication = retryableImport(
    "application",
    () => import("./application-bootstrap"),
  );
  function startApplication(
    action?: ApplicationCommand,
    retainedSelection?: Promise<BluetoothDevice>,
  ): Promise<void> {
    if (applicationPromise) return applicationPromise;
    let release: (() => void) | undefined;
    let selection: Promise<BluetoothDevice> | undefined;
    try {
      release = updates?.beginActivity(
        "Finish opening the workspace before updating.",
      );
      // Invoke the chooser before loading the application, while the gesture is active.
      selection =
        retainedSelection ??
        (action?.kind === "connect" ? selectFromHome(action) : undefined);
    } catch (error) {
      release?.();
      return Promise.reject(error);
    }
    void selection?.catch(() => undefined);
    const attempt = loadApplication().then((module) =>
      module.startApplication(appRoot, action, updates, selection),
    );
    // An import may fail while the native chooser is still open. Keep ownership
    // until that selection actually settles; never restart the chooser here.
    const owned = attempt.finally(async () => {
      await selection?.catch(() => undefined);
      release?.();
    });
    applicationPromise = owned;
    void owned.catch(() => {
      applicationPromise = null;
      startupStatus(
        "MatrixSmith",
        true,
        action
          ? () => {
              loadApplication.retry();
              startupStatus("MatrixSmith");
              void startApplication(action, selection).catch(() => undefined);
            }
          : undefined,
        Boolean(action) && !loadApplication.canRetry(),
      );
    });
    return owned;
  }

  const coldHome = location.hash === "" || location.hash === "#/home";
  const simulated =
    import.meta.env.DEV && new URLSearchParams(location.search).has("sim");
  if (!coldHome || simulated) {
    startupStatus("MatrixSmith");
    void startApplication().catch(() => undefined);
  } else {
    render(
      <BootstrapHome
        updates={updates}
        capabilities={createHomeCapabilities()}
        start={(action) => startApplication(action)}
      />,
      appRoot,
    );
  }
  // The offline shell belongs to production builds only. In dev the service
  // worker would cache Vite's transient module URLs and serve stale HTML after
  // refactors, so dev sessions unregister any worker left by a previous build.
  if ("serviceWorker" in navigator) {
    if (import.meta.env.DEV)
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations.map((registration) => registration.unregister()),
          ),
        )
        .catch(() => undefined);
  }
}
