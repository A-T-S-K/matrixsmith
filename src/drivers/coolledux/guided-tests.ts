import type { DeviceProfile } from "../../core/device";
import type { ObservationFieldSpec, ObservationValue } from "../../investigation/observations";
import {
  booleanAnswer, choiceAnswer, durationAnswer,
  type ClaimUpdate, type GuidedTestDefinition, type GuidedTestInterpretation,
} from "../../investigation/tests";
import { formatDuration } from "../../investigation/observations";
import { PIXEL_CHANNEL_PROBE_WORDS } from "./diagnostics";

/**
 * CoolLEDUX guided hardware tests for the iLedHat characterization phase.
 * Every test transmits a fixed diagnostic program (see diagnostics.ts) and
 * converts structured physical observations into atomic claim evidence.
 * Interpretation is deliberately conservative: an unclear observation stays
 * "unresolved", and no outcome silently rewrites built-in profile behavior.
 */

const PERSISTENT_CONSEQUENCE =
  "This replaces the currently stored display program with a diagnostic image. "
  + "The device's hardware reset path is known to restore its factory/default content, "
  + "but automatic content restoration has not been verified.";

const COLOR_CHOICES = [
  { id: "off", label: "Off / black" },
  { id: "red", label: "Red" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "cyan", label: "Cyan" },
  { id: "magenta", label: "Magenta" },
  { id: "yellow", label: "Yellow" },
  { id: "neutral-white", label: "Neutral white" },
  { id: "tinted-white", label: "Tinted white" },
  { id: "another-color", label: "Another color" },
] as const;

// ---------------------------------------------------------------------------
// TEST A — characterize Graffiti black / off
// ---------------------------------------------------------------------------

const graffitiBlackTest: GuidedTestDefinition = {
  id: "coolledux-graffiti-black",
  driverId: "coolledux",
  title: "Test static-image black behavior",
  category: "recommended",
  targetClaims: ["graffiti.black-semantics"],
  prerequisites: [
    { claimId: "stored-program.upload", anyOf: ["verified"] },
    { claimId: "graffiti.initial-render", anyOf: ["verified"] },
  ],
  requiresCompletedTests: [],
  risk: "persistent", persistence: "persistent", consequence: PERSISTENT_CONSEQUENCE,
  about: {
    question: "Does this iLedHat actually require the blue-ish nonzero workaround for black static-image pixels?",
    whyRelevant: "MatrixSmith currently inherits a blue-ish black workaround from another CoolLEDUX device; this exact iLedHat has not been tested for that behavior.",
    whatMatrixSmithDoes: "Uploads a fixed pattern with alternating 8-column regions: literal raw 0x0000 (columns 0–7 and 16–23) and the raw 0x0004 workaround (columns 8–15 and 24–31), bypassing the normal off-color substitution. One bright marker pixel tops each tile.",
    whatChangesOnDevice: "The stored display program is replaced with this diagnostic pattern.",
    estimatedObservationTime: "About 1 minute.",
    possibleOutcomes: [
      { outcome: "The 0x0000 regions are off/black", learns: "The upstream Graffiti white-sentinel quirk does not apply here; true black is available on the static-image path." },
      { outcome: "The 0x0000 regions are bright white", learns: "The white-sentinel quirk is directly corroborated on this profile; the workaround stays necessary." },
      { outcome: "Something else / unsure", learns: "Black semantics stay uncharacterized; the observation is still recorded as evidence." },
    ],
    preTransferNote: "Judge the initial image immediately. This test isolates black/off pixel encoding. Any later movement is a separate playback question.",
    observeInstructions: "Look at the two kinds of vertical regions right after the upload. Ignore the single bright marker pixel at the top of each 8-column tile.",
    technicalDetails: [
      "Graffiti stored program, mode=0, speed=0, stayTime=3, four 8-column tiles at full 16-row height.",
      "Raw pixel words are transmitted exactly: 0x0000 and 0x0004 with no substitution or transfer curve.",
      "Upstream reference: coolledux-ble@4f5656d observed 0x0000 → bright white on its hardware; that has never been observed on this iLedHat.",
    ],
  },
  operation: { type: "ShowDiagnostic", diagnosticId: "graffiti-black-probe" },
  observation: [
    { kind: "choice", id: "zero-appearance", prompt: "What do the raw 0x0000 regions (columns 1–8 and 17–24) look like?", options: [
      { id: "off-black", label: "Off / black" }, { id: "bright-white", label: "Bright white" }, { id: "dim-blue", label: "Dim blue" },
      { id: "another-color", label: "Another color" },
    ], allowOther: true },
    { kind: "choice", id: "workaround-appearance", prompt: "What do the raw 0x0004 regions (columns 9–16 and 25–32) look like?", options: [
      { id: "off-black", label: "Off / black" }, { id: "dim-blue", label: "Dim blue" }, { id: "bright-white", label: "Bright white" },
      { id: "another-color", label: "Another color" },
    ], allowOther: true },
    { kind: "note", id: "note", prompt: "Anything else worth recording?" },
  ],
  showRegionDiagram: true,
  interpret(values) {
    const zero = choiceAnswer(values, "zero-appearance");
    const workaround = choiceAnswer(values, "workaround-appearance");
    const updates: ClaimUpdate[] = [];
    const established: string[] = [];
    const rejected: string[] = [];
    const unknowns: string[] = [];
    let status: GuidedTestInterpretation["status"] = "inconclusive";
    let summary = "The black/off observation was not conclusive.";
    if (zero === "off-black") {
      status = "passed";
      summary = "Literal Graffiti 0x0000 renders off/black on this iLedHat.";
      established.push("Graffiti-path literal 0x0000 is genuinely off/black on this exact device.");
      rejected.push("The upstream white-sentinel quirk (0x0000 → bright white) does not reproduce on this profile.");
      updates.push({ claimId: "graffiti.black-semantics", status: "verified", summary: "Literal 0x0000 observed off/black on the Graffiti path; the upstream white-sentinel quirk does not apply to this profile. Built-in profile behavior is not changed automatically." });
    } else if (zero === "bright-white") {
      status = "passed";
      summary = "Literal Graffiti 0x0000 renders bright white: the upstream quirk is directly corroborated on this iLedHat.";
      established.push("The Graffiti white-sentinel quirk is directly observed on this profile; the 0x0004 workaround remains necessary.");
      updates.push({ claimId: "graffiti.black-semantics", status: "verified", summary: "Literal 0x0000 observed bright white on the Graffiti path; the white-sentinel workaround is required on this profile." });
    } else if (zero !== null) {
      status = "partial";
      summary = `The raw 0x0000 regions showed an unexpected appearance (${zero}).`;
      unknowns.push("Graffiti 0x0000 semantics remain uncharacterized: the observed appearance matches neither hypothesis.");
      updates.push({ claimId: "graffiti.black-semantics", status: "unresolved", summary: `Raw 0x0000 regions observed as "${zero}" — neither off/black nor bright white.` });
    } else {
      unknowns.push("No observation was recorded for the 0x0000 regions.");
    }
    if (workaround && workaround !== "off-black") established.push(`The raw 0x0004 workaround regions appeared "${workaround}" — visible rather than fully off.`);
    else if (workaround === "off-black") established.push("The raw 0x0004 workaround regions appeared off/black.");
    return { status, established, rejected, unknowns, summary, claimUpdates: updates, nextHint: "Measure static-image movement to characterize Graffiti playback timing." };
  },
};

