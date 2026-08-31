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

## Explicitly deferred

The CoolLEDUX stored-program pipeline—CRC32 announce, LZSS, compressed chunks, RGB444 content, text, images, animation/GIF, Graffiti, borders, and tiling—is next-branch work. Password set and OTA are not implemented.
