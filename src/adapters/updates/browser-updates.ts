import { UpdateManager, type UpdatePort } from "../../app/update-manager";

export function createBrowserUpdates(
  container: ServiceWorkerContainer,
  reload: () => void,
): UpdateManager {
  let disposed = false;
  let reloaded = false;
  const reloadOnce = (): void => {
    if (!reloaded) {
      reloaded = true;
      reload();
    }
  };
  let registration: ServiceWorkerRegistration | undefined;
  const listeners = new Set<() => void>();
  const cleanups: (() => void)[] = [];
  let lockTimer: ReturnType<typeof setTimeout> | undefined;
  let hadController = Boolean(container.controller);
  const announce = (): void => {
    for (const listener of listeners) listener();
  };
  const port: UpdatePort = {
    hasWaiting: () => Boolean(registration?.waiting),
    async check() {
      await registration?.update();
      announce();
    },
    activate: () =>
      new Promise<void>((resolve, reject) => {
        const worker = registration?.waiting;
        if (!worker) {
          reject(new Error("No update is waiting."));
          return;
        }
        const channel = new MessageChannel();
        const done = (error?: Error): void => {
          clearTimeout(timeout);
          channel.port1.close();
          container.removeEventListener("controllerchange", changed);
          if (error) reject(error);
          else resolve();
        };
        const changed = (): void => done();
        const timeout = setTimeout(
          () =>
            done(
              new Error(
                "Update activation timed out. Retry when all app tabs are idle.",
              ),
            ),
          15000,
        );
        container.addEventListener("controllerchange", changed, { once: true });
        channel.port1.onmessage = (event: MessageEvent<{ error?: string }>) => {
          if (event.data.error) done(new Error(event.data.error));
        };
        worker.postMessage({ type: "matrixsmith:apply-update" }, [
          channel.port2,
        ]);
      }),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        disposed = true;
        clearTimeout(lockTimer);
        for (const cleanup of cleanups.splice(0)) cleanup();
      };
    },
    reload: reloadOnce,
  };
  const manager = new UpdateManager(port);
  const message = (event: MessageEvent): void => {
    if (event.data?.type === "matrixsmith:check-ready") {
      const reason = manager.blockingReason;
      event.ports[0]?.postMessage({ ready: !reason, reason });
      if (!reason) {
        manager.setActivationLock(true);
        clearTimeout(lockTimer);
        lockTimer = setTimeout(() => manager.setActivationLock(false), 16000);
      }
    } else if (event.data?.type === "matrixsmith:update-cancelled") {
      clearTimeout(lockTimer);
      manager.setActivationLock(false);
    } else if (event.data?.type === "matrixsmith:update-available") announce();
  };
  const changed = (): void => {
    if (hadController) reloadOnce();
    hadController = true;
  };
  container.addEventListener("message", message);
  container.addEventListener("controllerchange", changed);
  cleanups.push(
    () => container.removeEventListener("message", message),
    () => container.removeEventListener("controllerchange", changed),
  );
  void container
    .register("./sw.js")
    .then((value) => {
      if (disposed) return;
      registration = value;
      const found = (): void => {
        const worker = value.installing;
        if (worker) {
          worker.addEventListener("statechange", announce);
          cleanups.push(() =>
            worker.removeEventListener("statechange", announce),
          );
        }
        announce();
      };
      value.addEventListener("updatefound", found);
      cleanups.push(() => value.removeEventListener("updatefound", found));
      found();
    })
    .catch(() => {
      /* Offline first visit: installation will be retried on the next load. */
    });
  return manager;
}
