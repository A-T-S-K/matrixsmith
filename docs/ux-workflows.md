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

**Control** is the normal-user surface. It renders verified live capabilities plus focused creators. Text exposes Auto / Still / Scroll directly, previews the same bounded raster scroll plan that is compiled, and shows its frame/decoded-byte budget. Image exposes conservative Auto routing plus Artwork, Photo, Pixel Art, explicit composition, opt-in optical widening, exact logical/simulated-LED/apparent-size previews, and Legacy / Smooth under Advanced. Animation is reserved for authored multi-frame content and diagnostics rather than hiding normal marquee text. Everything processes locally and raw imported bytes are not persisted. Each persistent send shows exact consequences, actual packet progress, and honest host-versus-firmware completion semantics; Screen Wake Lock is best effort. Control never shows driver scores, raw GATT, or packet hex.

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
  orchestration            — bound to ONE physical display (see phase 5)
    CorePlan               — bounded, numbered milestones
      ExperimentRun        — one experiment: definition + parameters
        ExperimentAttempt  — one attempt at running and observing it
          TransferRecord   — one transmission, with a reason
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

A **concluded** experiment — anything except `abandoned` — leaves the automatic
rotation. Re-running it would produce the identical non-answer. Reopening is an
explicit act that records why. `continueToNextTest` refuses to launch a
concluded experiment even if the engine offers one, and a
recommendation-sequence guard watches for a test recurring with no new evidence
in between.

> Superseded by phase 5. "Anything except abandoned" was too coarse: it
> retired experiments whose measurement simply ran out of time. See
> *Experiment resolution* below.

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
place in the list **and their number**, so progress never moves backwards.

> Phase 5 correction: skipped slots originally left the denominator, which
> turned "Test 6 of 6" into "Test 5 of 5" mid-investigation. See *Stable
> numbering* below.

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

---

# Orchestration lifecycle (2026-09-01, phase 5)

Phase 4 built the right model and put it in the wrong place. An independent
review of the pushed code found the semantic state — experiments, transfers,
the active-diagnostic identity, reopen state, the recommendation trail —
living on `MatrixController` rather than on the Investigation whose evidence it
explains. Everything below follows from fixing that, plus the lifecycle holes
the same review found around it.

## Ownership: orchestration belongs to the investigation

The device boundary already detached and demoted an Investigation when a
different physical display connected. The orchestration collections were not
part of that boundary, so they survived it — one panel's execution history
could speak for another's.

`Investigation.orchestration` now holds all of it:

```ts
Investigation {
  …
  orchestration: {
    experiments          // ExperimentRun[]
    transfers            // TransferRecord[]
    panelProgram         // what is believed to be on the display
    reopened             // deliberate reopens, with reasons
    recommendationTrail  // what the user was actually sent to do
    cycleVerdict
  }
}
```

**The invariant:** no guided orchestration evidence outlives or crosses the
physical-device boundary independently of its Investigation.

| Event | Orchestration | Panel certainty |
| --- | --- | --- |
| Same authorized device reconnects | continues | **unknown** — the link dropped |
| Different physical device connects | detaches with its investigation; the new one starts empty | unknown |
| New investigation on the same device | previous keeps its own; new one starts empty | unknown |
| Stored record resumed on the same device | continues | unknown |
| Stored record resumed on a *different* device | **reset**; evidence resumes as history | unknown |
| Imported bundle | kept as external history | unknown |
| Browser restart | restored as history | unknown |
| Forget local history | removed with the investigation | unknown |

The resume case is the one that is easy to miss. `adoptInvestigation` rebinds
to the current display; without the reset, resuming unit A's record on unit B
would let B continue A's experiment runs and attempt numbering as its own. The
resume panel states which case it is before the user commits.

## Physical device identity

`DiagnosticExecutionFingerprint.deviceBindingId` was populated from
`profileId`. A profile is a **model**. Two units of the same model therefore
shared one execution identity, and each could be told its diagnostic was
already showing because the other had received it.

