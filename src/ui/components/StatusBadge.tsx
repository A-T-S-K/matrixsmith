import type { JSX } from "preact";
import type { ComponentChildren } from "preact";
export function StatusBadge({ children, tone = "neutral" }: { readonly children: ComponentChildren; readonly tone?: "good" | "warn" | "bad" | "neutral" }): JSX.Element { return <span class={`status-badge ${tone}`}>{children}</span>; }
