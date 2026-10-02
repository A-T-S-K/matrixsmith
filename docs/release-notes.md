# Release candidate notes

## Initial supported scope

The candidate targets the characterized CoolLEDUX iLedHat 31AE 32×16. Routine verified text/image sends remain direct. Other hardware remains bounded investigation territory; locally imported GIFs use the trusted raster animation substrate, while the native device GIF decoder and other unverified operations retain their experimental gates. Demo animation is not an authored animation editor.

Actual browser/OS and release-build hardware support must be filled from physical acceptance before publication. The planned primary acceptance environment is Chrome on Android using the stable HTTPS origin.

## Changes

- Composed application/presentation services replace shared-state inheritance and the presentation `any` escape hatch.
- Explicit workspace disposal, browser dependency injection, and retained-live/offline separation.
- Earlier image/file budget enforcement, visible import errors, truthful persistence failures, and stale-preview protection.
- Shareable diagnostics remove identifying advertisement data and identifying text in diagnostic descriptions; full local archives retain their explicitly labeled data.
- Build-specific offline assets, shared update state, multi-tab readiness, and recoverable upgrades.
- Resolved-import architecture checks, TypeScript-aware linting, combined unit/browser coverage, expanded recovery tests, and clean-source candidate packaging.

## Compatibility

Bundle V3 and `matrixsmith:v2:` settings/history remain unchanged. Older bundle formats remain unsupported. No protocol fixtures are intentionally changed. No backend, accounts, telemetry, new drivers, or firmware-writing features are added.

Deployment, real-device acceptance, and the owner's project-license decision remain launch gates.

## Imported GIF playback

Create → GIF converts a local file through browser `ImageDecoder` into a
contained, device-sized `FrameSequence`, then `ShowAnimation` and the existing
tiled animation compiler. Supported browsers must expose GIF decoding; there
is no raw native GIF fallback or file upload. The panel previews the actual
frames, dimensions, duration, and any finite-repetition warning.

Limits before frame iteration: 8 MiB encoded input, 48 frames, 24,000,000
cumulative source pixels, and 16 KiB decoded bytes per tile. Browser frame
durations round from microseconds to 1..65,535 ms; missing/nonpositive durations
use 100 ms. Source repetition is informational: the device animation does not
encode finite repetition. GIF hardware acceptance on the frozen candidate is
still pending; native `ShowGif` remains experimental and unverified.
