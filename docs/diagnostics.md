# Diagnostics and offline evidence

MatrixSmith downloads a versioned JSON bundle only when the user requests it.
Markdown previews, copy, and downloads are supervised separately. Nothing is uploaded.

## Version 3 shape

```text
schemaVersion (3), privacy, matrixsmithVersion, createdAt
fingerprint
driverMatches, selectedDriver, selectedProfile
provisionalProfile? — historical geometry snapshot with scalar source metadata
capabilities
assessment
trace
observations
advertisementEvidence
transactions
diagnosticRuns
contentCompilations  — compiled-program metadata (type, tiles, CRC, sizes, chunks, pacing)
importedEvidence     — external-import summaries (provenance, counts, warnings)
investigation        — guided tests, observations, claims, device binding and orchestration
```

Version 1 and 2 bundles are rejected; no automatic migration is implemented.
Original image/GIF files are never embedded in the bundle; compiled content
evidence is metadata plus exact TX packet hex retained by transactions. Packet
data can still reveal display content.

`transactions` are higher-level serializable protocol transactions (semantic operation, driver/profile, safety, ordered TX packets, raw RX packets, decoded response, host/protocol/device verification, timeout/error, findings). `diagnosticRuns` capture named workflow executions with per-step results and restoration state. Raw `trace` events remain the lowest-level ground truth underneath both.

Raw RX/TX bytes serialize as uppercase hexadecimal. The fingerprint contains portable observations, not browser Bluetooth objects. Trace types cover app startup, selection, matching, GATT lifecycle, reads/notifications, plan creation/authorization/blocking, packet host acceptance/failure, decoded notifications, observations, disconnect, and errors. Unknown notifications remain as raw events.

Import enforces input budgets, then runs the generated structural validator
(`src/diagnostics/generated/bundle-validator.js`) and semantic validation in
`src/diagnostics/bundle.ts` before workspace mutation. It creates an offline
`imported` session. Matching, profile resolution, capabilities, Investigate/Develop
review, trace display, and decoder work can run offline, but policy rejects every
imported transmission. `ReplayTransport` similarly replays notifications and
throws on write.

## External capture import (nRF Connect)

`src/diagnostics/importers.ts` implements the nRF Connect text-log importer. It conservatively extracts device name, connection timestamps, service discovery (normalized UUIDs and characteristic properties), descriptor writes/notification enablement, characteristic reads, TX writes, RX notifications, exact packet bytes, and clearly identifiable errors. It invents no packet semantics: extracted bytes are decoded by the installed drivers afterwards, TX/RX are correlated by endpoint, timing, and envelope opcode, and unmatched packets are preserved as their own transactions. BLE/MAC addresses stay out of the fingerprint and out of shareable Markdown by default; imported error text is redacted. Importing never creates a transmitting session — a live session gains labeled read-only evidence, otherwise an offline imported session opens. Unknown lines are counted and reported, never silently discarded.

## Hardware validation results

Driver-contributed guided tests (`src/investigation/tests.ts`) transfer fixed
diagnostic content after explicit consequence confirmation, then record structured
observations in completed guided tests and claim evidence. Application catalog,
orchestration, and observation services own execution and validation. There is no
`SessionValidationResult` collection or `src/diagnostics/validation.ts` module.
The canonical assessment drives availability and reports; recommendations also
consider historical evidence and execution history. Profile metadata is never
silently promoted by a runtime result — reports provide reviewable evidence for a
permanent source change. Simulator and authored fixture results are software
evidence only.

## Privacy

Included: selected device evidence, accessible GATT, exact plan/RX/TX trace, user-entered observations, and match explanations. Excluded by default: unrelated nearby devices, geolocation, arbitrary local storage, browser fingerprint noise, and unrelated personal data.

Before sharing, review free-form device names, browser device IDs, notes, display-content observations, and exact traffic for information you do not want to disclose.

## Markdown report

**Share report** in the device header generates deterministic Markdown from domain/session data (`src/diagnostics/report.ts`), never from the DOM. Stable headings cover goal, executive summary, a support-status table, fingerprint, GATT, advertisement evidence (observed vs. profile provenance), driver resolution with rejected hypotheses, device state, capabilities, diagnostic runs, transactions with literal hex, observations, verified/inferred/unknown/rejected facts, deterministic suggested next tests, reproduction environment, a protocol transcript table, and the user's analysis request. Browser/device identifiers and the full raw event trace default to excluded; the report states when identifying information is included. The JSON bundle remains the canonical machine-readable artifact, downloadable from the same dialog.

## Useful device-support bundle

From Home use **Explore unknown BLE** → **Choose device**, entering suspected
services in **Optional service UUIDs** first. Select the device, inspect permitted
GATT, perform only explicit reads, subscribe only to intended notify
characteristics, reproduce one labeled behavior, add manual observations, and
export. State what Chrome could not enumerate. Web Bluetooth reveals only services
granted through chooser filters/`optionalServices`; missing services are not
evidence that the peripheral lacks them.

## Guided investigation evidence (2026-08-31 revision)

Bundle V3 additionally carries the canonical assessment and active investigation (goal, device binding, completed guided tests with structured observations, and session claim evidence). Importing structurally demotes every investigation claim-evidence entry to `imported-external`; serialized scope fields are never trusted. Imported evidence never authorizes live operations.

