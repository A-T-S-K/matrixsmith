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
metadata objects in the recorder; validated metadata values are scalar JSON,
so a shallow copy is sufficient. Runtime-owned collections can be edited without
changing the prepared graph or another consumer. Manual observations now survive import and
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

## Bounded bulk trace import (2026-10-03)

Baseline `ebbcb1fd002adeb660a0bc9ee48a9b81601331ac` reproduced the separate
saturated direct-import cost. File import still constructs a fresh replacement
runtime, adopts before attaching workspace listeners, then publishes snapshots.
It does not repeatedly append to the active capped runtime. Retained workspaces
keep their trace subscriptions even when their presentation is elsewhere.

### Contract and implementation boundary

`events` remains the same chronological append-order live array, with the latest
50,000 accepted events retained. Imports do not sort timestamps or deduplicate
identical timestamps/types. Surviving event objects keep their identities. The
revision increases once per accepted record, including accepted records evicted
within the same import; empty/invalid-only imports do not change it. Direct
recorder acceptance still checks string timestamp/type and scalar metadata;
Bundle V3 validation remains the stricter authenticated application boundary.
Invalid serialized records are skipped. Invalid/odd hex omits bytes from an
otherwise accepted record; empty hex retains an empty byte buffer. No malformed
value is silently repaired. Imported metadata is now shallow-copied by the
recorder on both paths; report adoption no longer copies every incoming record
before retention. Decoded byte buffers and scalar metadata are independently
owned by each consuming runtime, including reuse of one frozen prepared source.
`record` retains its existing metadata behavior and copies supplied byte buffers.

Only potentially overflowing imports with no trace listeners and a dense plain
array of plain data records use batching. Descriptor inspection excludes
accessor-bearing records/metadata, custom array methods and custom iterables.
The path filters using the existing acceptance rules, counts valid records rather
than input length,
trims the existing array once, and constructs/decodes only the retained valid
tail. It preserves older retained object identities and never replaces the live
array. Below-cap imports retain the inexpensive sequential path, avoiding the
preflight cost when there are no shifts to eliminate. There is no caller-controlled
trust switch, new storage representation or change to prepared authentication.

Subscribed and accessor/custom-iterable paths retain append, revision increment,
trim, then notification per event. Listeners run in Set iteration order, including
addition/removal during iteration. Reentrant record/import calls run within that
iteration. Listener exceptions propagate immediately after the current event is
committed, skip subsequent listeners/records, and preserve partial progress.
Accessor input failures also preserve prior accepted progress. Regressions cover
these boundaries, actual production-cap overflow with interspersed invalid input,
raw/metadata fidelity, retained identity, bounded decoding and one compaction.

Raw review still keys events by object identity. Bulk retention invalidates its
raw projection once on the next publication; unrelated publications do not
rebuild it. An older page keeps its original slot IDs and removed-slot explanation,
without substituting another event. Show latest explicitly resets the window.
Prepared-adoption tests retain bounded export completeness, independent bytes and
metadata, historical scope, unknown panel certainty and absent send authority.
The Chromium journey imports a 50,000-event valid report, selects the oldest
raw page, imports 100 events through its subscribed recorder, checks eviction
explanations and keyboard focus, then checks latest bytes, focus, complete capped
full-local export, unchanged trace omission in shareable exports and axe
accessibility. No visual baselines were updated.

### Desktop measurements

The environment matches the previous section: Apple M1 Max, macOS Darwin 25.5.0
arm64, installed Node 24.21.0/npm 11.19.0. Pinned Node 24.20.0 is not installed;
no dependencies changed. The maintained `setupStill`/`verifyStill` helpers were
rerun with the fixed Date and sequential UUID method above. The resulting
10,000-event fixture was byte-identical to the prior fixture: 3,088,497 bytes,
SHA-256 `71a5aaa9f619c063adb2d0af38d6213fab75c073c911b79dc73a56295d5968da`.
It is synthetic software evidence with 200-character fixture metadata, not a
physical capture. Raw decoding and malformed bytes are separately covered by
production-cap contract tests.

Each path uses three warmups and twenty sequential measured samples. Durations
use `performance.now()`, upper median (sorted index 10) and upper empirical p95
(index 19, the maximum). A zero-delay timer queued immediately before the
operation measures queued-event delay. Fresh direct/adoption paths include runtime
construction/disposal. Workspace samples replace the same store's offline runtime;
saturated direct/adoption reuse a runtime populated by six prepared adoptions.
Recorder-only samples start with five batches at the actual cap. The subscribed
sample imports 100 events with a listener running the actual `TransactionReview`
raw projection against all 50,000 retained events. It is a deliberately demanding
observed path, not a claim about every application's listener cost.

