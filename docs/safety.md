# Safety policy

MatrixSmith fails closed at the semantic-plan boundary. No browser UI exposes arbitrary hex or characteristic writes.

## Capability-driven policy

| Condition                                       | Result                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| source is imported, fake, or replay             | block TX                                                                        |
| unknown/ambiguous driver for a normal operation | block TX                                                                        |
| plan marked `dry-run-only`                      | block live TX                                                                   |
| unverified or rejected validation               | block live TX                                                                   |
| experimental transient/read-only                | require per-session Lab unlock                                                  |
| verified read-only                              | allow only an explicit user action                                              |
| verified transient and driver marks plan live   | allow explicit Control action                                                   |
| verified routine persistent content             | direct target-bound, digest-checked command authorization                       |
| experimental persistent content                 | one consequence-specific confirmation bound to the exact target and plan digest |
| persistent probe                                | never allowed                                                                   |
| destructive or firmware risk                    | block                                                                           |
| endpoint/property mismatch                      | block                                                                           |

Validation alone never authorizes a future command: every plan also carries explicit driver intent (`live` or `dry-run-only`). The policy contains no CoolLED family, profile, opcode, or raw-brightness special cases.

Read-only protocol probes are the narrow exception to ordinary ambiguity blocking. A probe must be semantic, non-persistent, explicitly invoked, supported by a candidate match, planned through the driver, and authorized through the same policy/executor path. No probe runs on page load or merely because a device connected. Offline bundles may replay captured probe evidence but cannot transmit.

## Current iLedHat boundary

- CoolLEDUX `GetDeviceInfo` (`0x1F`): verified, read-only, live on explicit Refresh/probe.
- CoolLEDUX `SetBrightness` (`0x04`, raw 0–255): verified transient, live on deliberate Apply.
- CoolLEDUX power: dry-run-only on this profile.
- CoolLEDX brightness for this iLedHat: rejected hardware hypothesis and not live.
- CoolLEDUX static frame, rendered text, image, and animation on the reviewed iLedHat profile: verified routine persistent operations, direct after the user presses **Display it**. GIF remains experimental and uses one confirmation.
- Mirror, rotation, light modes, timers, reset, password, OTA, and firmware: not live.

## Persistent content writes

Stored-program uploads replace the display's stored content; MatrixSmith never pretends they are transient. Verified routine content needs no warning dialog. Experimental persistent content shows one exact consequence and confirmation, scoped to the canonical plan digest and consumed on execution. The known recovery observation — a long-ish inline power-button action displayed `reset` and restored the default scrolling `coolled` text — is documented evidence, not an implemented or verified automatic restoration.

Execution results keep three claims separate: browser/host acceptance, a matching protocol notification, and independently verified device state. Brightness echo establishes protocol acceptance; a following device-info readback can establish the resulting raw brightness.

Raster scrolling is preflighted before BLE. MatrixSmith may increase pixel step and proportional frame delay, but blocks a send that still exceeds the conservative 48-frame / 16 KiB-decoded-per-tile source-derived budget. This is a software guard, not a claimed physical iLedHat limit. Persistent sends never retry automatically; a partial failure makes panel state unknown and leaves retry as an explicit action.

For write-without-response content, “host accepted” means only that the browser/Bluetooth stack accepted every write. Normal UI says “Upload sent to display” and explicitly states when firmware acceptance and retention were not confirmed. Screen Wake Lock is best effort and never changes transfer success.

The experimental unlock is memory-only and clears on disconnect or reload. It cannot bypass driver intent, validation, risk, source, confidence, or endpoint checks.

## Path-specific content gating (2026-08-31 revision, hardened)

Per-path gates derive from OPERATIONAL TRUST (`operationalTrust` in `src/investigation/claims.ts`), not from the flat investigative claim state:

- text / image → require trusted `stored-program.upload` and a truly VIABLE static strategy: `static.strategy` is derived from the atomic requirements in `src/investigation/static-viability.ts` (upload, tiling, orientation, initial render, a measured ≥15 s stable hold, characterized black semantics, raw channel map, and encoder correctness). A casually asserted `static.strategy` entry has no authority, and a known-incorrect logical channel mapping keeps image/text gated. Optional visual color calibration is deliberately NOT required.
- animation → require trusted `animation.frames`, `animation.timing`, `animation.tile-sync`
- GIF → require trusted `gif.playback` on this device

Only `current-session` or `built-in-profile` evidence grants operational trust; previous local sessions and imported evidence inform the investigation, surface conflicts, and boost revalidation recommendations, but never unlock sends — and they also cannot revoke a shipped basis (only a trusted current-session rejection can). An inconclusive Graffiti validation cannot unlock unrelated content, and a successful Animation never silently proves Graffiti.

## Device/session evidence boundary

Current-session evidence is bound to one physical device session: only a matching browser-authorized device id lets an investigation (and its evidence) survive a reconnect. Any other connect detaches it with all evidence demoted to `previous-local-session`. LocalStorage and bundles are untrusted: every loaded evidence entry is structurally demoted regardless of its serialized scope, so poisoned records cannot manufacture `built-in-profile` or `current-session` authority. The controller also refuses to record guided-test observations outside a live physical session, and validates every submission (required fields, kinds, options, durations, timeline coherence) in the domain layer.

A running guided-test transfer cannot be dismissed as if canceled, and after transfer the only exit is "Stop observation and save as incomplete": an `abandoned` result records the exact operation and transaction ids with no claim conclusions, because the device WAS changed.

Guided hardware tests transmit only fixed driver-defined diagnostic programs (`ShowDiagnostic` with declared ids and enumerated parameter values — e.g. stayTime ∈ {3, 0}); there is no general raw writer and no arbitrary raw-word entry. Persistent guided plans keep `maxAttempts: 1` with no retry conditions; a missing receipt notification never triggers automatic persistent retransmission. Local investigation history persists structured evidence only — never experimental unlocks, persistent-send confirmation tokens, safety bypasses, or content binaries.
