import type { ConnectionService } from "./services/connection-service";

/** A read-only lifetime check; it conveys no transmission authority. */
export interface WorkflowContext {
  current(): boolean;
  assertCurrent(): void;
}

export function captureWorkflowContext(
  connection: Pick<
    ConnectionService,
    | "getSession"
    | "getTransport"
    | "getConnectionGeneration"
    | "_requireTargetBinding"
    | "_currentTargetBinding"
  >,
  relevantTarget = true,
): WorkflowContext {
  const generation = connection.getConnectionGeneration();
  const binding = connection._requireTargetBinding();
  const session = connection.getSession();
  const profile = session.profile;
  const driver = session.selection?.selected;
  const resolution = session.protocolResolution;
  const geometryRevision = session.geometryRevision;
  const experimental = session.experimentalTxEnabled;
  const targetKey = () =>
    JSON.stringify([session.profile, session.protocolResolution]);
  const target = targetKey();
  let retired = false;
  const current = () => {
    const now = connection._currentTargetBinding();
    retired ||= !(
      connection.getConnectionGeneration() === generation &&
      connection.getTransport().state === "connected" &&
      session.source === "live" &&
      now?.connectionId === binding.connectionId &&
      now.fingerprintKey === binding.fingerprintKey &&
      now.browserDeviceId === binding.browserDeviceId &&
      session.geometryRevision === geometryRevision &&
      (!relevantTarget ||
        (session.profile === profile &&
          session.selection?.selected === driver &&
          session.protocolResolution === resolution &&
          session.experimentalTxEnabled === experimental &&
          targetKey() === target))
    );
    return !retired;
  };
  return {
    current,
    assertCurrent() {
      if (!current())
        throw new Error(
          "The diagnostic or brightness workflow's original display context has retired. Reconnect and start a new operation; restoration was not confirmed.",
        );
    },
  };
}

/** Cleanup is tied to the owner object, so an old finally cannot free a new run. */
export class WorkflowReservation {
  private owner: WorkflowContext | null = null;
  get busy(): boolean {
    if (this.owner && !this.owner.current()) this.owner = null;
    return this.owner !== null;
  }
  guard(): void {
    if (this.busy)
      throw new Error(
        "A diagnostic workflow owns execution. Wait for it to settle or disconnect before another operation.",
      );
  }
  acquire(context: WorkflowContext): () => void {
    this.guard();
    context.assertCurrent();
    this.owner = context;
    return () => {
      if (this.owner === context) this.owner = null;
    };
  }
  retire(): void {
    this.owner = null;
  }
}
