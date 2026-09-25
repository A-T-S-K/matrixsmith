# Testing

Use the pinned Node/npm versions, then install dependencies with `npm ci` and Chromium with `npx playwright install chromium` (`--with-deps` on Linux CI).

## Gates

- `npm run verify`: typecheck, ESLint/native architecture and promise checks, formatting, unit/application tests, production build, and static-output validation.
- `npm run test:coverage`: unit tests plus instrumented development-browser journeys, instrumented identically on original source before Node/browser transformations and combined into one production-source coverage inventory. Thresholds remain 80% statements, 70% branches, 80% functions, and 80% lines. Test helpers do not contribute production coverage. Instrumentation is never enabled in release builds.
- `npm run test:e2e`: simulator/browser journeys, ARIA and reviewed visual baselines, axe, breakpoint checks, file recovery, exports, and disconnect handling. Unexpected page errors/unhandled rejections fail the journey.
- `npm run test:e2e:offline`: real production builds A/B on an isolated server; first install, upgrade, multiple tabs, offline lazy routes, failed installation, and rollback.
- `npm run verify:release`: the complete candidate gate including audit and whitespace checks.

Linux image baselines are reviewed in the pinned Playwright Ubuntu container used by CI; macOS image baselines remain separate because the application uses native system fonts. ARIA snapshots are shared across platforms. Baseline changes require visual review, not relaxed tolerances.

Browser tests own their local servers and fail on port collisions. The simulator suite uses port 4187 and production fixtures use 4174. Stop only the conflicting test server or configure an isolated run; never reuse an unrelated application's server.

## Regression evidence

Preserve the byte-level fixtures under `tests/fixtures/` and their source provenance. Do not regenerate golden packets or visual baselines merely to make a refactor pass. CoolLEDUX conformance regeneration remains documented in `research/coolledux-sources.md` against the pinned reference commit.

Coverage includes target/digest authorization, imported/historical trust boundaries, current-session isolation, timeouts and quarantine, reconnect/notification lifecycle, brightness restoration, claim/strategy agreement, Bundle V3 validation, and scoped reports.

Release-specific tests exercise pre-decode limits, malformed files, unavailable storage, runtime disposal, repeated offline workspace replacement, retained live connections, update failure/retry, and identifier redaction inside structured diagnostics. The opt-in QA bundle generator remains skipped unless `QA_BUNDLE_PATH` is set.

## Hardware boundary

Automated tests use fixtures, fake transports, or the development simulator. They do not establish that a display rendered content correctly. Run `docs/physical-acceptance.md` against the exact candidate on the stable HTTPS origin before publishing support claims. Record build ID, commit, browser/OS, device label, and observed outcome.

## Reviewing a failure

Reproduce the specific failure before changing code or baselines. Distinguish application defects from fixture/server problems. Keep unexpected browser errors visible; fix rejection handling rather than suppressing the error collector. CI retains coverage and browser artifacts to make failures reviewable.
