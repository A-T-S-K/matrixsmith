# UX workflows

MatrixSmith's UI is organized around four user jobs, not around code layers. The Preact UI renders immutable `AppSnapshot` objects from `MatrixStore` and invokes semantic controller operations; no component talks to a characteristic or reconstructs domain state from trace text.

```text
HOME
DEVICE WORKSPACE
  CONTROL   — use a supported display
  DIAGNOSE  — identify / troubleshoot a display
  DEVELOP   — protocol workbench
REPORT      — persistent Share report action in the device header
```

## Use

Home offers one primary call to action: **Connect a display**. When the browser supports `navigator.bluetooth.getDevices()`, previously authorized devices appear as a progressive enhancement; nothing requires it. After connection, a persistent device header shows name, geometry, protocol/resolution state, connection state, support status, **Share report**, and **Disconnect**. Mobile uses a compact top summary plus bottom navigation; desktop uses a sidebar.

**Control** is the normal-user surface. It renders verified live capabilities (CoolLEDUX device info and raw brightness with explicit Apply and verified readback) plus a Content section: rendered text (color, background, alignment), local image import (PNG/JPEG/WebP with contain/cover/stretch/center fit and a quantized preview), an animation chooser (diagnostic two-frame pattern or scrolling text), and local GIF import with byte/canvas metadata. Everything previews offline; nothing leaves the browser. While the static framebuffer is unvalidated on the session, content stays preview-only and a gate card routes the user into the guided validation flow instead of presenting experimental sends as normal controls. Every allowed send opens a confirmation dialog stating the exact persistent consequence. Control never shows driver scores, raw GATT, packets, or transport receipts.

## Diagnose

Diagnose answers three questions: what is working, what is uncertain, and what to run next.

- A support/development status matrix covers transport, protocol identity, device state, brightness, persistence, static framebuffer, pixel orientation, color encoding, stored programs, text rendering, animation, GIF, and recovery — each with an honest state (`Verified`, `Experimental`, `Not tested`, `Unknown`, `Rejected`, `Unsupported`, `Out of scope`) and evidence. `Unsupported` is reserved for evidence that a feature cannot work; unperformed work is `Not tested` or `Unknown`.
- A prominent **Recommended next action** advances the support state deterministically: disconnected → connect; ambiguous shared GATT → run safe identification; resolved with static frame untested → **Validate static framebuffer**; static frame passed with animation untested → **Validate animation**; everything validated → safe device checks.
- **Hardware validation** cards launch the guided workflows. Each opens a dialog that shows the exact consequence and a pixel-accurate preview, requires a checked confirmation before **Run test**, transfers the diagnostic program, then records structured yes/no/unsure observations (corners, colors, tile seams, canvas, background; frames, timing, tile sync, loop). Results land in the support matrix, the bundle, and the report, with a **Copy report** action at the end.
- Driver families contribute named diagnostic tools (`src/diagnostics/workflows.ts`). Tools execute only semantic controller operations through the safety policy — no raw transport. Runs are serializable and land in the diagnostic bundle and reports.

The CoolLEDUX brightness round-trip is a guided reversible validation: record baseline, set a sufficiently different test value, require a matching command response, verify by device-info readback, restore the baseline, require a response, and verify restoration. It never runs automatically; the pre-run explanation states that brightness changes temporarily and is restored. A restore failure is surfaced prominently and stops the workflow. Families with no safe probe say so instead of inventing one.

## Develop

Develop replaces the old Lab with six sections:

1. **Protocol candidates** — actionable cards (candidate / verified this session / rejected) with safe identification where one exists; numeric scores and match reasons live under expandable details.
2. **Family probes & tests** — the same constrained diagnostic tools, framed for protocol work.
3. **GATT explorer** — nRF-Connect-style service/characteristic hierarchy; each characteristic row shows UUID, properties, copy, and per-characteristic Read/Subscribe only where the properties allow. There is no generic write box.
4. **Transactions** — the primary protocol-debugging view. A concise timeline expands into TX/RX raw hex, decoded fields, host/protocol/device verification, errors, and one-click copy for every packet. Filters (All, TX/RX, Queries, Probes, Diagnostics, Errors) plus text search over opcode/operation/hex/driver/summary.
5. **Raw events** — the `TraceEvent` ground truth, collapsed by default. Raw notifications never disappear because decoding failed.
6. **Evidence / observations** — session notes plus **Import external capture**: paste or open an nRF Connect text log; the summary shows parsed device, GATT counts, transaction/decode counts, warnings, unparsed lines, and the BLE address (kept out of shareable reports). Imported and live transactions share the same Transactions view, labeled by source.

