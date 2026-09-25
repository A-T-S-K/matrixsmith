# MatrixSmith best-in-class product and architecture plan

> Historical planning/review document. The implemented architecture and current gates are documented in `architecture.md`, `testing.md`, and `releasing.md`.

Status: implemented refactor baseline; stable-domain physical checklist remains deployment-specific  
Date: 2026-09-02  
Hosting constraint: static Vite/Preact site deployable directly to Cloudflare Pages

Scope update (2026-09-04): The owner has deferred Cloudflare setup and deployment to a later task. Deployment credentials, project/domain configuration, preview publishing, and stable-domain acceptance are not blockers for the current code work. Keep the static deployment requirements intact. Physical-device and manual screen-reader results remain unverified until performed.

## Executive summary

MatrixSmith already has an unusually strong technical core for a browser hardware tool:

- semantic operations are compiled into inspectable transmission plans;
- the transport cannot invent protocol behavior;
- dangerous and firmware operations are blocked;
- raw evidence is retained beside decoded interpretations;
- protocol codecs have extensive golden and conformance coverage;
- investigation evidence distinguishes source, profile, current-session, historical, and imported scope;
- local-first behavior, CSP, and the lack of a backend reduce privacy and operational risk.

The application is nevertheless held back by the shell around that core. The current controller and store combine too many responsibilities, multiple generations of support state contradict one another, unknown devices cannot progress through the journey the product promises, BLE lifecycle events can leave stale application state, routine control has excessive confirmation friction, and accessibility behavior is incomplete.

The recommended strategy is **not** to rewrite the proven codecs, rendering algorithms, evidence resolution, or safety concepts. Preserve those modules and replace the application shell around them.

Because MatrixSmith is not live, make one clean breaking cutover:

- introduce one Bundle V3 schema;
- reset the local storage prefix;
- delete legacy validation, support, report, and migration paths;
- do not dual-write or preserve compatibility facades longer than required inside the refactor branch.

The target should remain a completely static browser application. No Cloudflare Functions, Workers, KV, D1, R2, SSR, API routes, accounts, telemetry, or runtime secrets are required.

## Product north star

MatrixSmith serves three distinct jobs. The interface should know which job is active and avoid mixing them.

### 1. Use a known display

The user wants to create content and put it on a supported display.

Target experience:

1. Connect or return to the known display.
2. Enter text or choose an image.
3. Press **Display it**.
4. See transfer progress and a concise success result.

Routine verified content should require one action, not a warning dialog plus a checkbox plus another action.

### 2. Characterize or troubleshoot a display

The user wants MatrixSmith to identify an unfamiliar device or determine why behavior is wrong.

Target experience:

1. Connect the device.
2. MatrixSmith states what it knows and what it needs next.
3. Run one bounded, available test.
4. Record the observation.
5. Finish with a clear conclusion or next step.

The product must support a provisional device target so safe protocol identification can occur before a reviewed physical-product profile exists.

### 3. Inspect protocol evidence

The user deliberately wants GATT, packets, transactions, decoders, imports, and orchestration details.

Developer tooling remains secondary. It should never be required to complete Create or guided Investigate.

## Guiding principles

1. **One source of product truth.** Raw evidence and atomic claims are authoritative. Every gate, badge, action, recommendation, and report derives from one canonical assessment.
2. **Impossible states are not representable.** Connection and guided workflows use explicit discriminated-union state machines.
3. **Pure domain, effects at the edges.** Bluetooth, storage, files, timers, clocks, IDs, wake locks, and downloads sit behind ports.
4. **Drivers describe; the application orchestrates.** No UI or generic application service branches on `coolledux` IDs.
5. **Friction follows hazard and uncertainty, not persistence.** Storing ordinary content on a known display is routine.
6. **Safety is enforced silently at execution.** Removing redundant dialogs does not weaken target binding, plan validation, or policy checks.
7. **Evidence is never silently promoted.** Historical and imported evidence can inform but cannot authorize.
8. **The static-site boundary is permanent.** Everything executes locally in the browser.

## Current strengths to preserve

The following should remain substantially intact, with only dependency-boundary adjustments:

- `src/drivers/coolledux/wire.ts`
- `src/drivers/coolledux/pixels.ts`
- `src/drivers/coolledux/content.ts`
- CoolLEDX envelope/protocol implementation
- framebuffers, frame sequences, fonts, raster scrolling, and image algorithms
- transmission plan and policy concepts
- notification decoding and raw-byte retention
- atomic claim resolution and operational trust
- static viability evaluation
- observation and timing models
- experiment, attempt, transfer, and panel-program records
- golden fixtures and byte-level conformance tests
- the low-level Web Bluetooth GATT adapter, after lifecycle hardening

