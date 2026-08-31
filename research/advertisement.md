# Advertisement analysis

Evidence labels in this document mean:

- **VERIFIED** — directly present in the supplied capture or independently observed on the hardware
- **STRONGLY INFERRED** — supported by multiple consistent observations but not directly proven
- **SPECULATIVE** — plausible but lacks identifying evidence
- **UNKNOWN** — not established

## Exact capture

```text
0201060303F0FF0EFFAE315EEA07000001100020031E0809694C6564486174
```

## AD structures

| Offset | Bytes | Decode | Status |
|---:|---|---|---|
| 0 | `02` | following AD-structure length = 2 | VERIFIED |
| 1 | `01` | Flags AD type | VERIFIED |
| 2 | `06` | LE General Discoverable + BR/EDR Not Supported | VERIFIED |
| 3 | `03` | following AD-structure length = 3 | VERIFIED |
| 4 | `03` | Complete List of 16-bit Service UUIDs | VERIFIED |
| 5–6 | `F0 FF` | little-endian service UUID `0xFFF0` | VERIFIED |
| 7 | `0E` | following AD-structure length = 14 | VERIFIED |
| 8 | `FF` | Manufacturer Specific Data AD type | VERIFIED |
| 9–10 | `AE 31` | little-endian manufacturer/company identifier value `0x31AE`; its assignee was not independently verified | VERIFIED bytes / UNKNOWN identity |
| 11–21 | `5E EA 07 00 00 01 10 00 20 03 1E` | vendor-defined payload | VERIFIED bytes / UNKNOWN fields |
| 22 | `08` | following AD-structure length = 8 | VERIFIED |
| 23 | `09` | Complete Local Name AD type | VERIFIED |
| 24–30 | `69 4C 65 64 48 61 74` | UTF-8/ASCII `iLedHat` | VERIFIED |

## Geometry-looking bytes

`10 00 20` appears at absolute offsets 17–19, inside the vendor-defined manufacturer payload. The physical display is independently known to be 16×32, so `0x10` and `0x20` correlate with 16 and 32.

That correlation does **not** establish field boundaries, byte order, or semantics. Possibilities include separate one-byte dimensions with a zero separator, part of a wider integer, or unrelated flags/values. The repository therefore records the bytes but does not use them to configure geometry.

Status: **STRONGLY INFERRED correlation; UNKNOWN encoding**.
