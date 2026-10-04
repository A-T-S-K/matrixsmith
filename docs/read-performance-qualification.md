# Read ownership and desktop performance qualification

The independent read-only audit examined baseline
`9fca44cf62b142eea0385017f42bee6f1c1fbe5b` using installed Node 24.21.0,
npm 11.19.0, macOS arm64 and an Apple M1 Max. No physical Bluetooth, Android
or shipping-hardware qualification follows from these software fixtures.

## Repaired reproduced findings

- A read deadline clears the user-facing busy notice while the browser read
  can remain pending. The former update blocker permitted activation/reload
  then. Updates now use the workspace ownership gate, including discovery,
  pending GATT work and transmission execution. The service-worker readiness
  response uses that same gate, so another tab refuses activation. Focused
  tests cover timeout, late settlement and successful explicit disconnect.
- Late settlement formerly published before releasing discovery ownership,
  leaving cached workspace controls blocked after runtime ownership ended.
  Ownership is now released before publication. Tests require the cached
  transition reason to recover immediately without an extra trace event.
- A synchronous reservation subscriber could call Stop before dispatch, yet
  the read still ran. Intent and definition are rechecked after reservation;
  canceled reservations release pending ownership and create no fabricated
  transaction. This was a callback-level reproduction, not an established
  ordinary button-click race. Stop after dispatch still supervises pending work.
- Candidate review formerly hashes full retained histories on every unrelated
  trace publication. Display comparison now serializes the same private
  context inputs without hashing. It inspects nested edits each time instead
  of trusting mutable array identity. Revision and export still compute a
  fresh authoritative digest, including export completion ownership checks.
  Counter tests require zero full hashes on unrelated publications and
  rejection of nested mutation; existing target/geometry/definition checks pass.

The audit regenerated valid candidates at each bounded synthetic size. Its
300-run publication median/p95 was 25.513/27.376 ms; 750 runs/transfers
(1,803,704 JSON bytes, within the 2 MiB history ceiling) measured
62.299/63.414 ms. The focused rerun after repair measured 2.154/2.660 ms
and 4.659/19.958 ms respectively, with zero full hashes for all forty
publications plus five warmups. Timing is descriptive and subject to GC;
no wall-time assertion, safety ceiling reduction or Android inference was added.

## Immutable diagnostic import handoff (2026-10-03)

Workspace file import now prepares once and adopts the same historical input.
`prepareDiagnosticBundleImport(json)` runs the unchanged byte, depth and count
limits, JSON parse, generated Bundle V3 structural validator, semantic validator
and investigation sanitization. It deeply freezes that newly owned JSON graph
and registers a frozen, empty, null-prototype token in a module-private WeakMap.
`readPreparedDiagnosticBundle` authenticates identity before returning the frozen
graph. No object-stamping, serialized marker or validation-skipping API exists.
Ordinary parse results remain editable; prepared/import return data is immutable.

The token lasts while a caller retains it, may be reused by multiple runtimes,
and works only in its issuing module instance. Copies, proxies, inherited tokens,
JSON markers and incompatible-instance tokens fail authentication. The WeakMap
permits collection of unused handoffs. This is permission to adopt acceptable
historical input, never current-session, built-in or live authority.

The workspace factory receives the frozen fingerprint. Adoption clones only the
editable runtime fingerprint/profile, observations, transactions, diagnostic runs,
compilations, imported-evidence summaries and investigation. Trace events own new
metadata objects; validated metadata values are scalar JSON, so a shallow copy
is sufficient. Runtime-owned collections can be edited without changing the
prepared graph or another consumer. Manual observations now survive import and
re-export; the previous path omitted their population.

Preparation fails before factory creation. Factory/adoption failure preserves the
active and retained workspaces and UI drafts/review state, disposes only the returned
replacement, and records a separate import error without replacing other notice
owners. A successful retry clears that import error before retaining the previous
context. Existing live/offline continuity and report-generation guards remain.
Both runtime entrypoints reject discovery and pending GATT ownership. Workspace
imports also block broader execution ownership; direct import retains the existing
ability to retire a pending probe response context. Imported scope demotion, panel
uncertainty, registry/definition protections, geometry and privacy remain enforced.
Preparation/adoption dispatch no transport read, write or notification subscription.

Maintained tests wrap the actual generated validator and sanitizer and spy on the
actual `JSON.parse`, rather than counting a public parser wrapper. Non-null
investigation inputs retain two sanitizer calls per validation pass: semantic
checking and final returned-data sanitization. Temporary source instrumentation
also wraps the lexical semantic validator and freeze work. Across all twenty
samples per path:

| Path                         | JSON / structural / semantic passes before → after | Semantic-check / final sanitizer calls before → after |
| ---------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Workspace string import      | 2 → 1 each                                         | 2 / 2 → 1 / 1                                         |
| Direct runtime string import | 1 → 1 each                                         | 1 / 1 → 1 / 1                                         |
| Prepared adoption            | unavailable → 0 each                               | unavailable → 0 / 0                                   |

### Desktop sample method and results

Baseline source is `526e12347c7297a0391df3852039e8b62b6d2e82`.
The same Apple M1 Max MacBook Pro, 64 GB RAM, macOS Darwin 25.5.0 arm64,
installed Node 24.21.0/npm 11.19.0, Vitest 4.1.11, TypeScript 7.0.2 and
Vite 8.2.2 were used for both sides. Repository `.nvmrc` specifies 24.20.0
and engines specify 24.20.x; that Node version was not installed. No dependencies
were installed or changed.