The fingerprint now carries three separate things:

- `physicalDeviceKey` — the browser-authorized device id, or `null`
- `deviceIdentityBasis` — `browser-authorized-device` | `fingerprint-shape` |
  `unidentified`
- `profileId` — recorded for reports, never used as identity

When the display cannot be strongly identified the fingerprint says so rather
than inventing a stable id. A fingerprint shape identifies a *kind* of display
and is labelled as exactly that. The duplicate guard never assumes same
profile means same physical unit.

## Panel program identity

`activeExecution` only moved when `runGuidedTestTransfer` succeeded. Every
other persistent write — Create → Send Image, Send Text, Send Animation, Send
GIF, legacy validation — replaced the stored program without telling it, so the
guard stayed convinced a diagnostic was showing and refused a legitimate
re-run as a duplicate.

A stored-program display holds exactly one program. `PanelProgramState` is now
settled in `#execute`, the single path every persistent write goes through:

- `known-active` — this exact program was written and accepted
- `known-replaced` — something else was written since
- `unknown` — the panel's contents cannot be established from this session

Certainty drops to `unknown` on a failed or partial write, a device change, an
import, a reconnect, and on restore from storage. The guard asks *"is THIS
diagnostic presumed active right now?"* — not *"were these bytes ever sent?"*.

## Experiment resolution

Status describes the hardware. Resolution describes the **experiment**:

| Resolution | Meaning | Behaviour |
| --- | --- | --- |
| `settled` | the question was answered, positively or negatively | leaves automatic rotation; rerun needs an explicit reopen |
| `retryable-incomplete` | not enough usable observation | leaves automatic rotation but is offered as *Measure again*, at the same number |
| `invalid` | measurement or transfer failed | no claim conclusion; retry allowed |
| `abandoned` | the user stopped observing | transmission evidence kept, no hardware conclusions |

The case that forced this: stability verification requires a measured 15s hold.
A user who stops at 7 seconds has not verified stability, has not disproved it,
and has not concluded anything. Phase 4 called that `inconclusive` and retired
the only test that could settle the question, then reported "No further test is
recommended". It is now `retryable-incomplete`: the milestone stays current,
the result screen leads with **Measure again**, and the plan resumes when a
sufficient measurement lands. `continueToNextTest` will not advance past a
milestone waiting on one — moving to a controlled variant of a baseline nobody
actually observed would read as though the short measurement had counted.

## Attempts: one authoritative identity

`ExperimentAttempt` is the attempt. Timing detail nests under it as
`attempt.timing` and borrows its number; there is no second numbered list to
drift from it. Numbers are monotonic within their experiment and never
recycled.

A transfer that throws now **settles its attempt** — previously it left one
in progress forever. The transfer is recorded with its failure reason and any
transactions that did land, so a report can say the display may have been
partly written, and `attemptFailureKind` keeps a radio failure distinct from a
mistimed human tap:

```text
Attempt 1  INVALID  transfer-failed        (no hardware conclusion)
Attempt 2  INVALID  human-missed
Attempt 3  VALID    ~3.2 s hold
```

An experiment left `retryable-incomplete` is **continued** by a measure-again
rather than replaced, so its attempts keep counting up instead of producing a
pile of near-identical runs.

## Stable numbering

`total` is every slot in the plan and never changes during an investigation.
A skipped milestone keeps its ordinal and is shown as skipped at it.
`displayPosition` returns the slot's own `ordinal`, never a running count.

```text
1 ✓ Still image baseline
2 ✓ Does it stay still?
3 – Black behavior — skipped, not needed: …
4 → Color mapping
5 ○ Fallback still image
6 ○ Support decision            ← still 6, not 5
```

Completion is `resolved === total` where `resolved = completed + skipped`. The
UI reports `"3 of 6 done · 2 complete, 1 skipped"`: the split is stated
separately rather than deducted from the denominator.

## Cycle guard

