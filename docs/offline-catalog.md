# Reusable offline protocol explorer

Open `?offline=1` for the catalog, or use `?offline=1&reference=microbit`.
`?offline=lsled` remains supported. Unknown IDs show a useful catalog selection
and error; only literal loaders are invoked. IDs are bounded to 32 lowercase
ASCII letters/digits/hyphens, starting with a letter. They never become paths.

Application-owned immutable entries supply identity, geometry, examples, exact
pixel policy, delivery descriptions, unresolved behavior and validated source
IDs. Each entry closes over a pure DriverRegistry and reviewed reference.
The catalog listing imports neither implementations nor knowledge validators.
Adding micro:bit required one entry/loader, driver and reference, with no second
page or protocol-specific bootstrap/inspector branch. This is deliberately not a
plugin framework, data interpreter or service locator.

`compileOfflineFrame` accepts only a registered reference profile object with the
matching reviewed codec identity and source basis. It returns normalized logical
pixels, a definition digest and an unbound dry-run plan, including semantic
ShowFrame consequence, indexes, endpoints, modes, exact bytes and family-owned
metadata. It clones input pixels and output packet buffers. Each compilation is
deterministic and independent of subsequent compilations and input mutation.
No runtime, physical target, transport, recorder, receipts or session claims
participate. Labels are presentation only.

LSLED retains its 64-byte header, 66-byte group-major bitmap, 14 padding bytes
and nine 16-byte packets. micro:bit uses one direct five-byte characteristic
value with no borrowed program/CRC/compression metadata. Both implementations
remain outside default live drivers, discovery, probes and notifications.
Central policy independently rejects dry-run intent, even with unlock and
confirmation. Neither reference is accepted shipping hardware support.

The single inspector owns async generations for entry load, citations and copy.
Entry switching immediately clears incompatible packet selection, result,
error/success notices and citations. Old completions cannot publish into a new
owner. Compilation retry stays local; module retry reloads the same selected
URL because browsers cache failed dynamic imports. Citation failure never
invalidates compiled bytes. One packet is displayed at a time; explicit copy
controls use the supervised existing browser adapter. No hardware action exists.

Maintained source/reference files and the knowledge JSON contribute to build
identity. Vite's existing asset manifest deliberately includes all new lazy
chunks in service-worker precaching. The production journey installs from Home,
opens neither entry online, disables networking, then navigates both references,
loads micro:bit citations and reloads the selected reference. CSP, external
origin scans and validated source-only citation navigation remain unchanged.

See [LSLED source scope](lsled-offline.md) and
[micro:bit source scope](microbit-offline.md). Pairing, firmware installation,
readback editing, text, brightness, animation and live support remain deferred.
