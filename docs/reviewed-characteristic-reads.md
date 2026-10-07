# Registered characteristic reads

Display setup can inspect one application-registered LED Matrix State endpoint,
without a profile or a transmission plan. The read catalog is authored TypeScript;
knowledge, imported identifiers, profiles and experimental permission cannot
register reads. A service name/UUID supplies relevance, never identity.

The transport-facing reviewed boundary checks catalog object identity, active
interview intent, live source, current connection/target, pinned definition and
accessible Read property immediately before reserving costs and calling read.
Write probes remain a distinct execution class. No write, subscription,
notification waiter, automatic retry, polling or reconnect is used by a read.

## Scope and interpretation

The contract inspects Lancaster microbit-dal revision
`318c6abbb3d952d3f49a595a726486230e82fb5b`, specifically
[MicroBitLEDService.cpp](https://github.com/lancaster-university/microbit-dal/blob/318c6abbb3d952d3f49a595a726486230e82fb5b/source/bluetooth/MicroBitLEDService.cpp)
and the corresponding
[header](https://github.com/lancaster-university/microbit-dal/blob/318c6abbb3d952d3f49a595a726486230e82fb5b/inc/bluetooth/MicroBitLEDService.h).
The read callback samples image pixels into five binary row octets, clearing
bits 7–5. Leftmost is bit 4; row zero is the top row in the documented orientation.
It treats a nonzero image pixel as on, so brightness is not recovered.

The [DAL v2.1.1 LED documentation](https://lancaster-university.github.io/microbit-docs/ble/led-service/)
describes this service as optional and disabled by default. The
[MakeCode enablement reference](https://makecode.microbit.org/reference/bluetooth/start-led-service)
was inspected on 2026-10-03 for context, not as a guarantee about every firmware
or security configuration. Its security guidance does not turn browser errors
into definite pairing diagnoses. The implementation is independently authored.
Existing source records, notices, offline catalog and encoder remain intact.

A conforming result means: LED matrix service value received and decoded under
the inspected reference. The 5×5 preview is a supplied-state interpretation,
not a physical observation. It does not authenticate hardware, manufacturer,
board/chip generation, physical geometry/rendering, firmware security, persistence,
stored programs or live frame/text/control/animation/image support. Neither
micro:bit nor LSLED writing plans become live-executable.

## Bounds and ownership

Each interview has four attempts, four characteristic-read calls, eight write
packets, 2,048 application payload bytes and 30 seconds. A selected read reserves
one attempt, one read call, zero write packets, five expected returned bytes and
three seconds before dispatch. Write probes reserve their compiled packet bytes
and elapsed bounds as before. Replanning inside the interview does not refill
costs. A new explicit interview starts a new budget. These are application
payload/call counts, not total Bluetooth/radio traffic; Web Bluetooth cannot
measure that traffic.

Only exactly five bytes with all reserved bits clear can allocate a decoded
preview. Malformed values preserve bounded raw RX evidence without normalization
or identity adoption. Evidence allocation is capped at 512 bytes (the GATT
attribute-value ceiling); a defensive oversized scripted response records its
actual length and capped prefix. Browser allocation itself cannot be constrained
by this application. No value beyond the five-byte contract can authorize anything.

The common GATT recorder captures original source, driver/profile, endpoint,
connection generation and a connection-scoped target digest before awaiting.
Read RX packets, original definition/decoder/source references and explicit
outcome/failure stage use compatible V3 transaction fields and findings.
Decoded reads stay in the interview's read-value field; decodedResponse remains
null and no notification, TX packet, receipt or protocol acknowledgement is invented.
Shareable exports do not receive plaintext target names in these new findings.

Stop prevents scheduling/adoption while dispatched work remains supervised.
The read deadline invalidates adoption without claiming browser cancellation.
After timeout, competing operations and new interviews stay blocked until the
read settles or an explicit disconnect successfully retires the transport.
Disconnect invalidates local context immediately and releases read ownership
only after transport retirement. A fresh connection can then execute; an old
result may append original-context evidence but cannot alter the new interview,
preview, notices or authority. Read failures do not quarantine writes or reject
protocol support. No automatic recovery is attempted.

## Browser and presentation

Known optional LED-service permission is included before the unfamiliar-device
chooser; it does not require advertisement or promise availability. Cold Home
invokes requestDevice synchronously with lightweight sourced hints, then loads
the application and consumes that selection once. No dependency loading occurs
before the chooser call in the gesture. The application graph remains lazy.
The same setup interview presents progress, Stop, read value, source/time,
uncertainties and explicit disconnect/workbench/report recovery. A service
observation has its own terminal state and does not advance into Create.

Validation uses isolated scripted software fixtures and Chromium only. No real
Bluetooth hardware was contacted; this is software-tested read support, not
hardware-qualified micro:bit support.
