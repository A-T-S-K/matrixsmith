import type { DeviceTarget } from "../../domain/device/target";

export type ConnectionMode = "registered" | "inspection" | "replacement";
export type ConnectionOperation =
  "select" | "connect" | "disconnect" | "reconnect";

export interface AppError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface IndeterminateWrite {
  readonly planDigest: string;
  readonly packetIndex: number;
  readonly message: string;
}

export type ConnectionState =
  | { readonly value: "idle" }
  | {
      readonly value: "selecting";
      readonly mode: ConnectionMode;
      readonly previous?: Extract<ConnectionState, { value: "connected" }>;
    }
  | {
      readonly value: "connecting";
      readonly requestedDeviceId: string | null;
      readonly previous?: Extract<ConnectionState, { value: "connected" }>;
    }
  | {
      readonly value: "connected";
      readonly connectionId: string;
      readonly target: DeviceTarget;
    }
  | {
      readonly value: "disconnecting";
      readonly connectionId: string;
      readonly target: DeviceTarget;
    }
  | { readonly value: "disconnected"; readonly previousTarget: DeviceTarget }
  | {
      readonly value: "quarantined";
      readonly connectionId: string;
      readonly target: DeviceTarget;
      readonly reason: IndeterminateWrite;
    }
  | {
      readonly value: "failed";
      readonly operation: ConnectionOperation;
      readonly error: AppError;
      readonly previous?: Extract<ConnectionState, { value: "connected" }>;
    };

export type ConnectionEvent =
  | { readonly type: "SELECT"; readonly mode: ConnectionMode }
  | { readonly type: "CONNECT"; readonly requestedDeviceId: string | null }
  | {
      readonly type: "CONNECTED";
      readonly connectionId: string;
      readonly target: DeviceTarget;
    }
  | { readonly type: "DISCONNECT" }
  | { readonly type: "DISCONNECTED"; readonly unexpected: boolean }
  | {
      readonly type: "FAILED";
      readonly operation: ConnectionOperation;
      readonly error: AppError;
    }
  | {
      readonly type: "WRITE_INDETERMINATE";
      readonly reason: IndeterminateWrite;
    }
  | { readonly type: "RESET" };

export const INITIAL_CONNECTION_STATE: ConnectionState = Object.freeze({
  value: "idle",
});

export function transitionConnection(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState {
  switch (event.type) {
    case "SELECT": {
      const previous = connectedSnapshot(state);
      return {
        value: "selecting",
        mode: event.mode,
        ...(previous ? { previous } : {}),
      };
    }
    case "CONNECT": {
      if (
        state.value !== "selecting" &&
        state.value !== "idle" &&
        state.value !== "disconnected" &&
        state.value !== "failed"
      )
        return state;
      const previous =
        state.value === "selecting"
          ? state.previous
          : state.value === "failed"
            ? state.previous
            : undefined;
      return {
        value: "connecting",
        requestedDeviceId: event.requestedDeviceId,
        ...(previous ? { previous } : {}),
      };
    }
    case "CONNECTED":
      if (state.value !== "connecting" && state.value !== "selecting")
        return state;
      return {
        value: "connected",
        connectionId: event.connectionId,
        target: event.target,
      };
    case "DISCONNECT":
      return state.value === "connected" || state.value === "quarantined"
        ? {
            value: "disconnecting",
            connectionId: state.connectionId,
            target: state.target,
          }
        : state;
    case "DISCONNECTED": {
      const connected = connectedSnapshot(state);
      if (!connected)
        return state.value === "disconnecting"
          ? { value: "disconnected", previousTarget: state.target }
          : state;
      return { value: "disconnected", previousTarget: connected.target };
    }
    case "FAILED": {
      const previous =
        connectedSnapshot(state) ??
        (state.value === "selecting" || state.value === "connecting"
          ? state.previous
          : undefined);
      return {
        value: "failed",
        operation: event.operation,
        error: event.error,
        ...(previous ? { previous } : {}),
      };
    }
    case "WRITE_INDETERMINATE":
      return state.value === "connected"
        ? {
            value: "quarantined",
            connectionId: state.connectionId,
            target: state.target,
            reason: event.reason,
          }
        : state;
    case "RESET":
      return { value: "idle" };
  }
}

/** A failed replacement never destroys the previous usable session. */
export function recoverConnection(state: ConnectionState): ConnectionState {
  return state.value === "failed" && state.previous ? state.previous : state;
}

function connectedSnapshot(
  state: ConnectionState,
): Extract<ConnectionState, { value: "connected" }> | undefined {
  if (state.value === "connected") return state;
  if (
    state.value === "selecting" ||
    state.value === "connecting" ||
    state.value === "failed"
  )
    return state.previous;
  return undefined;
}
