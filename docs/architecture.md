# MatrixSmith architecture

## Dependency direction

```text
Control / Inspect / Lab UI
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
- `src/drivers/coolledux`: newer/advanced direct-command subset and safe `0x1F` probe.
- `src/profiles`: physical products independent of driver directory layout.
- `src/app`: session lifecycle, central policy, exact-plan authorization, execution, and application orchestration.
- `src/diagnostics`: typed trace and versioned portable bundle serialization.
- `src/render`: arbitrary positive dimensions in row-major RGB888; hardware wire order is driver-owned.
- `src/storage`: small key/value abstraction and structured preset records.
- `src/main.ts`: modular vanilla TypeScript UI wiring only.

## Runtime versus portable evidence

`DeviceFingerprint` separates requested discovery filters, browser-granted/accessible services, enumerated GATT, and genuinely observed/imported advertisement services. A request filter is never promoted to advertisement evidence. Runtime Bluetooth objects remain private to transport.

`MatrixSession` retains every raw notification, its optional rich decoded object, and protocol-resolution evidence. Trace metadata stays scalar. Imported bundles can replay captured resolution while policy blocks TX.

## Driver versus profile

A driver is a protocol-family implementation such as CoolLEDX or CoolLEDUX. A profile is reviewed physical-product knowledge. Static FFF0/F1 can leave generations tied; a safe semantic probe can add exact session evidence without mutating either static matcher.

## Transmission boundary

Every write starts as a semantic operation. The plan carries identity, purpose, explicit live intent, risk, validation, exact packets, and a serializable notification expectation. The response waiter is armed before BLE write so fast replies are not lost. Host acceptance, matching response, and state verification remain distinct.

See [ADR 0001](adr/0001-driver-oriented-architecture.md).
