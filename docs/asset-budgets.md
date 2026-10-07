# Provisional static asset budgets

The current enforced ceilings are **240 KiB total JavaScript gzip** (245,760
bytes, including the service worker), **90 KiB initial JavaScript gzip** (92,160
bytes across static imports/modulepreloads), and **256 KiB raw knowledge JSON**.
`scripts/verify-static-output.mjs` enforces them. These are provisional artifact
limits, not calibrated mobile-performance thresholds. Static verification,
schema validation, CSP and origin checks remain mandatory.

The measurements below describe earlier slices at their stated source/toolchain
identities. They explain allowance changes; they are not final integrated-build
acceptance. Retain the frozen commit's verifier output and manifests with release
qualification evidence. No Android performance claim follows from desktop builds.
Do not raise these limits or hide corpus/assets to pass the gate.

Offline installation downloads and caches the shell, every lazy application
chunk, and reference/schema JSON before those features are first executed. Lazy
execution and installation cost are separate measurements; gzip sums are artifact
estimates, not actual transfer bytes or cache storage.

## Historical slice measurements

Knowledge JSON is a separate asset capped at 256 KiB with a strict schema and
semantic reference validation. It is fetched and parsed on request, with one
shared load and owner-scoped result caching. It is not moved into an eager
JavaScript or alternate executable asset. Offline installation deliberately
caches the reference JSON, its schema and the profile schema, plus every lazy
application chunk. Build identity includes maintained sources and public assets.

The external-origin scanner permits HTTPS URLs only at `sources[].url` in the
schema-validated `knowledge-v1.json` file. It continues scanning all other data
strings and every script, HTML and stylesheet. Citation links do not fetch
executable dependencies. Runtime same-origin fetching and CSP are unchanged.

Full mobile performance work and permanent threshold calibration remain deferred.

The candidate revision adds a strict V2 profile schema/standalone validator,
a lazily imported application builder and evidence-reference inspector, and
supervised review/export controls. The baseline at commit `7f86ba8` measured
212,611 bytes gzip of total JavaScript; the first candidate build measured
220,983 bytes (8,372 bytes growth), exceeding the previous 215,040-byte ceiling.
The 225,280-byte ceiling covers this measured addition. Initial Home remains
lazy (13,346 bytes gzip in that candidate build), below its unchanged 90 KiB
ceiling. Profile schemas are separate JSON assets included in offline caching;
V3 schema, static/CSP/origin scanning and knowledge budget remain unchanged.
These are historical costs; no Android performance inference is made.

The independent LSLED offline-family slice provisionally raises the total ceiling
from 220 to 230 KiB (235,520 bytes). A Vite measurement of the exact starting
commit `8799007` with the installed Node 24.21.0/npm 11.19.0 measured 222,075 bytes
gzip total and 13,373 bytes initial JavaScript. This was an isolated /tmp archive
build with existing dependencies, not pinned-toolchain validation (the archive's
schema generator path comparison was stale, so baseline measurement used Vite
directly). The LSLED build measured 228,612 bytes total and 13,535 bytes initial,
6,537 and 162 bytes growth respectively. The new page/compiler asset is about
4.9 KiB gzip, with shared pure registry/framebuffer/preview dependencies. The
registry core is separated from live driver composition to avoid importing the
CoolLED codec graph into the offline preview. Existing live registry identity
behavior remains tested. No new image, font, vendor or example asset is fetched;
examples are authored bounded code. Source detail uses the existing on-demand
knowledge JSON (194,051 raw / 30,487 gzip bytes, unchanged) and lazy resolver
chunk (about 7.2 KiB gzip). Initial 90 KiB, knowledge 256 KiB, CSP, static and
origin checks remain enforced. This is an asset allowance, with no Android
performance claim.

The reusable catalog/micro:bit slice keeps the existing 230 KiB total allowance.
Using installed Node 24.21.0/npm 11.19.0 (not the unavailable Node 24.20.0 pin), an
isolated Vite build of starting commit `8fca303` measured 228,765 bytes gzip total
JavaScript and 13,640 bytes initial JavaScript. The catalog build measures
233,867 bytes total and 13,718 bytes initial: growth of 5,102 and 78 bytes.
Static verification includes the service worker in total JavaScript; the
application asset chunks alone are 231,138 bytes gzip. Both builds pass the
unchanged total/initial, CSP and origin gates. These are desktop asset
measurements, not Android performance measurements.