Multi-packet content uploads appear as one coherent transaction with a compiled-program summary (content type, logical size, tiles, uncompressed size, CRC32, compressed size and ratio, chunk count, pacing and estimated duration) above collapsible per-packet hex labeled announce / chunk N.

## Share

**Share report** opens from the device header. The dialog takes a goal/question, offers per-section include toggles, and previews deterministic Markdown generated purely from domain data (`src/diagnostics/report.ts`) — never from the DOM. Actions: **Copy Markdown**, **Download .md**, **Download diagnostic JSON** (the canonical machine-readable bundle).

Share-sensitive identifiers (browser opaque device IDs, imported MAC addresses, raw trace) default **off** and are labeled when included. Protocol UUIDs, packet bytes, product name, and profile identity are not redacted. The Markdown stands alone when pasted into an issue, forum, chat, or an AI assistant: stable headings, literal hex, and suggested next tests derived from deterministic driver metadata.

## How a driver contributes

- **Capabilities** — `driver.capabilities(profile)` declares supported/live/risk/persistence/validation; Control and the support matrix render from these, never from driver-id conditionals.
- **Probes** — `driver.probes(context)` returns read-only semantic identification probes with serializable response expectations.
- **Diagnostic tools** — named workflows registered in `src/diagnostics/workflows.ts` and executed by `MatrixController.runDiagnostic`, which records steps, transactions, restoration state, and findings.
- **Support-status evidence** — capability metadata plus session resolution evidence feed the Diagnose matrix and the report's support table and suggested next tests.

---

# The MatrixSmith product model (2026-08-31 revision)

MatrixSmith has three primary user jobs sharing one Investigation engine, presented through a **device-centered** workspace rather than three equal modes:

```text
HOME
  ├─ known/usable display  → DEVICE WORKSPACE
  │     Create (text / image / animation / GIF, preview, per-path Send)
  │     Controls (brightness; power when validated)
  │     Troubleshoot entry
  │     Developer tools → protocol workbench (secondary)
  └─ unknown/incomplete display → INVESTIGATION WORKSPACE
        Guided investigation (default)
        optional protocol workbench
```

- **Use / Configure / Create** — the Create view. Task-specific settings live beside their task (image fit next to the image preview, text alignment next to text). Send buttons are gated **per content path** (see safety); a normal user never sees FFF0/CRC/LZSS/packets unless they open technical details.
- **Develop / Characterize** — the Investigate view. Guided investigation is the primary developer experience: MatrixSmith inspects existing evidence, recommends the highest-information safe test, runs it, asks only for physical observations, updates atomic claims, and prepares copyable reports. The protocol workbench is optional and never required to produce complete evidence.
- **Debug / Troubleshoot** — symptom-first entry ("Content moves unexpectedly", "The colors look wrong", …). A symptom initializes an Investigation goal whose focus claims bias the recommendation engine; the same guided test engine runs from there and produces support-ready reports.

## The critical test loop

Every guided test is one linear mini-flow, while the overall investigation branches through a dynamic claim-derived support map:

```text
TEST → AUTOMATIC CAPTURE → PHYSICAL OBSERVATION → STRUCTURED FEEDBACK
     → EVIDENCE UPDATE → CONCLUSION → REPORT → NEXT TEST
```

`ABOUT` shows the question, why the test is recommended now, what MatrixSmith will do, what changes on the device, safety/consequence, expected observation time, possible outcomes, and collapsible technical details. `RUN` shows semantic progress (never raw BLE logs first). `OBSERVE` asks only what software cannot see, with structured controls — choices, yes/no/unsure, MatrixSmith-measured stopwatch durations, numbers, optional notes — and an on-screen diagram mapping raw-word diagnostic regions to panel positions. `RESULT` states what was established, rejected, and still unknown, what changed in device support, and prominently offers **Copy test report**, **Continue to next test**, and **Stop testing for now** (stopping saves the investigation locally for resume).

