# iLedHat protocol findings

Research and hardware-validation date: 2026-08-31

## Current decision

The physical 32×16 `iLedHat` is a hardware-verified **CoolLEDUX** device. CoolLEDX and CoolLEDUX share FFF0/FFF1 and the `0x01…0x03` escaped envelope, so static browser-visible GATT evidence is honestly ambiguous. An explicit read-only CoolLEDUX `0x1F` device-info probe resolves the protocol family for a session.

The earlier CoolLEDX hypothesis is retained as rejected evidence: classic brightness TX `01 00 02 06 08 40 03` produced RX `01 00 02 06 08 FE 03` and no visible brightness change. The decoded payload is `08 FE`; `FE` is rejection/error-like in this observation, but its exact semantics are not mapped.

## Physical evidence

| Fact | Result |
|---|---|
| BLE name / scanner address | `iLedHat` / `01:00:00:21:CC:99` |
| service / characteristic | FFF0 / FFF1 |
| properties | READ, NOTIFY, WRITE WITHOUT RESPONSE |
| manufacturer company field | `AE 31` = `0x31AE` little-endian |
| vendor identifier bytes | `5E EA 07 00 00 01`; semantics unknown, not called a MAC |
| advertisement layout | height 16, width BE16 32, `colorModeRaw=3`, `firmwareRaw=30` |
| initial `0x1F` response | 48-byte payload beginning `1F 01 CC` |
| brightness TX / RX | `01 00 02 06 04 40 03` / identical echo |
| physical result | panel visibly dimmed |
| follow-up `0x1F` response | 48-byte payload beginning `1F 01 40` |

Confirmed device-info prefix only: payload byte 0 is opcode `0x1F`, byte 1 is power state (`0x01` observed on), and byte 2 is raw brightness. All later bytes remain opaque and are preserved exactly. The parser intentionally accepts other response lengths with the same minimum prefix.

## Shared wire facts

Both generations use:

```text
01 || escape(length_be16 || payload) || 03
01 -> 02 05
02 -> 02 06
03 -> 02 07
```

MatrixSmith shares only GATT constants, envelope encoding/decoding, and conservative advertisement-layout parsing. Commands, capabilities, matching resolution, and response semantics remain generation-specific.

## CoolLEDUX direct commands in this branch

| Operation | Opcode | iLedHat validation | Live status |
|---|---:|---|---|
| GetDeviceInfo | `1F` | verified structured response | explicit live query/probe |
| SetBrightness | `04 level` | verified at `40`, observed initial `CC` | explicit live Control |
| SetPower | `05 bool` | external-source confirmed, not iLedHat-tested | dry-run only |
| Mirror | `0C bool` | external-source confirmed, not iLedHat-tested | not exposed live |

Golden vectors:

```text
device info       01 00 02 05 1F 03
brightness 40     01 00 02 06 04 40 03
brightness CC     01 00 02 06 04 CC 03
classic rejected  01 00 02 06 08 40 03 -> 01 00 02 06 08 FE 03
```

## Stored-program pipeline (implemented offline, awaiting physical validation)

The CoolLEDUX stored-program pipeline is now fully implemented and conformance-tested offline: custom CRC32 announce (`0x02`), safe/regular LZSS, 128-byte compressed chunks (`0x03`) with XOR checksums, dual RGB444 encodings with per-path off sentinels, ≤8-column tiling at full profile height, tiled Graffiti static frames, rendered text via an embedded 5×7 font, tiled pixel animation, native GIF (`0x0C`), and the decorative frame border (`0x04`). See [coolledux-sources.md](coolledux-sources.md) for provenance and the byte-for-byte conformance cross-check against the pinned reference.

Every content capability is classified **experimental + persistent** for this iLedHat until the guided hardware validations pass:

| Capability | Offline status | iLedHat status |
|---|---|---|
| Static frame (tiled Graffiti) | conformance-verified | not tested — first physical step: **Validate static framebuffer** |
| Pixel orientation / color encoding | deterministic 32×16 diagnostic pattern ready | not tested |
| Rendered text / image | share the Graffiti pipeline | not tested (unlocked by static-frame pass) |
| Animation | conformance-verified; two-frame diagnostic ready | not tested |
| GIF | conformance-verified framing; upstream-tested only ≤8 columns | not tested |
| Recovery | — | unknown; one observation: a long-ish inline power-button action displayed `reset` and restored the default scrolling `coolled` text; exact timing/class unknown; no automatic restoration is implemented or claimed |

