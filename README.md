# MatrixSmith

Local-first matrix display control and protocol lab.

MatrixSmith is a source-available static TypeScript PWA for controlling supported matrix displays, inspecting hardware, developing device drivers, and collecting repeatable protocol evidence. The hardware-verified CoolLEDUX iLedHat 31AE 32×16 panel is the first profile; it is not a global product assumption.

## Current capabilities

- generic Web Bluetooth transport with explicit chooser permissions and inspection mode
- portable device fingerprints, scored driver matching, and separate driver/profile models
- semantic matrix operations compiled into inspectable, immutable `TransmissionPlan` objects
- capability-driven safety and serialized execution with separate host/protocol/state results
- versioned diagnostic bundle export/import and offline matching/replay foundations
- independent CoolLEDX and CoolLEDUX drivers with shared factual envelope primitives, active read-only family probing, response correlation, and raw/decoded notification retention
- verified CoolLEDUX device-info and deliberate raw 0–255 brightness Control for the exact iLedHat
- goal-oriented Preact UI: Home, then a device workspace with Control, Diagnose, and Develop views and a persistent Share report action, responsive for Chrome on Android
- serializable protocol transactions, driver-contributed diagnostic workflows (including the reversible CoolLEDUX brightness round-trip), and a deterministic shareable Markdown report with privacy-safe defaults
- structured presets under `matrixsmith:v1:` with legacy iLedHat preset reading

Verified CoolLEDUX `GetDeviceInfo` and `SetBrightness` are live only through explicit actions after the session is resolved. Power and other direct commands remain dry-run-only. Persistent content, password set, and OTA are not implemented live. There is no arbitrary raw writer.

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
- [UX workflows](docs/ux-workflows.md)
- [Driver-oriented ADR](docs/adr/0001-driver-oriented-architecture.md)
- [Safety policy](docs/safety.md)
- [Diagnostics](docs/diagnostics.md)
- [Adding a driver](docs/adding-a-driver.md)
- [Testing](docs/testing.md)
- [iLedHat / CoolLEDUX research](research/protocol-findings.md)

## Privacy and legal status

The app has no backend, account, analytics, telemetry, runtime CDN, external font, or content upload. Diagnostic files are created only by explicit local download.

This repository currently has no project `LICENSE`. Do not describe MatrixSmith itself as open source until the owner chooses and adds a license. The public source and cited third-party protocol evidence have separate provenance documented in `research/`.
