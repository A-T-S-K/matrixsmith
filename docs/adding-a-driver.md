# Adding a MatrixSmith driver

Drivers contribute discovery, matching, codecs, plans, and evidence through typed
interfaces. Adding a profile and adding a protocol family have different current
limits; implementing a codec alone does not establish product support.

## 1. Collect portable evidence

From Home use **Explore unknown BLE** → **Choose device**; Web Bluetooth permission
is established in the browser chooser. Enter suspected service UUIDs in the
existing **Optional service UUIDs** field before choosing. Connect, inspect
accessible services/characteristics/properties, perform only explicit safe reads,
subscribe explicitly to notifications, label the physical action, add manual
observations, and export a diagnostic bundle. Unknown-device mode intentionally
has no arbitrary writer.

Turn the reviewed bundle into `tests/fixtures/devices/<profile>.json`. Preserve raw advertisement/GATT/notification bytes. Separate browser-observable facts from boot strings, physical geometry, labels, teardown observations, and other manual evidence.

## 2. Define family and profile separately

Add a driver under `src/drivers/<family>/`. Exercise it first through an injected
`DriverRegistry` in `ApplicationRuntime`; add it to `builtInDrivers` only when
shipping reviewed support. A driver owns discovery hints, matching, endpoints,
semantic probes, codecs, planning, notification decoding, and response matching.
Physical profiles live under `src/profiles/`, not under whichever driver was first
hypothesized. Test-only families must stay outside the production registry.

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

Today `DiagnosticTool.workflow` is limited to `family-identification`,
`refresh-device-info`, and `brightness-round-trip`; it is not an extensible workflow
runner. The round-trip assumes `brightnessRaw` and an unsigned-byte range. Shared device-info, brightness, and power readiness requires a bound current
family plus trusted semantic capability evidence. Family identity derives from a
live probe or a recognized contributed profile; it does not verify arbitrary
physical capabilities. Historical identity cannot authorize execution.
`operationRequirements` may add conservative family-specific prerequisites;
CoolLEDUX keeps `protocol.coolledux` as its own fact. Driver operations can narrow
canonical assessment, never promote it. Ordinary sends enforce both, then all
central policy checks, including explicit experimental permission. Probe results
carry the actual driver/probe identity and a typed match or rejection separately
from response correlation; UI copy uses the current interpretation.
Shared claim IDs and Bundle V3 remain unchanged. New family-specific claim
vocabulary and a general extension framework remain deferred.

## 8. Validate hardware deliberately

Choose the least risky transient/read-only experiment supported by provenance. Capabilities and explicit plan intent drive policy; do not add driver/opcode/profile special cases. Require deliberate action, raw notification retention, separate host/protocol/state claims, and exported trace. Keep retry count one until safe retry behavior is proven.

After repeated reviewed hardware evidence, promote the specific profile capability from unverified to experimental to verified. Do not promote the entire family or other profiles by association.

Persistent content operations use `sendPersistentContent`: declare the plan
`persistent`, attach compiler metadata and per-packet `delayAfterMs` pacing (the
executor owns timing). Verified routine content uses direct target/digest-bound
authorization; experimental persistent content requires a single-use exact-plan
consequence confirmation. Pair a new persistent capability with driver-contributed
`GuidedTestDefinition`s (`src/investigation/tests.ts`); application catalog,
orchestration, and observation services own execution and recording. There is no
`src/diagnostics/validation.ts`. Registered guided execution supports two classes: `read-only` risk with `none`
persistence, or the existing `persistent` risk with `persistent` persistence.
The compiled plan must agree with the declaration. Queries execute the fixed
registered definition through central authorization and retain transactions;
they never stage a panel program, consume persistent confirmation, or compile
content evidence. Their deliberate Run action needs no replacement checkbox,
but experimental permission remains explicit and is never silently enabled.
Stored-content tests retain exact-plan confirmation, panel replacement, final
host-write timing, and deliberate resend reasons. Other/transient/unknown guided
consequences remain unsupported; dedicated reversible diagnostics are separate. Destructive, reset, password,
storage erase, OTA, and firmware operations remain blocked and require dedicated
policy work. MatrixSmith must not acquire an arbitrary live writer as a
reverse-engineering shortcut.

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

For another profile, contribute separate matching/resolution, geometry, evidence,
capabilities, quirks, and applicable tests. CoolLEDUX currently scopes characterized
capabilities, baseline physical claims, and its guided/core suite to the exact
iLedHat profile ID; adding an entry to `profiles()` alone is insufficient. See
`tests/drivers/second-profile-contract.test.ts` and
`tests/drivers/synthetic-family-contract.test.ts` for software-only injection
examples. Neither fixture is hardware evidence or production support.
