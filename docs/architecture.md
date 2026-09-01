# MatrixSmith architecture

## Dependency direction

```text
Preact UI (Home / Control / Diagnose / Develop / Report)
  -> MatrixStore (immutable AppSnapshot + subscription)
    -> MatrixController + MatrixSession
    -> semantic MatrixOperation
      -> statically registered MatrixDriver + DeviceProfile
        -> immutable TransmissionPlan + serializable response expectation
          -> SafetyPolicy
            -> AuthorizedTransmission
              -> TransmissionExecutor + pre-write NotificationRouter waiter
                -> MatrixTransport
                  -> Web Bluetooth / Fake / Replay

Scene / Framebuffer / FrameSequence
  -> logical RGB888 rendering
    -> driver-specific quantization and packing
      -> TransmissionPlan
```

The UI never calls a characteristic write. A driver plans bytes but cannot access a browser device. The executor accepts only an authorized plan, sends its existing packet objects in order, and does not re-encode after approval.

## Responsibilities

- `src/core`: serializable fingerprints and profiles, evidence/validation, capabilities, risk, operations, and transmission artifacts.
- `src/discovery`: generic advertisement parsing and fact extraction. Hypotheses stay out of the parser.
- `src/transport`: browser/runtime I/O. `WebBluetoothTransport` knows chooser semantics, connections, endpoints, reads, notifications, writes, and host receipts; it contains no FFF0, opcode, or geometry constants.
- `src/drivers`: one central built-in list and independent family implementations. Drivers own matching, endpoints/probes, planning, notification decoding, and response matching.
- `src/drivers/coolled/common`: only shared FFF0/FFF1, envelope, conservative advertisement parsing, and static transport-shape matching.
- `src/drivers/coolledx`: older/simple commands and content codec; it no longer owns the iLedHat profile.
- `src/drivers/coolledux`: newer/advanced direct-command subset, the safe `0x1F` probe, and the stored-program compiler (`wire.ts` CRC32/LZSS/announce/chunks, `pixels.ts` RGB444 encodings and off sentinels, `content.ts` tiling and Graffiti/Animation/GIF/border program builders). Content plans are multi-packet, carry per-packet pacing metadata (`delayAfterMs`), and declare persistent risk honestly; the executor owns inter-packet timing, never the codec.
- `src/profiles`: physical products independent of driver directory layout.
- `src/app`: session lifecycle, central policy, exact-plan authorization, execution, and application orchestration.
- `src/diagnostics`: typed trace, serializable protocol transactions and diagnostic workflow runs, versioned portable bundle serialization (v2 with v1 migration), the deterministic Markdown report generator, the support-state matrix (`support.ts`), structured hardware-validation workflows (`validation.ts`), content-compilation evidence records (`content-evidence.ts`), and the implemented nRF Connect text-log importer (`importers.ts`).
- `src/render`: arbitrary positive dimensions in row-major RGB888; hardware wire order is driver-owned. Includes the embedded 5×7 bitmap font/rasterizer (`font.ts`), browser-side image fit/decoding (`image.ts`), and deterministic diagnostic patterns (`patterns.ts`).
- `src/storage`: small key/value abstraction, structured preset records, and small-JSON content settings (`settings.ts`); binary media never enters localStorage.
- `src/ui`: Preact pages/views/components plus `MatrixStore`, which turns controller/session/trace state into an immutable `AppSnapshot` consumed via `useSyncExternalStore`. Components invoke semantic store/controller operations only; domain and protocol logic never lives in components.
- `src/main.tsx`: composition root wiring transport, trace, controller, store, and the Preact render.

## Runtime versus portable evidence

`DeviceFingerprint` separates requested discovery filters, browser-granted/accessible services, enumerated GATT, and genuinely observed/imported advertisement services. A request filter is never promoted to advertisement evidence. Runtime Bluetooth objects remain private to transport.

`MatrixSession` retains every raw notification, its optional rich decoded object, and protocol-resolution evidence. Trace metadata stays scalar. Imported bundles can replay captured resolution while policy blocks TX.

## Driver versus profile

A driver is a protocol-family implementation such as CoolLEDX or CoolLEDUX. A profile is reviewed physical-product knowledge. Static FFF0/F1 can leave generations tied; a safe semantic probe can add exact session evidence without mutating either static matcher.