## Rejected hypotheses

- Classic CoolLEDX brightness semantics for this profile (`0x08` → `08 FE`, no visible change; exact `0xFE` semantics unmapped).
- Advertisement byte `0x1E` as battery state-of-charge; the byte position corroborates a raw firmware/version field.

Password set and OTA are not implemented.

## Physical characterization update (2026-08-31, second session)

Facts observed on the exact physical iLedHat, with strict provenance:

### Tiled Graffiti static test (observed on this iLedHat)

- A tiled Graffiti upload produced a recognizable full 32×16 diagnostic raster.
- 4 × 8-column tiling reconstructed the canvas; corner positions appeared correct; orientation/placement substantially correct.
- **After initially appearing correctly, the raster began moving/scrolling in a deterministic cycle**: initial complete raster → progressive movement → large blank interval/region → wrap/re-entry → reconstruction. Parameters were mode=0, speed=0, stayTime=3. Upstream reference hardware reports mode=0 as Static; the cause on this exact unit is **unknown** and deliberately not invented.
- The current Graffiti `0x0004` background workaround is visibly blue-ish. It is an intentional inherited workaround from the pinned reference hardware, **not yet validated as required on this iLedHat**: direct Graffiti `0x0000` behavior here is still unobserved. The guided "Test static-image black behavior" diagnostic exists to answer exactly this.

Resulting atomic claims: stored-program upload **works**; tiled raster reconstruction **works**; orientation **works**; Graffiti initial render **works**; Graffiti playback stability **unresolved / expectation failed**; Graffiti color mapping **unresolved**; Graffiti black semantics **not tested on this profile** (source-supported only).

### Tiled two-frame Animation test (observed on this iLedHat — PASSED)

- Two distinct frames alternate; approximate timing correct; all four 8-column tiles change together; looping continues autonomously after upload with no further Bluetooth traffic.
- This verifies: animation frame decoding, animation timing, animation tile synchronization, animation autonomous playback.
- **It does NOT verify power-cycle persistence**, which remains unknown and is modeled as a separate claim.

### Animation black (observed on this iLedHat)

- Animation-path literal `0x0000` background is genuinely off/black. Recorded separately from the Graffiti path.

### Color (observed on this iLedHat)

- Active-color issues looked materially the SAME between the Graffiti and Animation tests, so the color issue is **not** classified as Graffiti-specific.
- RGB-max "white" does not appear convincingly neutral.
- The current encoding uses 12 of the 16 pixel-word bits (byte0 low nibble = R, byte1 high nibble = G, byte1 low nibble = B); byte0's high nibble is unused. The LED package may contain a dedicated white emitter — this is a **hypothesis**, not a fact. `colorModeRaw = 3` remains unexplained and is never asserted to mean RGBW.

### Stored-program receipt notifications (observed on this iLedHat; semantics unmapped)

- Announce-style receipt: raw `01 00 02 06 02 06 00 03` → payload `02 00` (opcode 0x02, status byte raw 0x00).
- Chunk-style receipts: payloads `03 00 00 00 00`, `03 00 00 01 00`, `03 00 00 02 00`, … (opcode 0x03, structural chunk index at bytes 2–3 BE, raw trailing status byte).
- Upstream is explicit that notify traffic during uploads is **not a reliable per-chunk acknowledgement** and documents no payload semantics. MatrixSmith decodes these structurally (`statusRaw`, `chunkIndex`), never labels 0x00 "success", never treats a missing receipt as failure, and never retries persistent writes off a missing notification.

### Focused upstream research (coolledux-ble@4f5656d source; NOT this-device facts)

- `stayTime` semantics are **not documented** anywhere upstream; the only value the reference ever uses is the default `3`. No units, no special 0/0xFF meanings. Therefore the only justified discriminator is stayTime=3 (baseline) vs stayTime=0 (null value); 0xFF is deliberately not probed.
- `mode`: only 0 and 2 are characterized upstream, and only for color behavior — mode 0 ("Static") renders per-pixel color; mode 2 drops color and renders white. Movement behavior per mode is not documented.
- `speed`: "doesn't appear to matter once mode=0 is set" (upstream, on its hardware); otherwise uncharacterized.
- Animation delays are 16-bit BE **milliseconds, one per frame**; the sign self-drives timing and loops forever (no loop-count primitive). 65535 ms is the per-frame ceiling.
- Post-upload latency: tens-of-KB programs can take roughly 16–20 seconds between the last chunk and playback start on upstream hardware — observation timers must not misread this as failure.
- Firmware assumes a fixed 16-row stride when decoding a segment's pixel stream regardless of the declared showHeight; declaring a shorter height misreads the data (upstream-confirmed).
- The advertisement layout, `colorModeRaw`, value 3, RGBW, and any white channel are **not addressed at all** by the upstream reference.

