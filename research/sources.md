# Sources and search record

Accessed 2026-08-31 unless noted. Protocol implementation sources are pinned in [coolledx-sources.md](coolledx-sources.md).

## Primary licensed protocol sources

- `jean-santos/coolled1248-rs` commit `55d008237c2bcc96bd9c5d34b7c221b3325e71fa` — MIT OR Apache-2.0
- `UpDryTwist/coolledx-driver` commit `ba24137a4fb63b44896143adbd5862ef74de9fff` — MIT

## Secondary corroboration

- `schulzad/coolled-sign-controller` commit `430fc716aa0d3d1355ac27d7c1ad9ee62bf054cf` — no visible project license when scoped; no code copied

## Vendor/product sources

- Shenzhen iLEDShow website — manufacturer/product domain
- Google Play `com.led.iledcolor` and APKPure archive metadata
- APKPure Mini LedShow metadata
- Apple App Store historical `iLed Show` release notes/reviews

## Non-matching UUID cautions

Unrelated medical devices, heaters, battery monitors, watches, and adapters reuse FFF0/F1-family UUIDs. Examples previously reviewed include LepuDemo, homeassistant-diesel-heater, Renogy BT2 Reader, and CMF Watch Pro protocol notes. Generic LED libraries using Triones/LEDBLE/QHM/FEE9 or other characteristics do not identify this profile.

Searches covered exact device/capture/manufacturer strings, UUID permutations, 16×32 LED hats, vendor packages, CoolLED1248/CoolLEDX/CoolLEDM, GitHub issues/repos, app stores, and BLE libraries. The final family candidacy comes from combined evidence and pinned protocol implementations, not the UUID alone.