## Priority findings

### P0: release and safety blockers

#### P0.1 Vulnerable production dependency

The lockfile installs Preact 10.27.2, affected by GHSA-36hm-qxxp-pg3m. Upgrade to at least 10.27.3 and keep `npm audit --omit=dev` in CI.

#### P0.2 Confirmation state can carry between different plans

`PendingSendDialog` and legacy validation keep checkbox state in components that remain mounted while returning an empty fragment. A checked acknowledgement can therefore survive canceling one plan and opening another.

Fix by removing confirmation for verified routine content. For the remaining experimental confirmation, store intent in workflow state keyed to the target-bound plan digest. Never use a component-local boolean as authorization evidence.

#### P0.3 Plans are not bound to a physical target

Authorization checks driver/profile IDs but not connection generation, fingerprint key, or browser device ID. A pending plan for one unit can remain structurally valid after connecting another unit of the same profile.

Every prepared and authorized operation must contain:

```ts
interface TargetBinding {
  connectionId: string;
  fingerprintKey: string;
  browserDeviceId: string | null;
}
```

Target changes invalidate every prepared operation, dialog, transfer, and command-scoped authorization.

#### P0.4 Transmission plans are not truly immutable

`readonly Uint8Array` is still mutable. Confirmation currently binds only to `plan.id`; bytes can theoretically change after preview and before execution while the ID remains the same.

Generate a canonical digest over target binding, safety classification, endpoints, write modes, packet bytes, pacing, and consequence. Authorization owns copied packet buffers and is bound to the digest.

#### P0.5 Write timeout is indeterminate, not canceled

`Promise.race` times out the host wait but cannot cancel the underlying Web Bluetooth write. A timed-out persistent write can land later after MatrixSmith has reported failure.

After a write timeout:

- mark the operation and panel state indeterminate;
- quarantine the connection from further writes;
- wait for the underlying promise if possible;
- otherwise require disconnect/reconnect before transmission resumes.

#### P0.6 Unexpected disconnect does not clean application state

The transport moves to idle, but the controller does not invalidate panel-program belief, suspend open workflows, clear subscription handles, or rebind notifications. Reconnection can therefore appear successful while notifications remain attached to old characteristics.

Unexpected disconnect must be a first-class application event handled by the connection state machine.

### P1: core product correctness

#### P1.1 Multiple truth systems contradict one another

Create and Investigate use atomic claims and static viability; the low-level report and legacy validation use `computeSupportMatrix`. A known iLedHat can simultaneously be ready for text/images and reported as “Not tested.”

Delete the legacy support matrix after introducing one `DeviceAssessment` consumed by all surfaces.

#### P1.2 Unknown-device identification is a dead end

The UI offers a safe family probe, but probing currently requires `resolveProfile()` first. A generic FFF0/F1 device is offered actions that all fail because it has no known profile.

Separate family-level identification from physical profile resolution and introduce provisional targets with evidence-backed or user-confirmed geometry.

#### P1.3 Home, session, and transport can diverge

Going Home does not disconnect. Connecting again clears application session state before the transport rejects the second connection as already connected.

Home should show an active-device card with **Return to display** and **Disconnect/change display**. Page navigation must never mutate the connection.

#### P1.4 Known-profile Finish is a no-op

A profile can have a complete core plan without an Investigation object. Investigate still renders a Finish button, but there is nothing to stop or save.

Use separate presentation states:

- “This model is already characterized” for shipped evidence;
- “Investigation complete” after an actual run;
- “Investigation saved” as a terminal state with Resume/Report/Create actions.

#### P1.5 Enabled actions are not guaranteed executable

Identify, refresh, brightness validation, Create, and diagnostic actions reconstruct availability from connection or driver IDs. They can be enabled even though planning will reject them.

All visible actions must come from application-provided `AvailableAction` values. UI code never invents availability.

#### P1.6 External bundle validation is shallow

Collections are checked as arrays but many nested elements are trusted through casts. Malformed input can enter reports and Developer UI.

Bundle V3 needs a complete runtime schema and input budgets before any application mutation.

#### P1.7 Advertisement enrichment can cross device generations

An observation started for one device can complete after reconnect and enrich the current fingerprint. Capture a connection token and device ID, abort on disconnect, and reject stale completion.

#### P1.8 Transaction evidence loses actual RX endpoints

Every notification since transaction start is attached to the transaction and labeled with its first TX endpoint. Preserve endpoint and receive timestamp at the transport boundary, then classify RX as matched, related receipt, or unrelated concurrent notification.

#### P1.9 Persisted-save success is overstated

