# Research index

- [protocol-findings.md](protocol-findings.md) — verified CoolLEDUX identity, rejected CoolLEDX hypothesis, hardware vectors, and unknowns
- [coolledx-sources.md](coolledx-sources.md) — pinned source provenance and independent implementation statement
- [coolledux-sources.md](coolledux-sources.md) — pinned CoolLEDUX source, MIT license, and evidence boundaries
- [advertisement.md](advertisement.md) — byte-level decode of the iLedHat advertisement
- [apk-analysis.md](apk-analysis.md) — vendor-family APK evidence without overclaiming FFF0/F1 provenance
- [sources.md](sources.md) — bibliography and search record

Status on 2026-08-31: the observed iLedHat is hardware-verified as CoolLEDUX. Device-info `0x1F` and brightness `0x04` are verified live capabilities; CoolLEDX remains an independent older driver and no longer owns this profile.

Status on 2026-09-01: the exact 32×16 iLedHat is physically characterized end to end. Graffiti static playback is **rejected** (both justified configurations move); one-frame Animation is the **verified preferred static strategy**; literal `0x0000` is **true black** here, so the inherited `0x0004` workaround does not apply; RGB444 channel mapping is **physically confirmed** and the fourth/white channel is **rejected**. Colour calibration remains open. See the 2026-09-01 section of [protocol-findings.md](protocol-findings.md).
