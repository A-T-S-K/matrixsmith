# Image reduction for very small LED matrices

Research pass dated 2026-09-01. Target: the physically characterized 32×16
iLedHat (512 RGB LEDs, RGB444-like channel behavior, true black, no fourth/white
channel, preferred still transport: one-frame Animation).

## Executive conclusion

There is no trustworthy universal “best resize” at 32×16. The best tested
architecture is a deterministic, content-routed hybrid:

- **Artwork/logo:** chroma-protected semantic palette → explicit composition →
  color-region signed distance fields → bounded destination-grid search → hard
  semantic-color rasterization → RGB444.
- **Photo:** explicit contain/cover/user crop → linear-light area reduction →
  mild destination-scale edge enhancement → RGB444; dithering off by default.
- **Pixel art:** recover/retain the native pixel grid and use nearest-neighbor,
  preferably at an integer scale; never smooth by default.
- **Text:** render original text/vector data with a real hinted font rasterizer
  when available. Raster-only text is an artwork/line fallback with a warning;
  automatic tracing cannot recover the original hinting intent.

For the exact supplied AT&S/K logo, the best human-ranked result was a hybrid
that widened the near-square source by at most 1.35× before signed-distance
grid fitting. It used exactly three destination colors and kept the hexagon and
three arrows recognizable. Strict contain preserved identity but spent only
about 16×16 of the 32×16 panel. Full stretch was clearer but distorted the
hexagon too far. Composition is therefore as important as rasterization.

This pass does **not** change the production decoder or Create UI.

## Exact primary fixture and an important correction

The primary source is the user-supplied
`research/image-reduction/fixtures/atsk-logo.png`, copied byte-for-byte from
`/Users/joshuahansen/dev/atsk-site/out/atsk-logo.png`:

- 512×497 RGBA PNG
- SHA-256 `0efa6c6376e83345dd036917bb398f9564d45b7bcadb325294f08d133b10666c`
- transparent background (composited over device true black in the harness)
- light gray hexagon and side arrows
- orange center arrow

An early proxy remains as a supplemental stress fixture, not as evidence about
the real logo. An experimental fairness error was also found and corrected:
the first mask/SDF run stretched regions to 32×16 while conventional reducers
used contain. Those results were discarded. Every rasterization comparison in
the final benchmark uses its recorded composition policy.

## Existing production baseline

`src/render/image.ts` currently decodes in the browser, computes contain/cover/
stretch/center placement, calls Canvas `drawImage` directly at the destination
size with high-quality smoothing, and reads the 32×16 pixels. This is a sound
general thumbnail operation, but it optimizes sample reconstruction rather than
the discrete design decisions a 512-LED display requires. On flat artwork it
creates transition shades, weakens one-pixel structures, and lets sampling phase
decide whether stems/corners survive.

## Experimental method

The isolated harness is `research/image-reduction/benchmark.py`. It requires
only Pillow, NumPy, and SciPy and does not import production code. A full run is:

```sh
python3 research/image-reduction/benchmark.py --generate-fixtures
python3 -m unittest research/image-reduction/test_benchmark.py
```

The final run contains 19 fixtures, 294 candidate/fixture rows, a source hash
per row, exact preprocessing metadata, runtime, unique-color count, structural
metrics, and selected manual ranks. The corpus covers the requested flat logo,
thin line, curve, text, pixel art, portrait, landscape, high-frequency photo,
gradient, transparency, black/white polarity, cartoon, asymmetric logo, and a
source smaller than the target. External fixture provenance is recorded in
`research/image-reduction/fixtures/PROVENANCE.md`.

Each required contact sheet shows:

1. exact logical 32×16 pixels enlarged with nearest-neighbor;
2. simulated circular LEDs with a small point-spread/glow;
3. an apparent-size 32×16 preview.

The benchmark uses an area-reduced linear-light image as a *measurement
reference*, not as ground truth. This intentionally makes SSIM favor
linear-area. Human ranking is based on recognizability, source faithfulness,
cleanliness, hierarchy, and apparent-size usability. Candidate labels are also
written to sidecar JSON so a future human study can hide method names.

## Candidate families tested