Storage failures are swallowed while the UI always says the investigation was saved. Repositories must return a typed success/failure result.

#### P1.10 Full diagnostic JSON privacy is unclear

Markdown identifier options do not govern JSON export. Full bundles include opaque browser device IDs, complete trace, and device binding. Offer explicitly separate shareable and full-forensic exports.

### P2: architecture and maintainability

- `MatrixController` is 1,468 lines and owns connection, execution, evidence, investigation, reports, imports, diagnostics, and legacy validation.
- `MatrixStore` is 1,812 lines and owns UI state, domain decisions, image processing, timers, reports, persistence, and orchestration.
- UI and controller modules hardcode CoolLEDUX IDs and import concrete diagnostics.
- the entire app snapshot is rebuilt on every trace event and every 100 ms timer tick;
- 59 rendered `.map()` sites have no stable keys;
- browser globals, clocks, and ID generation are embedded throughout domain/application code;
- trace, notifications, transactions, and imports are unbounded in memory;
- packet bytes and separately stored packet hex can disagree;
- `ackPolicy` is modeled but unused;
- retry policy exists generically although all shipped plans prohibit retries;
- settings and investigation history sanitation accept invalid or unbounded values;
- dead or legacy production modules remain, including `DiagnoseView` and unused presets;
- CSS contains old and redesigned layers overriding the same selectors;
- several major TSX modules are compressed into one-line implementations;
- versions are hardcoded in multiple report/bundle paths;
- the service worker deletes caches it does not own.

### P2: accessibility and interaction

- nested `<main>` landmarks;
- modal dialogs do not move, contain, or restore focus and do not close with Escape;
- device menu uses ARIA menu roles without the menu keyboard contract;
- content tabs lack roving focus, tab panels, arrow keys, and `aria-controls`;
- ImagePreview declares a tablist but its buttons have no tab semantics;
- hidden file inputs receive invisible focus;
- animated previews ignore reduced-motion preference;
- disabled action reasons are exposed through `title`, which is ineffective on touch and often inaccessible on disabled controls;
- notification close button lacks an accessible name;
- mobile toasts overlap the device header and persist across navigation.

## Target domain model

### Device target

```ts
type DeviceTarget =
  | {
      kind: "unresolved";
      fingerprint: DeviceFingerprint;
      candidates: readonly DriverCandidate[];
    }
  | {
      kind: "protocol-identified";
      fingerprint: DeviceFingerprint;
      driverId: DriverId;
      identificationEvidence: ClaimEvidence;
      geometry: Geometry | null;
    }
  | {
      kind: "provisional";
      fingerprint: DeviceFingerprint;
      driverId: DriverId;
      geometry: Geometry;
      geometrySource: "device-info" | "advertisement" | "user-confirmed";
    }
  | {
      kind: "profile-resolved";
      fingerprint: DeviceFingerprint;
      driverId: DriverId;
      profile: DeviceProfile;
    };
```

Family probes operate on unresolved candidates. Content planning requires a provisional or profile-resolved target.

### Canonical assessment

```ts
interface DeviceAssessment {
  readiness:
    | "no-device"
    | "inspecting"
    | "needs-identification"
    | "needs-geometry"
    | "ready"
    | "limited"
    | "offline";

  summary: string;
  capabilities: Readonly<Record<CapabilityId, CapabilityAssessment>>;
  strategies: StaticViabilityAssessment;
  actions: readonly DeviceAction[];
  recommendedActionId: string | null;
  unresolvedClaims: readonly ClaimState[];
  conflicts: readonly ClaimState[];
}

interface CapabilityAssessment {
  id: CapabilityId;
  label: string;
  availability: "available" | "blocked" | "unsupported";
  confidence: "verified" | "experimental" | "unknown" | "conflicted";
  reason: string;
  evidence: readonly EvidenceSummary[];
  missingClaims: readonly ClaimId[];
  safety: OperationSafety;
}
```

`availability` answers whether the capability can be used now. `confidence` answers how well its behavior is established. These are distinct.

### Safety classification

Persistence is not a hazard:

```ts
interface OperationSafety {
  hazard: "routine" | "experimental" | "destructive" | "firmware";
  persistence: "none" | "volatile" | "device-stored" | "unknown";
  assurance: "verified" | "experimental" | "unknown" | "rejected";
}
```

Interaction policy:

| Operation                     | Target             | Interaction                        |
| ----------------------------- | ------------------ | ---------------------------------- |
| Verified text/image/animation | Known profile      | Direct one-click send              |
| Verified brightness           | Known profile      | Direct one-click apply             |
| Guided revalidation           | Known profile      | Run button is consent; no checkbox |
| Experimental GIF              | Known profile      | One concise confirmation           |
| Experimental write            | Provisional target | One exact-consequence confirmation |
| Unknown protocol              | Unresolved target  | Block and explain next step        |
| Destructive/firmware          | Any                | Block                              |