The deterministic software fixture uses maintained `setupStill`/`verifyStill`
helpers with Date fixed to `2026-10-03T12:00:00.000Z` and sequential UUIDs.
It retains their valid provisional geometry, completed observations, transactions,
compilations and timing relationships. Replace trace with 100 or 10,000 copies of
the first valid event, metadata `{fixture: "x".repeat(200), index}`, then compact
JSON serialization. This is a synthetic software report, not a physical capture.
Regeneration produced byte-identical files (SHA-256 below):

- 100 events: 99,597 bytes,
  `a244b2ecb0512eefe044fb4f236651263fcad561863c6f8a71533bbac0ca2d49`.
- 10,000 events: 3,088,497 bytes,
  `71a5aaa9f619c063adb2d0af38d6213fab75c073c911b79dc73a56295d5968da`.

Temporary fixtures, source instrumentation, sampling code and distribution summaries
are in `/tmp/matrixsmith-import-slice/`. Baseline modules were loaded from a
read-only Git archive into the same test environment, without resetting the active
checkout. Each path has three warmups and twenty sequential measured samples,
`performance.now()` durations, upper median and upper-index empirical p95 (sorted indices 10 and 19;
p95 is the maximum of twenty). A zero-delay timer is queued immediately before each operation;
queued delay is elapsed time until that timer runs. Direct/adoption samples create
fresh runtimes and include construction and disposal; direct samples also assert
the imported trace count;
workspace samples replace the offline runtime in the same store. Final timing runs
ran without simultaneous browser/build/test jobs. GC and desktop scheduling still
produce variance; no wall-clock CI assertion or Android inference is appropriate.

All values below are median / p95 milliseconds:

| Fixture / path     | Before duration | After duration  | Before queued delay | After queued delay |
| ------------------ | --------------- | --------------- | ------------------- | ------------------ |
| 100 / direct       | 1.297 / 2.471   | 1.546 / 2.216   | 1.366 / 4.128       | 1.631 / 3.877      |
| 100 / workspace    | 3.572 / 5.164   | 2.786 / 5.201   | 3.638 / 5.748       | 2.836 / 5.274      |
| 10,000 / direct    | 26.109 / 35.616 | 31.058 / 39.687 | 26.991 / 35.744     | 31.103 / 39.766    |
| 10,000 / workspace | 52.357 / 55.752 | 32.551 / 42.136 | 53.402 / 56.888     | 32.669 / 42.162    |

For the large fixture, prepared creation alone measured 26.870 / 32.202 ms;
reused prepared adoption into a fresh runtime measured 2.461 / 5.439 ms.
The isolation/freezing cost makes direct import slower, while removing the
workspace's second validation pass improves its median by about 20 ms.

Lexical instrumentation for the large workspace path measured:

| Stage                                        | Before median / p95 ms | After median / p95 ms |
| -------------------------------------------- | ---------------------- | --------------------- |
| JSON parsing                                 | 12.275 / 13.632        | 6.295 / 13.586        |
| Generated structure validation               | 0.473 / 0.685          | 0.206 / 0.294         |
| Semantic validation (includes its sanitizer) | 11.202 / 13.001        | 5.486 / 9.455         |
| Semantic-check sanitizer subset              | 0.077 / 0.132          | 0.037 / 0.046         |
| Final sanitizer                              | 0.023 / 0.042          | 0.012 / 1.727         |
| Immutable freeze                             | absent                 | 1.987 / 3.666         |
| Runtime population (including owned copies)  | 1.380 / 1.744          | 2.241 / 5.121         |
| Snapshot publication (two calls)             | 2.367 / 3.103          | 2.281 / 7.154         |

Stage quantiles do not sum to total quantiles. Byte counting, depth traversal,
construction and other orchestration overhead remain in the totals rather than
being attributed to JSON/validator work. The semantic-check sanitizer row is a
subset, not an extra validation pass. Instrumentation is temporary and excluded
from production assets.

The production comparison adds 1,167 uncompressed bytes across asset JavaScript
(430 in the bundle chunk, 737 in application bootstrap). Using the repository's
Node gzip method, total JavaScript including service worker changes from 240,814
to 241,232 bytes gzip (+418); initial-route JavaScript changes from 14,114 to
14,119 bytes gzip (+5 from changed references/build identity, with unchanged raw
entry size). CSS, packet fixtures, schemas, existing assertions and budget limits are
unchanged. The baseline archive uses fallback build identity; hash/reference and
identity differences are included in these descriptive asset totals. Static,
CSP, origin and asset-budget checks pass.

## Remaining qualification

The large workspace import still synchronously delays queued work by roughly
33 ms median / 42 ms p95 in this desktop run. Removing duplicate validation does
not make it asynchronous. No worker, yielding, scheduler or trace-buffer redesign
was introduced. The audit's roughly 434 ms repeated direct import at a saturated
50,000-event trace cap remains deferred trace-trimming qualification, separate
from the fresh-runtime workflow. Heap deltas were GC-sensitive and do not establish
a retained-memory leak. Hardware/Bluetooth and Android acceptance remain separate.

Unexpected disconnect while a browser read remains unresolved conservatively
retains discovery ownership until explicit disconnect recovery. Late bytes
remain evidence of the original target and cannot authorize another context.
No unauthorized write or adoption defect was established in the tested cases.
Original-target attribution, imported demotion, central policy, exact-send
confirmation and no uncertain-write retry remain enforced.

Owner-run hardware qualification remains separate: record firmware and accessible
Read properties, perform one approved reviewed read, compare supplied bytes with
appearance as separate observations, and verify offline reports stay historical.
A small comprehension check should ask what the read established and whether
sending is approved before explaining the answer. Browser screenshots, ARIA and
axe checks are software evidence, not an operator study or physical verification.
