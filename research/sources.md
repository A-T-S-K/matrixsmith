# Sources and search record

Accessed 2026-08-31 unless noted. Protocol sources are pinned in [coolledx-sources.md](coolledx-sources.md) and [coolledux-sources.md](coolledux-sources.md).

## Primary licensed protocol sources

- `jean-santos/coolled1248-rs` commit `55d008237c2bcc96bd9c5d34b7c221b3325e71fa` — MIT OR Apache-2.0
- `UpDryTwist/coolledx-driver` commit `ba24137a4fb63b44896143adbd5862ef74de9fff` — MIT
- `CharlesLennon/coolledux-ble` commit `4f5656d9882adb4926c9dff4dc3fa5783b40a7ac` — MIT

## Secondary corroboration

- `schulzad/coolled-sign-controller` commit `430fc716aa0d3d1355ac27d7c1ad9ee62bf054cf` — no visible project license when scoped; no code copied

## Vendor/product sources

- Shenzhen iLEDShow website — manufacturer/product domain
- Google Play `com.led.iledcolor` and APKPure archive metadata
- APKPure Mini LedShow metadata
- Apple App Store historical `iLed Show` release notes/reviews

## Non-matching UUID cautions

Unrelated medical devices, heaters, battery monitors, watches, and adapters reuse FFF0/F1-family UUIDs. Examples previously reviewed include LepuDemo, homeassistant-diesel-heater, Renogy BT2 Reader, and CMF Watch Pro protocol notes. Generic LED libraries using Triones/LEDBLE/QHM/FEE9 or other characteristics do not identify this profile.

The final CoolLEDUX identification comes from the exact iLedHat's structured `0x1F` response plus verified `0x04` echo/visual/readback behavior. UUID shape remains only candidate evidence.
