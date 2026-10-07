# Architecture and state ownership

MatrixSmith is a static browser application. The composition roots construct adapters and services; services depend on explicitly typed capabilities rather than browser globals or a shared mutable superclass.

## Application composition

`ApplicationRuntime` is the stable command/query facade. It explicitly constructs the services, connects narrow capability ports, and binds its public methods. There is no runtime service inheritance, reflection-based method copying, or shared kernel.

| Owner                                    | Responsibility                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Connection                               | Device session, connection generation, transport lifetime, notification subscriptions            |
| Identification                           | Driver registry, target/profile identification and assessment projection                         |
| Transmission                             | Executor, safety policy, session-only transmission authority and confirmation consumption        |
| Protocol evidence                        | Bounded transactions, notifications, compilations, observations, and imported-evidence summaries |
| Diagnostics                              | Diagnostic runs and brightness restoration orchestration                                         |
| Investigation                            | Current/detached investigations, orchestration, attempts, panel-program belief                   |
| Guided catalog/orchestration/experiments | Bounded operations over investigation-owned state through explicit commands                      |
| Report/import                            | Validated Bundle V3 and report projections; no live authority from imported data                 |

Capability contracts use type-only references. Deferred capability access connects mutually coordinating services without circular runtime imports or passing the entire runtime into each service. Private fields remain with their owners; cross-service changes use owner commands. Protocol drivers and pure evidence evaluators remain independently testable.

Atomic claim resolution lives below derived static-strategy assessment, eliminating the former runtime import cycle. Create, Investigate, and reports continue to use the canonical assessment.

## Presentation composition

`PresentationStore` preserves `subscribe`/`getSnapshot` and public UI commands. It composes workspace, navigation, notice, connection, editor, send, report, investigation, guided-workflow, and projection controllers. The former inherited catch-all `any` index signature is gone.

- Workspace owns active and retained-live runtimes. Replacing an offline report retires its runtime; opening a report does not disconnect the retained live device. An offline-only workspace owns ReplayTransport and has no live-workspace factory; Home explains the reload needed to start another live session. Retained live workspaces offer the existing return route. A seamless fresh live session from an offline-only report would require a new composition-root capability.
- Navigation owns routes, overlays, Browser Back behavior, and listener disposal.
- Notice owns operation IDs, the active-operation collection, and workspace-bound errors per operation. Completion or harmless editing cannot erase an unrelated hardware/persistence failure; retired-workspace failures are suppressed.
- Content editor owns files/previews and latest-selection generations, including profile identity and geometry. Stale work cannot replace a newer preview or cross workspace boundaries. Retained image geometry is checked before planning a send.
- Guided controller exclusively owns mutable guided UI flow. Pure domain transitions and read-only projections remain separate from that ownership.
- Snapshot owns publication and subscriptions. `useMatrixSnapshot` / `useSyncExternalStore` is the single UI bridge; disposal suppresses later publications. Trace-only changes share one scheduled publication per task. Connection, authority, workspace and recovery changes publish immediately, and `getSnapshot` reconciles settled canonical evidence before returning. Queued work belongs to its workspace and is cancelled on replacement or disposal. Observer failures are supervised individually in bounded local diagnostics; they cannot interrupt protocol evidence or other subscribers. Local publication counts support qualification without persisting timing or device identifiers.
- Editor/send owners each keep one content-cache entry per computation. Workspace/profile identity, geometry, and actual text/render inputs invalidate it; notices, trace events, report options, image settings, and brightness do not regenerate unchanged text or demo frames. Replacement/disposal releases these entries and decoded content. Safety assessments and transmission gates are recomputed independently.
- Projection owns a bounded saved-history display cache. Initialization, successful save/forget, Home navigation, explicit review, and an injected cross-tab storage subscription refresh it. Cold and warm Home use the same display-summary reader. Resume reads authoritative storage again and validates/demotes history; a cached summary cannot authorize a send.

The cohesive guided controller is larger than the old per-file limit. File length is a review signal, not an excuse to split one mutable state across inheritance layers. The public facade also contains explicit API bindings; it contains no feature logic.

Browser environment construction occurs in adapters invoked by bootstrap. Feature constructors receive only the storage, file, route, Wake Lock, discovery, or workspace-factory capabilities they use. Tests supply explicit environments, including in-memory persistence.

## Boundaries and lifecycle

The native TypeScript compiler resolves imports, re-exports, and dynamic imports for architecture verification. The gate rejects runtime cycles, concrete-driver imports in generic layers, browser-adapter imports in application/presentation services, and implementation inheritance in services/controllers.

