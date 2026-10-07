import {
  Component,
  type ComponentChildren,
  type ComponentType,
  type JSX,
} from "preact";
import { lazy, Suspense } from "preact/compat";
import { useMemo, useState } from "preact/hooks";

import { isDownloadFailure, type ModuleLoader } from "./module-recovery";

class DownloadBoundary extends Component<
  {
    readonly label: string;
    readonly retry: () => void;
    readonly canRetry: () => boolean;
    readonly home: () => void;
    readonly children: ComponentChildren;
  },
  { error: unknown }
> {
  state = { error: null as unknown };
  focusFailure = (heading: HTMLHeadingElement | null): void => heading?.focus();
  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }
  render(): ComponentChildren {
    const { error } = this.state;
    if (!error) return this.props.children;
    // Programming/runtime failures belong to their actual owner, not a download
    // recovery message that could hide an unrelated failure.
    if (!isDownloadFailure(error)) throw error;
    const canRetry = this.props.canRetry();
    return (
      <section aria-label={`${this.props.label} recovery`}>
        <h1 tabIndex={-1} ref={this.focusFailure}>
          {this.props.label} unavailable
        </h1>
        <p role="alert">
          {canRetry
            ? "Could not download this view. Your workspace is still open."
            : "Retry failed. Your workspace is still open. Return to Home to choose another view."}
        </p>
        {canRetry && (
          <button onClick={this.props.retry}>Retry {this.props.label}</button>
        )}
        <button onClick={this.props.home}>Go to Home</button>
      </section>
    );
  }
}

/** A new lazy component per retry avoids Preact's cached rejected promise. */
export function LazyFeature<Props extends object>({
  label,
  loader,
  recovery,
  viewProps,
  home,
}: {
  readonly label: string;
  readonly loader: () => Promise<{ default: ComponentType<Props> }>;
  readonly recovery: Pick<ModuleLoader<unknown>, "canRetry" | "retry">;
  readonly viewProps: Props;
  readonly home: () => void;
}): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const View = useMemo(() => lazy(loader), [loader, attempt]);
  return (
    <DownloadBoundary
      key={attempt}
      label={label}
      canRetry={recovery.canRetry}
      retry={() => {
        recovery.retry();
        setAttempt((value) => value + 1);
      }}
      home={home}
    >
      <Suspense fallback={<p role="status">Loading {label}…</p>}>
        <View {...viewProps} />
      </Suspense>
    </DownloadBoundary>
  );
}
