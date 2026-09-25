# Product workflows

MatrixSmith separates three jobs: use a known display, characterize/troubleshoot a display, and inspect protocol evidence. Developer tooling is never required to complete Create or guided Investigate.

## Navigation

- `/#/home`
- `/#/device/create`
- `/#/device/investigate`
- `/#/device/develop/transactions`
- `/#/device/develop/gatt`
- `/#/offline/report`

Browser navigation changes presentation state only. Home keeps a connected display visible with **Return to display** and **Disconnect / change display**.

## Known display

1. Connect the reviewed profile.
2. Choose Text, Image, or Demo animation.
3. Edit and preview content locally.
4. Press **Display it**.
5. The button area shows transfer progress and finishes with **Display updated.**

Verified routine content opens no confirmation. The target-bound digest and execution policy still enforce safety. GIF and other experimental persistent content use one concise consequence-specific confirmation without a checkbox.

## Unknown display

1. Connect and enumerate browser-authorized GATT evidence.
2. Run one driver-contributed, bounded, read-only family probe.
3. If the family is identified but geometry is unavailable, confirm width and height explicitly.
4. MatrixSmith creates a provisional target; it inherits no reviewed product-profile evidence.
5. Run only the family tests and actions marked executable for that target.

The UI renders application-provided actions. It never branches on driver IDs or reconstructs availability.

## Known characterized profile

Investigate leads with “This model is ready for normal use.” It offers Create and evidence access; there is no no-op Finish action. Troubleshooting and revalidation create real investigation runs with explicit terminal states.

## Guided tests

The workflow stages are About, Transfer, timed observation or questions, Result, and optional explicit Retry. Stage-specific values exist only in their valid state-machine variant. Automatic recommendations leave concluded experiments out of rotation and detect cycles.

## Reports and files

- Shareable investigation report: conclusions and evidence, identifiers omitted by default.
- Forensic report: transactions, timing, candidates, decodes, and exact packet evidence.
- Shareable Bundle V3: strict portable data with identifiers, trace, advertisement bytes, and device binding removed.
- Full local archive: complete identifiers and trace, explicitly labeled unsafe to share by default.

Bundle V3 validates fully and enforces resource budgets before application mutation. Live and offline workspaces stay separate.

## Accessibility

Shared Dialog, Tabs, MenuButton, NoticeRegion, FileButton, UnavailableAction, and EvidenceDisclosure primitives implement keyboard and screen-reader behavior. Animated previews honor reduced motion. Unavailable reasons are visible text. Notices and bottom navigation do not cover controls.

Automated component tests and Playwright axe scans cover the critical routes; the stable-domain manual checklist is in [physical-acceptance.md](physical-acceptance.md).
