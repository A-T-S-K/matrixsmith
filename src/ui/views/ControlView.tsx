import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { AppSnapshot, PresentationStore } from "../../presentation/store";
import type { ContentPathId } from "../../investigation/gating";
import { Tabs } from "../components/Tabs";
import { ContentEditor } from "../features/control/ContentEditor";
import { DeviceControls } from "../features/control/DeviceControls";

const CONTENT_TYPES: readonly {
  readonly id: ContentPathId;
  readonly label: string;
}[] = [
  { id: "text", label: "Text" },
  { id: "image", label: "Image" },
  { id: "animation", label: "Demo animation" },
  { id: "gif", label: "GIF" },
];

/**
 * Making something and putting it on the display.
 *
 * Four creator panels used to render at once, so a phone showed four sets of
 * controls, four previews and four Send buttons for one task. Choosing the
 * content type first means the screen holds one set of controls, the preview
 * they affect, and a single primary action. A type that is not yet unlocked
 * explains itself where the user selected it, rather than as a warning banner
 * above work they were not doing.
 */
export function ControlView({
  snapshot,
  store,
}: {
  readonly snapshot: AppSnapshot;
  readonly store: PresentationStore;
}): JSX.Element {
  const [selected, setSelected] = useState<ContentPathId>("text");
  return (
    <section class="view create">
      <h1 class="view-title">Create</h1>
      <Tabs
        label="Content type"
        selected={selected}
        onSelect={setSelected}
        class="type-tabs"
        items={CONTENT_TYPES.map((type) => ({
          id: type.id,
          label: (
            <>
              {type.label}
              {!snapshot.contentGates[type.id].allowed && (
                <span class="lock" aria-label="not yet verified">
                  ●
                </span>
              )}
            </>
          ),
          panel: (
            <ContentEditor
              selected={type.id}
              snapshot={snapshot}
              store={store}
            />
          ),
        }))}
      />
      <details class="secondary-section">
        <summary>Brightness and display status</summary>
        <DeviceControls snapshot={snapshot} store={store} />
      </details>
    </section>
  );
}
