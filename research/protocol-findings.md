# iLedHat FFF0/FFF1 protocol findings

Research date: 2026-08-31

## Decision

The exact FFF1 command protocol has **not** been established with high confidence. Development stops before Phase 3 and before all command writes.

The application contains no FFF1 writer, no raw-hex UI, and no guessed query. `SafeBleTransport` supports selection, connection, GATT discovery, notification subscription, disconnection, and the already-observed zero-length FFF1 read only.

## Confirmed hardware transport

| Fact | Status | Evidence |
|---|---|---|
| Advertised name `iLedHat` | VERIFIED | supplied raw advertisement |
| Advertised service `0xFFF0` | VERIFIED | supplied raw advertisement |
| Primary service `0000fff0-...` | VERIFIED | supplied nRF Connect enumeration |
| Only custom characteristic `0000fff1-...` | VERIFIED | supplied nRF Connect enumeration |
| FFF1 properties READ, NOTIFY, WRITE WITHOUT RESPONSE | VERIFIED | supplied nRF Connect enumeration |
| CCCD notification enable works | VERIFIED | supplied nRF Connect observation |
| FFF1 read returns zero bytes | VERIFIED | supplied nRF Connect observation |
| Unsolicited notifications after subscribe | not observed | supplied nRF Connect observation |
| Pairing/bonding required | no | supplied nRF Connect observation |

## Protocol fields

| Item | Result | Status |
|---|---|---|
| packet framing | not recovered | UNKNOWN |
| command IDs | not recovered | UNKNOWN |
| endianness | not recovered | UNKNOWN |
| checksum/CRC | not recovered | UNKNOWN |
| sequence numbers | not recovered | UNKNOWN |
| fragmentation | not recovered | UNKNOWN |
| MTU assumptions | not recovered | UNKNOWN |
| ACK/response format | not recovered | UNKNOWN |
| framebuffer format | not recovered | UNKNOWN |
| pixel order/orientation | not recovered | UNKNOWN |
| RGB channel order | not recovered | UNKNOWN |
| brightness | not recovered | UNKNOWN |
| rotation | not recovered | UNKNOWN |
| transient vs persistent upload | not recovered | UNKNOWN |
| delete/reset/DFU commands | not recovered | UNKNOWN and treated as dangerous |

There is consequently no command table or golden packet vector to implement yet.

## Public-source investigations

### Exact-name and capture searches

Searches covered exact and case-varied device names, UUID combinations, the full advertisement prefix, manufacturer bytes, geometry, vendor/package names, and BLE LED-hat terms. No indexed repository, issue, capture, or firmware matched both `iLedHat` and the single-characteristic FFF0/FFF1 profile.

Status: **no exact protocol match found**.

### Current `iledcolor` vendor app

The Google Play listing verifies that `com.led.iledcolor` is published by Shenzhen iLEDShow and controls LED screens. Static analysis of version 1.0.59 is documented in [apk-analysis.md](apk-analysis.md).

The app embeds A950–A953 UUIDs, not FFF0/FFF1. This is precisely the family the project requirements warn against assuming.

Disposition: **REJECTED as protocol evidence for this unit**. It remains a vendor/product-domain source, but no matching transport identity exists.

### `Mini LedShow`

Static analysis of version 1.3.3 found both A950–A953 and AE00–AE02 protocol families. Neither matches the supplied GATT profile.

Disposition: **REJECTED as protocol evidence for this unit**.

### Older iOS `iLed Show`

The App Store identifies Shenzhen I-ledshow as the developer. Release notes mention 16-height display fixes, 32×32 resolution, and program deletion; a review mentions a hat. This is the closest historical product clue found.

Disposition: **UNRESOLVED**. No static binary or packet capture was obtained, so no bytes are imported from it.

### Generic FFF0/FFF1 devices

Searches found unrelated products using these UUIDs, including medical devices, diesel heaters, battery monitors, watches/OTA transports, and OBD adapters. Some use FFF1 for notify only and another characteristic for writes; others use FFF1 as a combined channel. This diversity confirms that the UUIDs are not protocol identifiers.

Disposition: **REJECTED** unless a source also matches device name/product, advertisement, GATT shape, and packet behavior.

### Generic BLE LED libraries

`Bluetooth-Devices/led-ble` targets names such as Triones, LEDBLE, QHM, and Dream; it does not claim iLedHat support. `timhodson/ble-led-badge` uses service FEE9, custom D44B... characteristics, and AES encryption.

Disposition: **REJECTED** due to mismatched product identity and GATT profile.

## Evidence needed next

Any one of the following could move the project into Phase 3:

1. A legally obtained IPA for the historical `iLed Show` 1.10–1.12 app, followed by static Objective-C/Swift/native analysis.
2. A legally obtained older Android vendor APK demonstrably offered for the same `iLedHat` hardware and containing FFF0/FFF1.
3. A BLE HCI snoop/pcap captured while the known-working official controller performs one narrowly identified action.
4. A passive packet capture showing connect, CCCD enable, first host command, and response, with the display action labeled.
5. Firmware extracted through a non-destructive, documented method, with write-command dispatch recovered statically.

For a capture, the preferred first action is a read-only device/version/capability query if the vendor app exposes one. If it does not, capture a transient display preview separately from any save/upload/persist action. Include negotiated MTU, ATT handle, packet boundaries, timing, notifications, app version, phone OS, and the exact visible result.

## First-write approval rule

Before adding the first `writeValueWithoutResponse` call, the change must include:

- source/capture provenance
- a byte-level packet explanation
- why the command is transient or read-only
- checksum/framing tests with at least one independent golden vector
- an explicit review that the command is not reset, delete, password, flash, OTA, or DFU
- a documented recovery plan

Until then, all TX is **BLOCKED**.
