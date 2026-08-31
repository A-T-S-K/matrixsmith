# Public sources and search record

Accessed 2026-08-31. Source links are included for reproducibility; third-party protocol claims were not treated as hardware compatibility evidence without a matching product identity.

## Vendor/product sources

- [Official Shenzhen iLEDShow site](https://www.iledshow.com/) — identifies the manufacturer/product domain and lists app-controlled LED hats, caps, flexible displays, backpacks, and bare boards.
- [Google Play: `com.led.iledcolor`](https://play.google.com/store/apps/details?id=com.led.iledcolor) — verifies package, publisher, and app purpose.
- [APKPure: iledcolor 1.0.59 archive metadata](https://apkpure.net/iledcolor/com.led.iledcolor/download) — archive version, signature, variants, and published hashes used for static analysis verification.
- [APKPure: Mini LedShow](https://apkpure.net/mini-ledshow/com.led.miniled) — package identity, versions, and published hash.
- [Apple App Store: historical iLed Show](https://apps.apple.com/us/app/iled-show/id1486290176) — publisher, version history, 16-height/32×32/program-ID notes, and hat-related review.

## Rejected generic protocols

- [Bluetooth-Devices/led-ble](https://github.com/Bluetooth-Devices/led-ble) — generic strip/bulb families with different advertised identities.
- [timhodson/ble-led-badge](https://github.com/timhodson/ble-led-badge) — FEE9/D44B... AES badge protocol, not FFF0/FFF1.
- [homeassistant-diesel-heater](https://github.com/Xev/homeassistant-diesel-heater) — demonstrates unrelated heaters using FFF0/FFF1-family UUIDs with different write channels/framing.
- [LepuDemo](https://github.com/viatom-develop/LepuDemo) — demonstrates unrelated medical devices using FFF0/FFF1/FFF2.
- [Renogy BT2 Reader](https://github.com/neilsheps/Renogy-BT2-Reader) — uses FFF0/FFF1 as a receive service while sending via FFD0/FFD1.
- [CMF Watch Pro 2 protocol notes](https://github.com/joshuapassos/CMF-Watch-Pro-2-BLE-Protocol) — unrelated wearable with FFF0 plus separate FFF1/FFF2 directions.

## Static-analysis tooling

- [JADX](https://github.com/skylot/jadx) — inspected for the Android wrapper; app logic was Flutter AOT rather than ordinary Dex.
- [Blutter](https://github.com/worawit/blutter) — Flutter AOT analysis approach.
- [flutterdec](https://github.com/caverav/flutterdec) — used to identify Dart 3.11.5, snapshot hash, and statically disassemble the ARM64 application payload.

## Search terms

Searches included the requested strings and permutations of:

```text
iLedHat / ILEDHAT
iLedHat FFF0 / FFF1
0000fff0 / 0000fff1
16x32 LED hat bluetooth
iledcolor / iLEDShow / LED Controll
com.led.iledcolor
Shenzhen iLEDShow
BLE LED hat protocol
0201060303F0FF
AE315EEA
```

Search targets included GitHub repositories and issues, Home Assistant/ESPHome projects, Python and JavaScript BLE libraries, APK catalogs, the vendor site, Google Play, and the Apple App Store.
