# Safety policy

MatrixSmith fails closed at the semantic-plan boundary. No browser UI exposes arbitrary hex or characteristic writes.

## Capability-driven policy

| Condition                                       | Result                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| source is imported, fake, or replay             | block TX                                                                        |
| unknown/ambiguous driver for a normal operation | block TX                                                                        |
| plan marked `dry-run-only`                      | block live TX                                                                   |
| unverified or rejected validation               | block live TX                                                                   |
| experimental transient/read-only                | require per-session Lab unlock                                                  |
| verified read-only                              | allow only an explicit user action                                              |
| verified transient and driver marks plan live   | allow explicit Control action                                                   |
| verified routine persistent content             | direct target-bound, digest-checked command authorization                       |
| experimental persistent content                 | one consequence-specific confirmation bound to the exact target and plan digest |
| persistent probe                                | never allowed                                                                   |
| destructive or firmware risk                    | block                                                                           |
| endpoint/property mismatch                      | block                                                                           |

Validation alone never authorizes a future command: every plan also carries explicit driver intent (`live` or `dry-run-only`). The policy contains no CoolLED family, profile, opcode, or raw-brightness special cases.

Read-only protocol probes are the narrow exception to ordinary ambiguity blocking. A probe must be semantic, non-persistent, explicitly invoked, supported by a candidate match, planned through the driver, and authorized through the same policy/executor path. No probe runs on page load or merely because a device connected. Offline bundles may replay captured probe evidence but cannot transmit.

## Current iLedHat boundary

- CoolLEDUX `GetDeviceInfo` (`0x1F`): verified, read-only, live on explicit Refresh/probe.
- CoolLEDUX `SetBrightness` (`0x04`, raw 0–255): verified transient, live on deliberate Apply.
- CoolLEDUX power: dry-run-only on this profile.
- CoolLEDX brightness for this iLedHat: rejected hardware hypothesis and not live.
- CoolLEDUX static frame, rendered text, image, and animation on the reviewed iLedHat profile: verified routine persistent operations, direct after the user presses **Send to display**. Imported GIF is decoded locally and sent through this ShowAnimation path. Native ShowGif remains experimental and uses consequence confirmation where executable.
- Mirror, rotation, light modes, timers, reset, password, OTA, and firmware: not live.

## Persistent content writes

Stored-program uploads replace the display's stored content; MatrixSmith never pretends they are transient. Verified routine content needs no warning dialog. Experimental persistent content shows one exact consequence and confirmation, scoped to the canonical plan digest and consumed on execution. The known recovery observation — a long-ish inline power-button action displayed `reset` and restored the default scrolling `coolled` text — is documented evidence, not an implemented or verified automatic restoration.

Execution results keep three claims separate: browser/host acceptance, a matching protocol notification, and independently verified device state. Brightness echo establishes protocol acceptance; a following device-info readback can establish the resulting raw brightness.

Raster scrolling is preflighted before BLE. MatrixSmith may increase pixel step and proportional frame delay, but blocks a send that still exceeds the conservative 48-frame / 16 KiB-decoded-per-tile source-derived budget. This is a software guard, not a claimed physical iLedHat limit. Persistent sends never retry automatically; a partial failure makes panel state unknown and leaves retry as an explicit action.

For write-without-response content, “host accepted” means only that the browser/Bluetooth stack accepted every write. Create reports “Upload sent.” with “Check the display. Its appearance was not confirmed.” Protocol response timeouts remain visible; optional Send details distinguish acknowledgement from device readback and never claim physical rendering, firmware acceptance, or retention. Preflight rejections do not claim an upload; execution failures preserve uncertainty and accepted-packet progress where known. Quarantined writes require explicit disconnect/reconnect and draft review before a fresh plan can be sent; recovery neither resends nor reuses confirmation. Transactions record host, protocol, and device-state results separately. Screen Wake Lock is best effort and never changes transfer success.

The experimental unlock is memory-only and clears on disconnect or reload. It cannot bypass driver intent, validation, risk, source, confidence, or endpoint checks.

## Path-specific content gating (2026-08-31 revision, hardened)

