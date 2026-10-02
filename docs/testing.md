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

The injected-family and second-profile contract tests use authored fixtures in
`tests/helpers/synthetic-driver.ts` and `tests/helpers/second-coolledux-profile.ts`.
They exercise the real registry/application interfaces without adding production
drivers or profiles. The scripted fake transport can exercise live command paths,
but its replies and scope-spoofing import fixtures confer no physical verification.

Automated tests use fixtures, fake transports, or the development simulator. They do not establish that a display rendered content correctly. Run `docs/physical-acceptance.md` against the exact candidate on the stable HTTPS origin before publishing support claims. Record build ID, commit, browser/OS, device label, and observed outcome.

## Reviewing a failure

Reproduce the specific failure before changing code or baselines. Distinguish application defects from fixture/server problems. Keep unexpected browser errors visible; fix rejection handling rather than suppressing the error collector. CI retains coverage and browser artifacts to make failures reviewable.

The focused `tests/e2e/gif.spec.ts --project=chromium` journey uses the real
ImageDecoder and the tiny authored partial-update/disposal fixture documented
in `tests/fixtures/gif/README.md`. It checks complete pixels, timing, editor
preview, normal ShowAnimation delivery, and identical delays in four compiled
tiles. Unit tests cover budgets before proportional work, unsupported decoding,
cleanup/stale owners, product/native gates, and typed provenance round trips.
These remain software evidence; imported-GIF physical acceptance is unchecked.

`npm run schema:generate` reproduces the checked-in Bundle V3 validator from
`public/bundle-v3.schema.json`; `npm run schema:check` fails on stale output and
runs in normal verification and before builds. Schema tests execute both Ajv
2020-12 compilation and the generated function on current exports and mutations.
The focused `tests/e2e/release-wave-three.spec.ts --project=chromium` journey
covers source labels, report-kind/control/privacy transitions, Markdown downloads,
and an accessible failed-download/retry path using the actual report generators.

Presentation hardening regressions count text/scroll/demo generation and storage reads, assert preview identity and exact input invalidation, and exercise workspace/profile changes, history refresh/demotion, persistence failures, and concurrent errors. Browser regressions verify scrolling during unrelated publications, target-sized image modes and retry, connected Home diagnosis, external-store replacement/cleanup, and Device actions focus restoration with Escape/Browser Back. Timed observation elapsed displays update locally. Desktop timing measurements are supporting evidence, not pass/fail thresholds or Android acceptance.
