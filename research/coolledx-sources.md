# CoolLEDX source provenance

MatrixSmith's TypeScript codec was independently implemented from protocol behavior and byte-level facts. No upstream source file was copied or mechanically translated.

## Primary A: `jean-santos/coolled1248-rs`

- Commit: `55d008237c2bcc96bd9c5d34b7c221b3325e71fa`
- License: dual MIT OR Apache-2.0 as declared by the repository
- Consulted: `src/packets.rs`, `src/util.rs`, `src/coolled.rs`, license files, and embedded tests
- Facts used: opcodes 0x02–0x09; `0x01 || escaped(length_be16 || payload) || 0x03`; escaping 01/02/03 to 02 05/06/07; XOR checksum; 128-byte transfer chunks; record fields; 24-byte content prefix; image length prefix; animation frame/speed prefix; control golden vectors
- Reuse: behavioral extraction only; independent TypeScript implementation

The pinned Rust tests expose brightness `0x10`, speed `0x10`, static mode, and switch on/off vectors. The local environment did not contain Cargo, so the checkout could be inspected but its suite could not be executed here.

## Primary B: `UpDryTwist/coolledx-driver`

- Commit: `ba24137a4fb63b44896143adbd5862ef74de9fff`
- License: MIT, copyright 2025 Greg Tatham
- Consulted: `README.md`, `src/coolledx/basic_protocol.py`, `commands.py`, `render.py`, `hardware.py`, `message_handler.py`, and `tests/test_command.py`
- Facts used: framing/escaping; scored hardware caution distinguishing CoolLEDX from incompatible CoolLEDM; 16×32 discovery precedent; transfer record layout; errors including checksum 0x06; RGB plane packing (column-major, top pixel MSB, threshold); image/animation headers and dry-run shapes
- Reuse: behavioral extraction only; independent TypeScript implementation

The pinned `BasicProtocol.create_command` was executed from the temporary checkout with its exact framing method and an injected copy of that repository's own escape semantics (needed because the standalone class expects mixin behavior). It produced:

```text
brightness 10  01000206081003
brightness 40  01000206084003
brightness C0  0100020608C003
speed 10       01000206071003
mode static    0100020606020503
switch off     01000206090003
switch on      0100020609020503
```

These match MatrixSmith byte-for-byte. The full Python package could not import under the host Python 3.9 because the pinned package imports `enum.StrEnum` (Python 3.11+). Its checked-in image/animation tests and source were inspected rather than modified.

## Secondary corroboration only

`schulzad/coolled-sign-controller` at `430fc716aa0d3d1355ac27d7c1ad9ee62bf054cf` had no visible project license when this work was scoped. No code was copied or used as an implementation source. Public protocol descriptions and hardware observations may corroborate claims but do not elevate them above the licensed primaries.

## Discrepancies and limits

The licensed sources agree on the tested control framing, opcodes, transfer structure, XOR checksum, and pixel-plane direction. Primary A clamps brightness/speed below `0x10`, while Primary B accepts the full byte range. MatrixSmith's pure encoder preserves the supplied raw byte and leaves range policy to semantic operations; the live iLedHat gate allows only `0x40` and `0xC0`.

Primary A uses 500 ms in its animation construction; Primary B accepts a 16-bit speed. MatrixSmith models an explicit 16-bit speed and uses the first `FrameSequence` timing for dry-run. Physical timing interpretation remains unverified.

ACK error names are represented by Primary B, while automatic retry behavior is not sufficiently established. MatrixSmith decodes corroborated status bytes, retains raw notifications, and enables no live automatic retry.
