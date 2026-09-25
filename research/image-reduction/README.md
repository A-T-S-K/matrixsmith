# MatrixSmith image-reduction research harness

This directory is an isolated research artifact. It does not participate in the
production browser decoder or UI.

Run the complete deterministic benchmark with:

```sh
python3 research/image-reduction/benchmark.py --generate-fixtures
```

Run one source image with every applicable reducer:

```sh
python3 research/image-reduction/benchmark.py path/to/source.png --target 32x16
```

Results are written to `research/image-reduction/results/` by default. Each run
records the source SHA-256, composition, reducer, palette policy, device
quantization, dithering, runtime, and structural metrics in CSV and JSON.

Only Pillow, NumPy, and SciPy are required. The generated fixture corpus is
programmatic and CC0-equivalent project test data. `portrait_photo.png` and
`landscape_photo.png`, when present, are external public-domain NASA fixtures;
their exact provenance is recorded in `fixtures/PROVENANCE.md`.