// ---------------------------------------------------------------------------
// TEST B / C — Graffiti playback timing and the stayTime discriminator
// ---------------------------------------------------------------------------

function timingObservationFields(): readonly ObservationFieldSpec[] {
  return [
    { kind: "boolean", id: "initial-correct", prompt: "Did the full test image appear correctly at first?" },
    { kind: "boolean", id: "moved", prompt: "Did the image start moving at any point?" },
    { kind: "duration", id: "movement-start", prompt: "How long after the upload did movement start?", required: false },
    { kind: "choice", id: "motion-description", prompt: "If it moved, what did the motion look like?", required: false, options: [
      { id: "moves", label: "The whole image moves" },
      { id: "wraps-repeats", label: "It wraps around / repeats" },
      { id: "blank-interval", label: "There is a blank interval" },
      { id: "bands-tiles", label: "Bands or tiles move separately" },
    ], allowOther: true },
    { kind: "note", id: "note", prompt: "Anything else worth recording?" },
  ];
}

function interpretTiming(values: readonly ObservationValue[], stayTime: number): GuidedTestInterpretation {
  const initial = booleanAnswer(values, "initial-correct");
  const moved = booleanAnswer(values, "moved");
  const onsetMs = durationAnswer(values, "movement-start");
  const motion = choiceAnswer(values, "motion-description");
  const updates: ClaimUpdate[] = [];
  const established: string[] = [];
  const rejected: string[] = [];
  const unknowns: string[] = [];
  const parameterNote = `(mode=0, speed=0, stayTime=${stayTime})`;
  if (initial === "yes") {
    established.push("The full raster appeared correctly after upload.");
    updates.push({ claimId: "graffiti.initial-render", status: "verified", summary: `Full tiled raster rendered correctly after upload ${parameterNote}.` });
  } else if (initial === "no") {
    rejected.push("The raster did not initially render correctly.");
    updates.push({ claimId: "graffiti.initial-render", status: "rejected", summary: `The tiled raster failed to render correctly ${parameterNote}.` });
  }
  let status: GuidedTestInterpretation["status"];
  let summary: string;
  if (moved === "no") {
    const heldMs = onsetMs;
    status = "passed";
    summary = heldMs !== null
      ? `The image stayed still for the observed ${formatDuration(heldMs)} ${parameterNote}.`
      : `The image stayed still for the observed period ${parameterNote}.`;
    established.push(`No movement was observed${heldMs !== null ? ` within ${formatDuration(heldMs)}` : ""} with stayTime=${stayTime}.`);
    updates.push({ claimId: "graffiti.playback-stability", status: "verified", summary: `Raster remained static${heldMs !== null ? ` for ${formatDuration(heldMs)}` : ""} ${parameterNote}. Stability is scoped to the observed duration.` });
    updates.push({ claimId: "static.strategy", status: "verified", summary: `Graffiti ${parameterNote} held a static raster for the observed period; candidate static strategy.` });
  } else if (moved === "yes") {
    status = "partial";
    const onsetText = onsetMs !== null ? ` Movement began after ${formatDuration(onsetMs)} (measured).` : "";
    summary = `The image rendered and then began moving ${parameterNote}.${onsetText}`;
    rejected.push(`The raster did not remain static with stayTime=${stayTime}.${onsetText}`);
    if (motion) established.push(`Motion character: ${motion}.`);
    updates.push({ claimId: "graffiti.playback-stability", status: "rejected", summary: `Raster began moving${onsetMs !== null ? ` after ${onsetMs} ms` : ""} ${parameterNote}${motion ? `; motion: ${motion}` : ""}.` });
  } else {
    status = "inconclusive";
    summary = "Movement behavior was not observed conclusively.";
    unknowns.push("Whether the raster remains static is still unknown.");
    updates.push({ claimId: "graffiti.playback-stability", status: "unresolved", summary: `Observation inconclusive ${parameterNote}.` });
  }
  return {
    status, established, rejected, unknowns, summary, claimUpdates: updates,
    ...(moved === "no" && stayTime === 0 ? {} : {}),
    ...(status === "passed" ? { selectsRasterStrategy: "graffiti" as const } : {}),
    nextHint: moved === "yes" && stayTime === 3
      ? "Compare stayTime=0 with the same raster — the only other justified variant — to isolate the stayTime byte."
      : "Validate the static raster via the Animation path as an alternative strategy.",
  };
}