Per-path gates derive from OPERATIONAL TRUST (`operationalTrust` in `src/investigation/claims.ts`), not from the flat investigative claim state:

- text / image → require trusted `stored-program.upload` and a truly VIABLE static strategy: `static.strategy` is derived from the atomic requirements in `src/investigation/static-viability.ts` (upload, tiling, orientation, initial render, a measured ≥15 s stable hold, characterized black semantics, raw channel map, and encoder correctness). A casually asserted `static.strategy` entry has no authority, and a known-incorrect logical channel mapping keeps image/text gated. Optional visual color calibration is deliberately NOT required.
- animation → require trusted `animation.frames`, `animation.timing`, `animation.tile-sync`
- native GIF → require trusted `gif.playback` on this device; imported GIF in Create uses the animation prerequisites after bounded local decoding

Only `current-session` or `built-in-profile` evidence grants operational trust; previous local sessions and imported evidence inform the investigation, surface conflicts, and boost revalidation recommendations, but never unlock sends — and they also cannot revoke a shipped basis (only a trusted current-session rejection can). An inconclusive Graffiti validation cannot unlock unrelated content, and a successful Animation never silently proves Graffiti.

## Device/session evidence boundary

Current-session evidence is bound to one physical device session: only a matching browser-authorized device id lets an investigation (and its evidence) survive a reconnect. Any other connect detaches it with all evidence demoted to `previous-local-session`. LocalStorage and bundles are untrusted: every loaded evidence entry is structurally demoted regardless of its serialized scope, so poisoned records cannot manufacture `built-in-profile` or `current-session` authority. The controller also refuses to record guided-test observations outside a live physical session, and validates every submission (required fields, kinds, options, durations, timeline coherence) in the domain layer.

A running guided-test transfer cannot be dismissed as if canceled, and after transfer the only exit is "Stop observation and save as incomplete": an `abandoned` result records the exact operation and transaction ids with no claim conclusions, because the device WAS changed.

Guided hardware tests transmit only fixed driver-defined diagnostic programs (`ShowDiagnostic` with declared ids and enumerated parameter values — e.g. stayTime ∈ {3, 0}); there is no general raw writer and no arbitrary raw-word entry. Persistent guided plans keep `maxAttempts: 1` with no retry conditions; a missing receipt notification never triggers automatic persistent retransmission. Local investigation history persists structured evidence only — never experimental unlocks, persistent-send confirmation tokens, safety bypasses, or content binaries.

Driver diagnostic availability is an authored upper bound: live context never enables a tool declared unavailable. Imported context disables every diagnostic; direct execution checks this projection before any operation.

Ordinary GetDeviceInfo, SetBrightness, and SetPower execution requires both the
canonical shared capability assessment and the selected driver’s operation
contribution to allow it. Experimental availability still requires explicit
per-session permission. Family identity is a separate current-live or recognized
profile basis; historical identity and evidence remain non-authorizing. CoolLEDUX
adds its own protocol prerequisite without imposing it on other families. A
correlated probe response may be rejected by family interpretation. Registered
bounded probes alone use profile-free candidate eligibility. Investigation
continuity requires the same authorized device, fingerprint context, and profile;
geometry/profile or family changes detach previous evidence.

Registered characterization can establish missing evidence through a fixed
contributed test, never an imported definition or arbitrary prepared plan.
Declared prerequisites exclude imported and previous-session evidence as live
satisfiers. Risk/persistence must agree with the compiled plan before writes:
only read-only/none queries and persistent/persistent content are supported here.
Queries still need explicit experimental permission when experimental; Run
confirms the read-only consequence without a stored-content checkbox. Receipt
alone creates no physical observation or capability claim. Query failure settles
the attempt and retains transaction evidence without inventing panel replacement.
Persistent tests retain exact-plan consequence confirmation and panel uncertainty
on partial writes. All central source, confidence, target/digest, endpoint, risk,
validation and intent checks apply to both paths. No automatic retries are added.

## Private prepared-plan integrity

