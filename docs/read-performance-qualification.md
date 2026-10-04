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

## Remaining qualification

A fresh valid 3.09 MB bundle with 10,000 trace events measured 26.090/33.282 ms
for runtime import and 52.244/53.377 ms through file presentation. The latter
parses/validates twice and blocks a queued timer for approximately 52 ms.
Removing duplicate validation with a trusted parsed-bundle handoff is a bounded
next slice; it must preserve failed-import isolation, owner checks and imported
demotion. A roughly 434 ms result was repeated direct runtime import after
filling a 50,000-event trace cap, not the normal fresh-runtime file workflow.
Trace-cap trimming is separate qualification work. Heap deltas were GC-sensitive
and do not establish a retained-memory leak.

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