## Transmission boundary

Every write starts as a semantic operation. The plan carries identity, purpose, explicit live intent, risk, validation, exact packets, and a serializable notification expectation. The response waiter is armed before BLE write so fast replies are not lost. Host acceptance, matching response, and state verification remain distinct.

See [ADR 0001](adr/0001-driver-oriented-architecture.md).

## Investigation and claims layer (2026-08-31 revision)

```text
src/investigation/
  claims.ts           — atomic claim taxonomy, scoped evidence, deterministic resolution
  observations.ts     — structured observation model (boolean/choice/duration/number/note)
  investigation.ts    — first-class Investigation object (goal, tests, evidence, stop/resume)
  tests.ts            — driver-contributed GuidedTestDefinition contract + availability
  recommendations.ts  — deterministic, inspectable next-test ranking
  gating.ts           — path-specific content gates derived from operational trust
  static-viability.ts — derived static-strategy viability (shared by gating, session strategy, recommendations, reports)
  session-behavior.ts — session-resolved behavior beside immutable profile quirks
  device-identity.ts  — physical device/session identity binding for investigations
  reports.ts          — test / investigation / forensic report generators
  legacy-bridge.ts    — legacy validation areas → atomic claim evidence (scope decided by the controller)
```

**Atomic claims** replace the coarse support model. Each claim (`graffiti.black-semantics`, `animation.autonomous-loop`, `power-cycle.persistence`, …) resolves from scoped evidence — `source-reference`, `built-in-profile`, `current-session`, `previous-local-session`, `imported-external` — with higher-authority scope winning and, within a scope, rejection outranking verification. Session observations never rewrite built-in profile facts; one passing sub-question cannot verify a broad parent; a rejected prerequisite blocks a "verified" presentation; autonomous looping is a different claim from power-cycle persistence.

**Drivers contribute** composable providers instead of UI special cases: `capabilities`, `probes`, `guidedTests(profile)`, `claimEvidence(profile)`, diagnostic content builders, and outcome interpreters. The recommendation engine, guided-test dialog, support map, and reports all render generically from those declarations — adding a test or driver edits no view or recommendation conditionals.

**Raster strategy**: `ShowFrame`/`ShowText` route through the session's validated `RasterStrategy` (`graffiti`, `animation-single-frame`, `animation-identical-frames`) rather than hardcoding one content opcode. Built-in profile quirks (`src/core/quirks.ts`) are immutable structured facts with honest unknowns (Graffiti black unknown, white channel unknown, `colorModeRaw=3` unexplained); session evidence selects the current strategy without mutating them.

**Timing and receipts**: the executor records real per-packet write and host-acceptance timestamps plus measured TX gaps (`PacketTiming`); transactions carry them, and `diagnostics/upload-analysis.ts` structurally correlates announce/chunk receipt notifications with transmitted chunks — raw status bytes verbatim, missing receipts reported as observations (never failures, never retries), matching upstream evidence that these notifications are not reliable acknowledgements.

**Local history** (`src/storage/investigations.ts`) persists whitelisted investigation state only; on resume, session evidence is demoted to `previous-local-session` scope so history never bypasses current-session safety gates.

## Hardening revision (2026-08-31, phase 2)

**Device-bound investigations** (`device-identity.ts`): an `Investigation` carries an
`InvestigationDeviceBinding` (browser device id when available, profile id, and a
deterministic fingerprint-shape key that is never treated as a MAC or unique hardware
identity). Only a matching browser-authorized device id proves the SAME physical unit.
Connecting anything else detaches the active investigation — its evidence is
structurally demoted to `previous-local-session` and persisted to local history — so
current-session evidence can never cross physical displays. Reconnecting the same
authorized device resumes the investigation with its evidence intact (intentional and
tested). Troubleshooting retargets a goal only within the same device session.

**Trust boundaries**: loading an investigation from browser-local history demotes EVERY
claim-evidence entry to `previous-local-session` regardless of its serialized scope
field; bundle import demotes to `imported-external`. Serialized scopes are never
trusted, so a poisoned local record claiming `built-in-profile` or `current-session`
authority has none. Legacy validation evidence gets its scope from controller-side
trust state (live on the current device session → `current-session`; device change →
`previous-local-session`; bundle import → `imported-external`), never from serialized
data.