const graffitiTimingTest: GuidedTestDefinition = {
  id: "coolledux-graffiti-timing",
  driverId: "coolledux",
  title: "Measure static-image movement",
  category: "recommended",
  targetClaims: ["graffiti.playback-stability", "graffiti.initial-render"],
  prerequisites: [
    { claimId: "stored-program.upload", anyOf: ["verified"] },
    { claimId: "graffiti.initial-render", anyOf: ["verified"] },
  ],
  requiresCompletedTests: [],
  risk: "persistent", persistence: "persistent", consequence: PERSISTENT_CONSEQUENCE,
  about: {
    question: "Does a static image stay still on this display, and if not, exactly when does it start moving?",
    whyRelevant: "The static-image raster previously rendered correctly and then began moving in a cycle. Measuring the onset precisely is the best evidence for what triggers it.",
    whatMatrixSmithDoes: "Uploads a deterministic high-contrast raster with the baseline playback bytes, then starts a stopwatch the moment the final program packet is accepted. Tap the button as soon as movement starts — MatrixSmith records the exact elapsed time.",
    whatChangesOnDevice: "The stored display program is replaced with the diagnostic raster.",
    estimatedObservationTime: "Watch for up to 15–20 seconds.",
    possibleOutcomes: [
      { outcome: "The image never moves", learns: "Graffiti is a viable static-image strategy at these settings." },
      { outcome: "Movement starts after a measurable delay", learns: "The measured onset points at a playback parameter (like stayTime) as the trigger." },
      { outcome: "The image is wrong from the start", learns: "The problem is rendering, not playback timing." },
    ],
    observeInstructions: "Watch the panel. Tap \"Movement started\" the instant anything shifts, or use the still-unchanged buttons at each milestone.",
    technicalDetails: [
      "Graffiti stored program, mode=0, speed=0, stayTime=3 — the exact baseline that previously exhibited movement.",
      "The stopwatch starts at the final host-accepted write; the recorded duration is measured by MatrixSmith, not estimated later.",
      "Upstream reference reports mode=0 as Static and never documents stayTime semantics; only value 3 appears upstream.",
    ],
  },
  operation: { type: "ShowDiagnostic", diagnosticId: "graffiti-timing-probe", parameters: { stayTime: 3 } },
  observation: timingObservationFields(),
  timer: { fieldId: "movement-start", startLabel: "Movement started", stopLabel: "Still unchanged — stop watching", milestoneSeconds: [5, 10, 15] },
  showRegionDiagram: false,
  interpret: (values) => interpretTiming(values, 3),
};

