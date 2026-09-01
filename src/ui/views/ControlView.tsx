import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { AppSnapshot, MatrixStore } from "../store";
import type { ContentPathId } from "../../investigation/gating";
import { StatusBadge } from "../components/StatusBadge";
import { FramePreview } from "../components/FramePreview";
import { ImagePreview } from "../components/ImagePreview";
import { AnimatedFramePreview } from "../components/AnimatedFramePreview";

const CONTENT_TYPES: readonly { readonly id: ContentPathId; readonly label: string }[] = [
  { id: "text", label: "Text" },
  { id: "image", label: "Image" },
  { id: "animation", label: "Animation" },
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
export function ControlView({ snapshot, store }: { readonly snapshot: AppSnapshot; readonly store: MatrixStore }): JSX.Element {
  const [selected, setSelected] = useState<ContentPathId>("text");
  return <section class="view create">
    <h1 class="view-title">Create</h1>
    <div class="type-tabs" role="tablist" aria-label="Content type">
      {CONTENT_TYPES.map((type) => <button
        role="tab"
        aria-selected={selected === type.id}
        class={`type-tab ${selected === type.id ? "active" : ""}`}
        onClick={() => setSelected(type.id)}
      >{type.label}{!snapshot.contentGates[type.id].allowed && <span class="lock" aria-label="not yet verified">●</span>}</button>)}
    </div>
    <ContentEditor selected={selected} snapshot={snapshot} store={store}/>
    <details class="secondary-section"><summary>Brightness and display status</summary><DeviceControls snapshot={snapshot} store={store}/></details>
  </section>;
}

function ContentEditor({ selected, snapshot, store }: { selected: ContentPathId; snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const content = snapshot.content;
  const settings = content.settings;
  const gate = snapshot.contentGates[selected];
  const live = snapshot.liveConnected;
  const canSend = gate.allowed && live && snapshot.busy === null;
  const sendTitle = !live ? "Live content requires a connected physical display." : gate.allowed ? "" : gate.reason;
  const chooseImage = async (event: Event): Promise<void> => { const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (file) await store.loadImage(file, file.name); };
  const chooseGif = async (event: Event): Promise<void> => { const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (file) await store.loadGif(file, file.name); };
  return <div class="content-editor">
    {!gate.allowed && <LockedNotice snapshot={snapshot} store={store} reason={gate.reason}/>}

    {selected === "text" && <>
      <label class="field"><span>Text</span><input value={settings.text} placeholder="HELLO" onInput={(event) => store.updateContentSettings({ text: (event.currentTarget as HTMLInputElement).value })}/></label>
      <label class="field"><span>Display</span><select value={settings.textDisplayMode} onChange={(event) => store.updateContentSettings({ textDisplayMode: (event.currentTarget as HTMLSelectElement).value as typeof settings.textDisplayMode })}><option value="auto">Auto</option><option value="still">Still</option><option value="scroll">Scroll</option></select></label>
      {content.textScrollPlan ? <AnimatedFramePreview sequence={content.textScrollPlan.sequence} label="Actual scrolling-text preview"/> : content.textPreview ? <FramePreview frame={content.textPreview} label="Text preview"/> : <p class="empty">Type something to preview it.</p>}
      {content.textScrollPlan && <>
        <p class={content.textScrollPlan.safe ? "fineprint" : "notice warning"}>{content.textScrollPlan.textWidth} columns · {content.textScrollPlan.frameCount} frames · {content.textScrollPlan.decodedBytesPerTile.toLocaleString()} decoded bytes/tile · step {content.textScrollPlan.step} · raster fallback</p>
        {content.textScrollPlan.warnings.map((warning) => <p class="notice warning">{warning}</p>)}
        <details class="secondary-section"><summary>Text backend</summary><p class="fineprint">Raster scrolling is bounded and available now. Firmware-native CoolLEDUX Text remains experimental: the pinned protocol evidence does not define its segment layout clearly enough to transmit safely without hardware validation.</p></details>
      </>}
      <div class="field-row">
        <label class="field"><span>Color</span><input type="color" value={settings.textColor} onInput={(event) => store.updateContentSettings({ textColor: (event.currentTarget as HTMLInputElement).value })}/></label>
        <label class="field"><span>Background</span><input type="color" value={settings.textBackground} onInput={(event) => store.updateContentSettings({ textBackground: (event.currentTarget as HTMLInputElement).value })}/></label>
        <label class="field"><span>Alignment</span><select value={settings.textAlignment} onChange={(event) => store.updateContentSettings({ textAlignment: (event.currentTarget as HTMLSelectElement).value as "left" | "center" | "right" })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      </div>
      <button class="primary send" disabled={!canSend || !settings.text.trim()} title={sendTitle} onClick={() => store.requestSendText()}>Send to display…</button>
    </>}

    {selected === "image" && <>
      <label class="text-action file-action">Choose an image (PNG/JPEG/WebP) →<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseImage(event)}/></label>
      {content.image ? <>
        <ImagePreview frame={content.image.preview}/>
        <div class="field-row">
          <label class="field"><span>Mode</span><select value={settings.imageMode} onChange={(event) => void store.setImageProcessing({ mode: (event.currentTarget as HTMLSelectElement).value as typeof settings.imageMode })}><option value="auto">Auto</option><option value="artwork">Artwork</option><option value="photo">Photo</option><option value="pixel-art">Pixel Art</option></select></label>
          <label class="field"><span>Composition</span><select value={settings.imageComposition} onChange={(event) => void store.setImageProcessing({ composition: (event.currentTarget as HTMLSelectElement).value as typeof settings.imageComposition })}><option value="contain">Fit whole image</option><option value="cover">Fill / crop</option><option value="foreground-trim">Foreground trim</option><option value="custom">Custom / focal crop</option></select></label>
        </div>
        {content.image.processed && <p class="notice">{content.image.processed.analysis.likelyMode === content.image.processed.resolvedMode ? `${labelMode(content.image.processed.resolvedMode)} · ${content.image.processed.analysis.confidence} confidence` : `Auto used ${labelMode(content.image.processed.resolvedMode)}-safe processing · uncertain content type`}</p>}
        <p class="fineprint">32×16 · {content.image.processed?.resolvedMode ?? "Legacy / Smooth"} · {content.image.processed?.outputColorCount ?? "—"} colors · static delivery uses the selected device profile strategy.</p>
        {content.image.processed?.warnings.map((warning) => <p class="notice warning">{warning}</p>)}
        {settings.imageComposition === "custom" && <div class="custom-crop-controls">
          <label class="field"><span>Zoom</span><input type="range" min="1" max="4" step="0.1" value={settings.imageZoom} onChange={(event) => void store.setImageProcessing({ zoom: Number((event.currentTarget as HTMLInputElement).value) })}/></label>
          <label class="field"><span>Horizontal focal offset</span><input type="range" min="-16" max="16" step="1" value={settings.imageOffsetX} onChange={(event) => void store.setImageProcessing({ offsetX: Number((event.currentTarget as HTMLInputElement).value) })}/></label>
          <label class="field"><span>Vertical focal offset</span><input type="range" min="-8" max="8" step="1" value={settings.imageOffsetY} onChange={(event) => void store.setImageProcessing({ offsetY: Number((event.currentTarget as HTMLInputElement).value) })}/></label>
        </div>}
        <details class="secondary-section"><summary>Advanced image processing</summary>
          {(settings.imageMode === "artwork" || content.image.processed?.analysis.likelyMode === "artwork") && <label class="check-row"><input type="checkbox" checked={settings.imageOpticalFit} onChange={(event) => void store.setImageProcessing({ opticalFit: (event.currentTarget as HTMLInputElement).checked })}/><span>Use more of display (previewed optical widening, max 1.35×)</span></label>}
          <label class="field"><span>Photo edge strength</span><input type="range" min="0" max="0.25" step="0.01" value={settings.imageEdgeStrength} onChange={(event) => void store.setImageProcessing({ edgeStrength: Number((event.currentTarget as HTMLInputElement).value) })}/></label>
          <button class="text-action" onClick={() => void store.setImageProcessing({ mode: "legacy" })}>Use Legacy / Smooth reducer</button>
        </details>
        <p class="fineprint">{content.image.name} · {content.image.sourceWidth}×{content.image.sourceHeight} source. Processed locally; raw image bytes are not persisted or uploaded.</p>
      </> : <p class="empty">Choose a local image to see how it will look on the display.</p>}
      <button class="primary send" disabled={!canSend || !content.image} title={sendTitle} onClick={() => store.requestSendImage()}>Send to display…</button>
    </>}

    {selected === "animation" && <>
      <p class="fineprint">Animation is for authored multi-frame content and diagnostics. Normal scrolling messages live under Text.</p>
      <div class="frame-strip">{content.animationPreview.map((frame, index) => <div><small>Frame {index + 1}</small><FramePreview frame={frame} scale={5}/></div>)}</div>
      <button class="primary send" disabled={!canSend} title={sendTitle} onClick={() => store.requestSendAnimation()}>Send test animation…</button>
    </>}

    {selected === "gif" && <>
      <label class="text-action file-action">Choose a GIF →<input type="file" accept="image/gif,.gif" onChange={(event) => void chooseGif(event)}/></label>
      {content.gif ? <>
        <p class="fineprint">{content.gif.name} · {content.gif.byteLength.toLocaleString()} bytes{content.gif.width !== null ? ` · ${content.gif.width}×${content.gif.height}` : ""}. Read locally; never uploaded.</p>
        {content.gif.warning && <p class="notice warning">{content.gif.warning}</p>}
      </> : <p class="empty">The display decodes GIFs itself, so the file is sent as-is.</p>}
      <button class="primary send" disabled={!canSend || !content.gif} title={sendTitle} onClick={() => store.requestSendGif()}>Send to display…</button>
    </>}
  </div>;
}

function labelMode(mode: string): string { return mode === "pixel-art" ? "Pixel Art" : mode.charAt(0).toUpperCase() + mode.slice(1); }

/** Why this content type is not available yet, and the one step that changes that. */
function LockedNotice({ snapshot, store, reason }: { snapshot: AppSnapshot; store: MatrixStore; reason: string }): JSX.Element {
  return <div class="locked-notice">
    <p><strong>Preview only for now.</strong> {reason}</p>
    {snapshot.nextTest && <button
      class="secondary"
      disabled={snapshot.busy !== null || !snapshot.liveConnected}
      onClick={() => { store.setView("diagnose"); store.startGuidedTest(snapshot.nextTest!.testId); }}
    >Run “{snapshot.nextTest.title}”</button>}
  </div>;
}

function DeviceControls({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const verified = snapshot.liveConnected && snapshot.capabilities.some((c) => c.id === "brightness" && c.live && c.validation === "verified");
  const [brightness, setBrightness] = useState(snapshot.deviceState.brightness ?? snapshot.content.settings.lastBrightness ?? 64);
  useEffect(() => { if (snapshot.deviceState.brightness !== null) setBrightness(snapshot.deviceState.brightness); }, [snapshot.deviceState.brightness]);
  return <section class="device-controls">
    <div class="brightness-row">
      <span class="panel-kicker">BRIGHTNESS</span>
      <strong class="big-value">{brightness}</strong>
    </div>
    <input class="range" aria-label="Brightness" type="range" min="0" max="255" value={brightness} disabled={!verified} onInput={(event) => setBrightness(Number((event.currentTarget as HTMLInputElement).value))}/>
    <button class="secondary" disabled={!verified || snapshot.busy !== null} title={verified ? "" : snapshot.liveConnected ? "Brightness is not a verified live capability for this session." : "Live operations are blocked for offline reports."} onClick={() => void store.applyBrightness(brightness)}>Apply brightness</button>
    <p class="fineprint">Apply requires a matching command response and verifies the value with a fresh device-info readback.</p>
    <dl class="about-facts">
      <div><dt>Power</dt><dd>{snapshot.deviceState.power}</dd></div>
      <div><dt>Brightness</dt><dd>{snapshot.deviceState.brightness ?? "Unknown"}</dd></div>
      <div><dt>Protocol</dt><dd>{snapshot.device?.protocol}</dd></div>
      <div><dt>Size</dt><dd>{snapshot.device?.profileGeometry}</dd></div>
    </dl>
    <div class="utility-row">
      <StatusBadge tone={snapshot.liveConnected ? "good" : "neutral"}>{snapshot.liveConnected ? "Live readback" : "Imported evidence"}</StatusBadge>
      <button class="text-action" onClick={() => void store.refreshInfo()} disabled={!verified || snapshot.busy !== null}>Refresh device info</button>
    </div>
  </section>;
}
