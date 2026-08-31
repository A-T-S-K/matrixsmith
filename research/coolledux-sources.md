# CoolLEDUX source provenance

MatrixSmith's TypeScript implementation was written independently from protocol facts and conformance vectors. Python source was not copied or mechanically translated.

## Primary source

- Repository: `CharlesLennon/coolledux-ble`
- Commit: `4f5656d9882adb4926c9dff4dc3fa5783b40a7ac`
- License: MIT
- Consulted: `PROTOCOL.md`, `coolledux/wire.py`, `coolledux/commands.py`, `coolledux/ble.py`, `README.md`, and `LICENSE`
- Facts used: FFF0/FFF1, write without response, notifications on FFF1, shared envelope/escaping, brightness `0x04`, power `0x05`, mirror `0x0C`, device info `0x1F`, and the documented distinction between newer CoolLEDUX and older CoolLEDX.

The source reports hardware testing on another CoolLEDUX sign and a roughly 30-byte device-info response. The exact iLedHat returned 48 bytes, so MatrixSmith parses a confirmed prefix and preserves the remainder rather than imposing the source device's length.

## Evidence boundaries

The source documents brightness across raw 0–255. The iLedHat directly verifies `0x40`; `0xCC` was observed in device-info state before the change. Power and mirror remain dry-run-only because external confirmation on another unit does not establish behavior or persistence on this iLedHat.

Stored-program details in the source were reviewed only to define the next branch's scope; they are not implemented here.
