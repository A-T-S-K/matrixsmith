import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { AppSnapshot, MatrixStore } from "../store";
import { StatusBadge } from "../components/StatusBadge";
import { FramePreview } from "../components/FramePreview";

export function ControlView({ snapshot, store }: { readonly snapshot: AppSnapshot; readonly store: MatrixStore }): JSX.Element {
  const verified = snapshot.liveConnected && snapshot.capabilities.some((c) => c.id === "brightness" && c.live && c.validation === "verified");
  const [brightness, setBrightness] = useState(snapshot.deviceState.brightness ?? snapshot.content.settings.lastBrightness ?? 64);
  useEffect(() => { if (snapshot.deviceState.brightness !== null) setBrightness(snapshot.deviceState.brightness); }, [snapshot.deviceState.brightness]);
  return <section class="view">
    <div class="view-heading"><div><p class="eyebrow">NORMAL OPERATION</p><h1>Control</h1><p>Verified controls for this display. Protocol details stay out of the way.</p></div><button class="secondary" onClick={() => void store.refreshInfo()} disabled={!verified || snapshot.busy !== null}>Refresh device info</button></div>
    <div class="control-layout">
      <article class="panel state-panel"><div class="panel-title"><div><span class="panel-kicker">CURRENT STATE</span><h2>Display status</h2></div><StatusBadge tone={snapshot.liveConnected ? "good" : "neutral"}>{snapshot.liveConnected ? "Live readback" : "Imported evidence"}</StatusBadge></div><dl class="state-grid"><div><dt>Power</dt><dd>{snapshot.deviceState.power}</dd></div><div><dt>Brightness</dt><dd>{snapshot.deviceState.brightness ?? "Unknown"}</dd></div><div><dt>Protocol</dt><dd>{snapshot.device?.protocol}</dd></div><div><dt>Profile geometry</dt><dd>{snapshot.device?.profileGeometry}</dd></div></dl></article>
      <article class="panel brightness-panel"><div class="panel-title"><div><span class="panel-kicker">VERIFIED LIVE</span><h2>Brightness</h2></div><strong class="big-value">{brightness}</strong></div><input class="range" aria-label="Brightness" type="range" min="0" max="255" value={brightness} disabled={!verified} onInput={(event) => setBrightness(Number((event.currentTarget as HTMLInputElement).value))}/><div class="range-labels"><span>0</span><span>Raw device value</span><span>255</span></div><button class="primary" disabled={!verified || snapshot.busy !== null} title={verified ? "" : snapshot.liveConnected ? "Brightness is not a verified live capability for this session." : "Live operations are blocked for offline reports."} onClick={() => void store.applyBrightness(brightness)}>Apply brightness</button><p class="fineprint">Apply requires a matching command response and verifies the value with a fresh device-info readback.</p></article>
    </div>
    <ContentSection snapshot={snapshot} store={store}/>
  </section>;
}

