# Provisional static asset budgets

The total JavaScript gzip ceiling is provisionally 210 KiB for the bounded
local-profile and advisory-knowledge slice, replacing the historical 180 KiB
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
