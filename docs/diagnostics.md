# Diagnostics and offline evidence

MatrixSmith exports a versioned JSON bundle only when the user taps Download. Nothing is uploaded.

## Version 2 shape

```text
schemaVersion (2), matrixsmithVersion, createdAt
fingerprint
driverMatches, selectedDriver, selectedProfile
capabilities
trace
observations
advertisementEvidence
transactions
diagnosticRuns
validations          — structured hardware-validation results
contentCompilations  — compiled-program metadata (type, tiles, CRC, sizes, chunks, pacing)
importedEvidence     — external-import summaries (provenance, counts, warnings)
```

Version 1 bundles remain readable: import migrates them by defaulting the new collections to empty. Binary image/GIF payloads are never embedded in the bundle; content evidence is metadata plus the exact TX packet hex already retained by transactions.

`transactions` are higher-level serializable protocol transactions (semantic operation, driver/profile, safety, ordered TX packets, raw RX packets, decoded response, host/protocol/device verification, timeout/error, findings). `diagnosticRuns` capture named workflow executions with per-step results and restoration state. Raw `trace` events remain the lowest-level ground truth underneath both.

Raw RX/TX bytes serialize as uppercase hexadecimal. The fingerprint contains portable observations, not browser Bluetooth objects. Trace types cover app startup, selection, matching, GATT lifecycle, reads/notifications, plan creation/authorization/blocking, packet host acceptance/failure, decoded notifications, observations, disconnect, and errors. Unknown notifications remain as raw events.

Import validates top-level metadata, fingerprint shape, match/trace/observation collections, and schema version. It creates an offline `imported` session. Matching, profile resolution, capabilities, Diagnose/Develop review, trace display, and decoder work can run offline, but policy rejects every imported transmission. `ReplayTransport` similarly replays notifications and throws on write.

## External capture import (nRF Connect)

`src/diagnostics/importers.ts` implements the nRF Connect text-log importer. It conservatively extracts device name, connection timestamps, service discovery (normalized UUIDs and characteristic properties), descriptor writes/notification enablement, characteristic reads, TX writes, RX notifications, exact packet bytes, and clearly identifiable errors. It invents no packet semantics: extracted bytes are decoded by the installed drivers afterwards, TX/RX are correlated by endpoint, timing, and envelope opcode, and unmatched packets are preserved as their own transactions. BLE/MAC addresses stay out of the fingerprint and out of shareable Markdown by default; imported error text is redacted. Importing never creates a transmitting session — a live session gains labeled read-only evidence, otherwise an offline imported session opens. Unknown lines are counted and reported, never silently discarded.

## Hardware validation results

Guided validation workflows (`src/diagnostics/validation.ts`) transfer diagnostic content once after an explicit consequence confirmation, then record structured yes/no/unsure answers about the physical panel. Results are session-scoped `SessionValidationResult` records with validated and rejected areas; they drive the Diagnose support matrix, the report's support table, and the deterministic suggested next tests. Profile metadata is never silently promoted by a runtime result — the report provides the reviewable evidence for any permanent change.

## Privacy

Included: selected device evidence, accessible GATT, exact plan/RX/TX trace, user-entered observations, and match explanations. Excluded by default: unrelated nearby devices, geolocation, arbitrary local storage, browser fingerprint noise, and unrelated personal data.

Before sharing, review free-form device names, browser device IDs, notes, display-content observations, and exact traffic for information you do not want to disclose.

## Markdown report

**Share report** in the device header generates deterministic Markdown from domain/session data (`src/diagnostics/report.ts`), never from the DOM. Stable headings cover goal, executive summary, a support-status table, fingerprint, GATT, advertisement evidence (observed vs. profile provenance), driver resolution with rejected hypotheses, device state, capabilities, diagnostic runs, transactions with literal hex, observations, verified/inferred/unknown/rejected facts, deterministic suggested next tests, reproduction environment, a protocol transcript table, and the user's analysis request. Browser/device identifiers and the full raw event trace default to excluded; the report states when identifying information is included. The JSON bundle remains the canonical machine-readable artifact, downloadable from the same dialog.

## Useful device-support bundle

From Home choose **Explore unknown BLE device** to open the inspection chooser (the controller accepts extra service UUID hints; a UI field for them is planned), select the device, inspect permitted GATT, perform only explicit reads, subscribe only to intended notify characteristics, reproduce one labeled behavior, add manual observations, and export. State what Chrome could not enumerate. Web Bluetooth reveals only services granted through chooser filters/`optionalServices`; missing services are not evidence that the peripheral lacks them.

## Guided investigation evidence (2026-08-31 revision)

The diagnostic bundle additionally carries the active `investigation` (goal, device binding, completed guided tests with structured observations, and session claim evidence). Importing a bundle structurally demotes EVERY investigation claim-evidence entry to `imported-external` — serialized scope fields are never trusted — and bundle-carried legacy validations bridge as `imported-external` too. Imported evidence never authorizes live operations.

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
