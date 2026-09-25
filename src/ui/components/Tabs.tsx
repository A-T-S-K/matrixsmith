import type { JSX } from "preact";
import { useId, useRef } from "preact/hooks";

export interface TabItem<Id extends string> {
  readonly id: Id;
  readonly label: JSX.Element | string;
  readonly panel: JSX.Element;
  readonly disabled?: boolean;
}

export function Tabs<Id extends string>({
  label,
  items,
  selected,
  onSelect,
  class: className = "",
}: {
  readonly label: string;
  readonly items: readonly TabItem<Id>[];
  readonly selected: Id;
  readonly onSelect: (id: Id) => void;
  readonly class?: string;
}): JSX.Element {
  const baseId = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const enabled = items.filter((item) => !item.disabled);
  const move = (current: Id, direction: number | "start" | "end"): void => {
    if (enabled.length === 0) return;
    const index = enabled.findIndex((item) => item.id === current);
    const next =
      direction === "start"
        ? enabled[0]
        : direction === "end"
          ? enabled[enabled.length - 1]
          : enabled[
              (Math.max(0, index) + direction + enabled.length) % enabled.length
            ];
    if (!next) return;
    onSelect(next.id);
    requestAnimationFrame(() =>
      tabsRef.current
        ?.querySelector<HTMLElement>(
          `#${CSS.escape(`${baseId}-tab-${next.id}`)}`,
        )
        ?.focus(),
    );
  };
  const active = items.find((item) => item.id === selected) ?? items[0];
  return (
    <div class={`tabs ${className}`.trim()}>
      <div ref={tabsRef} class="tab-list" role="tablist" aria-label={label}>
        {items.map((item) => (
          <button
            id={`${baseId}-tab-${item.id}`}
            key={item.id}
            role="tab"
            type="button"
            disabled={item.disabled}
            aria-selected={item.id === active?.id}
            aria-controls={`${baseId}-panel-${item.id}`}
            tabIndex={item.id === active?.id ? 0 : -1}
            class={item.id === active?.id ? "active" : ""}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(item.id, -1);
              } else if (
                event.key === "ArrowRight" ||
                event.key === "ArrowDown"
              ) {
                event.preventDefault();
                move(item.id, 1);
              } else if (event.key === "Home") {
                event.preventDefault();
                move(item.id, "start");
              } else if (event.key === "End") {
                event.preventDefault();
                move(item.id, "end");
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {active && (
        <div
          id={`${baseId}-panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${active.id}`}
          tabIndex={0}
        >
          {active.panel}
        </div>
      )}
    </div>
  );
}
