# LSLED legacy offline reference

This is a software layout proof, not accepted device support. No hardware was
connected or tested. One 44×11 monochrome bank, speed zero / fixed mode (04),
flash and marquee disabled. Input is exactly 484 row-major 0/1 samples; no resize,
crop, luminance threshold, font or effects. RGB ShowFrame accepts only black and
white with equal channels. The final four low bits of each last-group row are
zero. Six 8×11 groups give 66 bitmap bytes, a 64-byte header, 130 program bytes,
14 final zero bytes, and nine sequential 16-byte packets.

## Inspected sources and proof boundary

- [BadgeBLE.md](https://github.com/fossasia/badgemagic-firmware/blob/b2137f083bc24e212fe6281b53b26c1d511cd9b0/BadgeBLE.md): documented header offsets, big-endian group counts, MSB-first rows within eight-column groups, packet order, legacy and F055 distinctions.
- [Firmware README](https://github.com/fossasia/badgemagic-firmware/blob/b2137f083bc24e212fe6281b53b26c1d511cd9b0/README.md): author hardware/batch observations. Those do not identify a user's badge or establish this implementation's hardware compatibility.
- [Original app encoder](https://github.com/fossasia/badgemagic-app/blob/69377e7e97458e541d8bebd58793ad20833dfeb9/lib/others/data_to_bytearray_converter.dart), [converters](https://github.com/fossasia/badgemagic-app/blob/69377e7e97458e541d8bebd58793ad20833dfeb9/lib/others/converters.dart), and [tests](https://github.com/fossasia/badgemagic-app/blob/69377e7e97458e541d8bebd58793ad20833dfeb9/test/data_to_bytearray_converter_test.dart): inspected implemented header construction, getSizes, getOptions, _matrixToHex, eight-column segment ordering, and final chunking.
- Maintained public/knowledge-v1.json provides source-only context, never authority.

The literal fixture is a separately hand-calculated bit-string oracle: authored
coordinate pairs map to six explicitly written 11-byte groups, with a literal
header and padding. Tests compare complete bytes and every individual pixel.
This is not a claim that the whole Flutter encoder was executed. No upstream
code, fonts, glyph fixtures, vendor assets or manuals are redistributed. The app
LICENSE at that revision is Apache-2.0; these independently authored vectors
reuse layout facts only. See THIRD_PARTY_NOTICES.md.

Conflicts are preserved: the app's getTime uses month+1 while the notes say month;
its fillZeros adds a whole block at aligned lengths, unlike the notes' padding
only when necessary. convertBitmapToLEDHex also performs trim/centering and uses
height in padding calculations; that preprocessing is outside this proof.
The newer boolean segment path right-pads rows and confirms segment ordering.
No whole-app equivalence is claimed. This fixed geometry is unaligned, so the
aligned-padding conflict does not affect its nine packets.

Timestamp policy is six zero bytes at 26h–2Bh, independent of clock/timezone.
This is an offline reference choice, not a universal device requirement. The
purpose and interpretation of those fields remain unknown. Timing, persistence,
read/notify responses and acknowledgements remain unestablished. GATT write
response mode in the planned packets is a modeling choice, not proof of protocol
acknowledgement or successful rendering.