## Target architecture

```text
Preact feature UI
  -> presentation signals and accessible primitives
    -> ApplicationRuntime
      -> connection machine
      -> guided-test machine
      -> command handlers / effect runner
        -> canonical DeviceAssessment
          -> pure domain
            -> ports
              -> Web Bluetooth, drivers, local storage, files, wake lock
```

### Proposed source layout

```text
src/
  domain/
    device/
      target.ts
      fingerprint.ts
      identification.ts
      assessment.ts
    evidence/
      claims.ts
      trust.ts
      viability.ts
    investigation/
      model.ts
      tests.ts
      recommendations.ts
      orchestration.ts
      reports.ts
    content/
      operations.ts
      framebuffer.ts
      sequence.ts
      rendering/
    transmission/
      plan.ts
      validation.ts
      policy.ts
      result.ts

  application/
    runtime.ts
    state.ts
    commands.ts
    effects.ts
    machines/
      connection-machine.ts
      guided-test-machine.ts
    services/
      connection-service.ts
      identification-service.ts
      transmission-service.ts
      investigation-service.ts
      content-service.ts
      report-service.ts
    ports/
      transport.ts
      driver.ts
      persistence.ts
      files.ts
      platform.ts

  adapters/
    bluetooth/
      web-bluetooth-transport.ts
    drivers/
      registry.ts
      coolledux/
      coolledx/
    persistence/
      browser-investigation-repository.ts
      browser-settings-repository.ts
    files/
      bundle-v3-codec.ts
      capture-importer.ts
      browser-download.ts
    simulation/
      simulated-transport.ts
      replay-transport.ts

  presentation/
    app/
      App.tsx
      context.ts
      routes.ts
    state/
      app-signals.ts
      device-signals.ts
      content-signals.ts
      investigation-signals.ts
    components/
      Dialog.tsx
      Tabs.tsx
      MenuButton.tsx
      Notice.tsx
      FileButton.tsx
      UnavailableAction.tsx
    features/
      home/
      create/
      investigate/
      develop/
      reports/
```

## Application state machines

### Connection machine

```ts
type ConnectionState =
  | { value: "idle" }
  | { value: "selecting"; mode: ConnectionMode }
  | { value: "connecting"; requestedDeviceId: string | null }
  | { value: "connected"; connectionId: string; target: DeviceTarget }
  | { value: "disconnecting"; connectionId: string; target: DeviceTarget }
  | { value: "disconnected"; previousTarget: DeviceTarget }
  | { value: "quarantined"; connectionId: string; reason: IndeterminateWrite }
  | { value: "failed"; operation: ConnectionOperation; error: AppError };
```

Rules:

- page navigation never changes connection state;
- failed replacement preserves the previous valid session;
- importing a report creates an offline workspace rather than overwriting a live workspace;
- unexpected disconnect clears subscription handles and invalidates operational panel certainty;
- target changes invalidate prepared commands;
- a quarantined connection must reconnect before more writes.

### Guided-test machine

```ts
type GuidedTestState =
  | { value: "idle" }
  | { value: "about"; prepared: PreparedTest }
  | {
      value: "transferring";
      prepared: PreparedTest;
      progress: TransferProgress;
    }
  | { value: "observing-timed"; run: ActiveRun; timing: TimingState }
  | { value: "observing-questions"; run: ActiveRun; answers: AnswerState }
  | { value: "retry-confirmation"; run: ActiveRun }
  | { value: "result"; completed: CompletedGuidedTest }
  | { value: "failed"; prepared: PreparedTest; failure: TestFailure };
```

Stage-specific data exists only in its valid state. The timer updates one isolated presentation signal instead of rebuilding the entire application.

## Driver contract

Split family identification from profile-dependent operation planning:

```ts
interface CandidateContext {
  fingerprint: DeviceFingerprint;
  endpoints: readonly GattEndpoint[];
}

interface OperationalContext {
  target: Extract<DeviceTarget, { kind: "provisional" | "profile-resolved" }>;
  assessment: DeviceAssessment;
}

interface MatrixDriver {
  id: DriverId;
  family: string;
  discoveryHints(): DiscoveryHints;
  match(fingerprint: DeviceFingerprint): DriverMatch;
  familyProbes(context: CandidateContext): readonly ProbeDefinition[];
  identify(
    result: ProbeResult,
    context: CandidateContext,
  ): IdentificationResult;
  resolveProfile(fingerprint: DeviceFingerprint): DeviceProfile | null;
  baselineEvidence(target: DeviceTarget): readonly ClaimEvidence[];
  operations(context: OperationalContext): readonly OperationDefinition[];
  guidedTests(context: OperationalContext): readonly GuidedTestDefinition[];
  plan(
    operation: MatrixOperation,
    context: OperationalContext,
  ): TransmissionPlan;
  decodeNotification(
    packet: ReceivedPacket,
    context: DecodeContext,
  ): readonly DecodeCandidate[];
}
```

