import { useEffect, useState } from "preact/hooks";
import type { UpdateManager } from "../../app/update-manager";

export function UpdateNotice({
  updates,
  blocked = null,
}: {
  readonly updates?: UpdateManager;
  readonly blocked?: string | null;
}) {
  const [, changed] = useState(0);
  useEffect(() => updates?.subscribe(() => changed((n) => n + 1)), [updates]);

  useEffect(() => {
    if (!updates?.state.applying) return;
    const elements = [
      ...document.querySelectorAll<HTMLElement>("main, dialog, [role=dialog]"),
    ];
    const prior = elements.map((element) => element.inert);
    elements.forEach((element) => {
      element.inert = true;
    });
    return () =>
      elements.forEach((element, index) => {
        element.inert = prior[index] ?? false;
      });
  }, [updates?.state.applying]);
  if (!updates || (!updates.state.available && !updates.state.error))
    return null;
  const { applying, error } = updates.state;
  return (
    <aside class="update-notice" aria-label="Application update">
      <p role={error ? "alert" : "status"}>
        {error ??
          (applying
            ? "Updating MatrixSmith…"
            : "An update is ready. Updating refreshes all open MatrixSmith tabs.")}
      </p>
      {blocked && <p>{blocked}</p>}
      <button
        type="button"
        disabled={Boolean(blocked) || applying}
        onClick={() => void updates.applyUpdate()}
      >
        Update and reload
      </button>
      <button
        type="button"
        disabled={applying}
        onClick={() => void updates.checkForUpdate()}
      >
        Check for updates
      </button>
    </aside>
  );
}
