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

Exact fixtures under `tests/fixtures/iledhat/` preserve advertisement, GATT, classic `08 FE`, initial `1F 01 CC`, `04 40`, and follow-up `1F 01 40` packets.