| Family | Concrete candidates | Result at 32×16 |
|---|---|---|
| Conventional sampling | nearest, bilinear, bicubic, Lanczos, box/area | Necessary baselines. Area/bicubic remain good photo primitives; none is a sufficient artwork reducer. |
| Correct color processing | sRGB filtering, linear-light filtering, RGB444 before vs after | Linear-light area is the defensible photo base. Quantize after reduction. |
| Palette optimization | deterministic OKLab clustering, chroma-reserved semantic palette | Useful for flat artwork only after protecting small saturated brand colors. Ordinary area-weighted clustering discarded the orange arrow. |
| Region coverage | area-downsampled semantic masks, winning region per LED | Clean and fast (~17 ms on the supplied logo), but can break corners/thin paths and is not the final answer. |
| Implicit/vector-like reconstruction | SDF region reconstruction, contour extraction, marching squares, RDP polygon simplification, supersampled rerasterization | SDF + grid fitting materially helped the logo. Contour/vector rerasterization ranked sixth: automatic tracing plus antialias coverage recreated gray ramps and did not beat SDF. |
| Font-like grid fitting | subpixel translation/scale search, minimum represented component, symmetry term, hard semantic colors | The strongest artwork idea. It is analogous to hinting, but inferred hints are less reliable than author-provided font hints. |
| Direct framebuffer optimization | deterministic coordinate descent over palette labels with color, edge, isolation, fragmentation, and symmetry terms | Computationally practical (~471 ms capped) but visually unsafe: it found high-metric false-orange/topology solutions. Reject current objective. |
| Edge-aware abstraction | linear-area plus OKLab-lightness unsharp mask | Best portrait rank and best thin-icon rank; modest, cheap, and traceable. Aggressive cartoon abstraction was not justified. |
| Dithering | none, Floyd–Steinberg, Jarvis/JJN, Bayer, deterministic blue-noise-like mask, edge-excluded FS | Mostly harmful at 512 individually visible RGB444 LEDs. Keep off except an explicit photo/gradient experiment. |
| Composition | contain, center cover, foreground trim, gradient-saliency cover, seam carving, full stretch, 1.35× bounded stretch | Must be a separate stage. Bounded stretch helped the exact logo; simple saliency and seam carving failed semantically. |
| Pixel-art handling | nearest versus smooth filters | Nearest/linear-area tied only because the fixture aligned favorably; nearest alone preserves authored blocks and palette by policy. |

Not promoted to serious runtime candidates:

- learned/generative vectorization, diffusion, and semantic reconstruction can
  silently change branding and violate source traceability;
- LPIPS and large neural saliency models add dependencies and have doubtful
  validity at 32×16;
- superpixel pipelines and general image abstraction are designed for much
  larger outputs; at 512 pixels their boundary budget collapses to essentially
  the same discrete region problem;
- differentiable vector fitting is scientifically relevant but substantially
  more compute/dependency complexity than the measured SDF benefit warrants;
- HQx/xBR/Scale2x/MMPX and depixelization methods primarily magnify already
  authored pixel art; they do not solve ordinary-image reduction.

## Quantitative results

The complete table is `research/image-reduction/results/benchmark.csv` (and
JSON). Selected final-run rows follow. Ranks are human ranks within the named
fixture, not a global score.

| Method | Content | Composition | Colors | SSIM | Edge F1 | Topology score | Human rank | Runtime | Notes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| SDF controlled | supplied logo | max 1.35× + grid fit | 3 | 0.427 | 0.799 | 0.077 | 1 | 283 ms | Best visual result; low metric because composition intentionally differs from contain reference. |
| SDF grid fit | supplied logo | contain | 3 | 0.797 | 0.885 | 0.083 | 2 | 268 ms | Best strict-composition artwork result. |
| Controlled area | supplied logo | max 1.35× | 32 | 0.427 | 0.766 | 1.000 | 3 | ~8 ms | Good composition, still too many transition shades. |
| Palette region | supplied logo | contain | 3 | 0.733 | 0.849 | 0.063 | 4 | 17 ms | Fast fallback; more fragmented by simple component metric. |
| Edge enhanced | supplied logo | contain | 34 | 0.996 | 0.989 | 1.000 | 5 | ~9 ms | Metrics love it; human view still sees gray ramps. |
| Framebuffer optimize | supplied logo | contain | 3 | 0.945 | 0.950 | 0.250 | 15 | 471 ms | Excellent-looking metrics, visibly wrong false-orange geometry. |
| Edge enhanced | thin icon | contain | 26 | 0.995 | 0.993 | 1.000 | 1 | ~1.3 ms | Best line continuity. |
| Nearest | pixel art | contain | 5 | 1.000 | 0.963 | 1.000 | 1 | ~0.1 ms | Exact authored palette/blocks. |
| Edge enhanced | portrait | contain | 74 | 0.973 | 0.972 | 1.000 | 1 | ~2.1 ms | Best facial feature visibility. |
| Linear area | portrait | contain | 70 | 0.977 | 0.955 | 1.000 | 4 | ~1.9 ms | Best simple/default photo primitive. |
| Floyd–Steinberg | portrait | contain | 87 | 0.954 | 0.976 | 1.000 | 8 | ~6.4 ms | More edge energy, more visible noise. |
| OKLab palette | portrait | contain | 8 | 0.932 | 0.954 | 1.000 | 12 | ~4.1 ms | Posterization removed identity cues. |