Baseline affected modules were loaded from a read-only Git archive into the same
Vitest environment. Timing runs had no concurrent browser/build/test jobs. An
initial overlapping exploratory run was excluded. The final overflow-only path
was remeasured after removing below-cap preflight. Fixtures, source archives,
sampling code, full duration distributions, queue summaries and logs remain in
`/tmp/matrixsmith-trace-slice/`. No wall-time CI assertion was introduced.

All values are median / p95 milliseconds:

| Path                                       | Before duration    | After duration    | Before queued delay | After queued delay |
| ------------------------------------------ | ------------------ | ----------------- | ------------------- | ------------------ |
| Preparation only                           | 26.377 / 31.178    | 25.653 / 30.178   | 27.201 / 31.280     | 26.513 / 30.246    |
| Fresh direct string import                 | 31.243 / 60.466    | 28.864 / 29.943   | 31.289 / 60.728     | 29.464 / 30.035    |
| Fresh prepared adoption                    | 2.795 / 10.284     | 2.045 / 2.319     | 3.004 / 10.319      | 2.083 / 4.102      |
| Fresh workspace file import                | 36.439 / 52.303    | 30.373 / 43.574   | 36.466 / 54.645     | 30.913 / 48.285    |
| Saturated direct string import             | 550.175 / 874.899  | 39.450 / 40.726   | 550.205 / 875.061   | 39.715 / 40.753    |
| Saturated prepared adoption                | 457.634 / 546.537  | 13.577 / 15.860   | 457.657 / 546.568   | 13.609 / 15.886    |
| Saturated recorder, no listeners           | 483.718 / 1148.543 | 11.871 / 17.922   | 483.765 / 1148.591  | 12.023 / 21.640    |
| Subscribed raw projection, 100 events      | 782.114 / 1046.188 | 680.423 / 715.229 | 782.336 / 1046.459  | 680.463 / 715.522  |
| 100 getters / unchanged review projections | 0.625 / 1.157      | 0.558 / 0.682     | 0.890 / 7.163       | 1.679 / 1.815      |

Preparation remains separate from population: prepared adoption authenticates and
populates without repeating validation. Each unobserved 10,000-event batch still
advances revision by 10,000; saturated retention changes from 10,000 shifts to
one splice. A maintained work-count regression checks zero shifts, one splice
and exactly 50,000 decodes for an overflowing batch of 50,101 valid raw events
interspersed with invalid records. Evicted incoming events allocate no decoded
buffers. Workspace sampling records 46 publications across warmups and samples
on both sides. The subscribed sample records 2,300 callbacks and 2,300 raw
projection rebuilds, with one transaction/filter/compilation build. Another 100
unchanged projections do no additional work. Getters return the identical array,
with no full collection copy on publication. The observed path has no bulk
optimization; its timing difference is descriptive variation, not an attributed
speedup. Synchronous validation, descriptor inspection, population and observed
projection/listener work remain. These timings do not establish constant-time
trace handling or a retained-memory conclusion.

Production assets compared with the starting Git archive add 998 total raw
JavaScript bytes including the service worker and 256 bytes using Node gzip
(241,232 to 241,488). Initial-route JavaScript changes from 14,119 to
14,120 bytes gzip with changed chunk references/build identity. CSS,
schemas, packet fixtures and all budgets are unchanged; static/CSP/origin checks
pass. Build identities and changed chunk references are included in these totals.
The archive was built with its committed generated validators, TypeScript and
Vite; schema-check output varies with the shared dependency symlink's generated
region comments. The active checkout's full schema check passes unchanged.

Validation of final source passed `npm run verify`: schema/knowledge checks,
TypeScript, ESLint/architecture checks, Prettier, 1,122 unit tests (one existing
skip), production build and static output/CSP/origin budgets. Directly affected
trace, import, prepared capability, review/store and privacy tests passed. The
focused Chromium set covered 33 journeys across transaction/raw review, reviewed
read recovery, discovery interviews, candidate portability and offline catalog.
The new journey checks full-local/shareable privacy boundaries, axe and the
fixture's unhandled-error guard on final source. `git diff --check` passed. No snapshots,
packet fixtures, dependencies, hardware operations or budget revisions changed.

## Remaining qualification

The final large workspace import still synchronously delays queued work by
roughly 31 ms median / 48 ms p95 in this desktop run. Removing duplicate validation does
not make it asynchronous. No worker, yielding, scheduler or trace-buffer redesign
was introduced. The saturated unobserved direct-import cost is addressed by the
bounded batch path above, separately from the fresh-runtime workflow. Active
trace listeners still require sequential states and can dominate synchronous
import cost. Heap deltas were GC-sensitive and do not establish
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