The portable contract is published as [`public/bundle-v3.schema.json`](../public/bundle-v3.schema.json). Its generated standalone validator executes in the browser before semantic checks and sanitization; `schema:check` verifies generated output. Runtime checks also validate nested values and byte/count budgets before workspace mutation. Schema tests keep the published contract aligned with serialized Bundle V3 output.

Three report formats exist beyond the classic device report:

- **Test report** (`testReportMarkdown`) — one guided test: question, device, existing relevant evidence with scope labels, why the test ran, exact parameters, safety, protocol operation, compiler/transmission summary, automatic observations (receipt correlation and measured timing), structured physical observations, result, establishes/rejects/unknowns, recommended next discriminator, transaction summaries, a few representative packet exemplars (never a full dump), reproduction info, and an explicit AI task.
- **Investigation report** (`investigationReportMarkdown`) — everything an AI needs to implement or repair support without the chat history: objective, identity, advertisement/GATT, protocol candidates, per-area claim sections (stored programs, tiling/orientation, black/off per content path, channel mapping, color, animation, static, text/image/GIF, controls, persistence/recovery), all tests and observations, a full claims-and-confidence table with scopes, rejected and open hypotheses, quirks-derived limitations, driver/profile recommendations, and an AI task request.
- **Forensic appendix** (`forensicReportMarkdown`) — every packet with real per-write timestamps, measured gaps, host-acceptance times, and receipt/timing analysis per stored-program upload.

Stored-program receipts decode structurally (`program-announce-receipt`, `program-chunk-receipt` with `statusRaw` and a structural `chunkIndex`). Status `0x00` is reported as a raw byte observed alongside physically successful uploads — never labeled "success" — and a missing receipt is never treated as a transmission failure or a retry trigger.

## Hardened report semantics (2026-08-31, phase 2)

- The investigation report includes the structured live Web Bluetooth advertisement observation (name, RSSI, tx power, advertised service UUIDs, manufacturer/service data), explicitly labeled `source: web-bluetooth-watch`; when nothing was captured the report says so and never fabricates raw bytes.
- The claims table separates the INVESTIGATIVE status (what all evidence says, historical contradictions included) from the OPERATIONAL basis (trusted current-session/built-in authorization, or "derived" for the static strategy). An "Evidence trust and conflicts" section breaks multi-scope claims down per scope and marks CONFLICT where historical/imported evidence contradicts a trusted basis, recommending revalidation.
- A "Static image strategy assessment" section renders the derived per-requirement viability for graffiti, animation-single-frame, and animation-identical-frames from the same evaluator that powers gating — including the measured Graffiti stayTime timing comparison when both runs exist.
- Scoped test reports include a "Physical timing" section: T0 (final host-accepted write), T1 (full raster visible), T2 (movement/observation end), render latency, and visible static hold — measured by the MatrixSmith timer and kept distinct from per-packet transport timing.
- A characterized channel permutation is flagged as ENCODER CORRECTION REQUIRED with the observed vs emitted maps, an explicit instruction to fix the driver/profile in code, and a reminder that normal image/text sending stays gated until re-verification.
- Abandoned tests (transfer completed, observation stopped) keep their transactions and partial observations and still produce a test report.

The optional `provisionalProfile` remains Bundle V3: older V3 bundles without it
still validate. It contains experimental geometry and empty profile evidence,
using existing profile metadata for manual/reported source and response provenance.
Validation checks geometry limits, selected driver/profile consistency and the
original successful correlated identification transaction for reported dimensions.
Both archive modes retain dimensions, source, driver, transaction linkage and
timestamps. Shareable JSON omits the geometry browser device ID and replaces
geometry fingerprint/connection keys with output-local aliases; known identifiers
repeated in interpretation rationale are redacted. Default Markdown projections
apply the same policy and preserve equality between repeated binding keys. Full
local archives retain the original provenance, and privacy projection never mutates
the source archive or live state. Import restores only historical
geometry, including when that driver is absent locally. It never creates an eligible
proposal, a current family claim, an unlock or confirmation. A live connection
always requires new identification and explicit adoption.

### Workbench review windows

Transactions, selected-transaction packets, and raw events use explicit pages of
50 records. Transaction and raw-event windows open newest first and retain their
identities while records arrive. **Show latest** starts a new window on page one.
Search and filter changes also restart transaction paging; they search the full
capture's operation, driver, decoded summary/opcode, and exact packet hex, not
just the visible page. Retention leaves unavailable slots rather than silently
substituting another record. Packet numbering is the original zero-based index.
Reports and bundle exports still contain all retained evidence.

Search, filter, pages, selection, and list position are in-memory workspace review
state. A transaction detail URL selects an opaque ID within a retained runtime;
its browser history entry also binds the runtime generation. Reloads and old
history from replacement reports require reopening the intended context. URLs do
not restore live connections, permissions, or evidence. Browser Back returns to
the list and restores its row focus and scroll position when the row survives.

Host acceptance, correlated acknowledgement, and operation-response fulfillment
are independent recorded dimensions. The executor's `deviceStateVerified` flag
means a matching response fulfilled the operation expectation. It is not proof of
physical appearance or separate readback; physical observations remain separate.

Projection caches belong to one workspace review owner. Transaction, compilation,
and trace mutation revisions cover in-place edits, imports, and same-length
retention. Unrelated publications reuse filtering and joins. Compilation joins
preserve the first matching record for retained transaction IDs and refresh when
that ID membership changes. Disposal clears the active review caches. The caches
retain references and identities,
not extra normalized copies of large packet strings. Replacing or disposing a
workspace releases its captured review state; no global evidence cache is used.
