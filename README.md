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
- goal-oriented Preact UI: Home, then a device workspace with Create and Investigate as primary views (the protocol workbench is secondary developer tooling) and a persistent Share report action, responsive for Chrome on Android
- serializable protocol transactions, driver-contributed diagnostic workflows (including the reversible CoolLEDUX brightness round-trip), and a deterministic shareable Markdown report with privacy-safe defaults
- an nRF Connect text-log importer that extracts GATT, TX/RX bytes, and timestamps, correlates transactions, decodes packets with the installed drivers, and merges labeled read-only evidence into live or offline sessions
- a complete offline CoolLEDUX stored-program compiler: custom CRC32, Okumura LZSS (regular + safe/all-literal), program/announce/chunk framing, dual RGB444 encodings with per-path off sentinels, and generic 8-column tiling — conformance-tested byte-for-byte against the pinned reference implementation
- profile-derived content pipelines: tiled Graffiti static frames, rendered text through an embedded 5×7 bitmap font, local PNG/JPEG/WebP image import with fit modes, tiled pixel animation, and native GIF programs
- guided hardware-validation workflows (deterministic 32×16 orientation/color pattern and a two-frame diagnostic animation) with an exact-consequence confirmation, structured observation questions, and session-scoped validation evidence
- a support matrix using honest states (`Verified`, `Experimental`, `Not tested`, `Unknown`, `Rejected`, `Unsupported`, `Out of scope`) whose recommended next tests advance the device-support state
- structured presets under `matrixsmith:v1:` with legacy iLedHat preset reading; content settings persist as small JSON only
- a first-class **Investigation** model with atomic hardware claims and scoped evidence (source-reference / built-in-profile / current-session / previous-local-session / imported), replacing coarse support states that could overclaim
- **guided hardware tests** contributed by drivers as generic ABOUT → RUN → OBSERVE → RESULT workflows — for the iLedHat: the raw 0x0000/0x0004 Graffiti black probe, a MatrixSmith-measured static-image movement stopwatch, the stayTime 3-vs-0 discriminator, single-frame (and separate identical-pair) Animation static rasters, an 11-word raw pixel-channel probe including untransformed high-nibble values, and color/white characterization
- a deterministic, inspectable **recommendation engine** that always surfaces one obvious next test from the goal/symptom, unresolved claims, prerequisites, and safety
- **symptom-first troubleshooting** that shares the same investigation engine, and a device-centered workspace: Create for known displays, guided Investigate for unknown/incomplete hardware, and the protocol workbench as secondary developer tooling
- AI-ready **test reports**, a full **investigation report** designed to let an AI implement or fix a driver without the chat history, a forensic packet/timing appendix, and the canonical JSON bundle
- per-path content gating (text/image need a validated static-raster strategy; animation and GIF each need their own verified claims), a session-scoped **raster strategy** abstraction (graffiti vs. animation-delivered stills), and immutable structured profile quirks with honest unknowns
- structural stored-program **receipt decoding** (raw statuses verbatim; missing receipts are observations, never failures or retry triggers) and real per-packet write/host-acceptance timing in every transaction
- resumable **local investigation history** (structured evidence only — never safety tokens or content binaries) and optional Web Bluetooth advertisement enrichment (`watchAdvertisements`, `optionalManufacturerData 0x31AE`) with chooser-free reconnect where `getDevices()` exists
- **device-bound investigations**: current-session evidence is tied to one physical device session (browser-authorized device identity); a different display can never inherit it, and localStorage/bundle evidence is structurally demoted on load so poisoned scopes have no authority
- **operational trust vs investigative state**: gates authorize only from trusted current-session/built-in evidence, while historical contradictions stay visible as conflicts and drive revalidation recommendations
- **derived static-image viability**: `static.strategy` derives from atomic requirements (including a MatrixSmith-measured ≥15 s stable hold from T1, characterized black semantics, and encoder correctness); the T0/T1/T2 timeline measures render latency and visible static hold without the user ever estimating a time
- **native-static-first characterization**: the recommendation engine walks the pursued strategy's requirement graph — baseline Graffiti timing first, the stayTime=0 discriminator after movement, black/channel characterization next, and the Animation-as-static fallback only once Graffiti is conclusively non-viable
- reports that label the structured live advertisement observation (`web-bluetooth-watch`), distinguish trusted vs historical vs conflicting evidence per scope, include a derived static-strategy assessment, and flag encoder permutations as explicit driver-correction tasks

Verified CoolLEDUX `GetDeviceInfo` and `SetBrightness` are live only through explicit actions after the session is resolved. Stored-program content (static frame, text, image, animation, GIF) is compiled and previewable offline, classified experimental + persistent, gated behind the guided static-frame validation, and every send shows its exact consequence before an explicit confirmation. Power and other direct commands remain dry-run-only. Password set and OTA are not implemented. There is no arbitrary raw writer.

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
