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
  let attempts = 0;
  let requested = false;
  const load = () => {
    if (pending) return pending;
    if (attempts === 2 || (attempts && !requested))
      return Promise.reject(failure);
    requested = false;
    const attempt = attempts++;
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
        pending = undefined;
        failure = error;
        throw error;
      },
    );
    return pending;
  };
  const canRetry = () => attempts === 1 && isDownloadFailure(failure);
  return Object.assign(load, {
    canRetry,
    retry: () => {
      if (canRetry()) requested = true;
    },
  });
}
