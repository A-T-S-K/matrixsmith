import type { JSX } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";

export interface MenuButtonItem {
  readonly label: string;
  readonly onSelect: () => void;
  readonly destructive?: boolean;
}

/** A disclosure of ordinary buttons; intentionally does not claim ARIA menu semantics. */
export function MenuButton({
  label,
  children = "⋮",
  items,
}: {
  readonly label: string;
  readonly children?: JSX.Element | string;
  readonly items: readonly MenuButtonItem[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const disclosureId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent | MouseEvent): void => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      } else if (
        event instanceof MouseEvent &&
        !rootRef.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("mousedown", close);
    };
  }, [open]);
  return (
    <div class="device-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        class="icon-button"
        aria-expanded={open}
        aria-controls={disclosureId}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        {children}
      </button>
      {open && (
        <div id={disclosureId} class="menu-popover">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              class={item.destructive ? "destructive" : undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
