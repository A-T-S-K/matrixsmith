# Tiny authored GIF fixture

`partial-disposal.gif` is an original, manually assembled 142-byte GIF89a,
4×2 logical pixels, with palette 0 transparent/black, 1 red, 2 green, 3 blue.
No external image or production decoder/generator dependency is used. Each
image uses GIF minimum code size 2 and literal three-bit LZW codes: clear (4),
pixel index, repeated for each pixel, then end (5), packed least-significant
bit first. This deliberately avoids a fixture generator library.

The NETSCAPE2.0 extension declares one repetition after the first play.
Complete expected row-major frames (`K` is transparent, composited over black):

| Frame | Encoded image rectangle | Disposal               | Delay  | Complete pixels |
| ----- | ----------------------- | ---------------------- | ------ | --------------- |
| 0     | (0,0), 4×2: RRRR/RRRK   | retain (1)             | 100 ms | RRRR/RRRK       |
| 1     | (0,0), 1×1: G           | restore previous (3)   | 200 ms | GRRR/RRRK       |
| 2     | (1,0), 1×1: B           | restore background (2) | 300 ms | RBRR/RRRK       |
| 3     | (2,0), 1×1: transparent | retain (1)             | 400 ms | RKRR/RRRK       |

The same fixture is also decoded with NETSCAPE repetition byte 41 changed to
zero, proving the browser exposes infinite repetition without a finite-loop warning.

The Chromium test checks every RGB pixel at 4×2 using the real browser codec,
then the normal Create file picker decodes at the resolved 32×16 geometry,
previews, plans and sends the tiled animation. Finite repetition is reported
and warned about; it is not emulated in the raster program. This fixture and
simulator journey establish software behavior only, not hardware acceptance.