The shared inspector chunk is 2,622 bytes gzip. LSLED's entry chunk is 3,322 and
micro:bit's is 3,019. Including static dependencies and the shared inspector,
the LSLED explorer graph is 24,504 bytes gzip (10,786 beyond the initial graph);
micro:bit is 24,201 (10,483 beyond initial). These graph totals share dependencies
and must not be added together. Neither graph includes the live application
bootstrap/CoolLED graph or knowledge validators. The entry increment after the
inspector loads is 7,256 bytes for LSLED or 6,953 for micro:bit.

Optional source details add 9,826 bytes gzip of lazy JavaScript to either explorer
(the resolver/validator chunk itself is 7,178), plus knowledge JSON at 195,970 raw /
30,946 gzip bytes. The broad research corpus remains intact with three new source
records; only the source retrieval-date schema gains the additional inspected
date. No runtime executable origin or dependency is added. Citation failure is
independent of compilation.

The offline manifest grows from 24 to 29 assets (931,774 raw / 240,320 gzip
bytes across JavaScript and CSS), deliberately including both literal entry
chunks, compiler, registry and preview dependencies. All lazy
assets plus the existing shell, icons and validated reference/schema JSON are
cached by the normal Home installation. Build identity hashes maintained source,
public assets and notices. Production tests verify every manifest asset is cached
before offline navigation to either reference, including source detail and reload.

The registered characteristic-read slice provisionally raises the total JavaScript
ceiling from 230 to 240 KiB (245,760 bytes). An isolated Vite build of the exact
starting commit `bf368f6` with installed Node 24.21.0/npm 11.19.0 measures 233,867
bytes gzip total and 13,718 initial. The first read build measures 237,483 total
and 14,080 initial: growth of 3,616 and 362 bytes. Lazy JavaScript is 223,403
versus 220,149 bytes; the application static dependency graph is 174,981 versus
171,534 bytes (graphs overlap initial assets). The 90 KiB initial limit remains.
The new chooser adapter invokes the browser synchronously before lazy application
loading; no eager application prefetch is required. Pure sourced GATT constants
keep codec/application machinery out of Home. The manifest has 30 assets versus
29; JavaScript/CSS measure 949,969 raw / 246,708 gzip bytes versus 939,746 /
243,049 in this first read build. Knowledge remains 195,970 raw / 30,946 gzip
bytes. No new image/font/vendor asset or external executable dependency is added.
Final integrated measurements require frozen-commit qualification. Node 24.20.0 was not available;
these desktop asset measurements make no Android performance claim. Static,
CSP, origin, schema and initial-budget checks remain mandatory.

The Merkury/advisory/read-ownership integration keeps the existing 240 KiB total
JavaScript and 90 KiB initial ceilings; no budget revision was needed. The exact
starting commit `9fca44cf62b142eea0385017f42bee6f1c1fbe5b` measured 237,779
bytes total JavaScript gzip and 14,063 initial. The combined source measures
240,814 total and 14,114 initial: growth of 3,035 and 51 bytes. Measurements
include the service worker in total JavaScript, use gzipSync per file, and use
the same static-import/modulepreload traversal as the enforced initial gate.
Installed Node 24.21.0/npm 11.19.0 was used; Node 24.20.0 was unavailable.

The Merkury entry chunk is 5,946 raw / 2,767 gzip bytes. Its complete explorer
graph, including initial and shared inspector/compiler/preview dependencies,
is 59,524 raw / 24,426 gzip bytes across nine files; graph totals overlap other
references and cannot be added. The manifest grows from 30 to 31 application
assets, measuring 950,187 raw / 247,298 gzip bytes across JavaScript and CSS.
The deliberately installed shell plus manifest assets total 1,214,438 raw /
295,417 per-file gzip bytes across 45 files, excluding the service-worker
script itself. These are artifact estimates, not browser transfer sizes or
measured cache storage. Lazy execution does not avoid installation download.

Knowledge revision 2026-10-03.3 measures 207,380 raw / 34,091 gzip bytes, versus
195,970 / 30,946 at the baseline. Its 256 KiB ceiling and standalone validators
remain unchanged. No image, font, vendor document, upstream code or artwork
asset was added. CSP, source-only citation exception, same-origin loading and
static/origin scanning remain enforced. Candidate review avoids full history
hashes on unrelated publications while retaining nested-content comparisons
and fresh authoritative checks before revision/export; see
[read/performance qualification](read-performance-qualification.md). These
desktop measurements make no Android performance claim.