const graffitiStayTimeTest: GuidedTestDefinition = {
  id: "coolledux-graffiti-staytime",
  driverId: "coolledux",
  title: "Compare stayTime 3 and 0",
  category: "advanced",
  targetClaims: ["graffiti.playback-stability"],
  prerequisites: [
    { claimId: "stored-program.upload", anyOf: ["verified"] },
  ],
  requiresCompletedTests: ["coolledux-graffiti-timing"],
  risk: "persistent", persistence: "persistent", consequence: PERSISTENT_CONSEQUENCE,
  about: {
    question: "Does the undocumented stayTime byte control when the static image starts moving?",
    whyRelevant: "The baseline measurement used stayTime=3 (the only value the upstream source ever uses, with unknown semantics). Changing exactly this one byte to 0 isolates its effect.",
    whatMatrixSmithDoes: "Uploads the identical raster and playback bytes as the baseline measurement, changing only stayTime from 3 to 0, then runs the same stopwatch observation.",
    whatChangesOnDevice: "The stored display program is replaced with the diagnostic raster.",
    estimatedObservationTime: "Watch for up to 15–20 seconds.",
    possibleOutcomes: [
      { outcome: "Behavior matches the baseline", learns: "stayTime is probably not the movement trigger at these values." },
      { outcome: "Movement timing changes", learns: "stayTime directly influences playback; its scale can be characterized next." },
      { outcome: "The image stays still", learns: "stayTime=0 is a static configuration for this panel." },
    ],
    observeInstructions: "Watch the panel exactly as before. Tap \"Movement started\" the instant anything shifts.",
    technicalDetails: [
      "Identical program to the baseline except the per-tile stayTime byte: 0 instead of 3. Every other byte and frame is unchanged.",
      "No other stayTime values are offered: upstream never documents the field, so only the used value (3) and the null value (0) are justified. 0xFF is deliberately not probed.",
    ],
  },
  operation: { type: "ShowDiagnostic", diagnosticId: "graffiti-timing-probe", parameters: { stayTime: 0 } },
  observation: timingObservationFields(),
  timer: { fieldId: "movement-start", startLabel: "Movement started", stopLabel: "Still unchanged — stop watching", milestoneSeconds: [5, 10, 15] },
  showRegionDiagram: false,
  interpret: (values) => interpretTiming(values, 0),
};

// ---------------------------------------------------------------------------
// TEST D — validate static raster via Animation
// ---------------------------------------------------------------------------

function staticRasterObservationFields(): readonly ObservationFieldSpec[] {
  return [
    { kind: "boolean", id: "initial-correct", prompt: "Did the image appear correctly at first?" },
    { kind: "boolean", id: "stays-still", prompt: "Did it remain completely stationary for at least 15 seconds?" },
    { kind: "boolean", id: "background-off", prompt: "Is the background genuinely off/black?" },
    { kind: "boolean", id: "tiles-aligned", prompt: "Are all four tiles aligned with no seams?" },
    { kind: "boolean", id: "flicker", prompt: "Did you notice any flicker or periodic reset?", required: false },
    { kind: "note", id: "note", prompt: "Anything else worth recording?" },
  ];
}

