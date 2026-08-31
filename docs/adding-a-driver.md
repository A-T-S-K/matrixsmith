# Adding a MatrixSmith driver

This workflow is designed so a contributor can add a second device family without reading the entire UI.

## 1. Collect portable evidence

In Lab choose **Probe unknown device**. Enter suspected service UUIDs before opening the chooser; Web Bluetooth permission is established there. Connect, inspect accessible services/characteristics/properties, perform only explicit safe reads, subscribe explicitly to notifications, label the physical action, add manual observations, and export a diagnostic bundle. Unknown-device mode intentionally has no writer.

Turn the reviewed bundle into `tests/fixtures/devices/<profile>.json`. Preserve raw advertisement/GATT/notification bytes. Separate browser-observable facts from boot strings, physical geometry, labels, teardown observations, and other manual evidence.

## 2. Define family and profile separately

Add a driver under `src/drivers/<family>/` and register it statically. A driver owns discovery hints, scored matching, protocol codecs, operation planning, and notification decoding. A profile owns product/revision facts: dimensions, expected GATT, orientation, limits, evidence, and per-device validation.

Never make a profile dimension a global framebuffer constant. Never treat a generic UUID or name substring as protocol identity.

## 3. Implement scored matching

Return driver ID, score, confidence (`none`, `weak`, `candidate`, `strong`, `exact`), reasons, and contradictions. Combine independent observations and test partial/misleading cases. Equal top scores are ambiguous and must not select a live driver. Manual evidence affects runtime matching only when explicitly supplied in the fingerprint.

## 4. Model evidence, validation, and risk

`EvidenceConfidence` describes why a fact is believed: observed, corroborated, inferred, speculative, or unknown. `ValidationStatus` describes whether a capability works on the profile: unverified, experimental, verified, or rejected. They are independent.

Each capability also declares read-only/transient/persistent/destructive/firmware risk and none/volatile/persistent/unknown persistence. Unknown persistence is conservative. A browser button click records a session observation; promoting checked-in validation is a reviewed source change.

## 5. Build pure codecs and golden vectors

Keep codecs independent of DOM, browser Bluetooth, and mutable singletons. Record source repository, exact commit, license, files, extracted protocol facts, and whether implementation was independent or adapted. Never copy unlicensed code. Generate deterministic vectors in a temporary upstream checkout where possible, then test framing, escaping, lengths, checksums, chunk boundaries, orientation, and failure cases in MatrixSmith.

## 6. Plan semantic operations

Extend the `MatrixOperation` union only when needed. The driver translates it and logical frames into one `TransmissionPlan` containing exact packets, endpoint/write mode, validation, evidence, risk/persistence, ACK/retry/timeout policy, metadata, and recovery notes. Lab must display the same plan object the executor receives.

Start new operations dry-run only. Use `FakeTransport` for order/failure/timeout/concurrency tests and `ReplayTransport` or imported bundles for match/decoder tests. Do not simulate device-side success.

## 7. Validate hardware deliberately

Choose the least risky transient/read-only experiment supported by provenance. Add a narrow policy rule rather than a global developer bypass. Require a memory-only session unlock, visible plan and bytes, one deliberate send, host receipt, separate physical observation, and exported trace. Keep retry count one until safe retry behavior is proven.

After repeated reviewed hardware evidence, promote the specific profile capability from unverified to experimental to verified. Do not promote the entire family or other profiles by association.

Persistent, destructive, reset, password, storage erase, OTA, and firmware operations require owner authorization, documented recovery, and dedicated policy work. MatrixSmith must not acquire an arbitrary live writer as a reverse-engineering shortcut.
