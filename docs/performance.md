# Performance budget

The production build is checked by `npm run verify:static`.

- Cold Home JavaScript: 90 KiB gzip across its complete static dependency closure.
- Total JavaScript: 240 KiB gzip, including the service worker.
- Knowledge JSON: 256 KiB raw, independently schema/semantics checked.
- These are provisional artifact limits. Passing them does not establish Android responsiveness, memory use, Bluetooth timing or mobile acceptance.
- The application runtime loads after connect, reconnect, import, resume, or a direct workspace route. Protocol workbench, Reports, Create, Investigate, and image tooling remain lazy chunks.
- Offline installation precaches every lazy production asset plus reference/schema JSON. Their download/cache cost remains even when their execution is deferred.
- Trace, notification, and transaction collections are bounded.
- External runtime origins, backend artifacts, simulator code, and broken asset references fail static verification.

`verify:static` follows static imports and modulepreloads recursively. Record the
verifier's exact bytes, asset manifest and toolchain for the frozen integrated
commit; historical values in [asset budgets](asset-budgets.md) are not final-build
measurements. Do not remove corpus/assets or raise limits to pass qualification.

[Read/performance qualification](read-performance-qualification.md) covers the
runtime workloads and measurement limits. Offline artifact gzip sums are neither
browser transfer sizes nor measured cache storage, and do not measure lazy
execution cost. Mobile performance and permanent budget calibration remain
owner-run acceptance work.
