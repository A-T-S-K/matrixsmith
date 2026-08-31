# Adding a MatrixSmith driver

This workflow is designed so a contributor can add a second device family without reading the entire UI.

## 1. Collect portable evidence

In Lab choose **Probe unknown device**. Enter suspected service UUIDs before opening the chooser; Web Bluetooth permission is established there. Connect, inspect accessible services/characteristics/properties, perform only explicit safe reads, subscribe explicitly to notifications, label the physical action, add manual observations, and export a diagnostic bundle. Unknown-device mode intentionally has no writer.

Turn the reviewed bundle into `tests/fixtures/devices/<profile>.json`. Preserve raw advertisement/GATT/notification bytes. Separate browser-observable facts from boot strings, physical geometry, labels, teardown observations, and other manual evidence.

## 2. Define family and profile separately

Add a driver under `src/drivers/<family>/` and add it once to `builtInDrivers`. A driver owns discovery hints, matching, endpoints, semantic probes, codecs, planning, notification decoding, and response matching. Physical profiles live under `src/profiles/`, not under whichever driver was first hypothesized.

Never make a profile dimension a global framebuffer constant. Never treat a generic UUID or name substring as protocol identity.

## 3. Implement scored matching

Return driver ID, score, confidence (`none`, `weak`, `candidate`, `strong`, `exact`), reasons, and contradictions. Equal top scores remain ambiguous. When generations share transport shape, add a read-only, non-persistent semantic probe with a serializable response expectation; never use arbitrary writes or treat silence as proof of the other family.

## 4. Model evidence, validation, and risk

`EvidenceConfidence` describes why a fact is believed: observed, corroborated, inferred, speculative, or unknown. `ValidationStatus` describes whether a capability works on the profile: unverified, experimental, verified, or rejected. They are independent.

Each capability also declares read-only/transient/persistent/destructive/firmware risk and none/volatile/persistent/unknown persistence. Unknown persistence is conservative. A browser button click records a session observation; promoting checked-in validation is a reviewed source change.

## 5. Build pure codecs and golden vectors

Keep codecs independent of DOM, browser Bluetooth, and mutable singletons. Record source repository, exact commit, license, files, extracted protocol facts, and whether implementation was independent or adapted. Never copy unlicensed code. Generate deterministic vectors in a temporary upstream checkout where possible, then test framing, escaping, lengths, checksums, chunk boundaries, orientation, and failure cases in MatrixSmith.

## 6. Plan semantic operations

Extend `MatrixOperation` only when needed. A plan contains exact packets, endpoint/write mode, validation, evidence, semantic risk/persistence, explicit `live`/`dry-run-only` intent, purpose, and response expectation. A characteristic write may still be a read-only semantic query; policy follows semantic risk.

Start new operations dry-run only. Use `FakeTransport` for order/failure/timeout/concurrency tests and `ReplayTransport` or imported bundles for match/decoder tests. Do not simulate device-side success.

## 7. Validate hardware deliberately

Choose the least risky transient/read-only experiment supported by provenance. Capabilities and explicit plan intent drive policy; do not add driver/opcode/profile special cases. Require deliberate action, raw notification retention, separate host/protocol/state claims, and exported trace. Keep retry count one until safe retry behavior is proven.

After repeated reviewed hardware evidence, promote the specific profile capability from unverified to experimental to verified. Do not promote the entire family or other profiles by association.

Persistent, destructive, reset, password, storage erase, OTA, and firmware operations require owner authorization, documented recovery, and dedicated policy work. MatrixSmith must not acquire an arbitrary live writer as a reverse-engineering shortcut.
