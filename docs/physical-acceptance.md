# Physical-device acceptance

Run this checklist on the stable HTTPS Cloudflare Pages custom domain. Web Bluetooth permissions and opaque device IDs are origin-scoped, so preview origins are suitable for simulator QA but not final hardware acceptance.

Record the browser/OS, deployment commit, display identifier label, and result for every run. Do not paste opaque browser device IDs into shareable reports.

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
- [ ] Brightness round-trip changes, reads back, restores, and verifies the baseline.
- [ ] Text updates with one **Display it** action and no confirmation dialog.
- [ ] Image updates with one **Display it** action and no confirmation dialog.
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
- [ ] An available service-worker update is surfaced and reloads on request.
- [ ] Keyboard-only completion works for Home, Create, Investigate, Reports, and Developer.
- [ ] Screen-reader landmarks, dialogs, tabs, notices, and unavailable reasons are coherent.
- [ ] Layout and controls are usable at 320, 390, 768, 1024, and 1280 CSS pixels.
- [ ] Notices and bottom navigation do not cover actionable controls.