Failures are evidence: "the raster rendered, then moved after a measured 3.2 s" is a PARTIAL result that verifies the initial render, rejects playback stability, and advances the investigation — never a bare "Test failed".

## Reporting is part of the flow

Every test result offers a scoped **test report**; every investigation offers the **investigation report** (sufficient for an AI to implement or fix a driver without the chat history), plus the forensic full report and the canonical JSON bundle. The active investigation supplies the report question automatically.

---

# Hardened guided UX (2026-08-31, phase 2)

**Navigation**: primary navigation (desktop sidebar and mobile bottom nav) is Create +
Investigate only. The protocol workbench lives under a "Developer tools" sidebar group
and an "Open protocol workbench" action inside Investigate's Developer tools
disclosure. Every guided workflow and every report completes without opening it.

**Investigate surface**: the default page answers, top to bottom — the CURRENT GOAL
(heading), WHAT WE KNOW (compact verified/ruled-out/open summary plus the static-image
strategy state), the ONE recommended next test, the LAST TEST result with Copy report,
and the report actions. "All guided tests", "Technical support map", "Previous tests",
and "Developer tools" (read-only diagnostics, the legacy validations labeled as
superseded, and workbench access) are collapsed secondary sections.

**The static timing test** speaks user language ("Measure how long a static image
stays still", "Full image is visible now", "Movement started", "Still completely
static at 15 seconds") and drives a two-phase measured timeline: T0 starts
automatically at the final host-accepted packet, the first tap records T1 (full image
visible; a fail button records a wrong/incomplete render), the second tap records T2
(movement) or a still-stop. Stopping before 15 s is allowed and recorded honestly as
an exact measured duration that does not verify stability. Protocol parameters
(mode/speed/stayTime bytes) appear only under Technical details.

**Transfer protection**: while a diagnostic upload runs, the dialog cannot be
dismissed and says the Bluetooth upload would continue regardless. After the transfer,
"Discard" no longer exists — the device WAS changed — the exit is "Stop observation
and save as incomplete", which records an abandoned result (operation, transactions,
partial observations, no claim conclusions) with its report still available.

**Evidence-aware runs**: the About screen's preview, region diagram, plan summary, and
recorded parameters always reflect the actual generated operation — e.g. the
color/white probe shows its extra 0xF000/0xFFFF bands only when the fourth channel is
established.

---

# Guided UX redesign (2026-08-31, phase 3)

Phase 2 made the investigation engine capable. This phase closes the gap between
what MatrixSmith knows and what it shows: the interface had been exposing the
evidence architecture more or less directly, so a screen answered "here is
everything MatrixSmith knows and can do" when the user needed "here is the one
thing to understand and do right now".

The work was done against the running application at real device sizes, not by
reading JSX. A dev-only simulated device (`src/dev/simulated-device.ts`, loaded
only under `import.meta.env.DEV` and `?sim`) makes the full guided workflow —
including transfers and physical-timing stages — drivable in a browser without
hardware. Several defects in this document were found by measuring the rendered
page rather than by reading code.

## Principles applied

Drawn from Nielsen Norman Group on progressive disclosure, the GOV.UK Design
System's "one thing per page" question pattern, and WCAG 2.2 target sizing
(2.5.8 sets a 24×24 CSS px minimum, with a spacing exception). They are used as
principles, not as platform mimicry — MatrixSmith is a responsive web app.

1. **One dominant purpose per screen.** Each screen has one primary action.
   Secondary actions look secondary; utility actions do not get full-width
   buttons because a button component exists.
2. **Progressive disclosure, two levels deep at most.** Advanced, forensic and
   historical material is reachable but never competes with the current task.
3. **Proximity and recognition over recall.** A question about a place on the
   panel is rendered beside that place, highlighted and named. The user never
   scrolls back to reconstruct what a question refers to.
4. **One thing at a time.** An eleven-zone test is a sequence, not a form.
5. **Containers must earn their boundary.** Cards are not a spacing primitive;
   spacing, alignment, type hierarchy and dividers do most of the grouping.

## The UI system

`src/style.css` defines tokens for spacing (`--s1`…`--s8`), page rhythm, a type
scale, radii, palette, and two touch targets: `--target: 44px` for primary
actions and `--target-sm: 36px` for utility controls. Both clear the 24px WCAG
minimum; the intent is that importance, not accessibility, decides which one a
control gets. Density comes from this scale rather than ad-hoc pixel values.