---

## 2026-09-01 physical characterization session (exact iLedHat 31AE 32×16)

Everything in this section was **observed on the exact physical unit** during a
guided MatrixSmith session on 2026-09-01. It supersedes the open questions
above for THIS profile and changes nothing about upstream CoolLEDUX behavior,
which is recorded separately and left intact.

### Graffiti static playback — REJECTED for this panel

| Configuration | Initial render | Visible static hold | Then |
| --- | --- | --- | --- |
| mode=0, speed=0, stayTime=3 | correct | ~3.6 s | begins moving |
| mode=0, speed=0, stayTime=0 | correct | ~1.0 s | begins moving |

Both justified configurations move, and there is no third justified
configuration to try — upstream never documents the `stayTime` field and uses
only the value 3, so 3 (the used value) and 0 (the null value) exhaust the
defensible probe space. Graffiti is therefore **not a viable static-image
route on this panel**, recorded as a conclusive rejection rather than an open
question.

This says nothing about what `stayTime` *means*. Only these two values were
tested; its units and semantics remain unknown, and 0xFF is still deliberately
not probed.

### Graffiti black — TRUE BLACK on this panel

- Literal raw `0x0000` renders as genuinely off/black.
- Raw `0x0004` renders as a **visibly dim blue**.
- The upstream `0x0000`-is-white sentinel does **not** apply here, so the
  inherited `0x0004` workaround must not be substituted for black on this
  profile. It remains correct for CoolLEDUX profiles that have not been
  physically characterized.

### Animation static — BOTH VARIANTS VIABLE

| Variant | Visible static hold from T1 | Background | Tiles | Flicker/reset |
| --- | --- | --- | --- | --- |
| One frame | ~16.8 s | genuinely off | aligned | none |
| Two identical frames | ~16.2 s | genuinely off | aligned | none |

Both pass the 15 s stability threshold. **Preferred static strategy:
animation-single-frame**; animation-identical-frames is a verified fallback,
not the primary route.

### Pixel format — RGB444 PHYSICALLY CONFIRMED

- byte0 low nibble → red
- byte1 high nibble → green
- byte1 low nibble → blue

This matches the encoder MatrixSmith already emits, so encoder correctness is
physically verified: logical colors reach the intended physical channels with
no correction needed.

### Fourth channel — REJECTED

High-nibble-only probes `0x1000`, `0x2000`, `0x4000`, `0x8000` and `0xF000`
were **all observed off**. The byte0 high nibble drives no fourth physical
emitter on this panel, so there is no dedicated white channel either. The
earlier RGBW hypothesis is closed negatively for this profile. `colorModeRaw =
3` remains unexplained and is still never asserted to mean RGBW.

### Color quality — CALIBRATION STILL OPEN

- Logical R/G/B reach the correct physical colors.
- No single channel was judged obviously brighter or dimmer than the others.
- RGB-max white still appears **tinted** rather than neutral.

Calibration remains unresolved and optional. It is deliberately NOT treated as
evidence for a different channel encoding: the channel map above was confirmed
directly, and inventing an alternative encoding to explain a tint would
contradict a measurement with a guess.

### Geometry

4 × 8-column tiling reconstructs the canvas, orientation is correct, and no
seams were observed in this run.

### What this changed in the product

The built-in `iledhat-31ae-32x16` profile now ships these as trusted facts, so
a fresh session recognizes the display, derives `animation-single-frame` as its
static strategy, and routes normal images and text through it without any
protocol probe or guided characterization. See docs/ux-workflows.md.

Two claims are deliberately still **unknown**: `image.rendering` and
`text.rendering`. Their gates open because the substrate they depend on is
verified, but "allowed through verified prerequisites" is not the same
statement as "physically smoke-tested", and the profile does not claim the
latter until someone has looked at a normal image on the panel.
