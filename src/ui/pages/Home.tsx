import { readBoundedText } from "../../application/file-input";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { FileButton } from "../components/FileButton";
import { parseServiceHints } from "../../presentation/service-hints";
import type {
  AppSnapshot,
  PresentationStore,
  WorkspaceView,
} from "../../presentation/store";

/** The intentionally small contract used by both the cold Home shell and the full store. */
export interface HomeSnapshot {
  readonly liveConnected: boolean;
  readonly device: Pick<NonNullable<AppSnapshot["device"]>, "name"> | null;
  readonly assessment: Pick<AppSnapshot["assessment"], "summary" | "readiness">;
  readonly busy: string | null;
  readonly error: string | null;
  readonly bluetoothSupported: boolean;
  readonly liveWorkspaceAvailable: boolean;
  readonly previouslyAuthorized: AppSnapshot["previouslyAuthorized"];
  readonly storedInvestigation: AppSnapshot["storedInvestigation"];
}

export interface HomeStore {
  connect(
    mode?: "registered" | "inspection",
    optionalServices?: BluetoothServiceUUID[],
  ): void | Promise<void>;
  setView(view: WorkspaceView): void;
  disconnect(): void | Promise<void>;
  importBundle(json: string): void | Promise<void>;
  importExternalCapture(content: string): void | Promise<void>;
  returnToLiveWorkspace(): void;
  reconnectAuthorized(deviceId: string): void | Promise<void>;
  resumeStoredInvestigation(): void;
  forgetLocalHistory(): void;
}

export function Home({
  snapshot,
  store,
}: {
  readonly snapshot: HomeSnapshot;
  readonly store: HomeStore | PresentationStore;
}): JSX.Element {
  const [serviceHints, setServiceHints] = useState("");
  return (
    <main class="home">
      <header class="home-hero">
        <div class="brand-lockup">
          <span class="brand-mark large">MS</span>
          <span>MatrixSmith</span>
        </div>
        <p class="eyebrow">BLUETOOTH MATRIX WORKBENCH</p>
        <h1>
          Make the display
          <br />
          <em>explain itself.</em>
        </h1>
        <p class="lede">
          Control supported displays, diagnose unfamiliar hardware, and capture
          protocol evidence—all locally in your browser.
        </p>
        {snapshot.liveConnected ? (
          <article class="active-device-card">
            <p class="panel-kicker">ACTIVE DISPLAY</p>
            <h2>{snapshot.device?.name}</h2>
            <p>{snapshot.assessment.summary}</p>
            <div class="inline-form">
              <button
                class="primary"
                onClick={() =>
                  store.setView(
                    snapshot.assessment.readiness === "ready"
                      ? "control"
                      : "diagnose",
                  )
                }
              >
                Return to display
              </button>
              <button
                class="secondary"
                disabled={snapshot.busy !== null}
                onClick={() =>
                  void (async () => {
                    await store.disconnect();
                    await store.connect();
                  })()
                }
              >
                Disconnect / change display
              </button>
            </div>
          </article>
        ) : (
          <button
            class="primary hero-cta"
            disabled={!snapshot.bluetoothSupported || snapshot.busy !== null}
            onClick={() => void store.connect()}
          >
            {snapshot.busy ?? "Connect a display"}
          </button>
        )}
        {!snapshot.bluetoothSupported && (
          <p class="notice error">
            Web Bluetooth is unavailable. Open a saved diagnostic report
            instead.
          </p>
        )}
        {snapshot.error && <p class="notice error">{snapshot.error}</p>}
      </header>
      <section class="home-grid">
        <article class="task-card">
          <span class="task-icon">◎</span>
          <h2>Diagnose / identify</h2>
          <p>
            Connect a display and run only verified, safe identification checks.
          </p>
          <button
            class="text-action"
            disabled={!snapshot.bluetoothSupported}
            onClick={() => void store.connect()}
          >
            Start diagnosis →
          </button>
        </article>
        <article class="task-card">
          <span class="task-icon">⌁</span>
          <h2>Explore unknown BLE</h2>
          <p>
            Open the browser chooser and inspect authorized GATT services
            without a generic writer.
          </p>
          <label class="hint-field">
            <span>Optional service UUIDs</span>
            <input
              placeholder="FFF0, A950, …"
              value={serviceHints}
              onInput={(event) => setServiceHints(event.currentTarget.value)}
            />
          </label>
          <p class="fineprint">
            These UUIDs tell the browser which services MatrixSmith may inspect
            after you select the device. Services not requested here can stay
            hidden.
          </p>
          <button
            class="text-action"
            disabled={!snapshot.bluetoothSupported}
            onClick={() =>
              void store.connect("inspection", parseServiceHints(serviceHints))
            }
          >
            Choose device →
          </button>
        </article>
        <article class="task-card">
          <span class="task-icon">⇧</span>
          <h2>Open diagnostic report</h2>
          <p>Review a portable MatrixSmith JSON bundle entirely offline.</p>
          <FileButton
            accept="application/json,.json"
            onFile={async (file) =>
              store.importBundle(await readBoundedText(file, "bundle"))
            }
          >
            Choose JSON report →
          </FileButton>
        </article>
        <article class="task-card">
          <span class="task-icon">⇩</span>
          <h2>Import external capture</h2>
          <p>
            Bring an nRF Connect text log into MatrixSmith. Imported evidence is
            decoded and correlated but never transmitted.
          </p>
          <FileButton
            accept=".txt,.log,text/plain"
            onFile={async (file) =>
              store.importExternalCapture(
                await readBoundedText(file, "capture"),
              )
            }
          >
            Choose .txt/.log capture →
          </FileButton>
        </article>
      </section>
      {snapshot.liveWorkspaceAvailable && (
        <section class="authorized">
          <h2>Live display still connected</h2>
          <p>The offline report is separate from the live workspace.</p>
          <button class="primary" onClick={() => store.returnToLiveWorkspace()}>
            Return to live display
          </button>
        </section>
      )}
      {snapshot.previouslyAuthorized.length > 0 && (
        <section class="authorized">
          <h2>Previously authorized devices</h2>
          <p>
            Your browser remembers these devices. Reconnect directly where
            supported; the secure chooser stays as the fallback.
          </p>
          <div class="authorized-list">
            {snapshot.previouslyAuthorized.map((device) => (
              <button
                key={device.id}
                class="authorized-device"
                onClick={() => void store.reconnectAuthorized(device.id)}
              >
                <span>▣</span>
                <strong>{device.name}</strong>
                <small>Reconnect</small>
              </button>
            ))}
          </div>
        </section>
      )}
      {snapshot.storedInvestigation && (
        <section class="authorized">
          <h2>Saved investigation</h2>
          <p>
            {snapshot.storedInvestigation.deviceName ?? "Stored display"} ·{" "}
            {snapshot.storedInvestigation.testCount} completed test(s) · saved{" "}
            {new Date(snapshot.storedInvestigation.savedAt).toLocaleString()}
          </p>
          <div class="inline-form">
            <button
              class="secondary"
              onClick={() => store.resumeStoredInvestigation()}
            >
              Review saved investigation
            </button>
            <button class="quiet" onClick={() => store.forgetLocalHistory()}>
              Forget local history
            </button>
          </div>
        </section>
      )}
      <footer class="home-footer">
        <span>Local-first · no backend · no analytics</span>
        <span>Chrome Android recommended</span>
      </footer>
    </main>
  );
}
