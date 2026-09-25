import { INPUT_LIMITS } from "./input-limits";

export async function readBoundedText(
  file: Blob,
  kind: "bundle" | "capture",
): Promise<string> {
  const limit =
    kind === "bundle"
      ? INPUT_LIMITS.diagnosticBundleBytes
      : INPUT_LIMITS.captureBytes;
  if (file.size > limit)
    throw new Error(
      `${kind === "bundle" ? "Report" : "Capture"} exceeds the ${limit / 1024 / 1024} MiB input budget.`,
    );
  return file.text();
}

/** One owner for file activity, including asynchronous selection callbacks. */
export class FileActivity {
  #pending = 0;
  get active(): boolean {
    return this.#pending > 0;
  }
  async run<T>(action: () => T | Promise<T>): Promise<T> {
    this.#pending++;
    try {
      return await action();
    } finally {
      this.#pending--;
    }
  }
}
export const fileActivity = new FileActivity();
