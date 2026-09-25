import type { ComponentChildren, JSX } from "preact";

export function EvidenceDisclosure({
  summary = "View evidence",
  children,
  class: className = "",
}: {
  readonly summary?: string;
  readonly children: ComponentChildren;
  readonly class?: string;
}): JSX.Element {
  return (
    <details class={`evidence-disclosure ${className}`.trim()}>
      <summary>{summary}</summary>
      <div class="evidence-content">{children}</div>
    </details>
  );
}
