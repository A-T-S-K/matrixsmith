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

No automated test requires Bluetooth hardware. `ReplayTransport` rejects writes by construction. Physical promotion requires a saved diagnostic bundle plus a separate visible observation.

## Verified iLedHat workflow

1. Deploy the green build over HTTPS and open it in current Chrome for Android with Bluetooth enabled.
2. Open MatrixSmith fresh; verify capability-driven safety is active.
3. Tap **Connect display**, select only the known `iLedHat`, and wait for Connected.
4. Inspect should show CoolLEDX/CoolLEDUX static ambiguity. Tap **Run safe protocol probe** deliberately; verify TX `01 00 02 05 1F 03` and a parsed `0x1F` response before CoolLEDUX resolves.
5. In Control, Refresh device information and confirm power plus raw brightness appear.
6. Move the raw 0–255 slider, then tap Apply once. Verify opcode `0x04`, separate host/echo status, and follow-up device-info readback.
7. In Lab, verify every notification shows timestamp, RAW RX, family/opcode/type, and decoded fields. Unknown/malformed data must retain raw bytes.
8. Download the bundle. Imported replay may reproduce resolution but must not transmit.

Exact fixtures under `tests/fixtures/iledhat/` preserve advertisement, GATT, classic `08 FE`, initial `1F 01 CC`, `04 40`, and follow-up `1F 01 40` packets.