function interpretAnimationStatic(values: readonly ObservationValue[], variant: "single" | "identical-pair"): GuidedTestInterpretation {
  const initial = booleanAnswer(values, "initial-correct");
  const still = booleanAnswer(values, "stays-still");
  const background = booleanAnswer(values, "background-off");
  const tiles = booleanAnswer(values, "tiles-aligned");
  const flicker = booleanAnswer(values, "flicker");
  const label = variant === "single" ? "one-frame Animation" : "two-identical-frame Animation";
  const strategy = variant === "single" ? "animation-single-frame" as const : "animation-identical-frames" as const;
  const claimId = "animation.static-single-frame" as const;
  const updates: ClaimUpdate[] = [];
  const established: string[] = [];
  const rejected: string[] = [];
  const unknowns: string[] = [];
  if (background === "yes") established.push("The literal 0x0000 background was off, re-confirming Animation black.");
  if (tiles === "yes") established.push("All four tiles were aligned.");
  if (flicker === "yes") established.push("Flicker or a periodic reset was observed and recorded.");
  const passed = initial === "yes" && still === "yes" && tiles !== "no" && flicker !== "yes";
  if (passed) {
    established.push(`The ${label} program held a stable static raster.`);
    updates.push({ claimId, status: "verified", summary: `The ${label} program rendered the raster and held it stationary for ≥15 s with an off background.` });
    updates.push({ claimId: "static.strategy", status: "verified", summary: `Validated static strategy: ${label} program.` });
    return {
      status: "passed", established, rejected, unknowns,
      summary: `The ${label} program is a working static-image strategy for this display.`,
      claimUpdates: updates, selectsRasterStrategy: strategy,
      nextHint: "Characterize the raw pixel channels next — the Animation path is now the reliable substrate for it.",
    };
  }
  if (initial === "no") {
    rejected.push(`The ${label} program did not initially render the raster correctly.`);
    updates.push({ claimId, status: "rejected", summary: `The ${label} program failed to render the raster correctly.` });
    return { status: "failed", established, rejected, unknowns, summary: `The ${label} render failed.`, claimUpdates: updates, ...(variant === "single" ? { nextHint: "Optionally try the separate two-identical-frame variant." } : {}) };
  }
  if (still === "no" || flicker === "yes") {
    rejected.push(`The ${label} raster did not remain visually stable.`);
    updates.push({ claimId, status: "rejected", summary: `The ${label} raster rendered but did not remain stable (movement or flicker observed).` });
    return { status: "partial", established, rejected, unknowns, summary: `The ${label} raster rendered but was not stable.`, claimUpdates: updates, ...(variant === "single" ? { nextHint: "Optionally try the separate two-identical-frame variant." } : {}) };
  }
  unknowns.push("Stability was not conclusively observed.");
  updates.push({ claimId, status: "unresolved", summary: `Observation of the ${label} program was inconclusive.` });
  return { status: "inconclusive", established, rejected, unknowns, summary: "The observation was inconclusive.", claimUpdates: updates };
}

const animationStaticTest: GuidedTestDefinition = {
  id: "coolledux-animation-static",
  driverId: "coolledux",
  title: "Show a still image via the animation path",
  category: "recommended",
  targetClaims: ["animation.static-single-frame", "static.strategy"],
  prerequisites: [
    { claimId: "animation.frames", anyOf: ["verified"] },
    { claimId: "animation.black-semantics", anyOf: ["verified"] },
  ],
  requiresCompletedTests: [],
  risk: "persistent", persistence: "persistent", consequence: PERSISTENT_CONSEQUENCE,
  about: {
    question: "Can the verified animation path hold a completely still image?",
    whyRelevant: "The static-image (Graffiti) path moved unexpectedly on this display, but animations played perfectly. If one animation frame stays still, it becomes the reliable way to show images.",
    whatMatrixSmithDoes: "Uploads the same logical diagnostic raster compiled as a one-frame tiled Animation program with a true-black background.",
    whatChangesOnDevice: "The stored display program is replaced with the diagnostic raster.",
    estimatedObservationTime: "Watch for at least 15 seconds.",
    possibleOutcomes: [
      { outcome: "The image is correct and stays still", learns: "A validated static-image strategy exists; images and text can route through it." },
      { outcome: "It renders but flickers or resets", learns: "Single-frame animation playback has a quirk; the separate two-identical-frame variant can be tried." },
      { outcome: "It renders incorrectly", learns: "Single-frame animation decoding differs from multi-frame decoding." },
    ],
    observeInstructions: "Watch the panel for at least 15 seconds and answer each question.",
    technicalDetails: [
      "Tiled Animation program: exactly ONE frame per tile, four 8-column tiles, full 16-row height, literal 0x0000 background, 1000 ms declared frame delay.",
      "The optional two-IDENTICAL-frame variant is a separate test and is never sent automatically.",
    ],
  },
  operation: { type: "ShowDiagnostic", diagnosticId: "animation-static-raster", parameters: { frames: 1 } },
  observation: staticRasterObservationFields(),
  showRegionDiagram: false,
  interpret: (values) => interpretAnimationStatic(values, "single"),
};

