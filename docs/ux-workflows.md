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

Home also exposes **Diagnose / identify**, **Explore unknown BLE** with an
**Optional service UUIDs** field, **Open diagnostic report**, and **Import external
capture**. The workspace calls its primary surfaces **Create** and **Investigate**;
the secondary **Protocol workbench** link opens a view titled **Develop**. Workbench
section selection currently stays in component state: selecting GATT does not
change the Transactions URL, and returning to the view starts at Transactions.

## Known display

1. Connect the reviewed profile.
2. Choose Text, Image, Demo animation, or GIF (converted locally to raster animation).
3. Edit and preview content locally.
4. Press **Send to display** beside the stored-content replacement consequence.
5. Progress and the result appear beside that action. Host-only completion says
   **Upload sent.** and **Check the display. Its appearance was not confirmed.**
   Optional **Send details** separates host acceptance, protocol acknowledgement,
   device readback, completion time, and unresolved physical/retention evidence.
   A response timeout remains in the headline.

A rejected gate, geometry mismatch, or planning error says **Send could not start**.
Once execution may have begun, failure says **Upload did not finish. Check the
display before sending again.** Accepted-packet progress is shown only when
reported by execution; missing callbacks do not prove zero writes. Valid drafts
and previews remain available. Quarantined writes require **Reconnect and review
draft** through the existing disconnect/connect path. Recovery never sends:
review and press Send explicitly to prepare a fresh target-bound plan, with a
fresh confirmation for experimental content. Results and callbacks are scoped
to their workspace, connection, target, and attempt; obsolete results are hidden.

Verified routine content, including imported GIF through ShowAnimation on the
reviewed profile, opens no confirmation. The target-bound digest and execution
policy still enforce safety. Experimental persistent content uses one concise
consequence-specific confirmation without a checkbox. The native GIF compiler
remains a separate experimental workbench capability.

## Unknown display

1. Connect and enumerate browser-authorized GATT evidence.
2. Run one driver-contributed, bounded, read-only family probe.
3. If the family is identified but geometry is unavailable, confirm width and height explicitly.
4. MatrixSmith creates a provisional target; it inherits no reviewed product-profile evidence.
5. Run only the family tests and actions marked executable for that target.

The geometry form currently starts at 32×16; those defaults are not device
evidence. The resulting provisional profile has no reviewed profile evidence.

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

Opening a bundle retains an already-connected live workspace, with **Return to
live display** on Home. Returning retires the offline runtime; the report must
be reopened to review it again. An offline-only report has no live-workspace
factory, so Home explains that starting a live connection requires a reload.

## Accessibility

Shared Dialog, Tabs, MenuButton, NoticeRegion, FileButton, UnavailableAction, and EvidenceDisclosure primitives implement keyboard and screen-reader behavior. Animated previews honor reduced motion. Unavailable reasons are visible text. Notices and bottom navigation do not cover controls.

Automated component tests and Playwright axe scans cover the critical routes; the stable-domain manual checklist is in [physical-acceptance.md](physical-acceptance.md).

### Retained live display and offline report

Open a JSON report to review read-only evidence in a separate context. From an
offline-only report, **Connect a display** explicitly opens a fresh live session
without reloading. Cancellation leaves searches, review notes and report choices
in place for retry. An existing live display offers **Return to live display**
with its current connection state. It is never silently replaced by another
connected display.

**Return to retained report** reopens the one retained report without importing
again. Each context remembers its workbench section, search/filter, unsaved
review note, content selection, draft/previews and report choices. Offline review
has no Create/send action. **Close retained report** disposes that report; opening
a valid replacement retires the previous report while preserving live. Invalid
imports preserve both contexts. Finish an active transfer/import or finish/close
a guided observation before switching. A physical disconnect while reviewing a
report updates the retained live indicator and requires explicit recovery.

All seven Protocol workbench sections have matching URLs. Back/Forward selects
available contexts and sections; Back first closes an open modal. Forward never
restores send confirmation. Reload/direct links to missing report data ask for
the JSON to be reopened; missing live data asks for explicit connection. No
complete report or decoded media is automatically persisted.
