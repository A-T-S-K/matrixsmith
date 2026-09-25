import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { ApplicationCommand } from "../../application/commands";
import type { HomeCapabilities } from "../../application/ports/home";
import { readStoredInvestigationSummary } from "../../storage/history-summary";
import type { UpdateManager } from "../../app/update-manager";
import { UpdateNotice } from "../components/UpdateNotice";
import { Home, type HomeSnapshot, type HomeStore } from "./Home";

export function BootstrapHome({
  start,
  updates,
  capabilities,
}: {
  readonly updates?: UpdateManager;
  readonly capabilities: HomeCapabilities;
  readonly start: (action: ApplicationCommand) => Promise<void>;
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previouslyAuthorized, setPreviouslyAuthorized] = useState<
    readonly { id: string; name: string }[]
  >([]);
  useEffect(() => {
    let active = true;
    void capabilities.authorizedDevices().then(
      (devices) => {
        if (active) setPreviouslyAuthorized(devices);
      },
      () => {
        if (active) setPreviouslyAuthorized([]);
      },
    );
    return () => {
      active = false;
    };
  }, [capabilities]);
  const storedInvestigation = useMemo(
    () => readStoredInvestigationSummary(capabilities.storage),
    [capabilities],
  );
  const load = (label: string, action: ApplicationCommand): Promise<void> => {
    setBusy(label);
    setError(null);
    return start(action).catch((reason: unknown) => {
      setBusy(null);
      setError(`Could not open MatrixSmith: ${String(reason)}`);
    });
  };
  const store: HomeStore = {
    connect: (mode, optionalServices) =>
      load("Opening display…", { kind: "connect", mode, optionalServices }),
    setView: () => undefined,
    disconnect: () => undefined,
    importBundle: (content) =>
      load("Opening report…", { kind: "import-bundle", content }),
    importExternalCapture: (content) =>
      load("Importing capture…", { kind: "import-capture", content }),
    returnToLiveWorkspace: () => undefined,
    reconnectAuthorized: (deviceId) =>
      load("Reconnecting…", { kind: "reconnect", deviceId }),
    resumeStoredInvestigation: () => {
      void load("Opening investigation…", { kind: "resume-investigation" });
    },
    forgetLocalHistory: () => {
      void load("Forgetting local history…", { kind: "forget-history" });
    },
  };
  const snapshot: HomeSnapshot = {
    liveConnected: false,
    device: null,
    assessment: { summary: "No display connected.", readiness: "no-device" },
    busy,
    error,
    bluetoothSupported: capabilities.bluetoothSupported,
    liveWorkspaceAvailable: false,
    previouslyAuthorized,
    storedInvestigation,
  };
  return (
    <>
      <Home snapshot={snapshot} store={store} />
      <UpdateNotice updates={updates} blocked={busy} />
    </>
  );
}
