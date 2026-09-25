import { createHomeCapabilities } from "../browser-home";
import { ApplicationRuntime } from "../../application/runtime";
import { ReplayTransport } from "../../transport/replay";
import type { PresentationEnvironment } from "../../presentation/environment";
import { createHashRouter } from "../../presentation/app/routes";
import { TransferWakeLock } from "../../app/wake-lock";
import { BrowserFilesAdapter } from "../files/browser-files";

export function createBrowserEnvironment(): PresentationEnvironment {
  const windowLike = typeof window === "undefined" ? null : window;
  const navigatorLike = typeof navigator === "undefined" ? {} : navigator;
  return {
    createOfflineWorkspace(fingerprint) {
      const transport = new ReplayTransport(fingerprint);
      return { transport, controller: new ApplicationRuntime(transport) };
    },
    ...createHomeCapabilities(),
    files: new BrowserFilesAdapter(),
    wakeLock: new TransferWakeLock(
      navigatorLike,
      typeof document === "undefined" ? undefined : document,
    ),
    router: windowLike ? createHashRouter(windowLike) : null,
    signalTimingStart() {
      try {
        (navigatorLike as Navigator).vibrate?.([40, 60, 40]);
      } catch {
        /* Optional physical timing cue. */
      }
    },
    onBack(listener) {
      windowLike?.addEventListener("popstate", listener);
      return () => windowLike?.removeEventListener("popstate", listener);
    },
    pushOverlay(kind) {
      windowLike?.history.pushState(
        { matrixsmithOverlay: kind },
        "",
        windowLike.location.href,
      );
    },
    back() {
      windowLike?.history.back();
    },
  };
}
