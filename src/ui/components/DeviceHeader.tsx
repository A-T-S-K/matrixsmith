import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { AppSnapshot, PresentationStore } from "../../presentation/store";
import { MenuButton } from "./MenuButton";

/**
 * The persistent workspace header.
 *
 * Inside a device workspace the device IS the context, so the header states
 * the device, its connection, and at most one problem that is actually
 * actionable right now. Product branding, geometry, report formats, and
 * disconnect all moved out: they were consuming the top third of a phone
 * screen before the user could see what to do next, and none of them is the
 * task. Branding lives on Home; the rest lives one tap away in the menu.
 */
export function DeviceHeader({
  snapshot,
  store,
}: {
  readonly snapshot: AppSnapshot;
  readonly store: PresentationStore;
}): JSX.Element {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const device = snapshot.device;
  if (!device) return <></>;
  const connected = snapshot.connection === "connected";
  // Exactly one actionable problem, and only when acting on it is the point.
  const problem = protocolProblem(snapshot, store);
  return (
    <header class="device-header">
      <div class="device-bar">
        <button
          class="device-identity"
          onClick={() => store.goHome()}
          aria-label={`${device.name} — back to MatrixSmith home`}
        >
          <span
            class={`conn-dot ${connected ? "on" : "off"}`}
            aria-hidden="true"
          />
          <strong>{device.name}</strong>
          <small>{connected ? "Connected" : device.connectionLabel}</small>
        </button>
        <MenuButton
          label="Device actions"
          items={[
            {
              label: "Device details",
              onSelect: () => setDetailsOpen(!detailsOpen),
            },
            { label: "Share report…", onSelect: () => store.openReport() },
            {
              label: "Developer tools",
              onSelect: () => store.setView("develop"),
            },
            ...(snapshot.source === "live"
              ? [
                  {
                    label: "Disconnect",
                    destructive: true,
                    onSelect: () => void store.disconnect(),
                  },
                ]
              : []),
          ]}
        />
      </div>
      {problem && (
        <div class="device-problem">
          <span>{problem.label}</span>
          {problem.action && (
            <button
              class="small"
              disabled={snapshot.busy !== null}
              onClick={problem.action.run}
            >
              {problem.action.label}
            </button>
          )}
        </div>
      )}
      {detailsOpen && (
        <dl class="device-details">
          <div>
            <dt>Protocol</dt>
            <dd>{device.protocol}</dd>
          </div>
          <div>
            <dt>Support</dt>
            <dd>{device.support}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>
              {device.profileGeometry !== "Unknown"
                ? device.profileGeometry
                : device.liveGeometry}
            </dd>
          </div>
        </dl>
      )}
    </header>
  );
}

/**
 * Surface a status only when it blocks the user and something can be done
 * about it. "Ambiguous protocol" as a permanent badge is a fact with no verb;
 * "Protocol needs confirmation → Identify" is the next step.
 */
function protocolProblem(
  snapshot: AppSnapshot,
  store: PresentationStore,
): { label: string; action?: { label: string; run: () => void } } | null {
  const device = snapshot.device;
  if (!device) return null;
  if (snapshot.connection !== "connected" && snapshot.source === "live") {
    return { label: "Display disconnected" };
  }
  if (
    device.protocol.includes("Ambiguous") ||
    device.support === "Identification required"
  ) {
    return {
      label: "Protocol needs confirmation",
      ...(snapshot.connection === "connected"
        ? { action: { label: "Identify", run: () => void store.identify() } }
        : {}),
    };
  }
  return null;
}
