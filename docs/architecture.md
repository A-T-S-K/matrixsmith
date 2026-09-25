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

- Workspace owns active and retained-live runtimes. Replacing an offline report retires its runtime; opening a report does not disconnect the retained live device.
- Navigation owns routes, overlays, Browser Back behavior, and listener disposal.
- Notice owns operation IDs and the active-operation collection. Completion of one operation cannot clear another operation's busy indication.
- Content editor owns files/previews and latest-selection generations. Stale work cannot replace a newer preview or cross workspace boundaries.
- Guided controller exclusively owns mutable guided UI flow. Pure domain transitions and read-only projections remain separate from that ownership.
- Snapshot owns publication and subscriptions. Disposal suppresses later publications.

The cohesive guided controller is larger than the old per-file limit. File length is a review signal, not an excuse to split one mutable state across inheritance layers. The public facade also contains explicit API bindings; it contains no feature logic.

Browser environment construction occurs in adapters invoked by bootstrap. Feature constructors receive only the storage, file, route, Wake Lock, discovery, or workspace-factory capabilities they use. Tests supply explicit environments, including in-memory persistence.

## Boundaries and lifecycle

The native TypeScript compiler resolves imports, re-exports, and dynamic imports for architecture verification. The gate rejects runtime cycles, concrete-driver imports in generic layers, browser-adapter imports in application/presentation services, and implementation inheritance in services/controllers.

Runtime disposal disconnects owned transports and releases subscriptions. Presentation disposal releases routing, Wake Lock, previews, snapshots, and owned workspaces. State transitions retain the existing target/digest, quarantine, evidence-demotion, and notification-correlation invariants.

## Files and updates

File buttons catch both synchronous failures and rejected promises. Bounded readers check file sizes before allocation; PNG/JPEG/WebP headers are inspected before decoding, and bitmap dimensions are checked again before canvas allocation. Bundle validation precedes workspace mutation.

A single update manager spans cold Home and the full application. Build identity is derived from source/build inputs and package version. The production worker precaches a complete generation and serves its matching shell, retaining the previous successful generation. Explicit activation waits for readiness from every open app tab, and operational errors remain visible independently of update availability.

No backend, cloud persistence, analytics, or runtime third-party service is introduced by this architecture.
