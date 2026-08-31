# Safety policy

MatrixSmith fails closed at the semantic-plan boundary. No browser UI exposes arbitrary hex or characteristic writes.

## Capability-driven policy

| Condition | Result |
|---|---|
| source is imported, fake, or replay | block TX |
| unknown/ambiguous driver for a normal operation | block TX |
| plan marked `dry-run-only` | block live TX |
| unverified or rejected validation | block live TX |
| experimental transient/read-only | require per-session Lab unlock |
| verified read-only | allow only an explicit user action |
| verified transient and driver marks plan live | allow explicit Control action |
| persistent risk/persistence | require the experimental unlock AND a single-use explicit per-plan confirmation of the exact consequence |
| persistent probe | never allowed |
| destructive or firmware risk | block |
| endpoint/property mismatch | block |

Validation alone never authorizes a future command: every plan also carries explicit driver intent (`live` or `dry-run-only`). The policy contains no CoolLED family, profile, opcode, or raw-brightness special cases.

Read-only protocol probes are the narrow exception to ordinary ambiguity blocking. A probe must be semantic, non-persistent, explicitly invoked, supported by a candidate match, planned through the driver, and authorized through the same policy/executor path. No probe runs on page load or merely because a device connected. Offline bundles may replay captured probe evidence but cannot transmit.

## Current iLedHat boundary

- CoolLEDUX `GetDeviceInfo` (`0x1F`): verified, read-only, live on explicit Refresh/probe.
- CoolLEDUX `SetBrightness` (`0x04`, raw 0–255): verified transient, live on deliberate Apply.
- CoolLEDUX power: dry-run-only on this profile.
- CoolLEDX brightness for this iLedHat: rejected hardware hypothesis and not live.
- CoolLEDUX stored-program content (static frame, rendered text, image, animation, GIF): experimental + persistent. Compiled and previewable offline; live transmission only through `sendPersistentContent`, which requires the exact consequence to be shown and explicitly confirmed for that one plan. Normal Control content sends are additionally gated behind a passed static-frame validation on the session.
- Mirror, rotation, light modes, timers, reset, password, OTA, and firmware: not live.

## Persistent content writes

Stored-program uploads replace the display's stored content; MatrixSmith never pretends they are transient. Every persistent send shows: "This replaces the currently stored display program… automatic content restoration has not been verified." The confirmation is scoped to one exact plan id and is consumed on execution, so no confirmation ever authorizes a second write. The guided validation workflows use the same mechanism and add structured post-transfer observation questions. The known recovery observation — a long-ish inline power-button action displayed `reset` and restored the default scrolling `coolled` text — is documented evidence, not an implemented or verified automatic restoration.

Execution results keep three claims separate: browser/host acceptance, a matching protocol notification, and independently verified device state. Brightness echo establishes protocol acceptance; a following device-info readback can establish the resulting raw brightness.

The experimental unlock is memory-only and clears on disconnect or reload. It cannot bypass driver intent, validation, risk, source, confidence, or endpoint checks.
