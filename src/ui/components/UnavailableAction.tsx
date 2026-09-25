import type { ComponentChildren, JSX } from "preact";
import { useId } from "preact/hooks";

export function UnavailableAction({
  children,
  available,
  reason,
  onClick,
  class: className,
}: {
  readonly children: ComponentChildren;
  readonly available: boolean;
  readonly reason: string;
  readonly onClick: () => void;
  readonly class?: string;
}): JSX.Element {
  const reasonId = useId();
  return (
    <div class="unavailable-action">
      <button
        type="button"
        class={className}
        disabled={!available}
        aria-describedby={!available ? reasonId : undefined}
        onClick={onClick}
      >
        {children}
      </button>
      {!available && (
        <p id={reasonId} class="unavailable-reason">
          {reason}
        </p>
      )}
    </div>
  );
}
