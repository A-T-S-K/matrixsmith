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
