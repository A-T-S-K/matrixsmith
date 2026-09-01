import type { JSX } from "preact";
import type { Framebuffer } from "../../render/framebuffer";
import type { DiagnosticRegionView } from "../store";
import { FramePreview } from "./FramePreview";

export type RegionMapState = "active" | "peer" | "answered" | "pending";

/**
 * The diagnostic pattern with its zones labelled directly on the picture.
 *
 * This is the component that removes the recall burden: a question about
 * "Zone 4" is meaningless unless Zone 4 is visible and unmistakable at the
 * moment it is asked. Zone state is never carried by color alone — the chip
 * glyph (▶ active, ✓ answered, number pending) and the outline weight both
 * change, and the active zone is additionally announced via aria-current.
 */
export function RegionMap({
  frame, regions, activeRegionId, answeredRegionIds, onSelect, label,
}: {
  readonly frame: Framebuffer;
  readonly regions: readonly DiagnosticRegionView[];
  readonly activeRegionId: string | null;
  readonly answeredRegionIds?: ReadonlySet<string>;
  /** Enables tap-to-jump. Omit for maps that are illustration only. */
  readonly onSelect?: (regionId: string) => void;
  readonly label?: string;
}): JSX.Element {
  const active = regions.find((region) => region.id === activeRegionId) ?? null;
  const stateOf = (region: DiagnosticRegionView): RegionMapState => {
    if (region.id === activeRegionId) return "active";
    if (active?.groupId && region.groupId === active.groupId) return "peer";
    if (answeredRegionIds?.has(region.id)) return "answered";
    return "pending";
  };
  return <div class="region-map">
    <div class="region-map-stage">
      <FramePreview frame={frame} scale={10} label={label ?? "Diagnostic pattern with labelled zones"}/>
      <div class="region-map-overlay" aria-hidden="true">
        {regions.map((region) => {
          const state = stateOf(region);
          const style = {
            left: `${(region.x / frame.width) * 100}%`,
            top: `${(region.y / frame.height) * 100}%`,
            width: `${(region.width / frame.width) * 100}%`,
            height: `${(region.height / frame.height) * 100}%`,
          };
          return <span class={`region-box ${state}`} style={style}>
            <span class="region-chip">{state === "active" ? "▶" : state === "answered" ? "✓" : ""}{region.shortLabel}</span>
          </span>;
        })}
      </div>
    </div>
    {onSelect && <div class="region-jump" role="group" aria-label="Jump to a zone">
      {regions.map((region) => {
        const state = stateOf(region);
        return <button
          type="button"
          class={`zone-chip ${state}`}
          aria-current={state === "active" ? "true" : undefined}
          aria-label={`${region.displayLabel}${state === "answered" ? " — answered" : ""}`}
          onClick={() => onSelect(region.id)}
        >{state === "answered" ? "✓ " : ""}{region.shortLabel}</button>;
      })}
    </div>}
  </div>;
}
