# Candidate packaging and launch

## Code-ready candidate

1. Review the intended working-tree changes and commit them. Preserve unrelated local work separately; packaging does not silently include it.
2. Use Node 24.20.0 / npm 11.19.0 and `npm ci` from a clean checkout.
3. Install Chromium and run `npm run release:package`. The command requires clean Git state, runs the complete release gate, verifies build/commit agreement, and produces `release/matrixsmith-<version>-<build-id>.tar.gz`, a SHA-256 file, and a JSON file manifest.
4. Verify the Linux CI result for that exact commit. CI runs the same packaging command and retains the candidate and verification artifacts.

The content manifest identifies every emitted file independently of archive timestamps. The artifact contains only static files and runtime dependency notices. No deployment credentials are required to complete code work. A dirty working tree or an unverified CI run must not be represented as a packaged release candidate.

## Deferred launch checklist

- [ ] Choose the public distribution terms; a MatrixSmith project license has not been selected.
- [ ] Deploy the tested artifact to a preview origin.
- [ ] Verify actual CSP, Permissions-Policy, cache, and content-type response headers. Vite preview does not establish production host behavior.
- [ ] Confirm no unexpected runtime external requests and no Functions/Worker backend artifacts.
- [ ] Deploy the same candidate to the stable HTTPS origin.
- [ ] Complete the physical acceptance checklist with build ID, commit, browser/OS, non-sensitive device label, and evidence.
- [ ] Complete keyboard, screen-reader, installed-PWA, and responsive acceptance.
- [ ] Complete the rollback drill below.
- [ ] Publish only the device/browser capabilities that passed acceptance, with known limitations and release notes.

Cloudflare Pages remains the planned static host: deploy the archive contents as the site root, without Functions or Worker runtime code. Web Bluetooth permissions are origin-scoped; preserve the stable origin for final hardware testing.

## Recovery and rollback

For a quarantined or disconnected device, reconnect before another transmission. Do not automatically retry indeterminate writes. Failed file imports retain the previous workspace/content; select a valid file again. Settings/history persistence failures remain visible.

For an application update, finish active operations and guided observations in every tab, then choose **Update and reload**. If another tab is unavailable, close it and retry. An unsuccessful install retains the current offline shell.

To roll back, restore the complete previous static artifact at the same origin, including its worker, HTML, manifest, metadata, and hashed assets. Do not replace only HTML or delete old assets independently. Check for updates in open clients and apply the returned build when all tabs are idle. Verify the displayed/exported build identity and repeat offline navigation plus a safe device-info query. Record the previous and restored artifact checksums and the result.

The worker retains current and previous successful caches. This supports recovery but is not a replacement for keeping both release artifacts on the deployment side.

## Reports and support

Use the repository bug-report template with browser/OS, build version, device profile, steps, expected behavior, and observed behavior. Prefer a shareable Bundle V3; inspect free-form content before posting. Full local archives contain identifiers and should not be the default attachment.