The UI receives actions already classified as available, blocked, or hidden. It never compares driver IDs.

## Transmission pipeline

```text
semantic command
  -> target-bound prepared operation
  -> plan validation
  -> canonical digest
  -> interaction policy
  -> command-scoped authorization
  -> connection-token verification
  -> serialized execution
  -> endpoint-aware evidence record
  -> assessment recomputation
```

Plan validation must guarantee:

- the target binding matches the current connection;
- packet indexes are contiguous and unique;
- endpoints and write modes exist;
- packet, total-byte, pacing, and timeout budgets are valid;
- persistent plans are never retried automatically;
- every report hex string is derived from authoritative bytes;
- the plan digest matches the prepared and confirmed operation.

## Presentation state and Preact

Use `@preact/signals` only for reactive presentation state and computed view models. Domain models remain plain immutable TypeScript.

Appropriate signals:

- current hash route;
- connection-machine snapshot;
- active dialog;
- selected content type and form settings;
- transfer progress;
- isolated timer display;
- computed `DeviceAssessment` projections.

Feature-local UI state remains in the feature. Do not recreate one giant global snapshot.

## Navigation and workspace model

Use a dependency-free hash router for static-host portability and reliable offline deep links:

```text
/#/home
/#/device/create
/#/device/investigate
/#/device/develop/transactions
/#/device/develop/gatt
/#/offline/report
```

Browser Back should close overlays, return from Developer, and then return Home. Home shows the active live device rather than pretending there is no connection.

Live and offline workspaces remain separate. Merging imported evidence into a live investigation is an explicit action with clear provenance.

## Create redesign

### Known device

- Text, Image, and verified Animation are direct operations.
- The primary action is **Display it**.
- An inline note can say “Replaces the content currently shown on iLedHat.”
- No modal or checkbox appears for verified routine content.
- Transfer progress replaces the action in place.
- Success copy is “Display updated.”
- Protocol caveats live in Developer evidence, not the routine success message.

### Experimental content

Use one concise confirmation with specifically labeled actions. No checkbox:

```text
GIF playback has not been verified on this iLedHat.
It will replace the current display content.

[Cancel] [Send experimental GIF]
```

### Animation

The current tab sends a built-in diagnostic rather than authored animation. Either:

- rename it **Demo animation**, or
- implement a real animation editor with frame import, ordering, timing, preview, and validation.

Do not label diagnostics as creation tools.

## Investigate redesign

### Known characterized profile

Lead with:

> This model is ready for normal use.

Actions:

- Create content
- Troubleshoot this display
- Revalidate this unit
- View evidence

Do not show a Finish button when no investigation exists. Already-established tests are labeled revalidation, not recommended setup.

### Unknown device

Lead with one executable action. After protocol identification, request geometry only if it cannot be derived. Then create a provisional target and offer bounded tests that are valid for that family and geometry.

### Technical support map

Replace the multi-screen flat list with grouped capability summaries. Each row has an explicit evidence disclosure that works on touch and keyboard. Do not hide evidence in `title` attributes.

## Reports and privacy

Remove the legacy low-level support report. Produce all reports from the canonical assessment.

Offer:

1. **Shareable investigation report** — identifiers redacted; concise conclusions and evidence.
2. **Forensic report** — all transactions, packet timing, candidates, and interpretations; identifier inclusion explicit.
3. **Shareable Bundle V3** — validated portable structured data with identifiers removed.
4. **Full local archive** — complete identifiers and trace, clearly warned and never presented as safe-to-share by default.

Every report must agree with Create and Investigate about capability state and next actions.

## Bundle V3 and local persistence

Use one strict runtime schema, preferably Zod Mini or an equivalently small validator. Generate or maintain JSON Schema from the same definitions.

Suggested resource budgets:

```ts
const INPUT_LIMITS = {
  diagnosticBundleBytes: 10 * 1024 * 1024,
  captureBytes: 25 * 1024 * 1024,
  gifBytes: 8 * 1024 * 1024,
  imagePixels: 24_000_000,
  traceEvents: 50_000,
  transactions: 10_000,
  investigationHistoryBytes: 2 * 1024 * 1024,
};
```