The simple source classifier was correct on 12/19 corpus labels (63%). It
systematically called thin-line and text fixtures “artwork,” called the cartoon
“artwork,” and called the grass texture “line/text.” Those confusions are
understandable statistically but matter because the wrong reducer can be
destructive. Deterministic statistics are good confidence signals, not a safe
single-label oracle.

### Metrics versus human judgment

The supplied-logo framebuffer optimizer is the decisive counterexample: SSIM
0.945 and edge F1 0.950, yet human rank 15 because orange spread into gray
structure and topology changed. Conversely the winning controlled SDF result
has SSIM 0.427 because it intentionally uses a different composition from the
strict-contain reference.

Useful metrics:

- unique colors and isolated pixels catch mush/speckles;
- edge overlap and chamfer expose missing boundaries;
- connected components/holes expose some topology failures;
- symmetry catches phase drift on symmetric artwork;
- OKLab error is more meaningful than RGB Euclidean distance.

Insufficient alone:

- SSIM/MS-SSIM reward the same blur as the measurement reference;
- component counts do not know *which* component is important and can be
  unstable under color/foreground thresholds;
- edge energy can be increased by false edges;
- Hausdorff is dominated by one outlier;
- palette size rewards a clean but semantically wrong palette.

Future metrics should operate per semantic region with source-to-output
correspondence and explicitly weight the orange center region, outer ring, and
individual arrow skeletons. Metrics remain guards and ranking aids, not the
optimization target.

## Exact logo acceptance assessment

Assessment of human-rank-1 `sdf-controlled`:

| Criterion | Result | Observation |
|---|---|---|
| Outer hexagon recognizable | Pass | Six-sided enclosure remains readable at LED and apparent size. |
| Approximately symmetric | Pass with minor grid error | Mirrored mismatch is 3.5% of channel samples; the source itself has subpixel antialias asymmetry. |
| Top/bottom corners survive | Pass | Both extremes are present; corner steps are intentionally optical rather than geometrically exact. |
| Left/right arrows distinct | Pass | Separate stems and heads remain. |
| Center orange dominant | Pass | Orange is protected during palette fitting and occupies the central hierarchy. |
| Arrow stems connected | Pass | All three are continuous. |
| Arrowheads recognizable | Pass | Each head is wider than its stem; the side heads are necessarily minimal. |
| Three arrows separable | Pass | Black gaps separate the three regions. |
| Center arrow centered | Pass | Paired grid-fit search keeps it centered. |
| Gray border avoids random shades | Pass | One device-realizable gray, not a ramp. |
| Orange contamination | Pass | Orange is confined to the center-arrow region in the winning result. |
| Black remains black | Pass | Transparent source is composited to exact zero; output background is zero. |
| False-color speckles | Pass | No off-palette colors; four “isolated” foreground detections are intentional one-pixel corner/head decisions, not false colors. |
| Accidental merged structures | Pass | Stems/heads remain separated from each other and mostly from the enclosure. |
| Important disconnected structures | Pass visually | The simple global topology score is pessimistic because it compares thresholded components without semantic identity. |

This is strong evidence for the representation, not permission to ship it. A
larger real-logo set and blinded human study are still required.

## Composition findings

Composition must be decided before rasterization and exposed separately.

- **Contain:** safest identity policy; poor use of a 2:1 panel for the nearly
  square supplied logo.
- **Center cover:** discarded most of the hexagon and failed the logo.
- **Foreground trim:** removes empty borders but cannot solve a real aspect
  mismatch by itself.
- **Simple gradient saliency:** on the uncropped astronaut selected the
  high-energy suit/badge rather than the face. It is not an object crop.
- **Seam carving:** preserved local gradient energy while bending or expanding
  identity-critical structures. Reject for logos; do not default it for photos.
- **Full nonuniform stretch (~2× here):** recognizable but identity-changing.
- **Bounded 1.35× optical stretch:** materially improved actual-size logo
  recognition while leaving black margins. Useful as an opt-in/previewed
  composition choice, never a silent universal transformation.

