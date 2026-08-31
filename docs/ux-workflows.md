# UX workflows

MatrixSmith's UI is organized around four user jobs, not around code layers. The Preact UI renders immutable `AppSnapshot` objects from `MatrixStore` and invokes semantic controller operations; no component talks to a characteristic or reconstructs domain state from trace text.

```text
HOME
DEVICE WORKSPACE
  CONTROL   — use a supported display
  DIAGNOSE  — identify / troubleshoot a display
  DEVELOP   — protocol workbench
REPORT      — persistent Share report action in the device header
```

## Use

Home offers one primary call to action: **Connect a display**. When the browser supports `navigator.bluetooth.getDevices()`, previously authorized devices appear as a progressive enhancement; nothing requires it. After connection, a persistent device header shows name, geometry, protocol/resolution state, connection state, support status, **Share report**, and **Disconnect**. Mobile uses a compact top summary plus bottom navigation; desktop uses a sidebar.

**Control** is the normal-user surface. It renders verified live capabilities (CoolLEDUX device info and raw brightness with explicit Apply and verified readback) plus a Content section: rendered text (color, background, alignment), local image import (PNG/JPEG/WebP with contain/cover/stretch/center fit and a quantized preview), an animation chooser (diagnostic two-frame pattern or scrolling text), and local GIF import with byte/canvas metadata. Everything previews offline; nothing leaves the browser. While the static framebuffer is unvalidated on the session, content stays preview-only and a gate card routes the user into the guided validation flow instead of presenting experimental sends as normal controls. Every allowed send opens a confirmation dialog stating the exact persistent consequence. Control never shows driver scores, raw GATT, packets, or transport receipts.

## Diagnose

Diagnose answers three questions: what is working, what is uncertain, and what to run next.

- A support/development status matrix covers transport, protocol identity, device state, brightness, persistence, static framebuffer, pixel orientation, color encoding, stored programs, text rendering, animation, GIF, and recovery — each with an honest state (`Verified`, `Experimental`, `Not tested`, `Unknown`, `Rejected`, `Unsupported`, `Out of scope`) and evidence. `Unsupported` is reserved for evidence that a feature cannot work; unperformed work is `Not tested` or `Unknown`.
- A prominent **Recommended next action** advances the support state deterministically: disconnected → connect; ambiguous shared GATT → run safe identification; resolved with static frame untested → **Validate static framebuffer**; static frame passed with animation untested → **Validate animation**; everything validated → safe device checks.
- **Hardware validation** cards launch the guided workflows. Each opens a dialog that shows the exact consequence and a pixel-accurate preview, requires a checked confirmation before **Run test**, transfers the diagnostic program, then records structured yes/no/unsure observations (corners, colors, tile seams, canvas, background; frames, timing, tile sync, loop). Results land in the support matrix, the bundle, and the report, with a **Copy report** action at the end.
- Driver families contribute named diagnostic tools (`src/diagnostics/workflows.ts`). Tools execute only semantic controller operations through the safety policy — no raw transport. Runs are serializable and land in the diagnostic bundle and reports.

The CoolLEDUX brightness round-trip is a guided reversible validation: record baseline, set a sufficiently different test value, require a matching command response, verify by device-info readback, restore the baseline, require a response, and verify restoration. It never runs automatically; the pre-run explanation states that brightness changes temporarily and is restored. A restore failure is surfaced prominently and stops the workflow. Families with no safe probe say so instead of inventing one.

## Develop

Develop replaces the old Lab with six sections:

1. **Protocol candidates** — actionable cards (candidate / verified this session / rejected) with safe identification where one exists; numeric scores and match reasons live under expandable details.
2. **Family probes & tests** — the same constrained diagnostic tools, framed for protocol work.
3. **GATT explorer** — nRF-Connect-style service/characteristic hierarchy; each characteristic row shows UUID, properties, copy, and per-characteristic Read/Subscribe only where the properties allow. There is no generic write box.
4. **Transactions** — the primary protocol-debugging view. A concise timeline expands into TX/RX raw hex, decoded fields, host/protocol/device verification, errors, and one-click copy for every packet. Filters (All, TX/RX, Queries, Probes, Diagnostics, Errors) plus text search over opcode/operation/hex/driver/summary.
5. **Raw events** — the `TraceEvent` ground truth, collapsed by default. Raw notifications never disappear because decoding failed.
6. **Evidence / observations** — session notes plus **Import external capture**: paste or open an nRF Connect text log; the summary shows parsed device, GATT counts, transaction/decode counts, warnings, unparsed lines, and the BLE address (kept out of shareable reports). Imported and live transactions share the same Transactions view, labeled by source.

Multi-packet content uploads appear as one coherent transaction with a compiled-program summary (content type, logical size, tiles, uncompressed size, CRC32, compressed size and ratio, chunk count, pacing and estimated duration) above collapsible per-packet hex labeled announce / chunk N.

## Share

**Share report** opens from the device header. The dialog takes a goal/question, offers per-section include toggles, and previews deterministic Markdown generated purely from domain data (`src/diagnostics/report.ts`) — never from the DOM. Actions: **Copy Markdown**, **Download .md**, **Download diagnostic JSON** (the canonical machine-readable bundle).

Share-sensitive identifiers (browser opaque device IDs, imported MAC addresses, raw trace) default **off** and are labeled when included. Protocol UUIDs, packet bytes, product name, and profile identity are not redacted. The Markdown stands alone when pasted into an issue, forum, chat, or an AI assistant: stable headings, literal hex, and suggested next tests derived from deterministic driver metadata.

## How a driver contributes

- **Capabilities** — `driver.capabilities(profile)` declares supported/live/risk/persistence/validation; Control and the support matrix render from these, never from driver-id conditionals.
- **Probes** — `driver.probes(context)` returns read-only semantic identification probes with serializable response expectations.
- **Diagnostic tools** — named workflows registered in `src/diagnostics/workflows.ts` and executed by `MatrixController.runDiagnostic`, which records steps, transactions, restoration state, and findings.
- **Support-status evidence** — capability metadata plus session resolution evidence feed the Diagnose matrix and the report's support table and suggested next tests.