## Device workspace header

Inside a workspace the device is the context, so the header carries device
identity, connection state, at most one *actionable* problem, and an overflow
menu. Branding, geometry, status pills, Share report and Disconnect previously
consumed roughly a third of a 360px viewport before the user could see what to
do next; they now live on Home or in the menu.

A status is surfaced only when it blocks the user and something can be done
about it. "Ambiguous protocol" is a fact with no verb; "Protocol needs
confirmation → Identify" is the next step.

## Investigate home

Ordered: device → next action → why → compact current state → secondary
history, troubleshooting, reports and tools. The product no longer describes
itself on the page that should be describing the display. Reports follow
context — there is nothing to report on before the first test runs, so report
access is a disclosure there and becomes prominent at a result and after
stopping.

Previous work is one line by default. The device-binding question is real —
MatrixSmith cannot prove two sessions saw the same physical unit — but it is a
footnote in the details ("Device match not confirmed — this may be a different
display"), not evidence-system vocabulary on the primary screen.

## Diagnostic regions and spatial observation

Regions used to be named by the raw word that produced them, which put `0x1000`
in front of the user as the identity of a place. `src/investigation/regions.ts`
defines a driver-neutral model:

```text
DiagnosticRegion { id, shortLabel, displayLabel, description, groupId?,
                   x, y, width, height,
                   technical { rawWord?, expectedUnderHypothesis?, notes? } }
```

Questions reference a `regionId`. The UI resolves that link to highlight the
zone, label it, drive progress, and give assistive technology the
region↔question relationship. `groupId` lets one question mean several places
("the four sections", "the joins").

Unknown probes are deliberately not given colour names. "Zone 6 · Extra channel
A" is honest; calling it "white" would put an assumption in front of the person
whose observation is the entire point of the test. Raw words stay in
`technical` — available on demand in the UI, exact in reports.

The guided dialog picks its presentation from what a test declares rather than
from a hand-set flag, so a test cannot drift out of sync with its own content:

| Declares | Presentation |
| --- | --- |
| a measured timeline | `TimedObservation`, then staged follow-up questions |
| questions naming a region | `SpatialObservation` |
| neither | `SimpleObservation` |

`SpatialObservation` asks one zone at a time with the map pinned beside the
question (stacked on mobile, side by side from 48rem). Answering a choice
advances automatically; Previous/Continue and zone tapping allow free movement,
and answers persist across navigation. Zone state never depends on colour
alone — the chip glyph (`▶` active, `✓` answered) and outline weight both
change, and the active zone carries `aria-current`.

The map shows only the zones the current question is about: a grouped region
brings its group, an ungrouped set shows all its zones so the numbering stays
orienting, and a question with no region shows the pattern plain.

## Human-timed physical observation

The previous timing flow assumed the user would tap perfectly while watching a
separate physical display, and treated one irreversible press as ground truth.
That assumption is wrong, and it was reported as a real product bug: people
miss the moment.

`src/investigation/timing.ts` models timing as **repeatable human observation**:

- **T0** — final host-accepted write. Automatic, precise within the
  browser/transport measurement model.
- **T1 / T2** — a person watching a panel and tapping a phone. Exact timestamps
  are retained for forensic output, but nothing presents them as instrument
  measurements. Reports say `~3.2 s` and label the provenance; `3.237 seconds`
  would overstate what was measured.

A run holds a sequence of **attempts**, each recording its number, the exact
parameter set, T0, its marks, validity and invalidation reason. Only a `valid`
attempt may establish a timing-dependent claim.

- **"I missed it"** invalidates the measurement and discards everything the
  attempt wrote. This is the load-bearing rule: a missed movement mark must
  never read as "movement did not occur", and a missed T1 must never read as
  "the image was never correct".
- **Undo** is offered only while the next physical event has not happened yet.
  After the fact, undoing could not recover the original moment, so the UI
  offers a retry instead of manufacturing precision.
- **Retry** re-sends the identical experiment — same content, same parameters —
  as a new attempt. A retry repeats a measurement; a variant changes a
  controlled variable. Reports preserve that distinction.
- Persistent retransmission always needs an intentional tap. The retry
  confirmation is a sentence, not the full pre-transfer warning, because it is
  the same already-understood test. There is no automatic retry loop.

A **readiness step** precedes transmission so the user is already looking at the
panel when timing starts, and an optional vibration cue at T0 is
feature-detected and silent on failure — the observation never depends on it.
The expected image, the timer and the event buttons stay in one viewport.

Aggregation across attempts is a range and a median. Two or three human
observations do not justify more, and pretending otherwise would reintroduce
the false precision this model exists to avoid.

## Create

Four creator panels rendered at once, so a phone showed four sets of controls,
four previews and four Send buttons for one task. Selecting the content type
first leaves one set of controls, the preview they affect, and one primary
Send. A locked type explains itself where it was selected and offers the single
test that unlocks it.

## Responsive

Mobile is the design target; desktop is designed rather than stretched. From
48rem, observation becomes master/detail (visual left, question right). From
60rem, Investigate and Create become two-column with secondary sections
spanning. Verified at 360×780, 390×844, 768×1024 and 1440×900.

## Defects found by visual inspection

Each of these was invisible in the source and obvious in the rendered page:

- Grid children default to `min-width: auto`, so the 320px zone map pushed the
  guided dialog wider than the phone. The dialog, body and observation grids
  now use `minmax(0, 1fr)` and the map canvas fills its container, so the
  percentage-positioned overlay lines up exactly.
- The dialog close control was 21×26 CSS px and sat 9px past the right edge of
  a 360px viewport, because the title block would not shrink.
- Choice answers had no active state at all — only yes/no/unsure were styled —
  so a selected colour looked unselected.
- The orientation raster previewed as solid black, because the region diagram
  painted only regions carrying a raw word. Diagnostics now declare their own
  preview.
- The superseded `.secondary-section` rule was still wrapping every disclosure
  in its own rounded container underneath the new divider treatment.
- The colour test asked about high-nibble zones that only exist when those
  bands are actually sent, so the store now drops questions whose zone is not
  part of the run being observed.

---

# Investigation orchestration (2026-09-01, phase 4)

The first real hardware session exposed a problem the UX work could not fix.
The user experienced what felt like an endless static-image test and could not
tell whether MatrixSmith was retrying a missed observation, running a
controlled variant, repeating a finished test, or stuck in its own
recommendation logic. The exported report could not answer that either: 35
transactions, one Graffiti payload sent 21 times, "Observations: None
recorded", and a closing suggestion from a superseded engine.

Crucially, **some of those repeats were legitimate** — the user deliberately
asked to measure again after missing a timing event. The defect was never that
the bytes repeated. It was that nothing in the system could say why.

## The semantic execution model

Protocol transactions are the wrong unit for guided work. On the wire, a
legitimate retry and an accidental resend are identical.

```text
Investigation
  CorePlan                 — bounded, numbered milestones
    ExperimentRun          — one experiment: definition + parameters
      ObservationAttempt   — one human attempt at observing it
        TransferRecord     — one transmission, with a reason
```

`src/investigation/orchestration.ts` defines these. Nothing duplicates protocol
transactions; records link to them by id.

**Experiment vs attempt is absolute.** Three attempts at Test 2 leave the user
on Test 2. Retries increment `Attempt N` and never advance plan progress.

**Retry vs controlled variant** are different things. A retry repeats the same
experiment because a human measurement failed; a variant changes one
scientifically meaningful value (`stayTime=3` → `stayTime=0`) and is a
different experiment with a different identity. Reports preserve the
distinction.

## Transfer reasons and the duplicate guard

Every guided transmission names a reason from a closed set:
`initial-experiment`, `explicit-retry-missed-observation`,
`explicit-measure-again`, `confirmation-run`, `controlled-variant`,
`explicit-reopen`. There is deliberately no generic "send again" — an
unexplained resend is a type error, not a silent side effect on someone's
display.

A `DiagnosticExecutionFingerprint` identifies one concrete execution: device
binding, test, diagnostic, resolved parameters, raster strategy, with the
program CRC carried as corroborating evidence rather than as identity. CRC
alone is not identity — the same bytes can be a different experiment, and the
same experiment can be a legitimate repeat.

The guard blocks a transmission whose reason **asserts novelty** for a
diagnostic already showing on the panel. Repeat reasons pass, because
repeating is what they mean. Timing retries are therefore fully supported.

## The anti-loop fix

The loop had a specific cause. A `partial` timing result left its target claim
unresolved, so the identical experiment kept scoring as the best next move —
forever. Only `passed` tests were excluded from the rotation.

A **concluded** experiment — anything except `abandoned` — now leaves the
automatic rotation. Re-running it would produce the identical non-answer.
Reopening is an explicit act that records why. `continueToNextTest` refuses to
launch a concluded experiment even if the engine offers one, and a
recommendation-sequence guard watches for a test recurring with no new
evidence in between.

## Two claim-status corrections

Both surfaced while simulating the branches, and both were the same mistake:
recording *incomplete* as *contradicted*.

`unresolved` outranks `verified` in claim resolution — deliberately, so a
contradiction cannot be papered over. But baseline movement at `stayTime=3` is
not a contradiction; it means one justified configuration moved and the other
is untested. Recording it as contradicted made the `stayTime` discriminator
structurally unable to settle the question it exists to settle. The same
applied to a static hold that stopped short of the 15s threshold. Both now
leave the claim **undecided**; only exhausting both configurations rejects it.

Separately, tiling and orientation were recorded only when *wrong*, so one "I
saw seams" answer stuck permanently — a later clean observation had nothing to
say. Both are now recorded symmetrically.

## The bounded core plan

A driver contributes a plan for a profile (`driver.corePlan`). Milestones are
numbered **slots**, not a script: a slot is satisfied by trusted evidence
(verified *or* conclusively rejected — "this path does not work" is an answer),
or skipped when the branch taken makes it unnecessary. Skipped slots keep their
place in the list and leave the denominator, so progress never moves backwards.

The iLedHat plan:

1. Still image baseline — does an image appear at all
2. Does it stay still — including the one justified alternative setting
3. Black / off behavior — skipped if the native path is ruled out
4. Color channel mapping — required before any image or text is trustworthy
5. Fallback still image — skipped once the native path is proven
6. Support decision

White calibration, GIF, persistence and power-cycle recovery are deliberately
**not** core. A user should not have to finish reverse-engineering a display
before MatrixSmith will say whether it can show a picture.

Recommendations follow plan order (a large boost for the current milestone)
rather than raw score, so progress reads as a sequence. `stepForTest` resolves
to the milestone a test is currently *serving*, not the first that mentions it
— the baseline run answers two milestones, and labelling it by the first told
users they were on Test 1 when the plan had moved past it.

## What the UI says

The test dialog leads with `Test 2 of 6` and, when repeating, `Attempt 2` — in
the header, not in technical details. Investigate home carries a compact
progress strip with the milestone list including skips and their reasons. When
core work finishes, the product says **Core characterization complete**, states
the support decision, and offers Finish; optional characterization is a
deliberate choice rather than an automatic next test.

`experimentRunId`, execution fingerprints and transfer reasons never appear on
the guided path. They live in Developer tools → Guided orchestration, because
from the outside a retry and a loop look identical.

## Report routing

Share now defaults to the **investigation report** whenever an investigation is
active; forensic and low-level views are selectable. The low-level device
report predates the atomic-claim model, so during an investigation it states
in-band that its support table and suggestions do not reflect what the
investigation established — the two views can no longer quietly contradict each
other.

The investigation report gains: core plan progress with skipped milestones and
why, experiments grouped with numbered attempts and transfer reasons, invalid
attempts shown as *excluded* rather than omitted, a transfer summary
classifying repeated payloads, and the current engine's next step.

Repeated identical payloads are **explained, not flagged**. A duplicate is only
called a workflow problem when its stated reason claims novelty the bytes
contradict.

## Testing

`tests/investigation/session-regression.test.ts` reconstructs the real
retry-heavy session: repeated identical payloads, a genuine controlled
variant, multiple observations, valid completion. It asserts the retries stay
one numbered experiment, are not reported as a workflow problem, and survive
into the report with their reasons.

`tests/investigation/core-finishability.test.ts` walks all four outcome
branches, asserting each reaches a support decision within seven distinct
experiments and never repeats one. Retries are not counted — a human missing a
timing event says nothing about whether the plan converges.

Transmission-count assertions cover the hard invariant: one spatial test sends
once, and navigating between eleven zone questions or editing answers causes
zero BLE writes.
