import importlib.util
import sys
import unittest
from pathlib import Path

import numpy as np

MODULE_PATH = Path(__file__).with_name("benchmark.py")
SPEC = importlib.util.spec_from_file_location("matrixsmith_image_benchmark", MODULE_PATH)
benchmark = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = benchmark
SPEC.loader.exec_module(benchmark)


class BenchmarkPrimitivesTest(unittest.TestCase):
    def test_rgb444_is_exact_and_bounded(self):
        values = np.array([[[0.0, 0.5, 1.0], [0.03, 0.97, 0.51]]])
        result = benchmark.quantize_rgb444(values)
        self.assertTrue(np.all(result >= 0) and np.all(result <= 1))
        self.assertTrue(np.allclose(result * 15, np.round(result * 15)))

    def test_linear_round_trip(self):
        rng = np.random.default_rng(3)
        source = rng.random((8, 9, 3))
        self.assertTrue(np.allclose(source, benchmark.linear_to_srgb(benchmark.srgb_to_linear(source)), atol=1e-7))

    def test_palette_region_is_deterministic(self):
        source = np.zeros((32, 64, 3))
        source[:, :20] = (0.8, 0.8, 0.8)
        source[8:24, 25:39] = (1.0, 0.3, 0.0)
        context = benchmark.Context(3, False, "artwork")
        first = benchmark.palette_region(source, 32, 16, context)
        second = benchmark.palette_region(source, 32, 16, context)
        self.assertTrue(np.array_equal(first, second))
        self.assertEqual(first.shape, (16, 32, 3))

    def test_small_low_palette_source_classifies_as_pixel_art(self):
        source = np.zeros((12, 16, 3))
        source[2:10, 4:12] = (1, 0, 0)
        self.assertEqual(benchmark.classification_signals(source, 32, 16)["predicted"], "pixel-art")

    def test_topology_metric_detects_component_loss(self):
        reference = np.zeros((16, 32, 3)); output = reference.copy()
        reference[3:6, 3:6] = 1; reference[10:13, 25:28] = 1
        output[3:6, 3:6] = 1
        self.assertLess(benchmark.metric_bundle(reference, output, False)["topology_score"], 1.0)


if __name__ == "__main__":
    unittest.main()