The guard exists to catch the **engine** looping, not a person choosing to
measure something again. Trail entries carry an origin
(`automatic-recommendation` | `explicit-retry` | `explicit-reopen`) and only
automatic entries are examined. A user repeating an incomplete measurement is
the workflow working; the engine proposing a settled test again with nothing
learned in between still trips it.

## Persistence

Local storage is at **schema v2**. It persists experiment runs, attempts (valid
and invalid), transfer records and reasons, fingerprints, transaction id
references, reopen state and the recommendation trail. v1 records still load;
missing structure becomes empty structure, and structurally invalid entries are
dropped without taking the rest with them.

Nothing operational survives. Restored orchestration is historical metadata:
the panel-program belief is **always** reloaded as `unknown`, whatever the
record claims, so a saved file cannot suppress a legitimate transmission by
asserting a diagnostic is live. Safety bypasses, persistent-send confirmation
tokens, experimental TX unlocks and raw content are never written at all.

Reports follow the same rule. A persisted report says *"Last known program
sent: …"* and *"Currently on the display: UNKNOWN"*; only a live session that
made the write says otherwise.

## Ownership boundary: ExperimentRun vs CompletedGuidedTest

Both exist and neither is redundant.

- **`ExperimentRun` owns execution.** Attempt identity and numbering, transfer
  linkage, execution fingerprint, resolution. It is the source of truth for
  *what was run and how many times*.
- **`CompletedGuidedTest` owns the claim record.** One submitted result: its
  observations, interpretation, claim evidence and the timing attempts behind
  it. It is the source of truth for *what was concluded*.

One run can produce more than one completed test (a measure-again after an
incomplete result). A completed test always belongs to exactly one run. The
run's `resolution` and the completed test's `resolution` are the same value —
`settleExperiment` is called with `completedTestResolution(result)` — so the
two can never disagree about whether the plan may move on.

## Testing

- `orchestration-lifecycle` — device boundary, execution identity, panel
  program across every persistent write, attempt lifecycle and failure
- `experiment-resolution` — sub-15s retryability, settled rotation, cycle-guard
  origins, controlled-variant identity
- `orchestration-persistence` — round-trip, invalid-attempt survival, v1
  migration, corrupt-entry rejection, panel certainty never restored
- `core-numbering` — stable denominator and ordinals
- `resume-and-reset` — the full restart story plus all six reset boundaries
- `core-finishability` — PATH E (a short measurement offers measure-again, does
  not advance, and the valid retry finishes the plan) and a denominator
  invariant on every branch

The dev simulator supports `?sim` and `?sim=b` — two units sharing profile,
name and GATT shape, differing only in browser authorization id — plus a
one-shot write failure, so both device isolation and the transfer-failure path
can be driven by hand.

---

# Productionizing a characterized profile (2026-09-01, phase 6)

Phases 4 and 5 built the machinery for characterizing an unknown display. This
one is about what happens *after* a display has been characterized: the
iLedHat had been measured end to end, and a fresh session still opened with
"Protocol needs confirmation → Identify", still compiled every image through a
route that was known not to hold a still image, and still asked the user to
re-derive facts already in the profile.

## The story the product now supports

Connect a known iLedHat. MatrixSmith recognizes CoolLEDUX and the 32×16
profile, opens the Device Workspace on Create, and lets the user send an image,
text or an animation. No probe, no Investigation, no guided characterization.

Ready means **characterized**, not **permitted**: every persistent send still
stops for an explicit confirmation of its exact consequence, because it still
replaces what is on someone's display. GIF and power stay gated — neither has
ever been demonstrated on this panel.

## What the profile now ships

Facts, not guesses. The full physical record is in
`research/protocol-findings.md`; the product-relevant shape is:

- Graffiti static playback **rejected** — both justified configurations move
  (~3.6 s at stayTime=3, ~1.0 s at stayTime=0), and there is no third one.
- Graffiti literal `0x0000` is **true black** here; `0x0004` is a visibly dim
  blue, so the inherited upstream workaround does not apply to this profile.
