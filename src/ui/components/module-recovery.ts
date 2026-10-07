type Entry =
  | "application"
  | "ControlView"
  | "InvestigationView"
  | "DevelopView"
  | "ReportDialog";

export type ModuleLoader<Module> = (() => Promise<Module>) & {
  canRetry: () => boolean;
  retry: () => void;
};

let applicationRevision = 0;

export function isDownloadFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    /dynamically imported module|module script|loading chunk|loading css chunk|preload CSS|importing a module/i.test(
      error.message,
    )
  );
}

/** The build maps known roots and their dependencies before module execution. */
export function retryableImport<Module>(
  entry: Entry,
  original: () => Promise<Module>,
): ModuleLoader<Module> {
  let pending: Promise<Module> | undefined;
  let failure: unknown;
  let attempt = 0;
  const load = () => {
    if (pending) return pending;
    const alias =
      entry === "application"
        ? "matrixsmith/application/1"
        : `matrixsmith/${entry}/${applicationRevision}/${attempt}`;
    pending = (
      attempt || (entry !== "application" && applicationRevision)
        ? (import(/* @vite-ignore */ alias) as Promise<Module>)
        : original()
    ).then(
      (module) => {
        if (entry === "application") applicationRevision = attempt;
        return module;
      },
      (error: unknown) => {
        failure = error;
        throw error;
      },
    );
    return pending;
  };
  const canRetry = () => attempt === 0 && isDownloadFailure(failure);
  return Object.assign(load, {
    canRetry,
    retry: () => {
      if (canRetry()) {
        attempt = 1;
        pending = undefined;
      }
    },
  });
}
