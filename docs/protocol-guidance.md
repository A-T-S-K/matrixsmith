# Source-scoped protocol guidance

Knowledge revision `2026-10-03.3` strengthens the existing curated facts without
changing the corpus schema, resolver or executable registry. Coverage remains
66 research records, 21 sheets, 44 families, 109 assertions, 151 citation records
and 22 retained conflicts. Curated GATT suggestions increase from five to nine.
All unresolved and adjacent classification records remain available to search.
This index supplies candidate explanations; it does not authenticate hardware,
select a driver, grant permission or establish physical support.

## Questions the advisory surface can answer

| Inspectable evidence                             | Useful explanation                                                                 | Boundary                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| FFF0 or FFF1                                     | CoolLEDUX advanced and classic CoolLEDX remain plausible together.                 | Shared identifiers and names cannot distinguish the protocols.                                 |
| FEE0 or FEE1                                     | OEM and open legacy LSLED shapes differ; both use the same endpoints.              | Properties describe the cited firmware, not a chip or authenticated batch.                     |
| F055, F056 or F057                               | Open Badge Magic next-gen is a distinct profile.                                   | It does not imply OEM legacy compatibility or promote its commands.                            |
| Optional micro:bit LED service or characteristic | Pinned DAL matrix state is five binary row bytes; firmware/security govern access. | Absence can reflect optional firmware or missing access; names/services do not identify V1/V2. |
| FFD0 or FFD1                                     | Source-scoped Merkury RGB block layout explains supplied data.                     | Properties, receipts and persistence remain unknown.                                           |

Suggestions use only the existing service/characteristic matching schema. The
resolver matches inspectable or advertised identifiers, not requested/granted
service lists, names or geometry alone. It reports missing access as uncertainty.
An explicit exact iLedHat geometry contradiction leaves both CoolLED families
plausible. The current resolver does not compare general family properties or
reject a firmware family on that basis. Broad suggestions remain advisory.

## CoolLEDUX and CoolLEDX

Re-inspected source records `seed-ux:PROTOCOL.md` and
`seed-ux:coolledux/ble.py` pin `CharlesLennon/coolledux-ble` at
`4f5656d9882adb4926c9dff4dc3fa5783b40a7ac`. Classic Python record
`seed-x-python:src/coolledx/client.py` pins `UpDryTwist/coolledx-driver` at
`ba24137a4fb63b44896143adbd5862ef74de9fff`. Each repository is its own
research origin; multiple files from one repository are not independent
corroboration. They share FFF0/F1 but have different payload/layout contracts.
Reverse-engineering and implemented behavior are not OEM specifications.

The CoolLEDUX notes report opcode 1F device-info query and an author-observed
30-byte echoed response: power and brightness at bytes 1 and 2, with later fields
partly unmapped. They do not establish geometry from this response. The existing
reviewed device-info query can investigate that prefix with current notify access.
The advisory resolver exposes that query only if it is already registered by the
caller. Corpus data contains no action identifier or executable operation.
Source observations do not authorize sending it or guarantee firmware behavior.
The decoder retains an unknown tail; current session evidence and central gates
remain necessary. A receipt never proves rendering or power-cycle retention.

## LSLED legacy and open next-gen

`file-fossasia-badgemagic-firmware-BadgeBLE-md` pins
`fossasia/badgemagic-firmware` at
`b2137f083bc24e212fe6281b53b26c1d511cd9b0`. Its OEM section is maintainer
reverse-engineering documentation, not a manufacturer-issued specification.
It describes OEM FEE1 Read/Write/Notify with unknown Read/Notify semantics.
Open legacy FEE1 is write-only; its advertised name is configurable through the
separate next-gen profile. Name and endpoints cannot identify hardware batches.

Legacy header size fields count eight-column groups, not byte lengths. Each group
holds eleven MSB-first row bytes; sequential writes carry sixteen-byte values.
Timestamp purpose, actual timing, receipt correlation and persistence are not
established. The maintained [LSLED offline reference](lsled-offline.md) records
additional app-versus-notes timestamp/padding conflicts and the narrower compiler
policy; its vectors prove software layout only.

