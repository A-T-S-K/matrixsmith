# Physical-device acceptance

Run this checklist on the stable HTTPS Cloudflare Pages custom domain. Web Bluetooth permissions and opaque device IDs are origin-scoped, so preview origins are suitable for simulator QA but not final hardware acceptance.

All boxes below are unperformed until the owner records evidence for the frozen build. Characterization, software conformance and simulator tests do not complete them. Record the browser/OS, full deployment commit, build ID, archive/manifest checksums, stable origin, non-sensitive display label, and result for every run. Do not paste opaque browser device IDs into shareable reports.

## Connection and lifecycle

- [ ] The chooser finds the known display and connects.
- [ ] Home shows the active-device card without disconnecting.
- [ ] Return to display preserves the connection.
- [ ] Disconnect/change display opens a fresh chooser.
- [ ] An unexpected power-off clears operational authority and panel certainty.
- [ ] Reconnect restores device notifications.
- [ ] A timed-out write quarantines transmission until reconnect.

## Known-device operations

- [ ] Device-info notification decodes and retains exact raw bytes and RX endpoint.
- [ ] Brightness round-trip changes and reads back; any baseline restoration is explicitly authorized, target-bound and verified rather than automatic.
- [ ] Text updates with one **Send to display** action and no confirmation dialog.
- [ ] Image updates with one **Send to display** action and no confirmation dialog.
- [ ] Demo animation plays with the documented frame timing.
- [ ] Screen lock is prevented during a transfer where Wake Lock is available.

## Unknown and experimental operations

- [ ] An unknown FFF0/F1 display can run the bounded read-only family probe without a product profile.
- [ ] Geometry is explicitly sourced from device information, advertisement evidence, or user confirmation.
- [ ] A provisional target inherits no iLedHat profile evidence.
- [ ] Experimental content shows exactly one consequence-specific confirmation and no checkbox.
- [ ] Destructive and firmware operations remain blocked.

## Evidence, files, and privacy

- [ ] Shareable Markdown excludes identifiers by default.
- [ ] Shareable Bundle V3 excludes browser ID, name, raw advertisement/manufacturer data, trace, and device binding.
- [ ] Full local archive is clearly labeled as containing identifiers.
- [ ] Malformed and over-budget files fail without partially changing the workspace.
- [ ] Imported evidence remains offline and cannot authorize transmission.

## PWA and responsive behavior

- [ ] Install prompt/installation works with the 192, 512, and maskable icons.
- [ ] The application shell opens offline after one successful online load.
- [ ] An available service-worker update is surfaced in installed-PWA and browser tabs; **Update and reload** waits for every open tab to be ready.
- [ ] Failed update installation leaves the prior shell usable offline.
- [ ] A complete previous artifact restores at the same origin; build identity and offline navigation match the recorded rollback artifact.
- [ ] Keyboard-only completion works for Home, Create, Investigate, Reports, and Protocol workbench.
- [ ] Screen-reader landmarks, dialogs, tabs, notices, and unavailable reasons are coherent.
- [ ] Layout and controls are usable at 320, 390, 768, 1024, and 1280 CSS pixels.
- [ ] Notices and bottom navigation do not cover actionable controls.

## Local imported GIF → raster animation (pending)

These checks require real iLedHat playback on the frozen candidate. Historical
native-GIF captures, existing animation evidence, and browser/simulator tests
do not satisfy these imported-GIF acceptance items.

- [ ] Imported GIF plays across the full 32-pixel width with four synchronized tiles.
- [ ] Multiple colors match the decoded preview.
- [ ] Variable frame timing matches the source durations exposed by the browser.
- [ ] Transparency, partial updates, and disposal match the complete decoded frames.
- [ ] Sustained looping remains stable; finite source repetition is visibly warned about and is not promised to be preserved.

## Owner-run six-journey script (unperformed)