**Operational trust vs investigative state** (`claims.ts`): `resolveClaims` keeps
describing what ALL evidence says, including historical contradictions.
`operationalTrust` answers the narrower authorization question — does this claim hold a
currently trusted verified basis (`current-session` or `built-in-profile` only)?
Historical/imported evidence surfaces conflicts, boosts revalidation recommendations,
and appears in reports, but can neither unlock an operation nor silently erase a
shipped trust basis. A current-session rejection still revokes a built-in basis.

**Derived static viability** (`static-viability.ts`): `static.strategy` is a DERIVED
claim — no direct evidence ever decides it. One evaluator derives per-strategy
viability from atomic requirements (upload, tiling, orientation, initial render, a
MEASURED ≥15 s visibly-static hold from T1, characterized black semantics, the raw
channel map, and encoder correctness) and powers content gating, the session raster
strategy, the recommendation engine's pursued-strategy walk, and the report's strategy
assessment. `pixel.channel-map` (raw wire behavior characterized) is distinct from
`pixel.encoder-correctness` (MatrixSmith's logical RGB reaches the intended channels):
a characterized permutation keeps normal rendering gated until the encoder is corrected
in code and re-verified. `pixel.fourth-channel` (any emitter exists) is distinct from
`pixel.white-channel` (that emitter appears white). Single-frame and identical-pair
Animation rasters carry separate claims.

**T0/T1/T2 physical timing**: guided static tests record T0 (final host-accepted
program write, automatic), T1 (full raster visible, measured tap), and T2 (movement
begins or observation ends, measured tap) through a small multi-phase timeline in the
observation model. Render latency = T1−T0; visible static hold = T2−T1. User estimates
never verify a claim; an early stop records the exact duration as unresolved. Reports
separate this human-observed display timeline from per-packet transport timing.

**Evidence-aware operations**: `GuidedTestDefinition.buildOperation(context)` derives a
test's exact fixed diagnostic operation from established evidence (e.g. the color/white
probe includes raw 0xF000/0xFFFF bands only when `pixel.fourth-channel` is trusted).
The plan, preview, region diagram, recorded parameters, and reports all use the
resolved operation. `validate(values)` adds per-test cross-field coherence checks, and
the controller validates every observation submission in the domain layer.

**Session-resolved behavior** (`session-behavior.ts`): trusted current-session evidence
with structured details (e.g. `zeroBehavior: "true-black"`) activates explicit runtime
behavior (Graffiti literal 0x0000) through `DriverContext.resolvedBehavior` — never by
mutating profile quirks and never from speculative, historical, or imported evidence.
An observed channel permutation is informational only; encoder corrections happen in
reviewed code.

**Applicability**: the iLedHat characterization suite (`ILEDHAT_GUIDED_TESTS`) applies
only to the iLedHat profile; other CoolLEDUX profiles receive only the generic suite.

## Content processing and transfer lifecycle

Imported images are decoded locally into an in-memory `DecodedImageSource`, then pass through explicit composition, conservative content analysis, and one of three pure reducers. Artwork uses a chroma-protected OKLab semantic palette, hard region rasterization, and bounded grid-phase search; photos use linear-light area reduction plus mild destination-scale edge enhancement; pixel art uses nearest-neighbor. RGB444 mapping happens once at the device boundary. Auto takes a semantic route only at high confidence; uncertain input uses Photo-safe processing. The Canvas reducer remains as Legacy / Smooth. Preview and send share the exact `ProcessedImage.frame`; raw bytes are never persisted.

Create owns the semantic Auto / Still / Scroll text decision. Still text uses the selected static strategy. Scroll currently uses one shared `ScrollPlan` for animated preview and bounded raster Animation transmission. The source-derived guardrail is 48 frames and 16 KiB decoded bytes per 8×16 tile; it is not an iLedHat firmware-limit claim. The pinned source does not define native CoolLEDUX Text segments well enough for safe transmission, so that backend remains a documented hardware-validation deferral rather than a guessed packet format.

The executor emits progress only after actual host-accepted writes. Create holds a best-effort Screen Wake Lock for active persistent sends, reacquires after visibility restoration, and releases it on completion or failure. Completion copy keeps host writes, protocol acknowledgement, device-state verification, and physical observation separate.