Parse and validate completely before mutating application state. Return structured field errors.

Use a new `matrixsmith:v2:` storage prefix and delete migration code. Storage repositories return typed success/failure results so the UI never claims unsaved data was saved.

## Accessibility foundation

Build and test shared primitives once:

- `Dialog`
- `Tabs`
- `MenuButton` or ordinary disclosure
- `NoticeRegion`
- `FileButton`
- `UnavailableAction`
- `EvidenceDisclosure`

Requirements:

- one `<main>` landmark;
- dialogs move focus inside, trap Tab/Shift+Tab, close on Escape, make the background inert, and restore focus;
- tabs implement tab/tabpanel relationships, roving focus, arrows, Home/End, `aria-selected`, and `aria-controls`;
- menus either implement the full ARIA menu keyboard model or use ordinary disclosure semantics;
- all controls have visible focus and accessible names;
- unavailable explanations are visible text;
- reduced motion pauses animated previews;
- touch targets and layouts are verified at 320, 390, 768, 1024, and 1280 CSS pixels;
- toast placement never obscures device controls or navigation.

## Static Cloudflare Pages architecture

The production runtime consists only of browser-side static assets:

- HTML, CSS, JavaScript;
- Preact and Signals;
- state machines and application services;
- runtime validation;
- protocol drivers/codecs;
- Web Bluetooth;
- local storage and local files;
- PWA service worker.

Do not add:

- `functions/`
- `_worker.js`
- Pages Functions
- Workers/KV/D1/R2
- SSR
- API routes
- runtime secrets

Cloudflare configuration:

```text
Build command: npm run verify
Build output directory: dist
Node version: 22
```

Add `public/_headers`:

```text
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
  Permissions-Policy: bluetooth=(self), camera=(), microphone=(), geolocation=()
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache
```

Service worker rules:

- network-first application shell;
- cache-first hashed assets;
- offline navigation fallback;
- delete only cache names beginning with `matrixsmith-`;
- no background sync or uploads;
- surface update availability to the app;
- register only in production.

Preview deployments are suitable for simulator/UI QA. Physical-device acceptance should use a stable HTTPS custom domain because Web Bluetooth authorization and device IDs are origin-scoped.

## Testing strategy

### 1. Pure domain tests

- claim resolution;
- operational trust;
- assessment derivation;
- strategy viability;
- recommendations;
- plan validation;
- state-machine transition tables.

### 2. Driver contract suite

Every driver must pass common tests for:

- conservative matching;
- candidate probes without a reviewed profile;
- profile resolution;
- capability/action contribution;
- plan safety invariants;
- byte compilation;
- response matching;
- malformed notification handling;
- unknown bytes retained without invented meaning.

### 3. Application tests

Use fake ports, not browser globals:

- connection and replacement failures;
- unexpected disconnect;
- notification resubscription;
- stale advertisement completion;
- target-bound plan invalidation;
- timeout quarantine;
- storage failure reporting;
- live/offline workspace separation.

### 4. Component and accessibility tests

- component behavior through semantic roles;
- dialog focus/restore/escape;
- tab and menu keyboard behavior;
- file controls and unavailable actions;
- reduced motion;
- axe scans for automated violations.

### 5. Playwright journeys

- clean known-device Create;
- unknown-device identification and provisional geometry;
- reconnect after unexpected disconnect;
- Home while connected;
- direct verified send;
- one-confirmation experimental send;
- guided timed observation and retry;
- malformed bundle recovery;
- shareable versus forensic export;
- mobile navigation and toast placement;
- offline shell and update behavior.

Use targeted assertions for behavior, ARIA snapshots for stable structure, and a small set of reviewed visual snapshots for key responsive states.

### 6. Physical acceptance

A documented checklist on the stable Cloudflare custom domain:

- chooser and reconnect;
- device-info notification;
- brightness round trip;
- text/image send;
- unexpected disconnect/reconnect;
- screen lock/wake lock behavior;
- known and experimental content;
- bundle/report export;
- installed PWA and offline shell.

## Quality gates

Recommended scripts:

```json
{
  "scripts": {
    "typecheck": "tsc -b",
    "lint": "eslint . --max-warnings=0",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "build": "tsc -b && vite build",
    "verify:static": "node scripts/verify-static-output.mjs",
    "verify": "npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm run verify:static"
  }
}
```

CI additionally runs:

- `npm audit --omit=dev`;
- architecture-boundary validation;
- coverage thresholds;
- Playwright simulator journeys;
- axe accessibility scans;
- bundle-size budgets;
- `git diff --check`.

Static-output verification asserts:

- required shell, manifest, icons, service worker, and `_headers` exist;
- no `_worker.js` or Functions output exists;
- every referenced asset exists;
- the development simulator is absent;
- no unexpected external origin appears in production output;
- individual and initial-route bundles remain within budget.

## Performance targets

- initial Home/Create JavaScript: target <= 90 KiB gzip;
- total lazy-loaded JavaScript: target <= 180 KiB gzip unless justified by measured image tooling;
- no global 100 ms rerender;
- content previews update within one animation frame for routine inputs;
- report generation occurs on demand and does not block transfer/timing UI;
- Developer lists use bounded rendering or virtualization for large traces;
- image analysis moves to a worker if measured mobile input latency warrants it;
- no runtime network request is required after static assets load.

## File disposition

### Preserve

- proven CoolLEDUX/CoolLEDX codecs and protocol fixtures;
- framebuffer and render algorithms;
- evidence, claim, trust, timing, and viability logic;
- safety concepts and transaction evidence;
- Web Bluetooth adapter internals after lifecycle changes.

### Replace

- `src/app/controller.ts`
- `src/ui/store.ts`
- `src/app/session.ts`
- legacy report generator and support projection;
- page-local navigation model;
- global toast-string error state;
- session-wide experimental and confirmation flags.

### Delete after replacement

- `src/ui/views/DiagnoseView.tsx`
- `src/diagnostics/support.ts`
- `src/investigation/legacy-bridge.ts`
- legacy validation UI and models once guided tests cover them;
- `src/storage/presets.ts` unless a real presets feature is implemented;
- v1/v2 bundle and storage migration paths;
- stale legacy CSS;
- UI/application conditionals containing concrete driver/workflow IDs;
- unused retry/ack concepts unless real semantics are implemented.

## Execution roadmap

### Phase 0: safety hotfixes and characterization

1. Upgrade Preact.
2. Add regression tests for confirmation carry-over.
3. Add target binding and plan digest tests.
4. Add unexpected-disconnect and notification-resubscription tests.
5. Add write-timeout quarantine tests.
6. Capture the current known-device byte-level suite as an immutable baseline.

Exit criteria:

- all current protocol tests pass;
- critical safety regressions are represented by failing tests before structural changes.

### Phase 1: canonical assessment

1. Introduce `DeviceAssessment`.
2. Derive it from atomic claims, operational trust, and static viability.
3. Make Create gates and recommendations consume it.
4. Rewrite reports against it.
5. Delete `computeSupportMatrix` and low-level contradictory status derivation.

Exit criteria:

- Create, Investigate, header, actions, and all reports agree for every modeled state.

### Phase 2: target and driver contracts

1. Add the `DeviceTarget` union.
2. Separate candidate probes from profile operations.
3. Implement provisional geometry.
4. Move operation descriptions and availability into drivers.
5. Remove CoolLEDUX IDs from presentation and generic application code.

Exit criteria:

- a synthetic unknown FFF0/F1 display can be family-identified without inheriting iLedHat profile evidence;
- every visible enabled action executes in its modeled state.

### Phase 3: application runtime and connection machine

1. Add application commands, effects, and ports.
2. Implement the connection machine.
3. Extract connection, identification, and transmission services.
4. Add connection generation and target-bound authorization.
5. Handle unexpected disconnect, reconnect, advertisement cancellation, and quarantine.
6. Remove `MatrixSession` and transport/session split-brain.

Exit criteria:

- exhaustive connection transition tests pass;
- Home cannot hide a live unusable connection;
- reconnection always restores notifications;
- stale async work cannot mutate a newer connection.

### Phase 4: guided-test machine

1. Convert mutable guided-flow fields to the discriminated state union.
2. Extract timer updates.
3. Preserve immutable investigation records.
4. Keep current observation and orchestration domain logic.
5. Delete legacy validation workflows.

Exit criteria:

- no nullable stage-specific state;
- no global timer rerender;
- retry, abandon, failure, and completion transitions are exhaustive.

### Phase 5: presentation rewrite

1. Add Preact Signals and feature contexts.
2. Add hash routing/history.
3. Build accessible primitives.
4. Rewrite Home, Create, Investigate, Develop, and Reports by feature.
5. Implement direct verified sends and one-confirmation experimental sends.
6. Add stable keys and remove driver imports from UI.

Exit criteria:

- known text/image requires one click after content selection;
- routine sends open no modal;
- all dialogs/tabs/menus pass keyboard tests;
- browser Back behavior is coherent;
- components contain presentation decisions only.

### Phase 6: Bundle V3, persistence, and privacy