const animationStaticPairTest: GuidedTestDefinition = {
  id: "coolledux-animation-static-pair",
  driverId: "coolledux",
  title: "Still image via two identical animation frames",
  category: "optional",
  targetClaims: ["animation.static-single-frame", "static.strategy"],
  prerequisites: [
    { claimId: "animation.frames", anyOf: ["verified"] },
  ],
  requiresCompletedTests: ["coolledux-animation-static"],
  risk: "persistent", persistence: "persistent", consequence: PERSISTENT_CONSEQUENCE,
  about: {
    question: "Does repeating the same frame twice make the animation-path still image stable?",
    whyRelevant: "A follow-up for when the one-frame variant behaved unexpectedly: some firmware handles a two-frame loop more reliably than a single frame.",
    whatMatrixSmithDoes: "Uploads the same raster as TWO identical animation frames per tile.",
    whatChangesOnDevice: "The stored display program is replaced with the diagnostic raster.",
    estimatedObservationTime: "Watch for at least 15 seconds.",
    possibleOutcomes: [
      { outcome: "The image is correct and stays still", learns: "The identical-pair variant becomes the validated static strategy." },
      { outcome: "Still unstable", learns: "The instability is not specific to single-frame programs." },
    ],
    observeInstructions: "Watch the panel for at least 15 seconds and answer each question.",
    technicalDetails: ["Identical to the one-frame variant except each tile carries the frame twice with 1000 ms delays."],
  },
  operation: { type: "ShowDiagnostic", diagnosticId: "animation-static-raster", parameters: { frames: 2 } },
  observation: staticRasterObservationFields(),
  showRegionDiagram: false,
  interpret: (values) => interpretAnimationStatic(values, "identical-pair"),
};

// ---------------------------------------------------------------------------
// TEST E — characterize raw pixel channels
// ---------------------------------------------------------------------------

const HIGH_NIBBLE_WORDS = [0x1000, 0x2000, 0x4000, 0x8000, 0xf000] as const;

function patchFieldId(word: number): string { return `patch-0x${word.toString(16).padStart(4, "0")}`; }

