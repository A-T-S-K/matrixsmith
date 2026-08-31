# Safety policy

MatrixSmith fails closed at the semantic-plan boundary. No browser UI exposes arbitrary hex or characteristic writes.

## Policy matrix

| Condition | Result |
|---|---|
| unknown driver | live TX blocked |
| ambiguous top driver matches | live TX blocked |
| driver confidence below strong | live TX blocked |
| imported/fake/replay source | live TX blocked |
| unverified or rejected operation | live TX blocked |
| experimental read-only | explicit Inspect/Lab action only |
| experimental transient | Lab plus per-session unlock |
| verified transient | eligible for Control in a future profile promotion |
| persistent or unknown operation classified persistent | blocked this milestone |
| destructive | blocked |
| firmware | blocked |

The experimental unlock defaults off, lives only in `MatrixSession`, is never stored, and clears on disconnect or reload. It does not disable policy checks.

## Current live boundary

The only live-eligible operation is `SetBrightness` for driver `coolledx`, profile `iledhat-31ae-32x16`, raw `0x40` or `0xC0`, over FFF0/FFF1 write-without-response. Required endpoint properties, strong/exact match, live source, connection, profile, and session unlock must all agree.

Promise resolution produces a host-level acceptance receipt only. It does not change profile validation and is never called device verification. The user records the visible device observation separately.

Mode, speed, switch, text, image, animation, persistent commands, reset, delete, password, OTA, DFU, and firmware are not executable live.

## Recovery information

Observed on the physical unit: a long-ish power-button action displayed `reset`, cleared the custom text, and restored scrolling text `coolled`. Unknown: exact press duration/sequence, whether it was a factory or program reset, other cleared state, firmware recovery, and wired programming access. MatrixSmith therefore documents no exact reset procedure and implements no software reset command.

If an experiment behaves unexpectedly, stop, disconnect in MatrixSmith, power the device off, preserve/export the diagnostic trace, and avoid additional commands until the observation is reviewed.
