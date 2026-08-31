# Testing

Run the complete hardware-independent gate:

```sh
npm ci
npm run typecheck
npm test
npm run build
git diff --check
```

Coverage includes advertisement fact extraction; arbitrary framebuffer dimensions; structured/legacy preset storage; scored and ambiguous matching; diagnostic round trips/import isolation; control framing and exact golden vectors; 128-byte transfer records and XOR checksums; 32×16 black/red/green/blue/white/corner/stripe bitplanes; safety blocks; FakeTransport execution order, failure, concurrency, disconnect, timeout, and host-versus-device result separation.

No automated test requires Bluetooth hardware. `ReplayTransport` rejects writes by construction. Physical promotion requires a saved diagnostic bundle plus a separate visible observation.

## First Galaxy S23 brightness validation

1. Deploy the green build over HTTPS and open it in current Chrome for Android with Bluetooth enabled.
2. Open MatrixSmith fresh; verify the banner says **Live TX locked**.
3. Tap **Connect display**, select only the known `iLedHat`, and wait for Connected.
4. In Inspect, verify selected driver CoolLEDX, profile `iledhat-31ae-32x16`, FFF0, FFF1, and READ/NOTIFY/WRITE WITHOUT RESPONSE.
5. Optionally tap **Explicit safe read**; the known unit previously returned zero bytes.
6. Open Lab. Keep the display visible and ensure no critical content is stored on it.
7. Check **Enable experimental TX for this session**.
8. Tap **Low test 0x40**. Inspect that the exact packet is `01 00 02 06 08 40 03`, then tap **Send this exact plan** once.
9. Treat “Host accepted” only as browser-stack acceptance. Record changed/no change/unexpected from the physical display.
10. If behavior is normal, create **High test 0xC0**, verify `01 00 02 06 08 C0 03`, send once, and record the result.
11. Download the diagnostic bundle before disconnecting. Disconnect; verify the session unlock clears.
12. On unexpected behavior, stop after step 8, disconnect, power off, and export the trace. Do not try other operations.