A trustworthy Auto mode may propose a crop/distortion with a visible before/
after preview, but users must be able to choose contain, cover, focal crop, and
distortion amount directly.

## Color and dithering findings

Reduction should happen in linear light for photo averaging. Perceptual
distances/palette fitting should use OKLab (or a future calibrated device
appearance space). Mapping source to RGB444 **before** reduction had greater
mean OKLab error than mapping after reduction on 14 of 19 fixtures. The mean
difference was small (~0.00047 in the harness scale), but there was no quality
case for destroying source precision early.

For artwork, device-realizable semantic colors should participate during region
selection so optimization cannot choose unreachable colors, followed by one
final exact RGB444 mapping. A calibrated display transfer model should later
wrap both preview and distance calculations. The unsolved tinted-white response
does not block the architecture.

RGB444 already offers up to 4096 colors—far more amplitude resolution than a
binary halftone device. Across the three real photo fixtures, no-dither linear
area averaged SSIM 0.965 and edge F1 0.973. Floyd–Steinberg averaged 0.949/
0.984: slightly stronger measured edges, lower structural similarity, and
visible LED-scale noise. Jarvis/JJN softened the noise but did not improve human
recognition. Bayer and the blue-noise-like mask were worse and individually
resolvable. Edge-excluded error diffusion ranked above unrestricted dithers on
the portrait but below no-dither/edge-enhanced output.

Default: **no dithering**. Offer photo-only structure-aware dithering as an
Advanced preview when a future calibrated display has materially fewer useful
levels than nominal RGB444. Forbid dithering in logo, line, text, and detected
pixel-art routes.

## Answers to the research questions

1. **Is conventional downsampling ever right?** Yes: linear-area/bicubic is the
   correct base for photos and gradients. It is not the artwork default.
2. **Is palette-first region reduction better for flat art?** Usually cleaner,
   but only if small saturated colors are protected. It remains weaker than the
   SDF/grid-fit hybrid on the supplied logo.
3. **Does vectorization beat region reduction?** The tested automatic contour
   reconstruction did not. It ranked sixth and recreated coverage shades.
   Implicit SDF reconstruction plus grid fitting did beat plain region voting.
4. **Does font-style grid fitting help?** Yes for logo topology, stems, symmetry,
   and corners. Inferred hints are fallible; real text should use real hints.
5. **Is direct framebuffer optimization practical?** Runtime is plausible (471
   ms in capped Python), but the tested objective is not trustworthy. It must be
   constrained by semantic correspondences before reconsideration.
6. **Does saliency crop improve photos?** Not reliably with cheap gradient
   saliency; it selected the wrong astronaut region. Object/face saliency can be
   an optional local enhancement, not the deterministic default.
7. **When does dithering help?** Only potentially on smooth photo/gradient
   regions when the physical device has fewer effective levels. It did not help
   the RGB444 portrait and must be forbidden on structure-dominant content.
8. **Different reducers by content?** Yes—artwork, photo, and pixel art need
   fundamentally different loss functions and representations.
9. **Can cheap classification choose reliably?** Not alone (12/19). Use
   confidence-weighted signals and safe fallback, plus user override.
10. **When RGB444?** After linear reduction for photos; during semantic
    candidate selection and again exactly at output for artwork; never blindly
    before reduction.
11. **Controlled aspect distortion?** 1.35× helped the supplied logo; full 2×
    stretch was too much. Preview and manual control are mandatory.
12. **Trustworthy Auto?** Yes as a conservative router with confidence,
    non-destructive preview, and no hallucination. Low confidence falls back to
    photo-safe linear area or asks the user to choose Artwork/Photo/Pixel Art.
13. **Default algorithm?** Default *architecture*, not one filter: confident
    artwork → SDF grid fit; confident pixel art → nearest; otherwise linear-area
    photo-safe reduction, no dithering, RGB444 at the end.
14. **What remains Advanced/manual?** focal crop, contain/cover, optical stretch,
    palette size/locking, semantic color pinning, threshold/minimum feature
    width, edge enhancement, dithering, and device calibration profile.

## Top three production candidates

### 1. Artwork: semantic SDF + grid fitting

Why it works: it converts color regions into continuous boundary-distance
evidence, protects chromatic accents, evaluates a few grid phases/scales, forces
meaningful small components to be represented, and emits hard semantic colors.

Failures: segmentation can choose the wrong regions; a 1-pixel source feature
may be impossible to preserve without collision; automatic topology metrics are
crude; text hinting cannot be reconstructed; strict contain may waste the panel.

