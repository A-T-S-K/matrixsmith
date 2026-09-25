# Performance budget

The production build is checked by `npm run verify:static`.

- Cold Home JavaScript: enforced at 90 KiB gzip across its complete static dependency closure; the verifier prints the measured value for each build.
- Total JavaScript: enforced at 180 KiB gzip.
- The application runtime loads after a connect, reconnect, import, resume, or direct workspace route. Developer, Reports, Create, Investigate, and image tooling remain lazy chunks.
- A build-generated asset manifest lets the service worker precache every lazy production asset for installed offline use.
- Trace, notification, and transaction collections are bounded.
- External runtime origins, backend artifacts, simulator code, and broken asset references fail static verification.

`verify:static` follows static imports and modulepreloads recursively, so moving code into an eagerly loaded chunk cannot game the initial budget.