1. Add strict Bundle V3/runtime schemas.
2. Add input/resource budgets.
3. Separate live and offline workspaces.
4. Add shareable and full-forensic exports.
5. reset storage to `matrixsmith:v2:`.
6. Delete all bundle/storage migration code.

Exit criteria:

- malformed input never partially mutates state;
- reports and bundles have explicit privacy behavior;
- storage success/failure is truthful.

### Phase 7: static hosting, performance, and cleanup

1. Add `_headers` and scoped service-worker caching.
2. Add full PWA icon set and install checks.
3. Lazy-load Developer, report, and heavy image tooling.
4. Add quality gates and architecture checks.
5. Remove dead modules, stale tests, unused CSS, and documentation duplication.
6. Deploy preview and stable-domain hardware acceptance builds.

Exit criteria:

- `dist/` deploys directly to Cloudflare Pages;
- no backend artifact or request exists;
- static, offline, responsive, accessibility, and physical checklists pass.

## Recommended pull-request sequence

1. Security dependency and critical regression tests.
2. Domain safety types: target binding, plan digest, operation safety.
3. Canonical assessment and unified reports.
4. Driver candidate/provisional contract.
5. Connection runtime and lifecycle hardening.
6. Guided-test state machine.
7. Presentation signals, router, and accessible primitives.
8. Known-device direct-control UX.
9. Bundle V3, privacy, and storage reset.
10. Cloudflare/PWA/performance and legacy deletion.

Keep each PR green. The branch may be breaking relative to old local data, but it should not remain internally half-migrated between two truth models.

## Success measures

### Product

- known-device text/image: one primary click after input;
- zero routine confirmation dialogs;
- experimental operation: at most one concise confirmation;
- every enabled action succeeds or enters a documented recoverable state;
- known and unknown journeys have a clear terminal outcome;
- report conclusions match the UI exactly.

### Safety and correctness

- every write is bound to a physical target and connection generation;
- confirmation binds to the exact plan digest;
- stale async work cannot affect a newer device;
- unexpected disconnect cannot preserve operational authority;
- indeterminate writes quarantine the connection;
- imported/historical evidence never authorizes;
- packet reports are derived from authoritative bytes and real endpoints.

### Engineering

- no controller/store monolith larger than approximately 400 lines;
- presentation imports no concrete driver or browser adapter;
- domain imports no browser or Preact module;
- all external data passes runtime schemas;
- no unused production module or symbol;
- architecture boundaries are CI-enforced;
- byte-level protocol coverage remains unchanged or improves.

### Accessibility and quality

- WCAG-oriented axe gate has zero serious/critical violations;
- critical paths have reviewed ARIA snapshots;
- keyboard-only completion works for Home, Create, Investigate, Reports, and Developer;
- responsive and visual snapshots cover key breakpoints;
- manual screen-reader and physical-device checklists are complete.

### Hosting

- Cloudflare Pages serves only static assets;
- no Function/Worker invocation;
- production security headers are present;
- offline shell succeeds after initial load;
- stable-domain Web Bluetooth acceptance passes;
- preview deployments pass all simulator journeys.

## Definition of done

MatrixSmith is best-in-class when:

- a normal user can connect a known display and update it without laboratory ceremony;
- an unknown display can make honest, bounded progress without inheriting another product's facts;
- every surface tells the same story about capability and evidence;
- safety is stronger because it is target-bound and digest-bound, not because the UI asks repeated questions;
- connection and guided workflows cannot enter impossible combinations;
- reports are trustworthy, privacy-explicit, and sufficient without chat history;
- the codebase has clear domain/application/adapter/presentation boundaries;
- the proven protocol implementation remains byte-for-byte covered;
- the built `dist/` is a secure, offline-capable, static Cloudflare Pages application.

## Primary references

- Web Bluetooth specification: https://webbluetoothcg.github.io/web-bluetooth/
- Preact Signals guide: https://preactjs.com/guide/v10/signals/
- React external-store snapshot guidance: https://react.dev/reference/react/useSyncExternalStore
- W3C modal dialog pattern: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- W3C tabs pattern: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- W3C menu pattern: https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
- Cloudflare Pages headers: https://developers.cloudflare.com/pages/configuration/headers/
- Cloudflare Pages static serving/SPA behavior: https://developers.cloudflare.com/pages/configuration/serving-pages/
- Cloudflare Pages build configuration: https://developers.cloudflare.com/pages/configuration/build-configuration/
- Zod runtime validation: https://zod.dev/basics
- Playwright accessibility testing: https://playwright.dev/docs/accessibility-testing
- Playwright ARIA snapshots: https://playwright.dev/docs/aria-snapshots
- Playwright visual comparisons: https://playwright.dev/docs/test-snapshots
