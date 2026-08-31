# MatrixSmith architecture

## Dependency direction

```text
Preact UI (Home / Control / Diagnose / Develop / Report)
  -> MatrixStore (immutable AppSnapshot + subscription)
    -> MatrixController + MatrixSession
    -> semantic MatrixOperation
      -> statically registered MatrixDriver + DeviceProfile
        -> immutable TransmissionPlan + serializable response expectation
          -> SafetyPolicy
            -> AuthorizedTransmission
              -> TransmissionExecutor + pre-write NotificationRouter waiter
                -> MatrixTransport
                  -> Web Bluetooth / Fake / Replay

Scene / Framebuffer / FrameSequence
  -> logical RGB888 rendering
    -> driver-specific quantization and packing
      -> TransmissionPlan
```

The UI never calls a characteristic write. A driver plans bytes but cannot access a browser device. The executor accepts only an authorized plan, sends its existing packet objects in order, and does not re-encode after approval.

## Responsibilities

- `src/core`: serializable fingerprints and profiles, evidence/validation, capabilities, risk, operations, and transmission artifacts.
- `src/discovery`: generic advertisement parsing and fact extraction. Hypotheses stay out of the parser.
- `src/transport`: browser/runtime I/O. `WebBluetoothTransport` knows chooser semantics, connections, endpoints, reads, notifications, writes, and host receipts; it contains no FFF0, opcode, or geometry constants.
- `src/drivers`: one central built-in list and independent family implementations. Drivers own matching, endpoints/probes, planning, notification decoding, and response matching.
- `src/drivers/coolled/common`: only shared FFF0/FFF1, envelope, conservative advertisement parsing, and static transport-shape matching.
- `src/drivers/coolledx`: older/simple commands and content codec; it no longer owns the iLedHat profile.
- `src/drivers/coolledux`: newer/advanced direct-command subset, the safe `0x1F` probe, and the stored-program compiler (`wire.ts` CRC32/LZSS/announce/chunks, `pixels.ts` RGB444 encodings and off sentinels, `content.ts` tiling and Graffiti/Animation/GIF/border program builders). Content plans are multi-packet, carry per-packet pacing metadata (`delayAfterMs`), and declare persistent risk honestly; the executor owns inter-packet timing, never the codec.
- `src/profiles`: physical products independent of driver directory layout.
- `src/app`: session lifecycle, central policy, exact-plan authorization, execution, and application orchestration.
- `src/diagnostics`: typed trace, serializable protocol transactions and diagnostic workflow runs, versioned portable bundle serialization (v2 with v1 migration), the deterministic Markdown report generator, the support-state matrix (`support.ts`), structured hardware-validation workflows (`validation.ts`), content-compilation evidence records (`content-evidence.ts`), and the implemented nRF Connect text-log importer (`importers.ts`).
- `src/render`: arbitrary positive dimensions in row-major RGB888; hardware wire order is driver-owned. Includes the embedded 5×7 bitmap font/rasterizer (`font.ts`), browser-side image fit/decoding (`image.ts`), and deterministic diagnostic patterns (`patterns.ts`).
- `src/storage`: small key/value abstraction, structured preset records, and small-JSON content settings (`settings.ts`); binary media never enters localStorage.
- `src/ui`: Preact pages/views/components plus `MatrixStore`, which turns controller/session/trace state into an immutable `AppSnapshot` consumed via `useSyncExternalStore`. Components invoke semantic store/controller operations only; domain and protocol logic never lives in components.
- `src/main.tsx`: composition root wiring transport, trace, controller, store, and the Preact render.

## Runtime versus portable evidence

`DeviceFingerprint` separates requested discovery filters, browser-granted/accessible services, enumerated GATT, and genuinely observed/imported advertisement services. A request filter is never promoted to advertisement evidence. Runtime Bluetooth objects remain private to transport.

`MatrixSession` retains every raw notification, its optional rich decoded object, and protocol-resolution evidence. Trace metadata stays scalar. Imported bundles can replay captured resolution while policy blocks TX.

## Driver versus profile

A driver is a protocol-family implementation such as CoolLEDX or CoolLEDUX. A profile is reviewed physical-product knowledge. Static FFF0/F1 can leave generations tied; a safe semantic probe can add exact session evidence without mutating either static matcher.

## Transmission boundary

Every write starts as a semantic operation. The plan carries identity, purpose, explicit live intent, risk, validation, exact packets, and a serializable notification expectation. The response waiter is armed before BLE write so fast replies are not lost. Host acceptance, matching response, and state verification remain distinct.

See [ADR 0001](adr/0001-driver-oriented-architecture.md).
