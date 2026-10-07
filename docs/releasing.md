# Candidate packaging and launch

## Code-ready candidate

1. Review the intended working-tree changes and commit them. Preserve unrelated local work separately; packaging does not silently include it.
2. Use Node 24.20.0 / npm 11.19.0 and `npm ci --no-audit --no-fund` from a clean isolated checkout after reviewing lifecycle-bearing dependencies. Record actual toolchain versions; a substituted Node version leaves pinned-toolchain qualification open.
3. Install Chromium and run `npm run release:package`. The command requires clean Git state, runs the complete release gate, verifies build/commit agreement, and produces `release/matrixsmith-<version>-<build-id>.tar.gz`, a SHA-256 file, and a JSON file manifest.
4. Verify a successful Linux CI result for that exact full commit SHA, using `.github/workflows/ci.yml`. CI runs the packaging command and retains the candidate and verification artifacts. A local green run, earlier commit or browser emulation does not satisfy CI or physical acceptance.

Before promotion, retain the complete `npm run verify`, `npm run test:coverage`
and `npm run test:e2e:offline` results on stable integrated source, with unchanged
thresholds and no focused-test substitution. `verify:release` also invokes
`npm audit --omit=dev`; CI's separate full dependency audit is advisory and uses
`continue-on-error`, so a green CI result alone does not close development
advisories. Audit sends dependency information to the registry: run it only in
an authorized release/CI process. Documenting these commands does not establish
completed qualification.

The content manifest identifies every emitted file independently of archive timestamps. Retain the full commit SHA, build ID, actual Node/npm/browser versions, archive SHA-256 and JSON per-file SHA-256 manifest. Verify the archive checksum and each extracted file against that manifest, and compare `build-metadata.json` commit/build identity before hosting. The artifact contains only static files and distributed dependency notices. No deployment credentials are required to complete code work. A dirty working tree or an unverified CI run must not be represented as a packaged release candidate.

## Deferred launch checklist

- [ ] Choose the public distribution terms; a MatrixSmith project license has not been selected.
- [ ] Deploy the tested artifact to a preview origin.
- [ ] Verify actual CSP, Permissions-Policy, cache, and content-type response headers. Vite preview does not establish production host behavior.
- [ ] Confirm no unexpected runtime external requests and no Functions/Worker backend artifacts.
- [ ] Deploy the same candidate to the stable HTTPS origin.
- [ ] Complete the physical acceptance checklist with build ID, commit, browser/OS, non-sensitive device label, and evidence.
- [ ] Complete all six owner-run journeys in [physical acceptance](physical-acceptance.md), including keyboard, screen-reader, installed-PWA and responsive checks.
- [ ] Complete the rollback drill below.
- [ ] Publish only the device/browser capabilities that passed acceptance, with known limitations and release notes.

Cloudflare Pages remains the planned static host: deploy the archive contents as
the site root, without Functions or Worker runtime code. Inspect the actual
HTTPS responses at `/`, `/index.html`, `/sw.js`, `/asset-manifest.json`,
`/build-metadata.json` and representative hashed JS/CSS assets. Compare with
`public/_headers`: same-origin CSP (including the maintained frame-ancestors
restriction), `bluetooth=(self)`, disabled camera/microphone/geolocation,
`nosniff`, no-referrer, immutable hashed assets and revalidated shell/metadata.
Check content types, deep-link routing, missing-asset behavior and unexpected
external requests. The presence of `_headers` in an archive is not proof that
host policy was applied. Web Bluetooth permissions are origin-scoped; preserve
the stable origin for final hardware testing.

## Recovery and rollback

For a quarantined or disconnected device, reconnect before another transmission. Do not automatically retry indeterminate writes. Failed file imports retain the previous workspace/content; select a valid file again. Settings/history persistence failures remain visible.

For an application update, finish active operations and guided observations in every tab, then choose **Update and reload**. If another tab is unavailable, close it and retry. An unsuccessful install retains the current offline shell. Verify this in an installed PWA as well as browser tabs; do not force service-worker activation through developer tools to count the user-facing update gate. Export important session-only profiles/reports and save draft text/original image or GIF files before intentional reload. Content drafts are session state; persisted settings/history do not preserve the full draft. Live connections and confirmations must be re-established afterward.

