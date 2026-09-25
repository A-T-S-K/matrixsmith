import { PresentationStore } from "../../src/presentation/store";
import { createBrowserEnvironment } from "../../src/adapters/presentation/browser-environment";
import type { ApplicationRuntime } from "../../src/application/runtime";
import type { MatrixTransport } from "../../src/application/ports/transport";
import type { FilesPort } from "../../src/application/ports/files";
export function createPresentationStore(
  runtime: ApplicationRuntime,
  transport: MatrixTransport,
  files?: FilesPort,
): PresentationStore {
  const environment = createBrowserEnvironment();
  const memory = new Map<string, string>();
  const storage =
    typeof localStorage !== "undefined"
      ? environment.storage
      : {
          getItem: (key: string) => memory.get(key) ?? null,
          setItem: (key: string, value: string) => {
            memory.set(key, value);
          },
          removeItem: (key: string) => {
            memory.delete(key);
          },
        };
  return new PresentationStore(runtime, transport, {
    ...environment,
    storage,
    files: files ?? environment.files,
  });
}
