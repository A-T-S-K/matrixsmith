# MatrixSmith

A local-first matrix display controller and protocol workbench, built as a static TypeScript/Preact PWA.

The initial supported profile is the characterized **CoolLEDUX iLedHat 31AE 32×16**. Other displays can use bounded identification and investigation tools; matching a Bluetooth service does not establish model compatibility. Release-build hardware acceptance is recorded separately from earlier protocol evidence.

## Use the app

1. Open MatrixSmith on the stable HTTPS release origin in the planned Chrome/Android acceptance environment. Exact release-build browser/hardware support remains pending the physical checklist. Desktop localhost is suitable for development.
2. Choose **Connect a display** and select your display in the browser chooser.
3. For a recognized, ready display, use **Create** to enter text or choose an image, then **Send to display**. A verified routine send replaces the current display content without a confirmation dialog. **Upload sent** reports host-side transfer completion; visual rendering and any protocol/readback result are separate evidence.
4. Use **Investigate** to troubleshoot or characterize an unfamiliar display. Experimental writes show one consequence-specific confirmation; imported evidence never enables a live write.
5. Use **Device actions → Share report…** for reports and Bundle V3 exports. A shareable bundle redacts device identifiers; a full local archive explicitly includes them.

Demo animation is a built-in example, not an animation editor. Imported GIFs decode locally in supported Chrome/Android browsers into device-sized raster animations, using the trusted animation path. The native device GIF decoder remains experimental research. Firmware, password changes, and arbitrary raw writes are not available.

After a successful online installation, the app shell and lazy features can open offline. Installation downloads and caches the lazy chunks and reference/schema JSON even before their first use; lazy execution reduces initial work, not offline installation cost. Bluetooth access still depends on browser/device support. Updates are explicit and refresh open MatrixSmith tabs only after they acknowledge readiness. Finish active work or close an unavailable tab before applying an update.

## Development

Use Node **24.20.0** and npm **11.19.0**, pinned in `.nvmrc` and package metadata.

```sh
npm ci
npm run dev
npm run verify
```

Open `/?sim` for the development-only known-device simulator or `/?sim=unknown` for an unknown display. Simulator results are not physical evidence and the simulator is excluded from production output.

The dev server uses port 5174. In a second terminal, run `npm run tunnel` to create a Cloudflare quick tunnel. Its random `*.trycloudflare.com` URL works automatically after every relaunch. For another tunnel provider, copy `.env.example` to `.env.local` and set its exact hostname in `MATRIXSMITH_TUNNEL_HOST`.

## Verification and release candidate

```sh
npx playwright install chromium
npm run verify:release
npm run release:package
```

The complete gate includes all-production-source unit/browser coverage (run the complete `npm run test:coverage`, without narrowing files), browser error checks, responsive/accessibility journeys, two-build production upgrade/offline tests, dependency checks, and static-output verification. `release:package` requires a reviewed, committed working tree, runs the gate, and emits a static archive plus commit/build identity and SHA-256 manifests under `release/`.

Deployment remains deferred. A local green run is not a successful Linux CI run or physical acceptance. See [the candidate and launch procedure](docs/releasing.md) before promotion.

## Data and privacy

The app has no backend, accounts, telemetry, runtime CDN, or content upload. Files are processed locally. Input budgets are 10 MiB for bundles, 25 MiB for images/captures, 8 MiB for GIFs, and 24 megapixels for decoded images. Imported GIFs are bounded to 48 frames, 24 million cumulative source pixels, and 16 KiB decoded data per 8-column tile; these are application guardrails, not hardware limits.

Bundle V3 and `matrixsmith:v2:` local settings/history remain the current formats. Older bundle versions are rejected rather than migrated. Invalid imports preserve the current workspace. Opening a report offline retains a connected live workspace separately; returning to it does not import authorization from the report.

Review free-form notes and raw protocol content before sharing diagnostics; automatic identifier redaction is not a substitute for reviewing information you entered yourself.

## Documentation

- [Architecture and state ownership](docs/architecture.md)
- [Testing](docs/testing.md)
- [Release notes](docs/release-notes.md)
- [Candidate packaging, recovery, and launch](docs/releasing.md)
- [Physical acceptance checklist](docs/physical-acceptance.md)
- [Safety policy](docs/safety.md)
- [Diagnostics](docs/diagnostics.md)
- [Adding a driver](docs/adding-a-driver.md)
- [Protocol research and provenance](research/README.md)

## Distribution status

This repository has no project `LICENSE`. MatrixSmith is described as source-available; no open-source license has been selected for it. [Third-party notices](THIRD_PARTY_NOTICES.md) preserve the notices for distributed runtime dependencies. Independently derived protocol implementations have separate provenance in `research/`.

From Home, **Open offline protocol explorer** offers [LSLED legacy](docs/lsled-offline.md) (one 44×11 monochrome bank), [micro:bit LED Matrix State](docs/microbit-offline.md) (one 5×5 binary matrix), and [Merkury RGB blocks](docs/merkury-offline.md) (one 16×16 RGB frame). Previews and packets are offline software references; they do not establish live hardware support.

Registered read support currently covers one bounded micro:bit LED Matrix State service value, tied to the inspected Lancaster DAL contract and an accessible Read characteristic. A read is evidence of that supplied endpoint value, not model identification or rendering; other firmware applicability remains unknown. Experimental discovery, still-route verification and session-only candidate V2 profiles require their own fresh target-bound evidence and confirmation; imported profiles/reports do not grant live authority.
