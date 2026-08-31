# MatrixSmith architecture

## Dependency direction

```text
Control / Inspect / Lab UI
  -> MatrixController + MatrixSession
    -> semantic MatrixOperation
      -> statically registered MatrixDriver + DeviceProfile
        -> immutable TransmissionPlan
          -> SafetyPolicy
            -> AuthorizedTransmission
              -> TransmissionExecutor
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
- `src/drivers`: static registry and family implementations. A driver matches observations, resolves a profile, reports capabilities, plans operations, and optionally decodes notifications.
- `src/drivers/coolledx`: pure family codec, matcher, GATT declaration, transfer packing, and the first built-in profile.
- `src/app`: session lifecycle, central policy, exact-plan authorization, execution, and application orchestration.
- `src/diagnostics`: typed trace and versioned portable bundle serialization.
- `src/render`: arbitrary positive dimensions in row-major RGB888; hardware wire order is driver-owned.
- `src/storage`: small key/value abstraction and structured preset records.
- `src/main.ts`: modular vanilla TypeScript UI wiring only.

## Runtime versus portable evidence

`DeviceFingerprint` contains serializable observations: name, advertised services when observable, manufacturer/advertisement evidence when supplied, GATT shape, manual geometry, evidence references, and notes. It never stores `BluetoothDevice`, GATT server, service, or characteristic objects.

The live browser handles remain private to `WebBluetoothTransport`. `MatrixSession` owns the selected fingerprint/driver/profile and a memory-only experimental unlock. Disconnect clears both runtime handles and the unlock. Imported bundles use source `imported`; policy blocks them from TX even if matching resolves exactly.

## Driver versus profile

A driver is a protocol-family implementation such as CoolLEDX. A profile is reviewed knowledge about a physical product or revision such as `iledhat-31ae-32x16`. Multiple profiles may use one driver while differing in dimensions, orientation, limits, and validation. One product family may also change protocols across generations; FFF0/FFF1 and a CoolLED-like name are clues, not identity.

## Transmission boundary

Every device write starts as a semantic discriminated union. The selected driver creates one `TransmissionPlan` containing driver/profile identity, risk, persistence, validation, evidence references, endpoints, write mode, exact byte arrays and hex, ACK/retry/timeout policy, metadata, and recovery notes. Lab renders that object, and Send hands the same object to policy and executor.

See [ADR 0001](adr/0001-driver-oriented-architecture.md).