const pixelChannelTest: GuidedTestDefinition = {
  id: "coolledux-pixel-channels",
  driverId: "coolledux",
  title: "Identify the color channels",
  category: "recommended",
  targetClaims: ["pixel.channel-map", "pixel.white-channel"],
  prerequisites: [
    { claimId: "animation.frames", anyOf: ["verified"] },
    { claimId: "animation.black-semantics", anyOf: ["verified"] },
  ],
  requiresCompletedTests: [],
  risk: "persistent", persistence: "persistent", consequence: PERSISTENT_CONSEQUENCE,
  about: {
    question: "Which parts of the 16-bit pixel value drive which physical LED channels — and does the unused high nibble drive anything?",
    whyRelevant: "\"White\" currently looks tinted on this panel, and the LED package may contain a dedicated white emitter the current encoding never uses. Small fixed patches answer both questions safely.",
    whatMatrixSmithDoes: "Uploads eleven small labeled patches over a black background via the verified animation path. Each patch carries one exact raw pixel value; an on-screen diagram maps every patch position to its value.",
    whatChangesOnDevice: "The stored display program is replaced with the patch pattern.",
    estimatedObservationTime: "About 2–3 minutes — one color per patch.",
    possibleOutcomes: [
      { outcome: "Patches match the expected red/green/blue mapping and high-nibble patches stay dark", learns: "The RGB444 hypothesis is confirmed and the high nibble is ignored." },
      { outcome: "A high-nibble patch lights up", learns: "A fourth physical channel exists; its color and behavior get recorded." },
      { outcome: "Colors are permuted", learns: "The actual channel ordering is characterized and the encoder can be corrected." },
    ],
    observeInstructions: "Match each lit patch on the panel to its position in the diagram and pick the color you see. Patches expected to be dark matter too — record them as Off.",
    technicalDetails: [
      "Animation path (verified frames/tiling/black), one frame, 60 s declared delay.",
      "Raw words in patch order: " + PIXEL_CHANNEL_PROBE_WORDS.map((word) => `0x${word.toString(16).padStart(4, "0").toUpperCase()}`).join(", ") + ".",
      "Words are transmitted untransformed — the high nibble is NOT put through the RGB transfer curve.",
      "Current hypothesis (unconfirmed on this panel): byte0 low nibble = R, byte1 high nibble = G, byte1 low nibble = B.",
    ],
  },
  operation: { type: "ShowDiagnostic", diagnosticId: "pixel-channel-probe" },
  observation: [
    ...PIXEL_CHANNEL_PROBE_WORDS.map((word): ObservationFieldSpec => ({
      kind: "choice", id: patchFieldId(word),
      prompt: `Patch with raw value 0x${word.toString(16).padStart(4, "0").toUpperCase()} — what color is it?`,
      options: [...COLOR_CHOICES], allowOther: true,
    })),
    { kind: "note", id: "note", prompt: "Relative brightness differences or anything else worth recording?" },
  ],
  showRegionDiagram: true,
  interpret(values) {
    const answer = (word: number): string | null => choiceAnswer(values, patchFieldId(word));
    const updates: ClaimUpdate[] = [];
    const established: string[] = [];
    const rejected: string[] = [];
    const unknowns: string[] = [];
    const zero = answer(0x0000);
    const red = answer(0x0f00);
    const green = answer(0x00f0);
    const blue = answer(0x000f);
    const rgbMax = answer(0x0fff);
    if (zero && zero !== "off") rejected.push(`The raw 0x0000 patch was not off (${zero}); channel conclusions below are less reliable.`);
    const rgbAsHypothesized = red === "red" && green === "green" && blue === "blue";
    const allRgbAnswered = red !== null && green !== null && blue !== null;
    if (rgbAsHypothesized) {
      established.push("Raw 0x0F00 → red, 0x00F0 → green, 0x000F → blue: the RGB444 nibble mapping is confirmed on this panel.");
      updates.push({ claimId: "pixel.channel-map", status: "verified", summary: "RGB444 mapping physically confirmed: byte0 low nibble = R, byte1 high nibble = G, byte1 low nibble = B." });
    } else if (allRgbAnswered) {
      const observed = `0x0F00→${red}, 0x00F0→${green}, 0x000F→${blue}`;
      established.push(`Observed single-nibble mapping: ${observed}.`);
      rejected.push("The hypothesized RGB444 ordering does not match the observed colors.");
      updates.push({ claimId: "pixel.channel-map", status: "verified", summary: `Channel mapping characterized as ${observed} — differs from the RGB444 hypothesis; the encoder needs a corrected ordering.` });
    } else {
      unknowns.push("Not all single-channel patches were observed; the channel map stays uncharacterized.");
      updates.push({ claimId: "pixel.channel-map", status: "unresolved", summary: "Single-channel patch observations were incomplete." });
    }
    const litHighNibble = HIGH_NIBBLE_WORDS.filter((word) => { const seen = answer(word); return seen !== null && seen !== "off"; });
    const answeredHighNibble = HIGH_NIBBLE_WORDS.filter((word) => answer(word) !== null);
    if (litHighNibble.length > 0) {
      const details = litHighNibble.map((word) => `0x${word.toString(16).padStart(4, "0").toUpperCase()}→${answer(word)}`).join(", ");
      established.push(`High-nibble-only values produced light while all RGB bits were zero: ${details}. Strong evidence for a fourth physical channel.`);
      const looksWhite = litHighNibble.some((word) => answer(word) === "neutral-white" || answer(word) === "tinted-white");
      updates.push({ claimId: "pixel.white-channel", status: "verified", summary: `High-nibble-only words lit (${details}); a fourth physical channel exists${looksWhite ? " and appears white" : ", color as recorded"}. This does not by itself make the profile RGBW.` });
    } else if (answeredHighNibble.length === HIGH_NIBBLE_WORDS.length) {
      established.push("Every high-nibble-only patch stayed off: the high nibble does not drive a physical emitter at these values.");
      updates.push({ claimId: "pixel.white-channel", status: "rejected", summary: "All high-nibble-only patches (0x1000…0xF000) observed off; no fourth channel is driven by the high nibble." });
    } else {
      unknowns.push("High-nibble patches were not all observed; the fourth-channel hypothesis stays open.");
      updates.push({ claimId: "pixel.white-channel", status: "unresolved", summary: "High-nibble patch observations were incomplete." });
    }
    if (rgbMax === "tinted-white") established.push("RGB-max renders tinted rather than neutral white — matching earlier sessions.");
    if (rgbMax === "neutral-white") established.push("RGB-max renders neutral white on this observation.");
    const status: GuidedTestInterpretation["status"] =
      rgbAsHypothesized || allRgbAnswered ? (litHighNibble.length > 0 || answeredHighNibble.length === HIGH_NIBBLE_WORDS.length ? "passed" : "partial") : "inconclusive";
    return {
      status, established, rejected, unknowns,
      summary: status === "passed" ? "Pixel-channel behavior characterized." : status === "partial" ? "Channel mapping characterized; the high nibble needs more observation." : "Channel observations were incomplete.",
      claimUpdates: updates,
      nextHint: "Run the color/white characterization to compare white options now that the channels are mapped.",
    };
  },
};

// ---------------------------------------------------------------------------
// TEST F — color / white characterization
// ---------------------------------------------------------------------------