Preparation stays synchronous and target-bound. Its digest protects driver and
profile IDs, evidence references, operation (including nested content), safety
and execution intent, purpose, packet order/indexes, normalized TX endpoints,
write modes, exact bytes, pacing, write deadline, recovery notes and metadata.
These fields govern execution, interpretation, or the consequence reviewed for
approval. The complete response contract is protected too: type, required flag,
response deadline, opcode/kind, operation fulfillment, reviewed RX endpoints and
explicit dispatch packet index. Current response-bearing plans dispatch one
packet (index zero); stored-content multi-packet plans expect no response. Future
multi-packet queries must declare the request packet that opens correlation.

Plan IDs are bookkeeping and deliberately excluded so identical contracts compare
deterministically. Packet hex is derived from authoritative bytes during copying;
it is validated separately. The digest itself, authorization time and policy
receipt are bookkeeping. Target binding is included; random connection IDs are
necessary ownership boundaries, not portable protocol identity. Recovery notes,
metadata and evidence references are conservative approval/provenance inputs.
Preparation and authorization independently copy nested operations, endpoints,
response contracts, buffers and provenance arrays.

This is the private prepared-plan contract, not a support-package format. Existing
built-in driver/profile IDs and real source references are bound here. When real
loaded definition and interpretation-engine identities exist, they must join this
identity/provenance input before approval. No definition hash or signing identity
is invented today.

## Live response correlation and ambiguity

Notification contracts declare reviewed RX endpoints, independently of TX.
CoolLEDUX queries and brightness echoes use FFF0/FFF1; authored Synthetic Lumen
queries write its command characteristic and receive on its separate notification
characteristic. UUID comparisons use the same normalization throughout preparation,
policy, dispatch and correlation. Missing endpoint or connection context never
falls back to opcode-only ownership.

The application connection boundary stamps live records with its connection
generation and a monotonically increasing receive sequence. Router-owned object
membership, rather than serialized context fields, establishes eligibility.
Imported/replayed records never acquire this membership; importing historical
state retires the live waiter context. Raw evidence is still decoded for inspection
regardless of correlation. The router checks ownership, current generation,
post-dispatch ordering and RX endpoint before calling the driver's matching
predicate. Wrong-endpoint, malformed, unmatched and late current-connection packets
remain in the bounded evidence collections.

Waiters are registered and both outcomes supervised before any writes. Eligibility
and the response deadline open immediately before transport.write for the explicitly
reviewed dispatch packet, preserving replies emitted synchronously inside write.
Records received before that boundary cannot satisfy the request, even if
republished later. Response deadlines are separate from per-write deadlines and
connection retirement. A write failure remains primary if the response also fails;
only an indeterminate write invokes write quarantine. Cancel/reset settle promises
and clear timers. Authorization is checked again before adopting completion.

Current protocols have no request tokens: endpoint, generation and receive order
establish eligibility, not causality. A dispatched request that times out or is
cancelled without a selected response leaves an unresolved signature for that
connection. Later requests with overlapping endpoints and opcode/kind cannot adopt
responses as family, geometry or capability evidence. They still record actual
host acceptance and raw RX, with an explicit ambiguity finding; reconnect retires
the ambiguity. Distinct signatures remain usable. There is no quiet interval,
automatic retry, or response-timeout write quarantine. Delayed duplicate replies to
successfully answered requests and unsolicited identical notifications remain a
protocol limitation; software cannot distinguish them without protocol tokens.

ExecutionResult.response retains the decoded compatibility view, while
responseRecord identifies the exact selected record. Live device-info presentation
also uses this selection; raw rejected packets remain available in the inspector.
Transactions project that
identity into the existing matched-response relation, so duplicate-looking decoded
objects and wrong-endpoint packets cannot steal attribution. Receive sequence,
not collection length, selects concurrent evidence across bounded eviction; the
selected record survives eviction for transaction attribution. Related receipts
must share a reviewed RX endpoint (or a TX endpoint for plans expecting no response)
and remain weaker than matched responses.
Ambiguity is projected into existing findings and trace metadata. Bundle V3 remains
unchanged and carries no runtime ownership tokens. Host acceptance, correlated
response, declared operation fulfillment and physical observation remain separate;
no response alone establishes visible rendering or retention.