Complexity: medium-high. Current capped Python runtime is ~268 ms strict contain
and ~283 ms with controlled aspect on the exact logo. A typed-array/Web Worker
implementation with bounded working masks should be interactive after debounce.

Generalization: strong for logos/icons/flat cartoons with 2–8 regions; poor for
photos and noisy screenshots.

### 2. Photo: linear-area + mild edge preservation

Why it works: correct linear-light averaging preserves energy; a small
destination-scale lightness enhancement restores features lost to the point
spread without inventing semantic objects. It ranked first on the portrait and
thin-line representative.

Failures: can halo high-contrast edges, cannot choose the right crop, retains
many RGB444 colors, and does not rescue impossible tiny text.

Complexity: low. Approximately 1–9 ms in Python across ordinary fixtures.

Generalization: strong for photos, gradients, screenshots, and uncertain/mixed
inputs. This is the safest low-confidence fallback.

### 3. Pixel art: native-grid nearest

Why it works: authored pixels already encode the human pixel artist’s choices.
Nearest preserves palette, connectivity, and hard edges exactly.

Failures: requires reliable grid/scale detection; non-integral composition can
create uneven block widths; “pixel-art-looking” antialiased images may need a
separate grid recovery pass.

Complexity: very low (~0.1 ms here).

Generalization: excellent for genuine sprites and low-resolution icons; wrong
for photos and high-resolution vector-like art.

## Recommended MatrixSmith architecture

```text
decode RGBA + metadata
        │
        ├─ composition model
        │    contain / cover / focal crop / foreground trim / bounded distortion
        │
        ├─ deterministic signals + confidence
        │    palette entropy, chroma mass, edge/gradient density, alpha,
        │    block/grid evidence, source size, connected regions
        │
        ├─ reducer route
        │    Artwork ─ semantic palette → SDF/grid fit
        │    Photo ─── linear area → optional edge preservation
        │    Pixel ─── native grid → nearest
        │    Mixed ─── photo-safe base; optional protected artwork regions later
        │
        ├─ device appearance/mapping
        │    calibrated transfer when known → RGB444 → true black policy
        │
        └─ three previews
             logical grid / simulated LED / apparent size
```

**Auto** should expose what it inferred (“Artwork, high confidence”) and the
composition it chose. It must not hide a crop or distortion. Low-confidence
Auto uses the photo-safe reducer and offers one-click Artwork/Pixel Art modes.

**Artwork** exposes palette locks, minimum feature width, symmetry hint, region
importance, and optional bounded distortion. **Photo** exposes crop/focal point,
edge strength, and normally-disabled dithering. **Pixel Art** exposes native
grid, integer scaling, and alignment. All modes share exact logical/LED/
apparent-size previews and device calibration.

## Production implementation plan (next coding pass; not implemented here)

1. Freeze a reviewed corpus manifest, add more real logos/fonts/screenshots, and
   replace synthetic fixtures where licensing permits.
2. Convert the research runner contract into TypeScript pure interfaces:
   decoded RGBA, composition transform, reducer metadata, device model, metrics.
3. Implement linear-light box reduction and RGB444 mapping first; add golden
   vectors against the Python harness.
4. Implement deterministic source signals and confidence without routing yet;
   measure confusion on the expanded corpus.
5. Implement the Artwork reducer in a Web Worker with a 256-pixel working cap,
   chroma-protected palette, SDF masks, bounded grid phases, and strict
   no-cross-region color constraints.
6. Replace the current direct-optimizer experiment with either constrained
   region-boundary edits or omit it. Do not optimize an unconstrained weighted
   metric sum.
7. Add composition as an independent immutable transform. Include explicit
   contain, cover/focal crop, foreground trim, and previewed max-1.35× optical
   distortion.
8. Add Pixel Art route with grid/block detection, integer scale/alignment, and
   an explicit manual override.
9. Add the three preview renderers and run blinded human comparisons on real
   hardware at multiple viewing distances.
10. Calibrate RGB transfer/white tint later through a `DisplayModel`; keep the
    reducer API device-aware now so calibration does not require a rewrite.
11. Define acceptance gates per content type (semantic palette preservation,
    component correspondence, isolated pixels, runtime, and human preference).
12. Only after those gates pass, replace `decodeImageFile` behind a feature flag
    and then design Create UI controls. Preserve the legacy reducer as a
    selectable baseline during rollout.

## Sources reviewed

Primary/authoritative sources that materially influenced the experiment:

