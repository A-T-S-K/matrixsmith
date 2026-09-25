# Accessibility and static-hosting contract

MatrixSmith renders exactly one page-level `<main>` landmark. The mount node in `index.html` is a neutral `<div>`; Home and the device workspace own the active `<main>`.

Interactive feature work should use the shared primitives in `src/ui/components`:

- `Dialog` for every modal. It provides focus entry, Tab containment, Escape close, inert background, and focus restoration.
- `Tabs` for tab interfaces. It owns tab/panel IDs, selection, roving focus, arrow keys, and Home/End.
- `MenuButton` for a small disclosure of ordinary buttons. Do not add ARIA menu roles unless the complete menu keyboard model is implemented.
- `NoticeRegion`, `FileButton`, `UnavailableAction`, and `EvidenceDisclosure` for announcements, visible file activation, visible unavailable reasons, and touch/keyboard evidence access.

Animated UI must stop or become effectively static when `prefers-reduced-motion: reduce` matches. Verify keyboard-only completion and layouts at 320, 390, 768, 1024, and 1280 CSS pixels. Notifications belong above the bottom navigation on phones and must not obscure the sticky device header.

## Cloudflare Pages

Deploy `dist/` directly with no Functions or Worker runtime:

- build command: `npm run verify`
- output directory: `dist`
- Node.js: 24.20.0; npm: 11.19.0

`public/_headers` is the authoritative production header policy. `public/sw.js` may delete only `matrixsmith-` caches, serves a generation-consistent cached shell and hashed assets after installation, and retains the previous successful generation. Registration remains production-only. A persistent update manager discovers waiting workers and coordinates explicit activation only when all open app tabs acknowledge readiness.

After building, run `node scripts/verify-static-output.mjs`. The verifier checks the shell, manifest, icon set, service worker, headers, asset references, simulator leakage, and forbidden backend artifacts.