- Both Animation static variants **verified** with measured holds (16.8 s and
  16.2 s), which is what lets the viability evaluator accept them past its 15 s
  threshold. Preferred strategy: `animation-single-frame`.
- RGB444 channel map and encoder correctness **verified**; fourth channel and
  white channel **rejected**.
- Colour calibration **unresolved** — white looks tinted, and that is a
  calibration question, not a reason to invent a different encoding.

`static.strategy` stays DERIVED. There is no fabricated "verified" record to
open a gate: the evaluator reads the atomic facts above and concludes
`animation-single-frame`, with Graffiti not-viable.

`image.rendering` and `text.rendering` stay **unknown**, deliberately. Their
gates open because the substrate they depend on is trusted, but *allowed
through verified prerequisites* is not the same statement as *physically
smoke-tested*, and the profile does not claim the latter until someone has
looked at a normal image on the panel. The optional "Check a normal image end
to end" test exists to close exactly that gap.

## Recognizing a known display without probing it

CoolLEDX and CoolLEDUX share FFF0/FFF1, so shape alone never decides the
family — for an unknown display the active `0x1F` probe is still the
discriminator, and nothing about that changed.

A known-profile **signature** (`src/profiles/known-profiles.ts`) records what
the profile itself establishes: the exact name, GATT shape and characteristic
properties that identify it, the manufacturer id and geometry that corroborate
it, the driver its evidence assigns, and the drivers its evidence ruled out
*with the physical reason*. Both matchers consult it generically — neither
driver contains a name check — so on a recognized iLedHat CoolLEDUX resolves
exact and CoolLEDX is rejected carrying "0x08 returned 0x08 0xFE with no
visible change" into the UI.

Recognition is narrow:

| Evidence | Effect |
| --- | --- |
| Exact name + exact FFF0/FFF1 shape and properties | recognized |
| Manufacturer `0x31AE` present | corroborates |
| Manufacturer absent (common in Web Bluetooth) | neither way; still recognized |
| Manufacturer contradicts `0x31AE` | **withdraws** recognition |
| Confirmed geometry ≠ 32×16 | **withdraws** recognition |
| FFF1 properties differ | **withdraws** recognition |
| Different name | not this profile at all |

Absent evidence is not contradiction — refusing recognition because the browser
exposed no advertisement bytes would make the mechanism useless in the browser
it targets. An explicit disagreement withdraws it entirely, and the display
falls back to the conservative shared-transport treatment with the
disagreement recorded where it is visible.

## Static routing consults the profile

`compileStaticRaster` did `strategy ?? "graffiti"`. Precedence is now:

1. a strategy this session physically validated,
2. the profile's own preferred strategy, once its evidence resolved one,
3. Graffiti, the upstream default, for profiles with no preference.

Graffiti black follows the same shape: session evidence, then the profile's
observed semantics, then the conservative `0x0004` workaround. Requiring a
current-session observation to use a fact the profile already ships meant the
workaround was applied to a panel that had been measured — writing a visibly
dim blue where the user asked for black.

## Core plan ordering

The real session ran the full colour/channel test after **both** native
playback configurations had already failed: careful work characterizing the
pixels of a substrate that might not exist. The order is now

1. Still image baseline
2. Native playback discriminator
3. Native black behaviour
4. **Fallback still-image viability**
5. **Pixel / channel correctness**
6. Support decision

The fallback slot stands down in both undecided directions — "the native path
works, no fallback needed" and "the native path has not been ruled out, no
fallback needed yet" — and becomes work only once Graffiti is conclusively
non-viable. Six slots, stable ordinals, denominator never moves.

## Optional work is never automatic

Once every core slot is resolved the product says **Core characterization
complete**, offers **Finish** as the primary action, and puts *Continue
optional characterization* beside it as a deliberate choice. Colour quality,
the second fallback variant, GIF and persistence stay fully reachable; they
just stop arriving by themselves. The investigation report agrees rather than
handing over a next test in the same breath as declaring completion.