Runtime disposal disconnects owned transports and releases subscriptions. Presentation disposal releases routing, Wake Lock, previews, snapshots, and owned workspaces. State transitions retain the existing target/digest, quarantine, evidence-demotion, and notification-correlation invariants.

TransmissionExecutor privately copies the complete authorized command before
calling any observer or transport. It validates one complete digest at entry,
then checks current target authority at each dispatch boundary. Transport,
trace, progress and driver callbacks receive independently owned data. Actual
attempts, receipts and measured timing are captured at execution boundaries;
planned packets do not stand in for dispatched history. A failure preserves its
original Error and cause. The optional failure-evidence callback receives a
defensive snapshot for that invocation; the compatibility Error lookup refuses
ambiguous reused Error identities. Neither path accepts serialized evidence as
current execution authority.

## Files and updates

File buttons catch both synchronous failures and rejected promises. Bounded readers check file sizes before allocation; PNG/JPEG/WebP headers are inspected before decoding, and bitmap dimensions are checked again before canvas allocation. Bundle validation precedes workspace mutation.

A single update manager spans cold Home and the full application. Build identity is derived from source/build inputs and package version. The production worker precaches a complete generation and serves its matching shell, retaining the previous successful generation. Explicit activation waits for readiness from every open app tab, and operational errors remain visible independently of update availability.

No backend, cloud persistence, analytics, or runtime third-party service is introduced by this architecture.

Imported GIFs cross a narrow `render/gif.ts` boundary: bounded local file →
browser ImageDecoder → sequential complete frames drawn into a target-sized
Canvas2D → FrameSequence. The editor owns the sequence and source metadata,
checks selection/workspace/profile lifetimes, and retains valid state on failure.
Create sends ShowAnimation through normal target-bound authorization; its `gif`
product gate uses animation prerequisites. The native GIF capability and
ShowGif compiler remain separate experimental research. No GIF bytes enter
settings, bundles, or provenance fields.

Bundle V3 imports check the byte budget before parsing, then execute the published
2020-12 schema through a deterministic standalone validator before returning a
semantically checked and sanitized bundle. The detailed semantic checks remain
stricter than generic schema objects; imported investigations still lose live
authority. `schema:generate` bundles only standalone helpers, and `schema:check`
rejects stale output before build identity is computed. No compiler, schema fetch,
or dynamic code evaluation runs in the browser.

Presentation evidence labels distinguish selected profile matches, current live
probes, historical evidence, and received device information. Device information
uses its connection-owned notification record and timestamp, with no second cache.
Markdown generators apply a pure report privacy projection: known identities are
omitted by default, with an explicit identifier choice for every report kind.
Report-local binding aliases preserve equality used by transfer analysis. Raw
packets, user messages, and free-form notes still require manual review.
The report owner supervises generation, clipboard and download actions, retains
valid prior previews separately from errors, and suppresses stale copy completion
after workspace changes. Markdown controls do not change either named JSON mode.

Workbench sections are projected by NavigationStore from typed hash routes.
The seven sections have live `#/device/develop/<section>` and offline
`#/offline/report/develop/<section>` routes. The existing transactions, GATT,
and offline-report links retain their meaning. Section memory is keyed by the
runtime identity; search and filters remain presentation state, outside URLs.
Routes select views only. Missing session/report data presents a connect/reopen
state; unknown routes return Home without creating transport authority.

WorkspaceStore bounds continuity to one live runtime and one retained offline
report, with one active context. A synchronous live factory at composition
creates a fresh trace, transport, application/session state and transmission
subscriptions; static registry configuration can be shared. Cold Home remains
lazy. Connecting from an offline report never imports its investigation into
the live runtime or saves it as a live investigation. Chooser cancellation or
failure retains the report and reuses the prepared live candidate on retry.

Each runtime keeps its own identity and listeners until explicit close,
replacement, or application disposal. Switching does not disconnect live.
Retained live disconnects still reach the connection service and revoke
transmission authority and panel certainty; only its connection indicator is
projected into offline review. Replacement reports are parsed and built before
activation. Retired listeners are detached and each runtime is disposed once.

The composed presentation owners expose narrow typed, in-memory UI capture and
restore methods: navigation view/section; report search, filter, review note,
privacy/kind and errors; editor selection, settings and valid decoded previews;
notice errors/info; external-capture summary; and content render caches.
Restore never writes storage. Text drafts are context-local; saved content
preferences retain the existing schema with an empty text field. Decoded media
is retained by reference and checked against current profile/geometry.
Snapshots contain no ApplicationState, transport authority, running execution,
wake-lock ownership, confirmation digest or experimental unlock. Switching
cancels pending send confirmation and consumes session confirmation/unlock.
Report action generations advance even on a switch away and back.

