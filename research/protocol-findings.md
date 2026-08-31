# iLedHat protocol findings

Research and hardware-validation date: 2026-08-31

## Current decision

The physical 32×16 `iLedHat` is a hardware-verified **CoolLEDUX** device. CoolLEDX and CoolLEDUX share FFF0/FFF1 and the `0x01…0x03` escaped envelope, so static browser-visible GATT evidence is honestly ambiguous. An explicit read-only CoolLEDUX `0x1F` device-info probe resolves the protocol family for a session.

The earlier CoolLEDX hypothesis is retained as rejected evidence: classic brightness TX `01 00 02 06 08 40 03` produced RX `01 00 02 06 08 FE 03` and no visible brightness change. The decoded payload is `08 FE`; `FE` is rejection/error-like in this observation, but its exact semantics are not mapped.

## Physical evidence

| Fact | Result |
|---|---|
| BLE name / scanner address | `iLedHat` / `01:00:00:21:CC:99` |
| service / characteristic | FFF0 / FFF1 |
| properties | READ, NOTIFY, WRITE WITHOUT RESPONSE |
| manufacturer company field | `AE 31` = `0x31AE` little-endian |
| vendor identifier bytes | `5E EA 07 00 00 01`; semantics unknown, not called a MAC |
| advertisement layout | height 16, width BE16 32, `colorModeRaw=3`, `firmwareRaw=30` |
| initial `0x1F` response | 48-byte payload beginning `1F 01 CC` |
| brightness TX / RX | `01 00 02 06 04 40 03` / identical echo |
| physical result | panel visibly dimmed |
| follow-up `0x1F` response | 48-byte payload beginning `1F 01 40` |

Confirmed device-info prefix only: payload byte 0 is opcode `0x1F`, byte 1 is power state (`0x01` observed on), and byte 2 is raw brightness. All later bytes remain opaque and are preserved exactly. The parser intentionally accepts other response lengths with the same minimum prefix.

## Shared wire facts

Both generations use:

```text
01 || escape(length_be16 || payload) || 03
01 -> 02 05
02 -> 02 06
03 -> 02 07
```

MatrixSmith shares only GATT constants, envelope encoding/decoding, and conservative advertisement-layout parsing. Commands, capabilities, matching resolution, and response semantics remain generation-specific.

## CoolLEDUX direct commands in this branch

| Operation | Opcode | iLedHat validation | Live status |
|---|---:|---|---|
| GetDeviceInfo | `1F` | verified structured response | explicit live query/probe |
| SetBrightness | `04 level` | verified at `40`, observed initial `CC` | explicit live Control |
| SetPower | `05 bool` | external-source confirmed, not iLedHat-tested | dry-run only |
| Mirror | `0C bool` | external-source confirmed, not iLedHat-tested | not exposed live |

Golden vectors:

```text
device info       01 00 02 05 1F 03
brightness 40     01 00 02 06 04 40 03
brightness CC     01 00 02 06 04 CC 03
classic rejected  01 00 02 06 08 40 03 -> 01 00 02 06 08 FE 03
```

## Stored-program pipeline (implemented offline, awaiting physical validation)

The CoolLEDUX stored-program pipeline is now fully implemented and conformance-tested offline: custom CRC32 announce (`0x02`), safe/regular LZSS, 128-byte compressed chunks (`0x03`) with XOR checksums, dual RGB444 encodings with per-path off sentinels, ≤8-column tiling at full profile height, tiled Graffiti static frames, rendered text via an embedded 5×7 font, tiled pixel animation, native GIF (`0x0C`), and the decorative frame border (`0x04`). See [coolledux-sources.md](coolledux-sources.md) for provenance and the byte-for-byte conformance cross-check against the pinned reference.

Every content capability is classified **experimental + persistent** for this iLedHat until the guided hardware validations pass:

| Capability | Offline status | iLedHat status |
|---|---|---|
| Static frame (tiled Graffiti) | conformance-verified | not tested — first physical step: **Validate static framebuffer** |
| Pixel orientation / color encoding | deterministic 32×16 diagnostic pattern ready | not tested |
| Rendered text / image | share the Graffiti pipeline | not tested (unlocked by static-frame pass) |
| Animation | conformance-verified; two-frame diagnostic ready | not tested |
| GIF | conformance-verified framing; upstream-tested only ≤8 columns | not tested |
| Recovery | — | unknown; one observation: a long-ish inline power-button action displayed `reset` and restored the default scrolling `coolled` text; exact timing/class unknown; no automatic restoration is implemented or claimed |

## Rejected hypotheses

- Classic CoolLEDX brightness semantics for this profile (`0x08` → `08 FE`, no visible change; exact `0xFE` semantics unmapped).
- Advertisement byte `0x1E` as battery state-of-charge; the byte position corroborates a raw firmware/version field.

Password set and OTA are not implemented.
