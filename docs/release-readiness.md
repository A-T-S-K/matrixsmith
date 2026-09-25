# Release readiness review

> Historical planning/review document. The implemented architecture and current gates are documented in `architecture.md`, `testing.md`, and `releasing.md`.

Reviewed 2026-09-12 against local HEAD `1e71e73` **plus the existing uncommitted working tree**. This is a review and proposed release plan, not a deployment approval or a completed hardware acceptance record.

## Recommendation

Prepare a narrowly scoped first release for the characterized CoolLEDUX iLedHat 31AE 32×16. The implementation has a strong automated baseline; the remaining work is targeted hardening, reproducible release packaging, documentation, and acceptance on the actual release origin and hardware. Another architecture rewrite is not a prerequisite.

Do not call the current working tree release-ready yet. Close the file-input and update-lifecycle issues below, freeze a reproducible candidate, and record physical acceptance before promoting it as a supported public release. Unknown devices should retain bounded investigation behavior and experimental labeling.

## What was verified

| Check                      | Result in this review                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`           | Passed: typecheck, current lint/architecture checks, formatting, unit/application tests, production build, static verifier |
| Unit/application tests     | 91 files passed, 1 skipped; 684 tests passed, 1 skipped                                                                    |
| `npm run test:coverage`    | Passed: 84.78% statements, 74.91% branches, 88.42% functions, 86.50% lines                                                 |
| Browser journeys           | 16 passed, 8 deliberately skipped duplicate mobile baseline/breakpoint/history cases                                       |
| `npm run test:e2e:offline` | Passed: 1 production offline-shell test                                                                                    |
| `npm audit --omit=dev`     | Zero reported production vulnerabilities at review time                                                                    |
| `git diff --check`         | Passed                                                                                                                     |
| Static JavaScript budgets  | Initial 9,711 bytes gzip; total 141,824 bytes gzip; both within enforced limits                                            |

The unit skip is the opt-in QA-bundle generation helper. Coverage measures the configured Vitest scope; it does not establish full browser-component coverage. The audit excluded development dependencies. Existing installed dependencies were used; a clean `npm ci` and Linux CI run remain release-candidate checks.

The default browser test configuration reused an unrelated server on port 4173, producing invalid failures against another application. A temporary configuration retained the same tests, projects, and baselines but used port 4187, `--strictPort`, and `reuseExistingServer: false`; that isolated run passed. No baselines were regenerated.

Reviewed areas included the application/service boundaries, transmission and import paths, image decoding, profile/evidence model, PWA lifecycle, build/CI configuration, browser tests, and project acceptance documentation. This was not an exhaustive security audit or a Bluetooth hardware test.

## Findings and required work

### 1. P1 — Make application upgrades and offline caches build-specific

**Evidence:** `public/sw.js:2` uses a fixed `VERSION = "v4"`; `vite.config.ts` generates an asset manifest but does not inject a build identifier into the worker. Precaching and the update announcement occur only in the worker's install event. `tests/e2e-prod/offline-shell.spec.ts` tests first installation and offline navigation, not an upgrade between two releases.

**Impact:** An application-only deployment can leave the service-worker script unchanged, so it does not install again or announce an update. Navigation can cache new HTML while newly hashed lazy assets have not been precached; a later offline visit can then fail on an unvisited feature. The existing first-install test does not cover this sequence.

**Work:** Generate a deterministic build identifier shared by the worker and release metadata. Isolate each build's caches, make update discovery survive page reloads and Home/workspace transitions, and inspect already-waiting workers instead of relying only on a one-time message. Define safe activation during active transfers and retain a recoverable previous release.

**Exit:** A real two-build browser test proves update discovery, activation, all lazy routes offline after upgrading, interrupted installation recovery, and an explicit rollback procedure. Reloading or moving between Home and a workspace must not silently lose a waiting update.

### 2. P1 — Make rejected file imports visible and enforce budgets earlier

**Evidence:** `src/ui/components/FileButton.tsx:37` discards the promise returned by `onFile`. Oversized image/GIF checks throw before the store's `_run` error handler (`src/presentation/state/content-editor-store.ts:32` and `:125`). Warm-application JSON import calls a parser that can throw without publishing an error (`src/presentation/state/connection-store.ts:226`). Home reads JSON/capture files with `file.text()` before checking byte budgets (`src/ui/pages/Home.tsx:164` and `:178`).

**Impact:** Invalid or oversized selections can produce an unhandled rejection without a useful visible explanation. Bundle validation prevents invalid state mutation, but that does not provide a complete recovery experience.

**Additional allocation gap:** `decodeImageSource` creates a full-size canvas and RGBA buffer before the caller checks the 24-megapixel limit (`src/render/image/decode.ts:4`, `src/presentation/state/content-editor-store.ts:44`). A small compressed file can therefore cause large allocations before rejection.

**Work:** Route every file-read/parse/decode failure through a visible, accessible error boundary; check `File.size` before text/array-buffer reads; check bitmap dimensions before canvas allocation and `getImageData`. Where feasible, reject excessive encoded dimensions before decoding. Preserve the previous editor/workspace and clear input state for retry.

**Exit:** Browser tests cover malformed bundles on cold and warm Home, oversized image/GIF/capture/bundle files, decode failures, and successful retry. Assert visible error text, no unhandled rejection, unchanged previous state, and no full-size canvas/readback for a rejected oversized bitmap.

### 3. P1 — Record release acceptance on the stable origin and real device

**Evidence:** `docs/physical-acceptance.md` is unchecked. `docs/completion-audit.md` explicitly leaves stable-domain, hardware, installed-PWA, and screen-reader acceptance unverified. Earlier protocol captures and built-in profile evidence are valuable, but they do not validate this application's final release build end to end.

**Work:** Run the existing checklist on the frozen release candidate, recording commit/build ID, browser/OS, non-sensitive device label, result, and evidence. Prioritize chooser/reconnect, brightness restoration, text/image/demo animation, disconnect recovery, timeout quarantine, Wake Lock, exports, experimental confirmation, and imported-evidence isolation. Complete keyboard, screen-reader, installed-PWA, and responsive checks. For unavailable secondary hardware, narrow published support claims rather than record a pass.

**Exit:** Every item is passed or explicitly excluded with a corresponding limitation in the release scope. Any supported-operation failure blocks promotion until corrected and retested.

Deployment was explicitly deferred in the existing project audit. This review does not change that decision or require credentials now. Hosting becomes a prerequisite for the later public-release acceptance stage, not for finishing the code fixes.

### 4. P2 — Freeze a reproducible candidate and make CI results trustworthy

**Evidence:** The working tree contains extensive modified, deleted, and untracked implementation/test/configuration files. The CI workflow exists, but this review did not inspect a successful remote run of the final candidate. `playwright.config.ts` unconditionally allows server reuse. The application and package each hardcode `0.1.0` separately.

**Work:** Review and commit the intended existing changes without discarding unrelated work. Make browser tests own their server and fail on a port collision, especially in CI. Pin/document the supported Node/npm toolchain, build from a clean checkout with `npm ci`, derive package/report/build identity from one source, and attach the tested static artifact to the candidate. Retain browser traces and useful CI output on failure.

**Exit:** A clean Linux CI run passes verification, coverage, both browser suites, dependency audit, and whitespace checks on the exact candidate commit. The deployed artifact and exported reports can be traced to that commit.

### 5. P2 — Align release documentation and distribution information

**Evidence:** README's paragraph after Current capabilities says every stored-content send needs guided validation and explicit confirmation, contradicting direct verified sends in the implementation and browser tests. `docs/testing.md` still describes removed Diagnose flows and v1→v2 migration coverage. README also explicitly records the absence of a project license.

**Work:** Rewrite the quick start and testing guide around the current UI and Bundle V3. Publish a concise tested-device/browser matrix, distinguish normal operation from experimental driver investigation, document replaced display content and local-data compatibility, and add release notes, a support/bug-report route, and recovery instructions. Confirm the intended distribution terms with the owner; add the chosen license if appropriate and collect applicable third-party notices from the documented provenance. Do not claim an open-source license that has not been selected.

**Exit:** A new user can connect, send content, recover from failure, and submit a redacted report using only the release documentation; advertised support matches recorded acceptance.

### 6. P2 — Complete static-host rollout and rollback verification

**Evidence:** `_headers`, PWA assets, and static-output verification are present. Local Vite preview does not establish that the production host actually serves the configured response headers. No release/deployment workflow is present alongside the CI workflow.

**Work:** When deployment resumes, configure the stable HTTPS origin and preview environment, deploy the tested artifact, verify actual CSP/Permissions-Policy/cache headers and absence of runtime external requests, and run a deployed smoke test. Document who promotes a release, where its build identity appears, how to restore the previous artifact, and how clients recover after rollback. Manual deployment is acceptable if it is reproducible.

**Exit:** Preview smoke checks pass, stable-origin physical acceptance passes, and a rollback drill preserves a usable online/offline shell.

## Ordered execution plan

| Stage                            | Deliverable                                                                                                 | Dependency / owner                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1. Scope and candidate inventory | Explicit initial support scope; reviewed inventory of current uncommitted changes                           | Maintainer; can start now                       |
| 2. Targeted hardening            | File handling/resource-budget fixes with failure-path tests; build-specific SW lifecycle with upgrade tests | Engineering; before candidate freeze            |
| 3. Release packaging             | Isolated browser configuration, unified build identity, clean CI, corrected docs and release notes          | Engineering; owner chooses distribution terms   |
| 4. Preview and stable origin     | Tested static artifact, observed host headers, rollout/rollback runbook                                     | Hosting owner; when deferred deployment resumes |
| 5. Acceptance                    | Completed physical, accessibility, and PWA record tied to the candidate                                     | Maintainer/device tester; requires stages 2–4   |
| 6. Promotion                     | Version/tag and release artifact published with supported-device limits and known issues                    | Maintainer; only after acceptance               |

Treat a candidate-changing fix as requiring the relevant automated gates and affected acceptance steps again. Do not regenerate visual snapshots simply to silence unexplained failures.

## Useful follow-up, not a reason for another rewrite

- Expand browser coverage beyond the currently passing journeys: image upload/send, experimental confirmation, guided observation/retry, malformed-file recovery, export redaction, and disconnect recovery.
- Broaden linting deliberately: the current `lint` script checks JS tooling and architecture patterns, not application TS/TSX ESLint rules. TypeScript checking remains valuable but is a different gate.
- Measure decode/preview responsiveness and memory on the target phone before deciding whether image processing needs a worker.
- Additional drivers, an animation editor, cloud accounts, telemetry, and backend infrastructure are not necessary for the scoped first release.

Release approval should be based on the frozen artifact, green automated checks, resolved P1 findings, accurate support documentation, and completed acceptance evidence—not only the earlier “automated complete” audit.
