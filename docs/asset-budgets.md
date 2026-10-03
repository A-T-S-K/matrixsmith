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