Run on the frozen candidate with benign owner-chosen drafts/files. Use the stable
origin for physical work; record simulator-only rehearsals separately. Do not
create a transport timeout with hardware or run experimental writes merely to
fill a checkbox. If a required condition cannot safely be exercised, record it
as unrun with the reason. Inconclusive observations remain inconclusive.

For each journey record: steps actually taken, expected/observed result, preserved
state, failure and recovery, pass/fail/unrun, and evidence location. Repeat with
keyboard only and the owner's actual screen reader; observe announced status,
unavailable reasons, dialog focus/return, tab navigation and visible focus. Check
320, 390, 768, 1024 and 1280 CSS-pixel layouts. Automated accessibility scans and
desktop emulation are supplementary evidence.

### 1. Routine send and recover

- [ ] Connect the characterized iLedHat 31AE 32×16 using **Connect a display**. Confirm the displayed profile/geometry and operation readiness before sending.
- [ ] In **Create**, enter benign text, then **Send to display** once. Repeat with an owner-chosen image and inspect its preview. Record **Upload sent**, any protocol/readback result and actual visual observation separately. Host completion alone does not prove rendering.
- [ ] Visit Home and return to the display. Verify live connection and draft continuity. Cancel a file selection and try a malformed file; prior content/workspace must remain intact.
- [ ] When safe, disconnect/reconnect explicitly. If a timeout/quarantine is observed, inspect the partial/uncertain outcome, reconnect, review the retained draft and deliberately decide whether to send. Verify no automatic resend or restoration. Do not count reconnect as proof the earlier write succeeded.

Expected preservation: navigation and failed imports retain usable drafts;
connection loss revokes operational certainty/authority. Recovery requires fresh
connection/readiness and an explicit new send. Stop and retain evidence if the
panel differs from the host/protocol result.

### 2. Unknown setup and inconclusive report

- [ ] With an owner-authorized unknown device (or separately labeled simulator rehearsal), connect from Home and open **Investigate**. Review the proposed bounded read-only identification path and any unavailable reason. A matching name or FFF0/F1 service alone must not select iLedHat support.
- [ ] Record geometry only from actual device information, advertisement evidence or explicit owner confirmation. Retain its provenance; a guessed/default dimension is not acceptance evidence.
- [ ] Follow the available interview without inventing responses. If no family/route can be established, choose/retain an inconclusive result and open **Device actions → Share report…**.
- [ ] Export a shareable report/Bundle V3 and inspect it for identifiers, free-form notes and raw content. Verify uncertainty is preserved and no write authority is created. Keep full local archives restricted and separately labeled.

Expected preservation: raw observations, provenance and inconclusive outcomes
remain inspectable; unknown setup does not acquire characterized-device evidence.
Recovery: reconnect for missing live evidence, or export the inconclusive report
and stop. Experimental still writes need separate permission and the exact
consequence-specific confirmation; this read-only journey does not grant it.

### 3. Candidate export, reload and reverify

- [ ] Only after separately authorized still-route checks, open **Candidate profile**, choose **Create candidate profile**, and inspect geometry, bootstrap/raw-channel/encoder history, limitations and recommended route. An incomplete candidate must remain visibly incomplete.
- [ ] Review public label, Bluetooth matching name and local profile ID; choose **Apply reviewed labels and matching** before **Download candidate profile** and **Download shareable candidate evidence**. Review the matching name for identifying content; the profile and redacted evidence have different privacy scopes.
- [ ] Change relevant target/geometry/evidence where safe, or inspect an existing stale review. Export must be unavailable until a fresh candidate is created/reviewed; a failed copy/download must preserve the current review.
- [ ] Start a fresh browser session and create a benign new draft. Use Home's **Choose local profile →**, inspect **Local profile review**, then **Load reviewed profile**. Verify a fresh disconnected workspace, preservation of that session's current draft and historical/incomplete evidence labeling. Loading grants no live permission.
- [ ] Reconnect explicitly, identify the family live, compare matching/geometry and repeat bootstrap → raw channels → encoder checks under separate authorization. Fresh experimental permission and exact persistent-send confirmation are required; history/import cannot replace them.

