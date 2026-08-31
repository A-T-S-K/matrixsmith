# iLedHat / CoolLEDX protocol findings

Research date: 2026-08-31

## Current decision

The observed iLedHat is a strong CoolLEDX candidate, not a verified CoolLEDX device. FFF0/FFF1 alone is non-identifying; the score combines name, advertisement, AE31 manufacturer prefix when available, complete GATT shape, and characteristic properties. The checked-in profile remains experimental.

MatrixSmith implements the licensed-evidence-backed family codec offline. Only brightness raw `0x40` and `0xC0` may cross the live policy, in Lab, after explicit session unlock and exact-plan review. Successful browser write resolution is not profile verification.

## Observed physical profile

| Fact | Confidence / validation |
|---|---|
| name `iLedHat` and raw advertisement | observed |
| advertised service FFF0 | observed |
| manufacturer bytes `AE315EEA07000001100020031E` | observed |
| boot-visible identifier `31AE` | observed |
| primary FFF0, single FFF1 | observed |
| FFF1 READ, NOTIFY, WRITE WITHOUT RESPONSE | observed |
| FFF1 read returned zero bytes | observed |
| notifications enabled; no unsolicited packet in test | observed |
| pairing/bonding not required | observed |
| physical geometry 32×16 | manually observed |
| bytes 10 and 20 correlate with 16 and 32 | inferred correlation, not parser truth |
| original stored message `FREE LLM TOKENS :-)` | observed |
| long-ish power-button action displayed `reset` | observed; timing/meaning unknown |
| post-reset scrolling text `coolled` | observed |
| advertisement unchanged near full battery | observed; therefore 0x1E is not live battery state of charge |

## Corroborated CoolLEDX family facts

Control frame:

```text
01 || escape(length_be16 || opcode || args) || 03
01 -> 02 05
02 -> 02 06
03 -> 02 07
00 is unchanged
```

Corroborated opcodes: text 02, image 03, animation 04, mode 06, speed 07, brightness 08, switch 09. Transfer content uses 128-byte chunks with reserved byte, full content length BE16, chunk index BE16, size U8, data, and XOR checksum, framed with the content opcode. RGB frame bits are column-major separate R/G/B planes, top-to-bottom, with the top pixel in each group as MSB. For 32×16 the packed frame is 192 bytes.

Exact control vectors:

```text
brightness 10  01 00 02 06 08 10 03
brightness 40  01 00 02 06 08 40 03
brightness C0  01 00 02 06 08 C0 03
speed 10       01 00 02 06 07 10 03
mode static    01 00 02 06 06 02 05 03
switch off     01 00 02 06 09 00 03
switch on      01 00 02 06 09 02 05 03
```

The two pinned licensed implementations produce equivalent control bytes. See [coolledx-sources.md](coolledx-sources.md).

## Implemented offline

- generic framing and escaping
- typed control encoders
- 128-byte transfer records and XOR checksum
- image/animation/text-rendered banner transfer headers
- RGB888 to one-bit R/G/B column planes
- static image and animation `TransmissionPlan` generation
- raw notification retention and conservative status decoder
- deterministic fixtures/tests and Lab packet inspection

Text uses a MatrixSmith/browser-rendered logical banner input; the protocol planner emits the corroborated text-shaped header. Deterministic font rendering is deliberately outside protocol golden tests.

## Unverified on this iLedHat

Physical orientation/channel presentation, all command compatibility, persistence behavior, ACK timing, safe retry semantics, maximum transfer size/storage, animation timing interpretation, native text metadata behavior, profile-specific orientation, and recovery/firmware access. A size measured on another 64×16 sign is not applied to this profile.

CoolLEDM is related at outer framing but has incompatible commands. MatrixSmith does not identify CoolLEDX from a CoolLED-looking name or FFF0/FFF1 alone.