const colorWhiteTest: GuidedTestDefinition = {
  id: "coolledux-color-white",
  driverId: "coolledux",
  title: "Check color and white quality",
  category: "optional",
  targetClaims: ["pixel.color-calibration"],
  prerequisites: [
    { claimId: "pixel.channel-map", anyOf: ["verified"] },
  ],
  requiresCompletedTests: [],
  risk: "persistent", persistence: "persistent", consequence: PERSISTENT_CONSEQUENCE,
  about: {
    question: "Do rendered colors — especially white — look visually correct on this panel?",
    whyRelevant: "With the wire channels mapped, the remaining question is visual quality: whether RGB-max white is acceptable and how the alternatives compare.",
    whatMatrixSmithDoes: "Uploads labeled bands of pure red, green, blue, and RGB-max white via the animation path. When a fourth channel has been established, additional bands compare it directly.",
    whatChangesOnDevice: "The stored display program is replaced with the color bands.",
    estimatedObservationTime: "About 1–2 minutes.",
    possibleOutcomes: [
      { outcome: "Colors and white look right", learns: "No calibration work is needed." },
      { outcome: "White looks tinted or channels look imbalanced", learns: "The imbalance is recorded as structured evidence for a future calibration step — no gain magic is applied blindly." },
    ],
    observeInstructions: "Compare each band against its label and judge the white quality.",
    technicalDetails: [
      "Animation path, one frame, raw words 0x0F00 / 0x00F0 / 0x000F / 0x0FFF; optional 0xF000 and 0xFFFF bands when the fourth channel is established.",
      "Wire values are raw and uncalibrated by design: this test separates protocol mapping from visual calibration.",
    ],
  },
  operation: { type: "ShowDiagnostic", diagnosticId: "color-white-probe", parameters: { includeHighNibble: 0 } },
  observation: [
    { kind: "boolean", id: "channels-correct", prompt: "Do the red, green, and blue bands show those exact colors?" },
    { kind: "choice", id: "white-quality", prompt: "How does the RGB-max band look?", options: [
      { id: "neutral-white", label: "Neutral white" }, { id: "tinted-white", label: "Tinted white" }, { id: "not-white", label: "Not white at all" },
    ], allowOther: true },
    { kind: "boolean", id: "imbalance", prompt: "Is any channel obviously brighter or dimmer than the others?", required: false },
    { kind: "note", id: "note", prompt: "Describe any tint or imbalance." },
  ],
  showRegionDiagram: true,
  interpret(values) {
    const channels = booleanAnswer(values, "channels-correct");
    const white = choiceAnswer(values, "white-quality");
    const imbalance = booleanAnswer(values, "imbalance");
    const updates: ClaimUpdate[] = [];
    const established: string[] = [];
    const rejected: string[] = [];
    const unknowns: string[] = [];
    if (channels === "yes") established.push("Pure red, green, and blue bands rendered their labeled colors.");
    if (channels === "no") rejected.push("At least one pure-channel band rendered the wrong color.");
    if (imbalance === "yes") established.push("A visible channel brightness imbalance was recorded.");
    if (white === "neutral-white" && channels === "yes") {
      updates.push({ claimId: "pixel.color-calibration", status: "verified", summary: "RGB-max white judged neutral and pure channels correct; no calibration needed." });
      return { status: "passed", established: [...established, "White looks neutral."], rejected, unknowns, summary: "Color rendering looks visually correct.", claimUpdates: updates };
    }
    if (white !== null || channels !== null) {
      updates.push({ claimId: "pixel.color-calibration", status: "unresolved", summary: `Visual quality recorded: white=${white ?? "unobserved"}, channels-correct=${channels ?? "unobserved"}, imbalance=${imbalance ?? "unobserved"}. Calibration remains open.` });
      return { status: "partial", established, rejected, unknowns, summary: "Color quality characterized; calibration remains open.", claimUpdates: updates };
    }
    unknowns.push("No color-quality observations were recorded.");
    updates.push({ claimId: "pixel.color-calibration", status: "unresolved", summary: "No color-quality observations recorded." });
    return { status: "inconclusive", established, rejected, unknowns, summary: "The observation was inconclusive.", claimUpdates: updates };
  },
};

export const COOLLEDUX_GUIDED_TESTS: readonly GuidedTestDefinition[] = Object.freeze([
  graffitiBlackTest, graffitiTimingTest, graffitiStayTimeTest,
  animationStaticTest, animationStaticPairTest,
  pixelChannelTest, colorWhiteTest,
]);

export function coolLedUxGuidedTests(profile: DeviceProfile): readonly GuidedTestDefinition[] {
  return profile.driverId === "coolledux" ? COOLLEDUX_GUIDED_TESTS : [];
}