Expected preservation: exported profile/evidence survive locally; session loading
keeps drafts while prepared work, current evidence and confirmations do not carry
over. Recovery: reject incompatible/malformed files without partial changes;
resolve export errors or redo stale verification without adopting historical
success as current evidence. This journey does not establish hardware equivalence.

### 4. Offline and live continuity

- [ ] While connected with a draft, go Home and use **Choose JSON report →** to open a valid shareable Bundle V3. Confirm recorded/offline labeling and that live actions are unavailable there.
- [ ] Inspect the report and return to the retained live workspace using the available return action. Verify target, connection and draft continuity; report data must not change current live authorization.
- [ ] Import a malformed/over-budget file. Verify the prior workspace survives with a visible error. If the retained display disconnected, require an explicit reconnect rather than showing ready authority.
- [ ] After a successful online installation, go offline and open/reload the protocol explorer for LSLED, micro:bit and Merkury, including source details. Verify logical previews, planned bytes and source limitations; no Bluetooth call or receipt is implied.

Expected preservation: offline reports and live state stay separate; failed
imports do not partially replace either. Recovery: return to live state, reconnect
if needed, or retry a valid local file. Missing offline assets leave this gate
failed/unrun; reducing installed assets is not a qualification fix.

### 5. Protocol workbench inspect and export

- [ ] Open **Protocol workbench** and inspect **Transactions**, **Raw events**, **GATT explorer**, and **Evidence / observations**. Follow a linked transaction to its exact bytes, endpoint and evidence. Planned/transmitted/read/notification evidence must remain distinct; missing evidence must not be fabricated.
- [ ] For browser-authorized readable endpoints in **GATT explorer**, use **Read** only where offered and record the endpoint/raw bytes. This raw read is separate from the registered micro:bit LED Matrix State interpretation available through **Explore unknown BLE → Set up this display**; record that bounded read's decoding/unavailable result when applicable. Neither value proves a command reply, identity or rendering. Unreadable/inaccessible endpoints must retain their unavailable reason.
- [ ] Copy an inspected value and export a shareable report; compare the selected bytes and stable evidence relationship. Repeat inspection on an imported report: live reads/subscriptions/writes must remain unavailable.
- [ ] Inspect each offline compiler's planned packets. Source-only timing/write-mode placeholders must not be interpreted as physical acceptance or transmitted bytes.

Expected preservation: inspection/copy/export do not alter target authority or
transmit. Recovery: retry a failed copy/export, retain raw bytes on decode failure,
or reconnect only for a separately authorized live read. Do not retry an uncertain
write from the workbench.

### 6. Startup and update recovery

- [ ] Open installed MatrixSmith and browser Home online, then offline after a successful installation. Open a lazy feature; failure must provide an understandable recovery route without losing usable Home access. Record any startup/import errors rather than interpreting a blank/loading page as success.
- [ ] With two tabs and the installed PWA open, make one client busy with safe work. Under a separately authorized two-build host drill, surface the available update. **Update and reload** must wait for readiness; finish work or close an unavailable tab before retrying. No forced reload during active work counts as acceptance.
- [ ] Exercise a failed install in the controlled host drill. Verify the existing shell still opens offline. Export session-only profiles/reports and save draft text/original image or GIF files before intentional reload. Verify persisted settings/history afterward; text/image/GIF drafts are session state and must be recreated after reload. Re-establish live connections and confirmations explicitly.
- [ ] Perform the [complete-artifact rollback](releasing.md#recovery-and-rollback) at the same origin. Record old/new archive checksums and manifests, displayed/exported build identity, offline lazy navigation and a separately authorized safe device-info query. An old tab alone is not evidence of rollback.

Expected preservation: failed installation preserves the successful shell;
updates wait for client readiness and do not carry live authority across reload.
Recovery: remain on the current usable build, restore the whole previous artifact
under owner authorization, then verify its identity and offline behavior. Leave
this journey unrun until two frozen artifacts and a host drill are available.
