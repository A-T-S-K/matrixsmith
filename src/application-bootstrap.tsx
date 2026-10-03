import { ReplayTransport } from "./transport/replay";
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
  const simulation = import.meta.env.DEV
    ? new URLSearchParams(location.search).get("sim")
    : null;
  const simulated =
    import.meta.env.DEV && new URLSearchParams(location.search).has("sim");
  // Resolve dev-only modules at composition, before any later user Connect.
  const Simulator = simulated
    ? (await import("./dev/simulated-device")).SimulatedIledHatTransport
    : null;
  const synthetic =
    import.meta.env.DEV && simulation === "lumen"
      ? await import("./dev/synthetic-workspace")
      : import.meta.env.DEV && simulation?.startsWith("discovery")
        ? (await import("./dev/discovery-workspace")).discoveryWorkspace(
            simulation,
          )
        : null;
  const registry =
    synthetic?.registry ??
    (import.meta.env.DEV && simulation === "experimental"
      ? (await import("./dev/experimental-registry")).experimentalRegistry()
      : undefined);
  const createLiveWorkspace = (acceptedRegistry = registry) => {
    const trace = new TraceRecorder();
    const transport = synthetic
      ? synthetic.createTransport()
      : Simulator
        ? new Simulator(
            simulation
              ? `simulated-iledhat-${simulation}`
              : "simulated-iledhat",
            simulation === "unknown",
          )
        : new WebBluetoothTransport(trace);
    const controller = new ApplicationRuntime(
      transport,
      trace,
      acceptedRegistry,
    );
    trace.record("app.started", {
      webBluetoothSupported: "bluetooth" in navigator,
    });
    if (import.meta.env.DEV)
      (globalThis as Record<string, unknown>).matrixsmithTransport = transport;
    return { controller, transport };
  };
  const { controller, transport } = createLiveWorkspace();
  const store = new PresentationStore(controller, transport, {
    ...createBrowserEnvironment(),
    createLiveWorkspace,
    createOfflineWorkspace(fingerprint) {
      const offlineTransport = new ReplayTransport(fingerprint);
      return {
        transport: offlineTransport,
        controller: new ApplicationRuntime(
          offlineTransport,
          new TraceRecorder(),
          registry,
        ),
      };
    },
    ...(simulated ? { bluetoothSupported: true } : {}),
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
  const initialization = store.initialize();
  if (action) await runApplicationEffect(store, action);
  await initialization;
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
