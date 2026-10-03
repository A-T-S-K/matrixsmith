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
the secondary **Protocol workbench** link opens the Protocol workbench. Workbench
sections have explicit routes, retained separately in each workspace.

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
2. Choose **Identify display** in Investigate for one contributed, bounded, read-only family probe. Other views link to this flow; Investigate has one identification execution button.
3. If a driver interprets eligible correlated response dimensions, review **Display reported W×H pixels** and explicitly choose **Use reported size**, or enter dimensions manually. No response adopts itself or overwrites draft text.
4. Manual width and height start blank. Use pixel columns and rows from the product specification, label, seller documentation, or counted LEDs. Raw partial edits remain text; field-associated errors preserve both fields. Dimensions must be integers from 1 to 512, with at most 65,536 pixels.
5. Either path creates experimental provisional geometry, without a reviewed model match, physical rendering evidence, experimental permission, or send authorization. Source, limitations, and canonical operation reasons remain visible.
6. Run only contributed applicable tests. If no tests apply, Investigate explains the limit and directly offers **Open Protocol workbench** and **Open report**; it does not promise tests or offer an unavailable refresh.

Unsubmitted manual text is owned by the presentation connection owner and captured
with workspace UI state. It survives view navigation and live/offline switches.
The same browser-authorized device with the same fingerprint shape retains text
across reconnects; anonymous targets use connection identity. A different device
starts blank. Every reconnect expires response proposals and requires a new live
identification; UI capture/restore never contains a proposal or execution authority.
Changing geometry consumes confirmations, invalidates prepared target bindings,
clears the validated raster strategy, and reconciles investigation evidence. Content
owners invalidate affected previews and pending sends while retaining valid text.
Reviewed profile geometry remains intact even when a response conflicts; the
reported discrepancy links to inspectable transaction evidence.

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
live display** on Home. Returning retains the offline workspace and its UI; Home
can reopen it. Starting a live connection from offline explicitly creates or
activates a separate live runtime. Imported evidence never gains live authority.

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

## Unfamiliar-display machine setup

A connected display that needs identification offers one primary **Set up this
display** action. It reviews accessible evidence and runs eligible application
checks with that explicit intent. The current question, completed checks,
uncertainty and meaningful findings appear without a fabricated total. Stop keeps
the pending browser operation owned until settlement. Exact transaction IDs,
response sequences, original connection and pinned definition identities are
available in an optional technical disclosure; Protocol workbench and reports
remain accessible after completion.

Results distinguish sourced dimensions for review, identified family needing
manual dimensions, configuration described with capabilities unverified,
competing candidates, missing access/setup, experimental review, interruption,
budget exhaustion and no further registered check. No-check completion does not
mean unsupported. The geometry proposal uses the existing explicit adoption
controls and preserves manual drafts. Manual diagnostics remain available when
idle. Setup does not toggle experimental permission, send content, establish
physical rendering or replace the known iLedHat workflow.
