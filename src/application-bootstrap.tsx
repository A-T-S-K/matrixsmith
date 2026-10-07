import { ReplayTransport } from "./transport/replay";
import { createBrowserEnvironment } from "./adapters/presentation/browser-environment";
import {
  workspaceUpdateBlocker,
  type UpdateManager,
} from "./app/update-manager";
import { render } from "preact";
import { ApplicationRuntime } from "./application/runtime";
import { TraceRecorder } from "./diagnostics/trace";
import { PresentationStore } from "./presentation/store";
import { WebBluetoothTransport } from "./transport/web-bluetooth";
import { App } from "./ui/App";
import type { ApplicationCommand } from "./application/commands";
import { runApplicationEffect } from "./application/effects";

// The shared advisory component retains owner-scoped state across views. Keep
// its module in the successful application graph during native view recovery.
export { AdvisoryKnowledge } from "./ui/components/AdvisoryKnowledge";

/**
 * Loads the hardware/application graph only when a user enters a workspace.
 * The cold Home route deliberately does not construct a transport, driver
 * registry, report codec, image pipeline, or investigation engine.
 */
export async function startApplication(
  root: HTMLElement,
  action?: ApplicationCommand,
  updates?: UpdateManager,
  initialSelection?: Promise<BluetoothDevice>,
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
      : import.meta.env.DEV && simulation?.startsWith("read-")
        ? (await import("./dev/read-workspace")).readWorkspace(simulation)
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
        : new WebBluetoothTransport(trace, initialSelection);
    initialSelection = undefined;
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
  let store: PresentationStore | undefined;
  let releaseBlocker: (() => void) | undefined;
  let removePagehide: (() => void) | undefined;
  let disposal: Promise<void> | undefined;
  let disposed = false;
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    disposed = true;
    removePagehide?.();
    try {
      disposal = (store ? store.dispose() : controller.dispose()).finally(() =>
        releaseBlocker?.(),
      );
    } catch (error) {
      releaseBlocker?.();
      disposal = Promise.reject(error);
    }
    return disposal;
  };
  try {
    store = new PresentationStore(controller, transport, {
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
    const workspace = store;
    releaseBlocker = updates?.addBlocker(() =>
      workspaceUpdateBlocker(workspace.getSnapshot()),
    );
    const pagehide = (event: PageTransitionEvent): void => {
      if (!event.persisted) void dispose().catch(() => undefined);
    };
    window.addEventListener("pagehide", pagehide);
    removePagehide = () => window.removeEventListener("pagehide", pagehide);
    // Observe both operations immediately and retain ownership until both settle.
    const outcomes = await Promise.allSettled([
      workspace.initialize(),
      action ? runApplicationEffect(workspace, action) : Promise.resolve(),
    ]);
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    if (disposed) {
      await disposal;
      return;
    }
    render(<App store={workspace} updates={updates} />, root);

    if (import.meta.env.DEV) {
      (globalThis as Record<string, unknown>).matrixsmithStore = workspace;
      (globalThis as Record<string, unknown>).matrixsmithTransport = transport;
    }
  } catch (error) {
    await dispose().catch(() => undefined);
    throw error;
  }
}