- Microsoft, [TrueType hinting](https://learn.microsoft.com/en-us/typography/truetype/hinting) and [fixing low-resolution rasterization](https://learn.microsoft.com/en-us/typography/truetype/fixing-rasterization-issues): grid fitting preserves regular distances, weight, alignment, symmetry, and local appearance.
- Apple, [Instructing Fonts](https://developer.apple.com/fonts/TrueType-Reference-Manual/RM03/Chap3.html): control key dimensions, white space, stems, diagonals, and dropout behavior.
- Chen and Peng, [Topology-Preserving Downsampling of Binary Images](https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/03067.pdf): discrete optimization can guarantee Betti-number topology, but exact guarantees are a harder global problem than local thresholding.
- Selinger, [Potrace: a polygon-based tracing algorithm](https://potrace.sourceforge.net/potrace.pdf): bitmap tracing is non-unique; efficient polygon/curve recovery is useful but cannot infer author intent perfectly.
- Inglis and Kaplan, [Pixelating Vector Line Art](https://src.acm.org/binaries/content/assets/src/2012/tiffany-inglis.pdf): low-resolution vector rasterization benefits from optimization of symmetry, sharp angles, and path properties.
- Kopf et al., [Content-Adaptive Image Downscaling](https://johanneskopf.de/publications/downscaling/paper/downscaling.pdf): line connectivity and palette-aware pixel-art reduction can outperform fixed filters.
- Avidan and Shamir, [Seam Carving](https://cs.brown.edu/courses/cs016/static/files/docs/seamcarving_original_paper.pdf), and Rubinstein et al., [RetargetMe](https://people.csail.mit.edu/mrub/retargetme/): composition is distinct from scaling, and common computational distances do not reliably predict human retargeting preference.
- Trentacoste, Mantiuk, and Heidrich, [Blur-Aware Image Downsampling](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-8659.2011.01894.x): apparent blur changes with scale; viewing-size evaluation matters.
- Winnemöller, Olsen, and Gooch, [Real-Time Video Abstraction](https://cs.colby.edu/courses/S19/cs365/papers/winnemoller-videoAbstraction-SIG06.pdf): suppress low-contrast detail and enhance perceptually important edges, but do not assume larger-output abstraction survives at 32×16.
- ImageMagick, [linear-light resize guidance](https://usage.imagemagick.org/resize/): linear operators should not blindly average nonlinear sRGB values.
- Ottosson, [Oklab](https://bottosson.github.io/posts/oklab/): a practical perceptual space for color distances and clustering.
- Wang et al., [Structural Similarity](https://eceweb.uwaterloo.ca/~z70wang/publications/ssim.html): structure-aware image metric used here with explicit limitations.
- Ulichney, [Dithering with Blue Noise](https://cv.ulichney.com/papers/1988-blue-noise.pdf), and [halftoning review](https://cv.ulichney.com/papers/2000-halftoning-review.pdf): error spectra matter, but the display assumptions differ sharply from individually visible RGB444 LEDs.
- [libimagequant](https://pngquant.org/lib/): mature palette optimization/remapping reference; its licensing and PNG-oriented objective require care before reuse.
- Li et al., [Differentiable Vector Graphics Rasterization](https://people.csail.mit.edu/tzumao/diffvg/diffvg.pdf): demonstrates image-space vector fitting; rejected here as premature complexity.
- Green/Valve, [signed distance fields for vector textures](https://cdn.fastly.steamstatic.com/apps/valve/2007/SIGGRAPH2007_AlphaTestedMagnification.pdf): motivated continuous boundary evidence, though MatrixSmith uses it for discrete down-grid decisions rather than magnification.
- scikit-image, [data fixture documentation](https://scikit-image.org/docs/stable/api/skimage.data), plus [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/): photo purpose/provenance.

## Delivered artifacts

- harness and primitives: `research/image-reduction/benchmark.py`
- tests: `research/image-reduction/test_benchmark.py`
- corpus and provenance: `research/image-reduction/fixtures/`
- complete benchmark: `research/image-reduction/results/benchmark.csv` and `.json`
- classification study: `research/image-reduction/results/classification.csv` and `.json`
- required contact sheets: supplied logo, thin icon, pixel-art sprite, and real
  portrait in `research/image-reduction/results/contact-sheet-*.png`
- anonymous label keys: adjacent `*.labels.json`

The evidence supports a hybrid architecture, but it also shows why the next pass
must begin with more blinded human evaluation rather than immediately replacing
the production decoder.