Progress wording: **"3 of 6 resolved · 2 completed, 1 skipped"**, where
resolved means completed plus skipped.

## Execution provenance

A `CompletedGuidedTest` is report evidence forever. It is **not** proof that
anything ran on the display in front of you.

Scheduling used to read `completedTests.some(testId)`, so a baseline measured
on device A both satisfied `requiresCompletedTests` and suppressed the
recommendation on device B. Results now carry `experimentRunId`, stamped by the
controller rather than the caller so the link is total, and scheduling asks
`executedTests()` — results whose run is still in this investigation's
orchestration. A resumed record on a different display has none, because
adoption resets orchestration there. Reports still see every recorded result.

Ownership stays as documented in phase 5: `ExperimentRun` owns execution,
`CompletedGuidedTest` owns the claim record, one run can produce several
results, and the controller settles the run from the same interpretation that
produced the result so the two can never disagree.

## Other lifecycle corrections

- **Cycle detection stops the workflow.** A detected automatic cycle now
  aborts before an experiment is opened and long before anything is
  transmitted. A warning read after the panel has been rewritten is not a
  guard. Explicit retries and reopens remain exempt.
- **Execution identity describes the experiment.** The fingerprint's raster
  strategy came from the session's selection, so the two-identical-frame run
  was recorded as "animation-single-frame". Diagnostics now declare the
  strategy they are a test of; the raw pixel and colour probes declare none,
  because they ride the Animation container to ask about pixels.
- **Panel timestamps.** `startedAt` and `writtenAt` are separate, and
  `writtenAt` is the final host-accepted write. Labelling transfer-start as
  "written at" reported a time the display had not been touched.
- **Disconnect invalidates certainty immediately**, so a report written while
  disconnected says "last known program sent" and "currently on the display:
  UNKNOWN".
- **Derived claims print their derivation.** The report was showing
  "static.strategy = verified — no evidence recorded" and explaining the
  derivation two sections later.
- **The report names why each test ran.** A guided workflow trail records an
  origin per run, and `manual-selection` joined the vocabulary — a test the
  user picked from the catalogue was being recorded as an automatic
  recommendation, which tells a reader the workflow made them run it.
- **One validator for Investigations.** Bundle parsing asserted an arbitrary
  object into shape while storage sanitized field by field.
  `investigation/serialization.ts` is now the single validator: malformed
  entries are dropped individually, unknown claim ids are refused, and the
  panel-program belief is always rebuilt as unknown.

## Capability presentation

Each capability now reads at the confidence its evidence supports. The static
substrate and animation path are verified and observed; text is verified by
prerequisite and corroborated, because it rides that substrate but has not been
looked at; GIF and power stay experimental. An uncharacterized CoolLEDUX
profile keeps the experimental presentation unchanged.

## Testing

- `tests/app/known-device-acceptance.test.ts` — the product test this phase
  exists for, plus its companion holding unknown-device safety unchanged.
- `tests/drivers/iledhat-static-routing.test.ts` — routed content type, frame
  count, tiling, exact CRC, session override, unresolved-profile fallback, no
  `0x0004` substitution, high nibble left clear.
- `tests/drivers/matcher.test.ts` — recognition and its five withdrawal cases.
- `tests/investigation/execution-provenance.test.ts` — run linkage and
  historical-completion isolation.
- `tests/investigation/lifecycle-correctness.test.ts` — cycle stop, execution
  identity, timestamps, disconnect, bundle validation, derived-claim rendering.
- `tests/drivers/normal-image-smoke.test.ts` — the production-path smoke test.

Several suites that exercise the guided journey now run against
`tests/helpers/uncharacterized-device.ts` rather than the shipped profile.
Against a productionized profile the core plan is complete on connect, so a
journey test would pass while walking nowhere.

The dev simulator supports `?sim` (known unit A), `?sim=b` (a different
physical unit, same profile) and `?sim=unknown` (the same transport on a
display nothing is known about), plus a one-shot write failure.