To roll back, restore the complete previous static artifact at the same origin, including its worker, HTML, manifest, metadata, and hashed assets. Do not replace only HTML or delete old assets independently. Check for updates in open clients and apply the returned build when all tabs are idle. Verify the displayed/exported build identity and repeat offline navigation plus a safe device-info query. Record the previous and restored artifact checksums and the result.

The worker retains current and previous successful caches. This supports recovery but is not a replacement for keeping both release artifacts on the deployment side.

## Reports and support

Use the repository bug-report template with browser/OS, build version, device profile, steps, expected behavior, and observed behavior. Prefer a shareable Bundle V3; inspect free-form content before posting. Full local archives contain identifiers and should not be the default attachment.

## Dependency and distributed-code review

The lockfile's ESLint → minimatch 10.2.6 → brace-expansion path accepts
`^5.0.8`. The narrow remediation resolves patched 5.0.12 on that same major line,
without overrides or parent upgrades; package.json and all other lock entries
remain unchanged. Primary advisories inspected
2026-10-06: [quadratic rewrite](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)
(5.x minimum 5.0.12), [comma parsing recursion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p)
(5.0.10) and [nested-group recursion](https://github.com/advisories/GHSA-qhr7-859c-m2p7)
(5.0.11). Record the resolved version/integrity, actual lockfile diff and lint
result. This addresses these named advisories; it is not a complete security
certification. Development classification does not determine shipped content.

| Distributed item                                                                            | Applicability and retained notices                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [preact 10.29.8](https://github.com/preactjs/preact/blob/10.29.8/LICENSE)                   | UI runtime; pinned MIT notice.                                                                                                                                                                                                                  |
| [Ajv 8.20.0 helpers](https://github.com/ajv-validator/ajv/blob/v8.20.0/LICENSE)             | Generated Bundle V3, profile V1/V2 and knowledge validators include runtime helpers; development compiler classification does not exclude that output.                                                                                          |
| [ajv-formats 3.0.1](https://github.com/ajv-validator/ajv-formats/blob/v3.0.1/LICENSE)       | Bundle V3 generated full-format/date-time helper; MIT notice.                                                                                                                                                                                   |
| [fast-deep-equal 3.1.3](https://github.com/epoberezkin/fast-deep-equal/blob/v3.1.3/LICENSE) | Generated profile validator through Ajv equal; MIT notice.                                                                                                                                                                                      |
| [Rolldown 1.2.6 helper](https://github.com/rolldown/rolldown/blob/v1.2.6/LICENSE)           | Generated CommonJS initialization helper; VoidZero, Rollup and Evan Wallace derivation notices retained.                                                                                                                                        |
| Independent protocol references                                                             | CoolLED provenance and LSLED/micro:bit/Merkury pinned facts and authored vectors are documented separately. Offline conformance does not promote a live profile. No upstream code/artwork/manual is redistributed by those reference compilers. |

See [third-party notices](../THIRD_PARTY_NOTICES.md) and each reference's linked
provenance. Recheck the frozen artifact when generated output/toolchain changes;
`npm audit --omit=dev` is insufficient to inventory distributed generated helpers.
Third-party notices do not choose distribution terms for MatrixSmith. The owner
must decide project terms before publication; this checklist leaves that gate open.

## Maintained acceptance references

Inspected 2026-10-06: [Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth)
(secure context, user gesture, service access; not a MatrixSmith browser-support
certification), [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)
(static-response policy; Functions require their own responses),
[service-worker lifecycle](https://web.dev/articles/service-worker-lifecycle)
(installation/waiting/activation; application multi-tab readiness is an additional
MatrixSmith requirement), [WAI page structure](https://www.w3.org/WAI/tutorials/page-structure/)
and [APG keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
(landmarks and focus/navigation checks). Maintained pages can change; retain
retrieval dates with acceptance evidence and recheck before launch.
