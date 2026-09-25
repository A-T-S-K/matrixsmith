import type { ComponentChildren, JSX } from "preact";

export function NoticeRegion({
  children,
  tone = "status",
  onClose,
  action,
}: {
  readonly children: ComponentChildren;
  readonly tone?: "status" | "error";
  readonly onClose?: () => void;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}): JSX.Element {
  return (
    <div
      class={`toast ${tone === "error" ? "error" : ""}`}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span>{children}</span>
      {action && (
        <button type="button" class="toast-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onClose && (
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onClose}
        >
          ×
        </button>
      )}
    </div>
  );
}
