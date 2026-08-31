# Testing

Run:

```sh
npm test
npm run build
```

Current unit coverage includes:

- exact BLE UUID constants
- captured advertisement structure parsing
- truncated-advertisement rejection
- hex logging and blocked-TX classification
- protocol fail-closed behavior
- 32×16 framebuffer size and addressing
- RGB888 host ordering and clamping
- bounds checks
- distinctive orientation-pattern corners

Protocol framing, checksum, fragmentation, response parsing, wire pixel packing, channel ordering, and golden packet vectors are intentionally absent because no verified format exists. Those tests must be added before the corresponding code.

## Galaxy S23 manual diagnostic check

1. Build and deploy over HTTPS.
2. Open in current Chrome for Android with Bluetooth enabled.
3. Tap **Connect to iLedHat** and select the device in the browser chooser.
4. Verify FFF0, FFF1, characteristic properties, and notifications show `yes`.
5. Tap **Safe read FFF1** and expect `RX <empty read>` unless the firmware behavior differs.
6. Power off the peripheral and confirm a `DISCONNECT` event and reset status.
7. Reconnect manually; no automatic write or pairing prompt should occur.

This procedure performs no characteristic write. Enabling notifications does write the standard CCCD through the browser BLE stack, matching the already-tested nRF Connect operation.
