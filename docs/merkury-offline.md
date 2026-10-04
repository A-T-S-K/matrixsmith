# Merkury MI-LNL62-999W offline RGB reference

This compiler represents the eight RGB data blocks in the reverse-engineered
`offe/mi-led-display` implementation, scoped to commit
`97a1be8b4edefc7eccdd2f3943997b4416d44771`. It accepts exactly one 16×16
RGB framebuffer, without resize, crop, gamma, brightness conversion or channel
masking. The reference identity belongs to MatrixSmith; it is source-only,
unverified and never resolves a physical profile. Every generated plan is
independently dry-run-only, including live, fake, imported and replay contexts.

## Inspected primary sources

All links below are pinned to that commit. No upstream program code, imagery,
packet captures or artwork is included in the implementation or fixtures.

| Source                                                                                                                                                                                                                                             | What it supports                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [draw_file.py](https://github.com/offe/mi-led-display/blob/97a1be8b4edefc7eccdd2f3943997b4416d44771/draw_file.py)                                                                                                                                  | Row-major RGB extraction, block encoder, eight blocks, FFD0/FFD1 constants, 20 ms sleep after each block.                                                           |
| [draw_picture.py](https://github.com/offe/mi-led-display/blob/97a1be8b4edefc7eccdd2f3943997b4416d44771/draw_picture.py)                                                                                                                            | Same executed encoder, gradient example, 25 ms block sleeps; separate setup/finalization commands. Its docstring conflicts with executed code.                      |
| [show_image.html](https://github.com/offe/mi-led-display/blob/97a1be8b4edefc7eccdd2f3943997b4416d44771/show_image.html)                                                                                                                            | Same explicit 100-byte blocks and RGB ordering, 5 ms sleeps and legacy writeValue calls.                                                                            |
| [README.md](https://github.com/offe/mi-led-display/blob/97a1be8b4edefc7eccdd2f3943997b4416d44771/README.md)                                                                                                                                        | Author identifies model MI-LNL62-999W and reports browser service-listing issues for this hardware. This is an author report, not a MatrixSmith observation.        |
| [protocol.txt](https://github.com/offe/mi-led-display/blob/97a1be8b4edefc7eccdd2f3943997b4416d44771/protocol.txt)                                                                                                                                  | Describes power, graffiti and slideshow commands; does not specify this full-frame block format. Those commands are outside compiler scope.                         |
| [grafitti.html](https://github.com/offe/mi-led-display/blob/97a1be8b4edefc7eccdd2f3943997b4416d44771/grafitti.html), [test_commands.html](https://github.com/offe/mi-led-display/blob/97a1be8b4edefc7eccdd2f3943997b4416d44771/test_commands.html) | Separate single-pixel/hex-command experiments, not automated conformance tests or proof of block acceptance.                                                        |
| [repository tree](https://github.com/offe/mi-led-display/tree/97a1be8b4edefc7eccdd2f3943997b4416d44771), [snoops/README.md](https://github.com/offe/mi-led-display/blob/97a1be8b4edefc7eccdd2f3943997b4416d44771/snoops/README.md)                 | No automated test suite present in inspected tree; snoop collection instructions exist. Capture files were not used as acceptance, receipt or persistence evidence. |
| [LICENSE](https://github.com/offe/mi-led-display/blob/97a1be8b4edefc7eccdd2f3943997b4416d44771/LICENSE)                                                                                                                                            | MIT, copyright 2025 Oscar Lindberg; agrees with README license label. This is upstream metadata, not a project licensing selection.                                 |

## Byte format and choices

The source endpoint constants are service
`0000ffd0-0000-1000-8000-00805f9b34fb` and characteristic
`0000ffd1-0000-1000-8000-00805f9b34fb`. Their presence does not establish
identity, characteristic properties, security, MTU or browser availability.

Pixels are ordered by increasing y, then x, with consecutive R, G, B channels.
Each block covers two rows: 32 pixels and 96 data bytes. Exactly eight packets
contain `BC 0F index`, data, then `55`, where index is 1 through 8. Each packet
is 100 bytes; total packet bytes are 800. Marker bytes inside RGB data are
preserved. No checksum, padding, compression or receipt meaning is inferred.
Physical orientation and color fidelity remain unverified.

The executed `draw_picture.py` code agrees with `draw_file.py` and HTML. Its
docstring instead describes 113 bytes, a 16-byte header and zero-based indices;
this compiler follows the executed 100-byte, three-byte-header, one-based
format. The source data path masks channel values, but this compiler rejects
noninteger/out-of-range input rather than normalizing it.

The plan records 20 ms after every block, including the last, matching the
`draw_file.py` loop. Other implementations use 25 ms or 5 ms, so this is a
source choice rather than a proven device timing requirement. No encoder sleeps.
The current TransmissionPlan type requires an explicit write mode. The plan
uses with-response solely as an offline placeholder: Python omits the Bleak
response argument and HTML uses writeValue, so neither establishes actual mode
or GATT properties. No notification/receipt contract is modeled. Its 1000 ms
timeout is an application placeholder, not a source-measured deadline.

This is a block-transfer codec proof, not a complete physical ShowFrame
procedure. `draw_file.py` sends a separate image-mode setup command and loops
with ten-second refresh intervals; `draw_picture.py` also sends finalization
commands and experiments with storage. Those commands and refresh loops are
omitted. The source's persistence comments and attempted refresh do not prove
retention. Acceptance, partial-frame behavior, timing, receipts, display
rendering, power-cycle persistence and recovery are unknown. No uncertain-write
retry is allowed or implemented. Tests and FakeTransport do not establish
physical behavior.

## Validation and integration

Tests use a hand-authored literal first gradient block, independently authored
256-position fixture table, blank/full and asymmetric block-boundary cases.
They cover RGB channel order, delimiter-valued channels, strict shape/count
and byte validation, deterministic output, separate packet/input/preview
buffers, foreign profile/implementation rejection, unsupported operations,
zero transport/evidence changes and central policy rejection despite exact
matching, experimental permission and digest confirmation.

The authored `merkuryEntry` implements the existing OfflineEntry contract.
Integration requires a literal `merkury` catalog descriptor importing
`./offline-entries/merkury` and returning `merkuryEntry`. Keep the reference
out of builtInDrivers, physical registries and discovery composition. No shared
API, profile version or capability-requirements migration is needed.

The orchestrator owns catalog wiring, knowledge source IDs, public citations,
third-party notices, static budgets, production browser/offline checks and
final full verification. Notice proposal: identify offe/mi-led-display at the
pinned revision; record MIT and copyright 2025 Oscar Lindberg, link its LICENSE,
and clarify that encoder/vectors were independently authored with no upstream
code or artwork copied. Include upstream MIT text if notice policy requires it;
no choice of MatrixSmith license is implied.
