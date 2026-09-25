import type { DeviceFingerprint } from "../core/device";
import type { ApplicationRuntime } from "../application/runtime";
import type { MatrixTransport } from "../application/ports/transport";
import type { FilesPort } from "../application/ports/files";
import type { KeyValueStorage } from "../application/ports/persistence";
import type { TransferWakeLock } from "../app/wake-lock";
import type { HashRouter } from "./app/routes";

export interface PresentationEnvironment {
  createOfflineWorkspace(fingerprint: DeviceFingerprint): {
    controller: ApplicationRuntime;
    transport: MatrixTransport;
  };
  readonly storage: KeyValueStorage;
  readonly files: FilesPort;
  readonly wakeLock: Pick<
    TransferWakeLock,
    "supported" | "acquire" | "release"
  >;
  readonly router: HashRouter | null;
  readonly bluetoothSupported: boolean;
  authorizedDevices(): Promise<readonly { id: string; name: string }[]>;
  signalTimingStart(): void;
  onBack(listener: () => void): () => void;
  pushOverlay(kind: string): void;
  back(): void;
}