Transfers, decode/import activity and guided flows block conflicting context
changes. Guided observation must be finished or explicitly closed as incomplete;
disconnect recovery remains available. Browser history can select available
contexts and sections, but cannot connect or confirm execution. Offline history
entries carry a report generation in history state, never in the URL; replaced
or closed generations show a reopen state. Reload loses in-memory contexts and
media and never reconnects. Modal Back closes the modal first; Forward restores
only the view. Heading focus changes with context/view/section, not ordinary
snapshot publications, and modal close returns to its trigger or heading.

## Family and registered execution contracts

IdentificationService derives a typed family basis bound to selected driver,
profile and fingerprint context: current live probe, recognized contributed
profile, historical, or unknown. Shared query/control claims do not stand in for
family identity. Driver operation requirements and restrictions only narrow the
canonical assessment; ordinary GetDeviceInfo, SetBrightness and SetPower sends
enforce both before central policy. Content/codec prerequisites remain separate.

Profile-free probes construct only the selected registered bounded probe. Their
correlated execution evidence and typed identification interpretation are
separate. Registered characterization is the other narrow exception: catalog
profile applicability, declared prerequisites, fixed operation and parameters,
live driver intent and plan consequence validation precede central policy.
TransmissionService’s registered query method accepts only a registered id and
constructs its own plan; public send/evaluate APIs have no readiness bypass.
The eventual claim outcome need not already be verified to run its test.

Guided orchestration distinguishes read-only non-persistent queries from the
existing persistent-content tests. Queries preserve panel belief and confirmation;
persistent content keeps staging, uncertainty, timing and resend guards. Catalog
snapshots validate declarations without compiling every plan. Failed attempts
settle even on preflight rejection. Late records update only their originating
investigation, including detached history, and cannot announce current-context
success, change replacement panel belief or consume replacement authority.
Bundle V3 and evidence entries retain their existing structures and IDs; reports
identify query execution from linked transaction risk/persistence evidence.

## Bounded machine discovery

DiscoveryService owns one in-memory interview per runtime. It coordinates the
existing connection, transmission, identification and protocol evidence owners
through narrow ports. It retains only a bounded step catalog, hypothesis ledger,
attempt summaries and transaction/response references, never packet copies or
human observations. The connected unfamiliar-display setup reads and identifies;
it does not characterize content or grant readiness for everyday use.

Application-authored family probes may contribute reviewed discovery metadata:
availability, fixed parameter domain, question, distinguishable families,
prerequisites, consequence, packet/byte/time bounds and stopping behavior.
Knowledge, uploaded profiles, imports and history cannot register executable
steps or grant authority. This first slice automatically runs only routine,
verified, read-only GetDeviceInfo probes. Experimental contributions end at a
review boundary even when a broad session unlock exists. Authored availability,
compiled plan eligibility and central policy all apply.

The deterministic planner ranks useful discrimination, fingerprint relevance,
prerequisite value and cost, then stable registered IDs. It uses no statistical
probabilities or registry insertion order. A legacy unmatched result, timeout,
malformed response or missing access never rejects another family. Only a
reviewed explicit negative meaning can contradict its declared family or
configuration scope. Conflicting reviewed family decoder interpretations remain
ambiguous; generic unmapped envelopes cannot displace structured identity.

An interview pins the runtime registry, connection generation, physical target,
profile/configuration, named steps and fixed domains. It permits at most four
attempts, eight packets, 2 KiB of query bytes and 30 seconds of reserved execution.
These limits comfortably cover the existing one-packet query and small distinct
checks while preventing an open-ended search. Reviewed bounds are checked before
plan construction; actual compiled bounds are reserved before dispatch. Replanning
cannot refill them or repeat an exhausted combination. A wall-clock deadline
stops subsequent scheduling; an unresolved browser operation retains ownership
until it settles. There is no retry, automatic reconnect or persistent resend.

Stop suppresses adoption and later scheduling immediately, while the existing
executor supervises the dispatched operation and retains its transaction. An
indeterminate write preserves quarantine recovery. Disconnect, replacement,
geometry/profile change or disposal retires the interview. Late results cannot
adopt replacement identity, geometry or notices. Conflicting runtime operations
and presentation workspace/profile transitions are blocked during ownership.
Geometry remains an explicitly adopted sourced proposal and never edits a manual
draft. Known iLedHat owners retain their existing normal-use path; connection
alone does not transmit. Development-only reviewed software fixtures prove a
multi-check sequence and are excluded from production builds and physical claims.