F055/F057/F056 belong to the open next-gen contract: Write controls on F057,
Notify error codes on F056, and Read listed as pending. Its documented 512-byte
message limit does not establish negotiated MTU or fragmentation. Configuration
saving and error returns remain source-scoped, and these advisory suggestions
create no execution steps. The existing legacy reference does not compile F055.

## Optional micro:bit LED service

`microbit-dal-led-cpp` and `microbit-dal-led-header` pin
`lancaster-university/microbit-dal` at
`318c6abbb3d952d3f49a595a726486230e82fb5b`; the maintained
[micro:bit offline reference](microbit-offline.md) records its DAL 2.1.1 scope.
These files share one origin. Unversioned documentation and MakeCode enablement
pages remain dated observations, not proof every V1/V2, CODAL or MakeCode build
implements this contract.

The constructor sets matrix/delay Read+Write and text Write, without Notify,
and applies configured security requirements. A matrix read rebuilds five rows
from current nonzero display pixels. Writes accept one to five rows, stop
animation, and update only supplied rows using bits 4–0. The full-matrix offline
reference is deliberately narrower. These are binary rows, regardless of the
unversioned page's UTF-8 wording. Text initiates asynchronous scrolling with a pinned twenty-byte buffer limit;
delay uses a uint16 buffer. No storage call in the matrix path establishes persistence.

Service inclusion is optional and disabled by default in the DAL documentation.
Pairing, firmware configuration and browser access can prevent inspection.
Missing service/properties are not contradictions; a service match does not
identify board generation, chip or security compatibility. The current resolver
has no generic read-action projection for this family. The orchestrator may
consider linking an already registered reviewed bounded matrix-state read in
shared resolver code; this corpus introduces neither a read nor write action.

## Merkury MI-LNL62-999W

`file-offe-mi-led-display-draw_file-py`, the README and protocol notes pin
`offe/mi-led-display` at `97a1be8b4edefc7eccdd2f3943997b4416d44771`.
This is one reverse-engineering origin, not three independent confirmations or
an OEM specification. The 16×16 implementation traverses pixels row-major and
builds eight 100-byte blocks: BC 0F, index 1–8, 96 RGB bytes and 55. It adds no
checksum; the separate pixel command's QQ field remains unresolved.

The code names FFD0/F1 and omits an explicit Bleak response argument. It supplies
no property dump, notification receipt or durability contract. It delays twenty
milliseconds between blocks; its refresh loop actually sleeps ten seconds between
repetitions despite comments describing rapid refresh. Those source facts are not
measured transfer behavior or proof of reliable retention. Browser anecdotes do
not establish browser support. The maintained [Merkury offline reference](merkury-offline.md) models only
the eight frame blocks and preserves unknown response/persistence semantics.
Its source aliases retain original lineage; the additional pinned HTML record
is from the same repository. The draw_picture.py docstring format conflict is
retained explicitly. Separate review is required before any live promotion.

## Evidence and redistribution

Eight pinned files were fetched into a unique temporary research folder and their
SHA-256 values matched the existing citation records. Updated source statuses
record that reinspection. URLs remain in validated corpus citation fields; facts
carry specific line/section locators. Existing licensing and attribution metadata
are retained: MIT for the pinned CoolLED, DAL and Merkury sources; Apache-2.0 for
Badge Magic. No upstream source, artwork, manual or capture is redistributed and
no project license is selected. No hardware was accessed.

The focused coverage tests use supplied fingerprints and existing pure
`resolveKnowledge`/`searchKnowledge` APIs. They verify schema/reference integrity,
shared ties, optional access, firmware shapes, exact-profile contradiction,
unresolved records, aliases, source retrieval and single-origin accounting.
They do not prove Bluetooth behavior, firmware compatibility or physical support.
