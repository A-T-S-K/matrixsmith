# Provisional static asset budgets

The total JavaScript gzip ceiling is provisionally 220 KiB for the bounded
local-profile, advisory-knowledge and bounded candidate slice, replacing the earlier 210 KiB
ceiling. Initial JavaScript remains capped at 90 KiB. Static verification stays
mandatory. This revision allows the measured standalone validators, trust
registration, review UI and lazy advisory resolver without spending the slice on
byte shaving. It is not a permanent calibrated mobile-performance threshold.
Baseline and final byte measurements are reported in the task's chat and temporary
review artifacts; no Android performance claim follows from desktop builds.

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
Final exact costs are reported in chat; no Android performance inference is made.

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
