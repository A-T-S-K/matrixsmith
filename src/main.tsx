import { createHomeCapabilities } from "./adapters/browser-home";
import { fileActivity } from "./application/file-input";
import { createBrowserUpdates } from "./adapters/updates/browser-updates";
import "./style.css";
import { render } from "preact";
import { BootstrapHome } from "./ui/pages/BootstrapHome";
import type { ApplicationCommand } from "./application/commands";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root");
const appRoot = root;

// Presentation mode uses the real framebuffer preview without constructing a
// transport, loading a workspace, or consulting persisted device state.
if (new URLSearchParams(location.search).get("demo") === "1") {
  void import("./ui/pages/Demo").then(({ Demo }) => render(<Demo />, appRoot));
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
  function startApplication(action?: ApplicationCommand): Promise<void> {
    if (applicationPromise) return applicationPromise;
    const attempt = import("./application-bootstrap").then((module) =>
      module.startApplication(appRoot, action, updates),
    );
    applicationPromise = attempt;
    void attempt.catch(() => {
      applicationPromise = null;
    });
    return attempt;
  }

  const coldHome = location.hash === "" || location.hash === "#/home";
  const simulated =
    import.meta.env.DEV && new URLSearchParams(location.search).has("sim");
  if (!coldHome || simulated) {
    void startApplication();
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
