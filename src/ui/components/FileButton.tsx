import { fileActivity } from "../../application/file-input";
import type { JSX } from "preact";
import { useId, useRef, useState, useEffect } from "preact/hooks";

export function FileButton({
  children,
  accept,
  onFile,
  class: className = "text-action",
}: {
  readonly children: JSX.Element | string;
  readonly accept?: string;
  readonly onFile: (file: File) => void | Promise<void>;
  readonly class?: string;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(0);
  useEffect(
    () => () => {
      attempt.current++;
    },
    [],
  );
  return (
    <>
      <button
        type="button"
        class={className}
        onClick={() => inputRef.current?.click()}
      >
        {children}
      </button>
      <input
        id={id}
        ref={inputRef}
        class="file-input"
        type="file"
        accept={accept}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          if (file) {
            const current = ++attempt.current;
            setError(null);
            void Promise.resolve()
              .then(() => fileActivity.run(() => onFile(file)))
              .catch((reason: unknown) => {
                if (current === attempt.current)
                  setError(
                    reason instanceof Error ? reason.message : String(reason),
                  );
              });
          }
          input.value = "";
        }}
      />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
