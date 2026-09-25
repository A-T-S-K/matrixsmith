# Release completion audit

The release-hardening implementation replaces the earlier inheritance-based architecture while preserving protocol fixtures and current data formats. See `architecture.md`, `testing.md`, and `releasing.md` for the authoritative implementation and gate descriptions.

## Implemented gates

- Explicit composition and feature-owned state, injected browser capabilities, and disposal APIs.
- Target/digest authority, evidence demotion, protocol/conformance regressions, and connection quarantine checks.
- File error boundaries, input budgets, pre-decode dimension inspection, and persistence-failure reporting.
- Build identity, generation-consistent offline assets, explicit multi-tab updates, and two-build browser scenarios.
- TypeScript-aware ESLint, native resolved-import/promise checks, all-production-source coverage, browser error capture, static-output checks, and candidate packaging.

A gate is considered passed only by its recorded run on the final candidate. Source inspection or an earlier run is not proof that a later candidate passes.

## External acceptance remains open

Cloudflare setup/deployment was deferred by the owner. Do not request deployment credentials as part of code hardening. The following remain unverified until explicitly recorded:

- clean Linux CI and candidate artifact for the final committed source;
- actual production-origin security/cache headers;
- stable-origin chooser, reconnect, and device-ID behavior;
- physical brightness, text/image/animation, disconnect, Wake Lock, and experimental-operation acceptance;
- installed-PWA and manual screen-reader acceptance;
- every applicable item in `physical-acceptance.md` and the rollout/rollback checklist.

No simulator or local automated result is represented as a physical pass.
