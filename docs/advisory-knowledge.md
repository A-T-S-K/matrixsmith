# Advisory reference corpus

`public/knowledge-v1.json` is a separately versioned application-facing curation
of the 2026-10-02 census and detailed knowledge pack. The research originals remain
in their supplied temporary folders. This is a compact reference index, not a
support catalog or reproduction of those full packs.

Coverage is all 66 census records, all 21 protocol sheets, 104 census assertions,
five scoped GATT assertions from the detailed pack, 44 normalized family records,
144 deduplicated citation records, and 21 retained conflict resolutions (14 census,
seven detailed-pack). The microbit-led-service alias resolves to microbit-led.
Classic Divoom and the five seed family aliases are normalized explicitly.
Unresolved lines retain a family record and null sheet/matching suggestion.
Records are searchable by label, alias, family and notes; lists are bounded.

Row references identify the research basis for that index entry. They do not
prove every family, company or chip relationship on the row. Protocol assertions
carry their own source and locator. Census maintainer reverse-engineering notes
are classified as implemented behavior, not manufacturer specifications.
Specified, implemented, author-observed, corroborated, hypothesis and unknown are
separate schema categories. No assertion is elevated to independent corroboration
by source count. File/README records share repository origin; URL-identical seed
and census sources are deduplicated. Explicit derived-source edges conservatively
join research origins. Unknown lineage remains unknown. Conflicts remain visible
without selecting a universal winner. Historical iLedHat capture values and private
identifiers are excluded; existing repository evidence retains them.

Five well-scoped GATT suggestions cover CoolLEDUX, CoolLEDX, iDotMatrix, BK-Light
and modern Divoom BLE. Shared FFF0/FFF1 and FA02/FA03 retain ambiguity. Missing
service/property access is uncertainty. Explicit exact-profile contradictions do
not remove family plausibility. Branding, app publishers, company fields and UUIDs
never identify chip/OEM. Suggestions link only to an already registered reviewed
query; they do not create operations, select drivers, interpret claims or grant
write permission. Stateful Divoom initialization has no action suggestion.

Schema validation and semantic reference checks run at build time and once on
lazy runtime load. Duplicate/dangling identities, alias conflicts and copied-source
cycles fail. Data is at most 256 KiB. Resolver output is bounded to eight families,
four facts, eight unknowns and eight sources per family. The projection cache is
scoped to workspace owner, immutable fingerprint and registered action identity.
Unrelated UI publications do not re-resolve the corpus. Cold Home does not import
or parse it. Offline installation deliberately caches it with the application
build, independently of its lazy parsing lifecycle.

URLs are citations only. Nothing fetches cited code or dependencies. Source
attribution, retrieved date, pinned revision/hash where available, inspection
status and license metadata remain in the index. Paraphrased facts do not resolve
rights for upstream code, fonts, capture blobs, manuals or vendor assets. No
project license is selected. Unversioned pages and inaccessible original lineage
references retain those limitations. This curation performs no new advisory
queries, upstream retrieval, Bluetooth operation or hardware acceptance.
