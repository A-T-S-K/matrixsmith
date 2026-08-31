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

**Control** is the normal-user surface. It renders only verified live capabilities (currently CoolLEDUX device info and raw brightness with explicit Apply and verified readback). It never shows driver scores, raw GATT, packets, or transport receipts. Capabilities that are not verified live appear labeled (`Experimental / gated`, `Dry-run only`) rather than pretending to be normal controls.

## Diagnose

Diagnose answers three questions: what is working, what is uncertain, and what to run next.

- A support/development status matrix covers transport, protocol identity, read-only status, transient control, persistence, framebuffer, orientation, color, stored programs, animation, and recovery — each with an evidence label (`Verified live`, `Experimental / gated`, `Dry-run only`, `Blocked`, `Unsupported`).
- A prominent **Recommended next action** is derived deterministically from session state: disconnected → connect; ambiguous shared GATT → run safe identification; resolved CoolLEDUX → run safe device checks; no safe probe → collect GATT evidence only.
- Driver families contribute named diagnostic tools (`src/diagnostics/workflows.ts`). Tools execute only semantic controller operations through the safety policy — no raw transport. Runs are serializable and land in the diagnostic bundle and reports.

The CoolLEDUX brightness round-trip is a guided reversible validation: record baseline, set a sufficiently different test value, require a matching command response, verify by device-info readback, restore the baseline, require a response, and verify restoration. It never runs automatically; the pre-run explanation states that brightness changes temporarily and is restored. A restore failure is surfaced prominently and stops the workflow. Families with no safe probe say so instead of inventing one.

## Develop

Develop replaces the old Lab with six sections:

1. **Protocol candidates** — actionable cards (candidate / verified this session / rejected) with safe identification where one exists; numeric scores and match reasons live under expandable details.
2. **Family probes & tests** — the same constrained diagnostic tools, framed for protocol work.
3. **GATT explorer** — nRF-Connect-style service/characteristic hierarchy; each characteristic row shows UUID, properties, copy, and per-characteristic Read/Subscribe only where the properties allow. There is no generic write box.
4. **Transactions** — the primary protocol-debugging view. A concise timeline expands into TX/RX raw hex, decoded fields, host/protocol/device verification, errors, and one-click copy for every packet. Filters (All, TX/RX, Queries, Probes, Diagnostics, Errors) plus text search over opcode/operation/hex/driver/summary.
5. **Raw events** — the `TraceEvent` ground truth, collapsed by default. Raw notifications never disappear because decoding failed.
6. **Evidence / observations** — session notes, plus the planned **Import external capture** placeholder (`src/diagnostics/importers.ts`).

## Share

**Share report** opens from the device header. The dialog takes a goal/question, offers per-section include toggles, and previews deterministic Markdown generated purely from domain data (`src/diagnostics/report.ts`) — never from the DOM. Actions: **Copy Markdown**, **Download .md**, **Download diagnostic JSON** (the canonical machine-readable bundle).

Share-sensitive identifiers (browser opaque device IDs, imported MAC addresses, raw trace) default **off** and are labeled when included. Protocol UUIDs, packet bytes, product name, and profile identity are not redacted. The Markdown stands alone when pasted into an issue, forum, chat, or an AI assistant: stable headings, literal hex, and suggested next tests derived from deterministic driver metadata.

## How a driver contributes

- **Capabilities** — `driver.capabilities(profile)` declares supported/live/risk/persistence/validation; Control and the support matrix render from these, never from driver-id conditionals.
- **Probes** — `driver.probes(context)` returns read-only semantic identification probes with serializable response expectations.
- **Diagnostic tools** — named workflows registered in `src/diagnostics/workflows.ts` and executed by `MatrixController.runDiagnostic`, which records steps, transactions, restoration state, and findings.
- **Support-status evidence** — capability metadata plus session resolution evidence feed the Diagnose matrix and the report's support table and suggested next tests.
