# Adding a MatrixSmith driver

This workflow is designed so a contributor can add a second device family without reading the entire UI.

## 1. Collect portable evidence

From Home choose **Explore unknown BLE device**; Web Bluetooth permission is established in the browser chooser. The controller accepts suspected service UUID hints for the chooser; a UI field for them is planned. Connect, inspect accessible services/characteristics/properties, perform only explicit safe reads, subscribe explicitly to notifications, label the physical action, add manual observations, and export a diagnostic bundle. Unknown-device mode intentionally has no writer.

Turn the reviewed bundle into `tests/fixtures/devices/<profile>.json`. Preserve raw advertisement/GATT/notification bytes. Separate browser-observable facts from boot strings, physical geometry, labels, teardown observations, and other manual evidence.

## 2. Define family and profile separately

Add a driver under `src/drivers/<family>/` and add it once to `builtInDrivers`. A driver owns discovery hints, matching, endpoints, semantic probes, codecs, planning, notification decoding, and response matching. Physical profiles live under `src/profiles/`, not under whichever driver was first hypothesized.

Never make a profile dimension a global framebuffer constant. Never treat a generic UUID or name substring as protocol identity.

## 3. Implement scored matching

Return driver ID, score, confidence (`none`, `weak`, `candidate`, `strong`, `exact`), reasons, and contradictions. Equal top scores remain ambiguous. When generations share transport shape, add a read-only, non-persistent semantic probe with a serializable response expectation; never use arbitrary writes or treat silence as proof of the other family.

## 4. Model evidence, validation, and risk

`EvidenceConfidence` describes why a fact is believed: observed, corroborated, inferred, speculative, or unknown. `ValidationStatus` describes whether a capability works on the profile: unverified, experimental, verified, or rejected. They are independent.

Each capability also declares read-only/transient/persistent/destructive/firmware risk and none/volatile/persistent/unknown persistence. Unknown persistence is conservative. A browser button click records a session observation; promoting checked-in validation is a reviewed source change.

## 5. Build pure codecs and golden vectors

Keep codecs independent of DOM, browser Bluetooth, and mutable singletons. Record source repository, exact commit, license, files, extracted protocol facts, and whether implementation was independent or adapted. Never copy unlicensed code. Generate deterministic vectors in a temporary upstream checkout where possible, then test framing, escaping, lengths, checksums, chunk boundaries, orientation, and failure cases in MatrixSmith.

## 6. Plan semantic operations

Extend `MatrixOperation` only when needed. A plan contains exact packets, endpoint/write mode, validation, evidence, semantic risk/persistence, explicit `live`/`dry-run-only` intent, purpose, and response expectation. A characteristic write may still be a read-only semantic query; policy follows semantic risk.

Start new operations dry-run only. Use `FakeTransport` for order/failure/timeout/concurrency tests and `ReplayTransport` or imported bundles for match/decoder tests. Do not simulate device-side success.

## 7. Contribute diagnostic tools and support status

Contribute named diagnostic tools through the driver contract (kind `identify` / `inspect` / `validate`, semantic workflow, risk, persistence, assurance, and a plain-language explanation). `ApplicationRuntime.runDiagnostic` executes only semantic operations under the safety policy and records serializable steps, transactions, restoration state, and findings. Reversible tests restore and re-verify the original state. If a family has no safe probe, say so rather than inventing one. Capability metadata and atomic evidence feed the canonical `DeviceAssessment` used by every UI and report surface.

## 8. Validate hardware deliberately

Choose the least risky transient/read-only experiment supported by provenance. Capabilities and explicit plan intent drive policy; do not add driver/opcode/profile special cases. Require deliberate action, raw notification retention, separate host/protocol/state claims, and exported trace. Keep retry count one until safe retry behavior is proven.

After repeated reviewed hardware evidence, promote the specific profile capability from unverified to experimental to verified. Do not promote the entire family or other profiles by association.

Persistent content operations are supported through a dedicated path: declare the plan `persistent`, attach compiler metadata and per-packet `delayAfterMs` pacing (the executor owns timing), and route live sends through `sendPersistentContent`, which enforces a single-use explicit consequence confirmation. Pair each new persistent capability with a guided validation workflow (`src/diagnostics/validation.ts`) so the first hardware run records structured evidence. Destructive, reset, password, storage erase, OTA, and firmware operations remain blocked and require dedicated policy work. MatrixSmith must not acquire an arbitrary live writer as a reverse-engineering shortcut.

## 9. Contribute guided tests and claims (2026-08-31 revision)

Beyond capabilities and probes, a driver contributes:

- `claimEvidence(profile)` — baseline atomic-claim evidence with honest scopes (`built-in-profile` for facts physically observed on that exact hardware, `source-reference` for upstream-only behavior).
- `guidedTests(profile)` — `GuidedTestDefinition`s: a user-language title and question, claim prerequisites, a fixed deterministic operation (usually `ShowDiagnostic` with a declared content id and enumerated parameters), structured observation specs, an optional stopwatch, and a conservative `interpret()` that turns observations into claim updates plus establishes/rejects/unknowns. The engine, dialog, recommendation ranking, support map, and reports all render from the definition — no view or recommendation edits are needed for a new test.
- Fixed diagnostic content builders (e.g. `src/drivers/coolledux/diagnostics.ts`) for any raw-word patterns a test needs. Diagnostic content must be fully determined by the definition: enumerate every allowed parameter value and never expose arbitrary bytes or pixel words.
- Structured profile quirks (`src/core/quirks.ts`) instead of `if (profile.id === …)` conditionals, with every uncertain field spelled `unknown`.

Additional contracts from the hardening revision:

- **Applicability**: scope test suites to the profiles whose assumptions they bake in (geometry, tiling, observed history). Do not expose a device-specific suite to every profile of the driver family; give other profiles a genuinely generic suite or none.
- **Evidence-aware operations**: when a test's exact operation depends on established evidence, implement `buildOperation(context)` — the result must still be a fixed diagnostic id with enumerated parameters. Optionally implement `validate(values)` for cross-field coherence; the controller enforces generic structural validation regardless.
- **Measured timelines**: physical timing uses the multi-phase timer (`GuidedTestTimer.phases`); durations are measured from the final host-accepted write and only MatrixSmith-measured values verify claims. Attach measured quantities as `metrics` and structured outcome facts as `details` on claim updates — `details` is what activates session-resolved behavior (`src/investigation/session-behavior.ts`) and powers report clarity.
- **Do not write `static.strategy` evidence**: it is derived. Contribute the atomic requirement claims and let `src/investigation/static-viability.ts` decide.
