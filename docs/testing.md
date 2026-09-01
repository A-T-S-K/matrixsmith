# Testing

Run the complete hardware-independent gate:

```sh
npm ci
npm run typecheck
npm test
npm run build
git diff --check
```

Coverage includes shared-envelope failures/round trips; exact 2026-08-31 hardware RX/TX; 48-byte and variable-length device-info parsing; conservative advertisement metadata; same-GATT ambiguity and probe resolution; offline replay; raw notification retention; pre-write waiter arming; unrelated-response timeout; CoolLEDX regressions; capability-driven safety; and host/protocol/state separation.

New in this branch: deterministic Markdown report generation (stable headings, exact packet preservation, identifier redaction defaults, imported-bundle reports, verified/inferred/unknown/rejected sections); protocol transaction recording (request/response correlation, timeout with unrelated raw RX preserved, read transactions, device verification, export/import round trip); diagnostic workflows (safe identification, the full brightness baseline/test/verify/restore/verify round-trip, restoration after test failure, surfaced restore failure, serialized runs); recommended-next-action derivation; the GATT explorer view model (read only where READ, subscribe only where notify/indicate, no generic write action); and default report privacy. A scripted CoolLEDUX device built from the captured fixtures (`tests/helpers/scripted-device.ts`) drives the workflow tests.

This branch adds: report-semantics tests (rejected profile hypotheses from stored evidence, distinct static-vs-protocol driver states, untested ≠ unsupported, captured advertisement geometry, support-state-advancing suggested tests); fixture-based nRF Connect importer tests built from the actual iLedHat capture evidence (GATT/TX/RX/timestamps/reads/notifications, correlation, driver decode, malformed and unknown lines, privacy redaction, no imported TX); CoolLEDUX compiler conformance against golden vectors generated from the pinned `CharlesLennon/coolledux-ble@4f5656d` checkout (`tests/fixtures/coolledux/conformance.json`) — the CRC, both LZSS variants, envelope escaping, announce, chunks, RGB444 encodings, tiling, and the complete Graffiti/Animation/GIF/border packet lists are byte-identical to the reference; LZSS decoder round trips including reference-produced streams; content-plan tests (profile-derived dimensions, pacing metadata, persistent classification); guided-validation tests (confirmation required, blocked ordinary send, coherent multi-packet transaction, single-use confirmation, structured answers, support-state advancement); executor pacing; bundle v1→v2 migration; content-settings persistence; and static service-worker regression guards.

To regenerate the conformance fixtures, clone the pinned reference into a temporary directory outside the repository, check out `4f5656d9882adb4926c9dff4dc3fa5783b40a7ac`, and run the generation snippet recorded in `research/coolledux-sources.md`.

No automated test requires Bluetooth hardware. `ReplayTransport` rejects writes by construction. Physical promotion requires a saved diagnostic bundle plus a separate visible observation.

## Verified iLedHat workflow

1. Deploy the green build over HTTPS and open it in current Chrome for Android with Bluetooth enabled.
2. Open MatrixSmith fresh; verify capability-driven safety is active.
3. Tap **Connect display**, select only the known `iLedHat`, and wait for Connected.
4. Diagnose should show CoolLEDX/CoolLEDUX static ambiguity and recommend safe identification. Tap **Run safe identification** deliberately; verify TX `01 00 02 05 1F 03` and a parsed `0x1F` response before CoolLEDUX resolves.
5. In Control, Refresh device information and confirm power plus raw brightness appear.
6. Move the raw 0–255 slider, then tap Apply once. Verify opcode `0x04`, separate host/echo status, and follow-up device-info readback.
7. In Develop → Transactions, verify each operation shows TX/RX raw hex, decoded fields, and host/protocol/device results, with copy on every packet. Unknown/malformed data must retain raw bytes in Raw events.
8. Download the bundle. Imported replay may reproduce resolution but must not transmit.

Exact fixtures under `tests/fixtures/iledhat/` preserve advertisement, GATT, classic `08 FE`, initial `1F 01 CC`, `04 40`, and follow-up `1F 01 40` packets. `tests/fixtures/nrf/iledhat-session.txt` reconstructs the same capture in nRF Connect's export format for importer tests.

## First hardware validation to run

The next physical step is **Validate static framebuffer** (Diagnose → Recommended next action). It previews the deterministic 32×16 orientation pattern (red/green/blue/yellow corners, white center, edge axes), states that it replaces the stored display content, transfers the tiled Graffiti program (1 announce + safe-LZSS chunks at 60 ms pacing) only after an explicit confirmation, and then records structured answers about corners, colors, tile seams, canvas coverage, and background. A pass unlocks Control's content sends for the session and advances the recommendation to **Validate animation**. Do not chain further experimental content on assumed success — each capability is validated by its own workflow.

## Guided investigation coverage (2026-08-31 revision)

New suites cover: atomic claims (partial observations never verify broad capabilities; rejected prerequisites block; autonomous loop ≠ power-cycle persistence; upload ≠ content semantics; scope precedence), the Investigation object (record/stop/resume, symptom goals, JSON round trip), the guided test engine (availability from claims and completed tests, confirmation-required transfers, structured observations → claim evidence, stopwatch durations measured from the final host-accepted write, raster-strategy selection), the recommendation engine (generic action model, passed tests not re-recommended, advanced discriminators promoted for blockers, symptom focus bias, optional work never outranking unresolved core), the fixed diagnostic content (raw 0x0000/0x0004 preservation, single-changed-byte stayTime variants, single/identical-pair animation rasters, exact untransformed raw channel words, no arbitrary ids or parameter values), receipts/timing (structural decoding, missing-receipt-as-observation, real per-packet timestamps and gap math), reports (all sections for test/investigation/forensic formats, compact-by-default packet exemplars, scope labeling, bundle round trip with scope demotion), local history (persistence, resume demotion, forget, no safety tokens), advertisement enrichment (structured observations, unsupported fallback, no fabricated raw bytes, chooser-free reconnect with fallback), path gating, and safety invariants (no retry, session-only unlock, profile immutability, no password/OTA/firmware operations).

## The physical sequence MatrixSmith now recommends

With the shipped iLedHat evidence, reconnecting the display and opening Investigate recommends, in claim-driven order: (1) show a still image via the animation path, (2) test static-image black behavior, (3) measure static-image movement, then the stayTime 3-vs-0 comparison when movement was observed, (4) identify the color channels (including the high-nibble white hypothesis), (5) check color/white quality once channels are mapped, and only then optional GIF / power-cycle / recovery work. The app itself surfaces each next test — no external notes are needed to remember the sequence.