function ContentGate({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  return <article class="panel content-gate">
    <div class="panel-title"><div><span class="panel-kicker">SOME CONTENT IS STILL PREVIEW-ONLY</span><h2>Verify this display's remaining capabilities</h2></div><StatusBadge tone="warn">Guided tests available</StatusBadge></div>
    <p>{snapshot.contentGates.image.allowed ? "" : snapshot.contentGates.image.reason} Each content type unlocks when its own capabilities are physically verified — an unrelated test never unlocks it.</p>
    {snapshot.nextTest && <p class="fineprint">Recommended: {snapshot.nextTest.title} (~{snapshot.nextTest.estimatedObservationTime}).</p>}
    <button class="primary" disabled={snapshot.busy !== null || !snapshot.liveConnected} onClick={() => { store.setView("diagnose"); if (snapshot.nextTest) store.startGuidedTest(snapshot.nextTest.testId); }}>Run the recommended test</button>
  </article>;
}

function ContentSection({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const content = snapshot.content;
  const settings = content.settings;
  const gates = snapshot.contentGates;
  const pathSend = (path: keyof typeof gates): { canSend: boolean; title: string } => ({
    canSend: gates[path].allowed && snapshot.busy === null,
    title: gates[path].allowed ? "" : gates[path].reason,
  });
  const text = pathSend("text");
  const image = pathSend("image");
  const animation = pathSend("animation");
  const gif = pathSend("gif");
  const chooseImage = async (event: Event): Promise<void> => { const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (file) await store.loadImage(file, file.name); };
  const chooseGif = async (event: Event): Promise<void> => { const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (file) await store.loadGif(file, file.name); };
  return <section>
    <div class="section-heading"><h2>Content</h2><p>Text, images, and animation compile locally into the display's stored-program format. Sends replace the stored content and always ask for confirmation.</p></div>
    {(!gates.image.allowed || !gates.animation.allowed) && <ContentGate snapshot={snapshot} store={store}/>}
    <div class="content-grid">
      <article class="panel">
        <div class="panel-title"><div><span class="panel-kicker">TEXT</span><h2>Rendered text</h2></div><StatusBadge tone={gates.text.allowed ? "good" : "warn"}>{gates.text.allowed ? "Verified path" : "Needs verification"}</StatusBadge></div>
        <label class="field"><span>Text</span><input value={settings.text} placeholder="HELLO" onInput={(event) => store.updateContentSettings({ text: (event.currentTarget as HTMLInputElement).value })}/></label>
        <div class="field-row">
          <label class="field"><span>Color</span><input type="color" value={settings.textColor} onInput={(event) => store.updateContentSettings({ textColor: (event.currentTarget as HTMLInputElement).value })}/></label>
          <label class="field"><span>Background</span><input type="color" value={settings.textBackground} onInput={(event) => store.updateContentSettings({ textBackground: (event.currentTarget as HTMLInputElement).value })}/></label>
          <label class="field"><span>Alignment</span><select value={settings.textAlignment} onChange={(event) => store.updateContentSettings({ textAlignment: (event.currentTarget as HTMLSelectElement).value as "left" | "center" | "right" })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
        </div>
        {content.textPreview ? <FramePreview frame={content.textPreview} label="Text preview"/> : <p class="empty">Type text to preview it on the {snapshot.device?.profileGeometry ?? "display"} canvas.</p>}
        <button class="primary" disabled={!text.canSend || !settings.text.trim()} title={text.title} onClick={() => store.requestSendText()}>Send text…</button>
      </article>
      <article class="panel">
        <div class="panel-title"><div><span class="panel-kicker">IMAGE</span><h2>Image</h2></div><StatusBadge tone={gates.image.allowed ? "good" : "warn"}>{gates.image.allowed ? "Verified path" : "Needs verification"}</StatusBadge></div>
        <label class="text-action file-action">Choose image (PNG/JPEG/WebP) →<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseImage(event)}/></label>
        <label class="field"><span>Fit mode</span><select value={settings.imageFitMode} onChange={(event) => void store.setImageFit((event.currentTarget as HTMLSelectElement).value as typeof settings.imageFitMode)}><option value="contain">Contain</option><option value="cover">Cover</option><option value="stretch">Stretch</option><option value="center">Center / crop</option></select></label>
        {content.image ? <>
          <p class="fineprint">{content.image.name}: source {content.image.sourceWidth}×{content.image.sourceHeight}, fit {content.image.fitMode}. Decoded locally; nothing leaves the browser.</p>
          <FramePreview frame={content.image.preview} label="Quantized image preview"/>
        </> : <p class="empty">Choose a local image to preview its {snapshot.device?.profileGeometry ?? ""} quantization.</p>}
        <button class="primary" disabled={!image.canSend || !content.image} title={image.title} onClick={() => store.requestSendImage()}>Send image…</button>
      </article>
      <article class="panel">
        <div class="panel-title"><div><span class="panel-kicker">ANIMATION</span><h2>Animation</h2></div><StatusBadge tone={gates.animation.allowed ? "good" : "warn"}>{gates.animation.allowed ? "Verified path" : "Needs verification"}</StatusBadge></div>
        <label class="field"><span>Animation</span><select value={content.animationChoice} onChange={(event) => store.setAnimationChoice((event.currentTarget as HTMLSelectElement).value as "diagnostic" | "scroll-text")}><option value="diagnostic">Diagnostic two-frame pattern</option><option value="scroll-text">Scrolling text (uses the Text settings)</option></select></label>
        {content.animationChoice === "diagnostic" && <div class="validation-previews">{content.animationPreview.map((frame, index) => <div><strong>Frame {index + 1}</strong><FramePreview frame={frame} scale={5}/></div>)}</div>}
        {content.animationChoice === "scroll-text" && (content.textPreview ? <FramePreview frame={content.textPreview} label="Scroll text preview (first frame renders offscreen right)"/> : <p class="empty">Enter text in the Text panel first.</p>)}
        <button class="primary" disabled={!animation.canSend || (content.animationChoice === "scroll-text" && !settings.text.trim())} title={animation.title} onClick={() => store.requestSendAnimation()}>Send animation…</button>
      </article>
      <article class="panel">
        <div class="panel-title"><div><span class="panel-kicker">GIF</span><h2>GIF</h2></div><StatusBadge tone="warn">Experimental</StatusBadge></div>
        <label class="text-action file-action">Choose GIF →<input type="file" accept="image/gif,.gif" onChange={(event) => void chooseGif(event)}/></label>
        {content.gif ? <>
          <p class="fineprint">{content.gif.name}: {content.gif.byteLength.toLocaleString()} bytes{content.gif.width !== null ? `, canvas ${content.gif.width}×${content.gif.height}` : ""}. Read locally; never uploaded.</p>
          {content.gif.warning && <p class="notice warning">{content.gif.warning}</p>}
        </> : <p class="empty">The sign has a native GIF decoder (source-verified in the untiled 8-column zone).</p>}
        <button class="primary" disabled={!gif.canSend || !content.gif} title={gif.title} onClick={() => store.requestSendGif()}>Send GIF…</button>
      </article>
    </div>
  </section>;
}
