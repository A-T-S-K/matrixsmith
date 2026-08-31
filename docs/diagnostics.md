# Diagnostics and offline evidence

MatrixSmith exports a versioned JSON bundle only when the user taps Download. Nothing is uploaded.

## Version 1 shape

```text
schemaVersion, matrixsmithVersion, createdAt
fingerprint
driverMatches, selectedDriver, selectedProfile
capabilities
trace
observations
advertisementEvidence
```

Raw RX/TX bytes serialize as uppercase hexadecimal. The fingerprint contains portable observations, not browser Bluetooth objects. Trace types cover app startup, selection, matching, GATT lifecycle, reads/notifications, plan creation/authorization/blocking, packet host acceptance/failure, decoded notifications, observations, disconnect, and errors. Unknown notifications remain as raw events.

Import validates top-level metadata, fingerprint shape, match/trace/observation collections, and schema version. It creates an offline `imported` session. Matching, profile resolution, capabilities, Inspect, trace display, and decoder work can run offline, but policy rejects every imported transmission. `ReplayTransport` similarly replays notifications and throws on write.

## Privacy

Included: selected device evidence, accessible GATT, exact plan/RX/TX trace, user-entered observations, and match explanations. Excluded by default: unrelated nearby devices, geolocation, arbitrary local storage, browser fingerprint noise, and unrelated personal data.

Before sharing, review free-form device names, browser device IDs, notes, display-content observations, and exact traffic for information you do not want to disclose.

## Useful device-support bundle

Open Lab, enter needed service UUID hints before the inspection chooser, select the device, inspect permitted GATT, perform only explicit reads, subscribe only to intended notify characteristics, reproduce one labeled behavior, add manual observations, and export. State what Chrome could not enumerate. Web Bluetooth reveals only services granted through chooser filters/`optionalServices`; missing services are not evidence that the peripheral lacks them.
