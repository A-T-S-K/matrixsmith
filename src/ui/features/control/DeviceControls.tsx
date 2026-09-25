import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
import { StatusBadge } from "../../components/StatusBadge";
import { UnavailableAction } from "../../components/UnavailableAction";

export function DeviceControls({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const verified =
    snapshot.liveConnected &&
    snapshot.capabilities.some(
      (c) => c.id === "brightness" && c.live && c.validation === "verified",
    );
  const [brightness, setBrightness] = useState(
    snapshot.deviceState.brightness ??
      snapshot.content.settings.lastBrightness ??
      64,
  );
  useEffect(() => {
    if (snapshot.deviceState.brightness !== null)
      setBrightness(snapshot.deviceState.brightness);
  }, [snapshot.deviceState.brightness]);
  const unavailableReason = snapshot.busy
    ? snapshot.busy
    : snapshot.liveConnected
      ? "Brightness is not a verified live capability for this session."
      : "Live operations are blocked for offline reports.";
  return (
    <section class="device-controls">
      <div class="brightness-row">
        <span class="panel-kicker">BRIGHTNESS</span>
        <strong class="big-value">{brightness}</strong>
      </div>
      <input
        class="range"
        aria-label="Brightness"
        type="range"
        min="0"
        max="255"
        value={brightness}
        disabled={!verified}
        onInput={(event) =>
          setBrightness(Number((event.currentTarget as HTMLInputElement).value))
        }
      />
      <UnavailableAction
        class="secondary"
        available={verified && snapshot.busy === null}
        reason={unavailableReason}
        onClick={() => void store.applyBrightness(brightness)}
      >
        Apply brightness
      </UnavailableAction>
      <p class="fineprint">
        Apply requires a matching command response and verifies the value with a
        fresh device-info readback.
      </p>
      <dl class="about-facts">
        <div>
          <dt>Power</dt>
          <dd>{snapshot.deviceState.power}</dd>
        </div>
        <div>
          <dt>Brightness</dt>
          <dd>{snapshot.deviceState.brightness ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Protocol</dt>
          <dd>{snapshot.device?.protocol}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{snapshot.device?.profileGeometry}</dd>
        </div>
      </dl>
      <div class="utility-row">
        <StatusBadge tone={snapshot.liveConnected ? "good" : "neutral"}>
          {snapshot.liveConnected ? "Live readback" : "Imported evidence"}
        </StatusBadge>
        <UnavailableAction
          class="text-action"
          available={verified && snapshot.busy === null}
          reason={unavailableReason}
          onClick={() => void store.refreshInfo()}
        >
          Refresh device info
        </UnavailableAction>
      </div>
    </section>
  );
}
