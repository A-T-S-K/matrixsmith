import { createBrowserEnvironment } from "./adapters/presentation/browser-environment";
import type { UpdateManager } from "./app/update-manager";
import { render } from "preact";
import { ApplicationRuntime } from "./application/runtime";
import { TraceRecorder } from "./diagnostics/trace";
import { PresentationStore } from "./presentation/store";
import { WebBluetoothTransport } from "./transport/web-bluetooth";
import { App } from "./ui/App";
import type { ApplicationCommand } from "./application/commands";
import { runApplicationEffect } from "./application/effects";

/**
 * Loads the hardware/application graph only when a user enters a workspace.
 * The cold Home route deliberately does not construct a transport, driver
 * registry, report codec, image pipeline, or investigation engine.
 */
export async function startApplication(
  root: HTMLElement,
  action?: ApplicationCommand,
  updates?: UpdateManager,
): Promise<void> {
  const trace = new TraceRecorder();
  const simulation = import.meta.env.DEV
    ? new URLSearchParams(location.search).get("sim")
    : null;
  const simulated =
    import.meta.env.DEV && new URLSearchParams(location.search).has("sim");
  const transport = simulated
    ? new (await import("./dev/simulated-device")).SimulatedIledHatTransport(
        simulation ? `simulated-iledhat-${simulation}` : "simulated-iledhat",
        simulation === "unknown",
      )
    : new WebBluetoothTransport(trace);
  const registry =
    import.meta.env.DEV && simulation === "experimental"
      ? (await import("./dev/experimental-registry")).experimentalRegistry()
      : undefined;
  const store = new PresentationStore(
    new ApplicationRuntime(transport, trace, registry),
    transport,
    {
      ...createBrowserEnvironment(),
      ...(simulated ? { bluetoothSupported: true } : {}),
    },
  );
  trace.record("app.started", {
    webBluetoothSupported: "bluetooth" in navigator,
  });
  updates?.setBlocker(() => {
    const snapshot = store.getSnapshot();
    return (
      snapshot.busy ??
      (snapshot.guidedFlow
        ? "Finish or close the guided test before updating."
        : null)
    );
  });
  render(<App store={store} updates={updates} />, root);
  await store.initialize();
  if (action) await runApplicationEffect(store, action);
  window.addEventListener(
    "pagehide",
    (event) => {
      if (!event.persisted) void store.dispose();
    },
    { once: true },
  );

  if (import.meta.env.DEV) {
    (globalThis as Record<string, unknown>).matrixsmithStore = store;
    (globalThis as Record<string, unknown>).matrixsmithTransport = transport;
  }
}
