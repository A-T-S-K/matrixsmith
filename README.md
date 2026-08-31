# MatrixSmith

Local-first matrix display control and protocol lab.

MatrixSmith is a source-available static TypeScript PWA for controlling supported matrix displays, inspecting hardware, developing device drivers, and collecting repeatable protocol evidence. The iLedHat 31AE 32×16 panel is the first experimental profile; it is not a global product assumption.

## Current capabilities

- generic Web Bluetooth transport with explicit chooser permissions and inspection mode
- portable device fingerprints, scored driver matching, and separate driver/profile models
- semantic matrix operations compiled into inspectable, immutable `TransmissionPlan` objects
- central safety policy and serialized executor with structured host receipts
- versioned diagnostic bundle export/import and offline matching/replay foundations
- independently implemented CoolLEDX control framing, escaping, transfer chunking, XOR checksum, RGB bitplane packing, static image, animation, and rendered-text dry runs
- responsive Control, Inspect, and Lab surfaces for Chrome on Android
- structured presets under `matrixsmith:v1:` with legacy iLedHat preset reading

Only `SetBrightness` with raw `0x40` or `0xC0` may be sent live to the `iledhat-31ae-32x16` profile, and only from Lab after a memory-only session unlock. Mode, speed, switch, text, image, and animation remain dry-run. There is no arbitrary raw writer.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Web Bluetooth requires a secure context. `localhost` works for desktop development; use an HTTPS deployment or tunnel for the Galaxy S23. To allow one local tunnel hostname, copy `.env.example` to `.env.local` and set `MATRIXSMITH_TUNNEL_HOST`. Wildcard hosts are not enabled.

## Documentation

- [Architecture](docs/architecture.md)
- [Driver-oriented ADR](docs/adr/0001-driver-oriented-architecture.md)
- [Safety policy](docs/safety.md)
- [Diagnostics](docs/diagnostics.md)
- [Adding a driver](docs/adding-a-driver.md)
- [Testing](docs/testing.md)
- [CoolLEDX research](research/protocol-findings.md)

## Privacy and legal status

The app has no backend, account, analytics, telemetry, runtime CDN, external font, or content upload. Diagnostic files are created only by explicit local download.

This repository currently has no project `LICENSE`. Do not describe MatrixSmith itself as open source until the owner chooses and adds a license. The public source and cited third-party protocol evidence have separate provenance documented in `research/`.
