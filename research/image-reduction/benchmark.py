#!/usr/bin/env python3
"""Deterministic low-resolution LED raster research harness.

This intentionally lives outside MatrixSmith's production TypeScript.  It is a
comparison laboratory: composition, reduction, quantization, metrics, and
visualization are explicit and independently recorded.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterable

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"
DEFAULT_RESULTS = ROOT / "results"
BLACK = np.array([0.0, 0.0, 0.0])


@dataclass(frozen=True)
class Fixture:
    path: Path
    content_type: str
    palette_size: int
    symmetric: bool = False
    primary: bool = False


@dataclass(frozen=True)
class Method:
    name: str
    content_types: tuple[str, ...]
    composition: str
    palette: str
    color_space: str
    quantization: str
    dithering: str
    reducer: Callable[[np.ndarray, int, int, "Context"], np.ndarray]


@dataclass(frozen=True)
class Context:
    palette_size: int
    symmetric: bool
    content_type: str


@dataclass
class Record:
    fixture: str
    source_sha256: str
    content_type: str
    method: str
    crop_strategy: str
    palette: str
    color_space: str
    device_quantization: str
    dithering: str
    unique_colors: int
    ssim: float
    oklab_delta: float
    edge_f1: float
    chamfer: float
    hausdorff: float
    silhouette_iou: float
    topology_score: float
    symmetry_error: float
    isolated_pixels: int
    edge_energy_ratio: float
    runtime_ms: float
    human_rank: int | None
    human_notes: str
    output: str


def srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    rgb = np.clip(rgb, 0.0, 1.0)
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(rgb: np.ndarray) -> np.ndarray:
    rgb = np.clip(rgb, 0.0, 1.0)
    return np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * rgb ** (1 / 2.4) - 0.055)


def linear_rgb_to_oklab(rgb: np.ndarray) -> np.ndarray:
    l = 0.4122214708 * rgb[..., 0] + 0.5363325363 * rgb[..., 1] + 0.0514459929 * rgb[..., 2]
    m = 0.2119034982 * rgb[..., 0] + 0.6806995451 * rgb[..., 1] + 0.1073969566 * rgb[..., 2]
    s = 0.0883024619 * rgb[..., 0] + 0.2817188376 * rgb[..., 1] + 0.6299787005 * rgb[..., 2]
    l_, m_, s_ = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    return np.stack((
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    ), axis=-1)


def srgb_to_oklab(rgb: np.ndarray) -> np.ndarray:
    return linear_rgb_to_oklab(srgb_to_linear(rgb))


def image_to_array(image: Image.Image) -> np.ndarray:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float64) / 255.0
    alpha = rgba[..., 3:4]
    return rgba[..., :3] * alpha


def array_to_image(rgb: np.ndarray) -> Image.Image:
    return Image.fromarray(np.uint8(np.clip(rgb, 0, 1) * 255 + 0.5))


def resize_rgb(rgb: np.ndarray, width: int, height: int, resample: int, linear: bool = False) -> np.ndarray:
    work = srgb_to_linear(rgb) if linear else rgb
    channels = []
    for channel in range(3):
        plane = Image.fromarray(np.float32(work[..., channel]))
        channels.append(np.asarray(plane.resize((width, height), resample=resample), dtype=np.float64))
    result = np.stack(channels, axis=-1)
    return linear_to_srgb(result) if linear else np.clip(result, 0, 1)


def contain(rgb: np.ndarray, width: int, height: int, resample: int = Image.Resampling.LANCZOS, linear: bool = False) -> np.ndarray:
    sh, sw = rgb.shape[:2]
    scale = min(width / sw, height / sh)
    dw, dh = max(1, round(sw * scale)), max(1, round(sh * scale))
    out = np.zeros((height, width, 3), dtype=np.float64)
    small = resize_rgb(rgb, dw, dh, resample, linear)
    x, y = (width - dw) // 2, (height - dh) // 2
    out[y:y + dh, x:x + dw] = small
    return out


def cover_crop(rgb: np.ndarray, width: int, height: int, crop: str = "center") -> np.ndarray:
    sh, sw = rgb.shape[:2]
    target_aspect = width / height
    if sw / sh > target_aspect:
        cw, ch = round(sh * target_aspect), sh
    else:
        cw, ch = sw, round(sw / target_aspect)
    if crop == "saliency":
        gray = srgb_to_oklab(rgb)[..., 0]
        energy = np.hypot(ndimage.sobel(gray, 0), ndimage.sobel(gray, 1))
        energy += 0.35 * ndimage.gaussian_filter(np.std(rgb, axis=-1), max(1, min(sw, sh) / 80))
        if cw < sw:
            scores = ndimage.uniform_filter(energy, size=(ch, cw), mode="constant")
            cy, cx = np.unravel_index(np.argmax(scores), scores.shape)
            x0 = int(np.clip(cx - cw // 2, 0, sw - cw)); y0 = 0
        else:
            scores = ndimage.uniform_filter(energy, size=(ch, cw), mode="constant")
            cy, cx = np.unravel_index(np.argmax(scores), scores.shape)
            x0 = 0; y0 = int(np.clip(cy - ch // 2, 0, sh - ch))
    else:
        x0, y0 = (sw - cw) // 2, (sh - ch) // 2
    return rgb[y0:y0 + ch, x0:x0 + cw]


def compose(rgb: np.ndarray, width: int, height: int, strategy: str, resample: int = Image.Resampling.LANCZOS, linear: bool = False) -> np.ndarray:
    if strategy == "contain":
        return contain(rgb, width, height, resample, linear)
    if strategy == "stretch":
        return resize_rgb(rgb, width, height, resample, linear)
    crop = cover_crop(rgb, width, height, "saliency" if strategy == "saliency-cover" else "center")
    return resize_rgb(crop, width, height, resample, linear)


def contain_source_canvas(rgb: np.ndarray, target_width: int, target_height: int) -> np.ndarray:
    """Letterbox at source resolution so mask reducers share contain geometry."""
    h,w=rgb.shape[:2]; aspect=target_width/target_height
    if w/h < aspect:
        canvas=np.zeros((h,max(w,round(h*aspect)),3),dtype=rgb.dtype); x=(canvas.shape[1]-w)//2; canvas[:,x:x+w]=rgb
    else:
        canvas=np.zeros((max(h,round(w/aspect)),w,3),dtype=rgb.dtype); y=(canvas.shape[0]-h)//2; canvas[y:y+h]=rgb
    return canvas


def controlled_source_canvas(rgb: np.ndarray, target_width: int, target_height: int, max_stretch: float = 1.35) -> np.ndarray:
    h,w=rgb.shape[:2]; aspect=target_width/target_height; canvas_w=max(w,round(h*aspect)); canvas_h=max(h,round(w/aspect))
    scale=min(canvas_w/w,canvas_h/h); base_w=max(1,round(w*scale));base_h=max(1,round(h*scale));desired=canvas_w/base_w
    dw=min(canvas_w,max(1,round(base_w*min(max_stretch,desired))))
    small=resize_rgb(rgb,dw,base_h,Image.Resampling.BOX,False);canvas=np.zeros((canvas_h,canvas_w,3),dtype=rgb.dtype);x=(canvas_w-dw)//2;y=(canvas_h-base_h)//2;canvas[y:y+base_h,x:x+dw]=small
    return canvas


def quantize_rgb444(rgb: np.ndarray) -> np.ndarray:
    return np.round(np.clip(rgb, 0, 1) * 15) / 15


def weighted_kmeans_oklab(rgb: np.ndarray, k: int, iterations: int = 20) -> tuple[np.ndarray, np.ndarray]:
    pixels = rgb.reshape(-1, 3)
    lab = srgb_to_oklab(pixels)
    # Deterministic stratified sample and farthest-point initialization.
    stride = max(1, len(pixels) // 8192)
    sample_rgb, sample = pixels[::stride], lab[::stride]
    chroma = np.linalg.norm(sample[:, 1:], axis=1)
    first = int(np.argmin(sample[:, 0] + chroma * 0.2))
    centers = [sample[first]]
    # Saturated brand accents can be small in area but dominant perceptually.
    # Reserve a chromatic seed before ordinary farthest-point seeding so an
    # orange arrow is not spent on a second antialiased gray cluster.
    protected_chroma_index = None
    if k >= 3 and float(np.max(chroma)) > 0.045:
        centers.append(sample[int(np.argmax(chroma))])
        protected_chroma_index = 1
    for _ in range(1, min(k, len(sample))):
        if len(centers) >= k: break
        d = np.min(np.sum((sample[:, None, :] - np.array(centers)[None, :, :]) ** 2, axis=2), axis=1)
        centers.append(sample[int(np.argmax(d))])
    centers = np.array(centers)
    for _ in range(iterations):
        dist = np.sum((sample[:, None, :] - centers[None, :, :]) ** 2, axis=2)
        labels = np.argmin(dist, axis=1)
        updated = centers.copy()
        for i in range(len(centers)):
            members = sample[labels == i]
            if i == protected_chroma_index:
                members = sample[(labels == i) & (chroma > 0.045)]
                if not len(members): members = sample[chroma > 0.045]
            if len(members): updated[i] = np.mean(members, axis=0)
        if np.max(np.abs(updated - centers)) < 1e-5: break
        centers = updated
    # Palette colors are medoids in source RGB, avoiding out-of-gamut conversion.
    palette = []
    for center in centers:
        idx = int(np.argmin(np.sum((sample - center) ** 2, axis=1)))
        palette.append(sample_rgb[idx])
    palette = np.asarray(palette)
    if protected_chroma_index is not None and len(palette) == 3:
        palette[protected_chroma_index] = sample_rgb[int(np.argmax(chroma))]
        neutral_index = next(i for i in range(3) if i not in (0, protected_chroma_index))
        bins=np.round(sample_rgb*31)/31; unique,counts=np.unique(bins,axis=0,return_counts=True); ulab=srgb_to_oklab(unique)
        eligible=(np.linalg.norm(ulab[:,1:],axis=1)<.035)&(ulab[:,0]>.18)
        if np.any(eligible):
            candidates=np.where(eligible)[0];palette[neutral_index]=unique[candidates[int(np.argmax(counts[candidates]))]]
    full_dist = np.sum((lab[:, None, :] - srgb_to_oklab(palette)[None, :, :]) ** 2, axis=2)
    return palette, np.argmin(full_dist, axis=1).reshape(rgb.shape[:2])


def map_palette(rgb: np.ndarray, palette: np.ndarray) -> np.ndarray:
    shape = rgb.shape
    lab = srgb_to_oklab(rgb.reshape(-1, 3))
    plab = srgb_to_oklab(palette)
    labels = np.argmin(np.sum((lab[:, None, :] - plab[None, :, :]) ** 2, axis=2), axis=1)
    return palette[labels].reshape(shape)


def baseline(resample: int, linear: bool = False, device: bool = True) -> Callable:
    def run(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
        out = compose(rgb, width, height, "contain", resample, linear)
        return quantize_rgb444(out) if device else out
    return run


def linear_area(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    return quantize_rgb444(compose(rgb, width, height, "contain", Image.Resampling.BOX, True))


def device_before(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    return quantize_rgb444(compose(quantize_rgb444(rgb), width, height, "contain", Image.Resampling.BOX, True))


def edge_enhanced(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    out = compose(rgb, width, height, "contain", Image.Resampling.BOX, True)
    lab = srgb_to_oklab(out)
    blur = ndimage.gaussian_filter(lab[..., 0], 0.72)
    lab_l = np.clip(lab[..., 0] + 0.75 * (lab[..., 0] - blur), 0, 1)
    # Preserve hue by applying the lightness contrast as a ratio in linear RGB.
    ratio = (lab_l + 0.025) / (lab[..., 0] + 0.025)
    return quantize_rgb444(linear_to_srgb(srgb_to_linear(out) * ratio[..., None]))


def palette_region(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    rgb=contain_source_canvas(rgb,width,height)
    if max(rgb.shape[:2])>256:
        scale=256/max(rgb.shape[:2]);rgb=resize_rgb(rgb,max(1,round(rgb.shape[1]*scale)),max(1,round(rgb.shape[0]*scale)),Image.Resampling.BOX,False)
    palette, labels = weighted_kmeans_oklab(rgb, ctx.palette_size)
    scores = []
    for i in range(len(palette)):
        mask = np.float32(labels == i)
        scores.append(np.asarray(Image.fromarray(mask).resize((width, height), Image.Resampling.BOX)))
    out = palette[np.argmax(np.stack(scores, axis=-1), axis=-1)]
    return quantize_rgb444(out)


def _gridfit_labels(rgb: np.ndarray, width: int, height: int, ctx: Context) -> tuple[np.ndarray, np.ndarray]:
    rgb=contain_source_canvas(rgb,width,height)
    if max(rgb.shape[:2])>256:
        scale=256/max(rgb.shape[:2]);rgb=resize_rgb(rgb,max(1,round(rgb.shape[1]*scale)),max(1,round(rgb.shape[0]*scale)),Image.Resampling.BOX,False)
    palette, labels = weighted_kmeans_oklab(rgb, ctx.palette_size)
    ph, pw = labels.shape
    bg = int(np.argmin(np.linalg.norm(palette, axis=1)))
    best_score, best_labels = -1e9, None
    # Search subpixel translations and mild optical scaling. Masks are sampled
    # as signed distance fields, then a minimum-coverage rescue preserves thin
    # components that ordinary area thresholds drop.
    for scale in (0.96, 1.0, 1.04):
        for ox in (-0.35, 0.0, 0.35):
            for oy in (-0.35, 0.0, 0.35):
                fields, coverages = [], []
                yy = (np.arange(height) + 0.5 - oy - height / 2) / scale + height / 2
                xx = (np.arange(width) + 0.5 - ox - width / 2) / scale + width / 2
                sy = np.clip(yy * ph / height, 0, ph - 1)
                sx = np.clip(xx * pw / width, 0, pw - 1)
                grid_y, grid_x = np.meshgrid(sy, sx, indexing="ij")
                for i in range(len(palette)):
                    mask = labels == i
                    sdf = ndimage.distance_transform_edt(mask) - ndimage.distance_transform_edt(~mask)
                    fields.append(ndimage.map_coordinates(sdf, [grid_y, grid_x], order=1, mode="nearest"))
                    coverages.append(np.asarray(Image.fromarray(np.float32(mask)).resize((width, height), Image.Resampling.BOX)))
                field = np.stack(fields, -1)
                coverage = np.stack(coverages, -1)
                candidate = np.argmax(field + 0.22 * coverage, axis=-1)
                # Rescue a represented pixel for every non-background component
                # whose source area is visually meaningful at this scale.
                for i in range(len(palette)):
                    if i == bg: continue
                    comps, count = ndimage.label(labels == i)
                    for c in range(1, count + 1):
                        area = np.count_nonzero(comps == c) * width * height / (pw * ph)
                        if area < 0.28: continue
                        comp_cov = np.asarray(Image.fromarray(np.float32(comps == c)).resize((width, height), Image.Resampling.BOX))
                        if not np.any((candidate == i) & (comp_cov > 0)):
                            candidate[np.unravel_index(np.argmax(comp_cov), comp_cov.shape)] = i
                recon = palette[candidate]
                ref = compose(rgb, width, height, "contain", Image.Resampling.BOX, True)
                color_loss = float(np.mean((srgb_to_oklab(recon) - srgb_to_oklab(ref)) ** 2))
                isolated = isolated_count(candidate != bg)
                symmetry = float(np.mean(candidate != np.fliplr(candidate))) if ctx.symmetric else 0.0
                components = component_count(candidate != bg)
                source_components = component_count(labels != bg)
                score = -color_loss * 10 - isolated * 0.012 - symmetry * 0.4 - abs(components - source_components) * 0.025
                if score > best_score: best_score, best_labels = score, candidate.copy()
    assert best_labels is not None
    return palette, best_labels


def sdf_gridfit(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    palette, labels = _gridfit_labels(rgb, width, height, ctx)
    return quantize_rgb444(palette[labels])


def sdf_gridfit_controlled(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    palette,labels=_gridfit_labels(controlled_source_canvas(rgb,width,height),width,height,ctx)
    return quantize_rgb444(palette[labels])


def _marching_loops(mask: np.ndarray) -> list[list[tuple[float, float]]]:
    """Extract half-pixel boundary loops with a deterministic marching square."""
    padded = np.pad(mask.astype(np.uint8), 1)
    h, w = padded.shape
    table = {
        1: (("left", "top"),), 2: (("top", "right"),), 3: (("left", "right"),),
        4: (("right", "bottom"),), 5: (("left", "top"), ("right", "bottom")),
        6: (("top", "bottom"),), 7: (("left", "bottom"),), 8: (("bottom", "left"),),
        9: (("top", "bottom"),), 10: (("top", "right"), ("bottom", "left")),
        11: (("right", "bottom"),), 12: (("left", "right"),),
        13: (("top", "right"),), 14: (("left", "top"),),
    }
    adjacency: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for y in range(h - 1):
        for x in range(w - 1):
            state = int(padded[y, x]) + 2 * int(padded[y, x + 1]) + 4 * int(padded[y + 1, x + 1]) + 8 * int(padded[y + 1, x])
            points = {"top": (2*x+1,2*y), "right": (2*x+2,2*y+1), "bottom": (2*x+1,2*y+2), "left": (2*x,2*y+1)}
            for a,b in table.get(state, ()):
                pa,pb=points[a],points[b]
                adjacency.setdefault(pa,[]).append(pb); adjacency.setdefault(pb,[]).append(pa)
    unused={tuple(sorted((a,b))) for a,neighbors in adjacency.items() for b in neighbors}
    loops=[]
    while unused:
        edge=next(iter(unused)); start,current=edge; previous=None; chain=[start]
        while True:
            chain.append(current); unused.discard(tuple(sorted((chain[-2],current))))
            candidates=[p for p in adjacency.get(current,[]) if tuple(sorted((current,p))) in unused]
            if not candidates: break
            nxt=candidates[0] if len(candidates)==1 or candidates[0]!=previous else candidates[-1]
            previous,current=current,nxt
            if current==start:
                chain.append(current); break
        if len(chain)>=4:
            loops.append([((x/2)-1,(y/2)-1) for x,y in chain])
    return loops


def _rdp(points: list[tuple[float,float]], epsilon: float) -> list[tuple[float,float]]:
    if len(points) < 3: return points
    a,b=np.array(points[0]),np.array(points[-1]); line=b-a; denom=float(np.dot(line,line))
    distances=[]
    for p in points[1:-1]:
        q=np.array(p); projection=a + line * (float(np.dot(q-a,line))/denom) if denom else a
        distances.append(float(np.linalg.norm(q-projection)))
    if not distances or max(distances)<=epsilon: return [points[0],points[-1]]
    idx=1+int(np.argmax(distances))
    return _rdp(points[:idx+1],epsilon)[:-1]+_rdp(points[idx:],epsilon)


def _simplify_loop(points: list[tuple[float,float]], epsilon: float) -> list[tuple[float,float]]:
    core=points[:-1] if points[0]==points[-1] else points
    if len(core)<4: return points
    origin=np.array(core[0]); split=int(np.argmax([np.linalg.norm(np.array(p)-origin) for p in core]))
    first=_rdp(core[:split+1],epsilon); second=_rdp(core[split:]+[core[0]],epsilon)
    return first[:-1]+second


def contour_reraster(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    """Recover simplified color-region contours, then re-rasterize them.

    This is deliberately a modest Potrace-like experiment, not a claim that
    arbitrary bitmaps have a unique vector explanation. Even/odd loop filling
    retains holes; RDP simplification exposes where automatic tracing changes
    identity-critical concavities or fine details.
    """
    palette, labels=weighted_kmeans_oklab(rgb,ctx.palette_size)
    ph,pw=labels.shape; bg=int(np.argmin(np.linalg.norm(palette,axis=1))); ss=8
    scale=min(width/pw,height/ph); dw,dh=pw*scale,ph*scale; dx=(width-dw)/2; dy=(height-dh)/2
    out=np.zeros((height*ss,width*ss,3),dtype=np.float64)
    out[:]=palette[bg]
    epsilon=max(pw/width,ph/height)*0.11
    for index,color in enumerate(palette):
        if index==bg: continue
        region=Image.new("1",(width*ss,height*ss),0)
        for loop in _marching_loops(labels==index):
            polygon=_simplify_loop(loop,epsilon)
            transformed=[((x*scale+dx)*ss,(y*scale+dy)*ss) for x,y in polygon]
            piece=Image.new("1",region.size,0); ImageDraw.Draw(piece).polygon(transformed,fill=1)
            region=ImageChops.logical_xor(region,piece)
        mask=np.asarray(region,dtype=bool); out[mask]=color
    return quantize_rgb444(resize_rgb(out,width,height,Image.Resampling.BOX,False))


def _objective(labels: np.ndarray, palette: np.ndarray, ref: np.ndarray, ctx: Context, bg: int) -> float:
    out = palette[labels]
    lab = srgb_to_oklab(out)
    ref_lab = srgb_to_oklab(ref)
    color = np.mean((lab - ref_lab) ** 2)
    edge = sobel_magnitude(lab[..., 0]); ref_edge = sobel_magnitude(ref_lab[..., 0])
    edge_loss = np.mean(np.abs(edge - ref_edge))
    mask = labels != bg
    fragment = isolated_count(mask) / labels.size
    symmetry = np.mean(labels != np.fliplr(labels)) if ctx.symmetric else 0.0
    # At this scale a false semantic color is much worse than a slightly less
    # exact edge. Keep the structural terms as tie-breakers, not invitations to
    # repaint a gray outline orange merely because that increases edge energy.
    return float(24.0 * color + 0.32 * edge_loss + 0.08 * fragment + 0.18 * symmetry)


def topology_opt(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    palette, labels = _gridfit_labels(rgb, width, height, ctx)
    ref = compose(rgb, width, height, "contain", Image.Resampling.BOX, True)
    bg = int(np.argmin(np.linalg.norm(palette, axis=1)))
    current = _objective(labels, palette, ref, ctx, bg)
    # Coordinate descent is deterministic and bounded: 512 * K decisions per
    # pass. Paired mirror edits keep symmetric inputs from accumulating drift.
    for _ in range(2):
        changed = False
        for y in range(height):
            for x in range((width + 1) // 2 if ctx.symmetric else width):
                old = int(labels[y, x]); mirror = width - 1 - x
                best, best_loss = old, current
                for candidate in range(len(palette)):
                    if candidate == old: continue
                    old_mirror = int(labels[y, mirror])
                    labels[y, x] = candidate
                    if ctx.symmetric: labels[y, mirror] = candidate
                    loss = _objective(labels, palette, ref, ctx, bg)
                    labels[y, x] = old
                    if ctx.symmetric: labels[y, mirror] = old_mirror
                    if loss + 1e-9 < best_loss: best, best_loss = candidate, loss
                if best != old:
                    labels[y, x] = best
                    if ctx.symmetric: labels[y, mirror] = best
                    current, changed = best_loss, True
        if not changed: break
    return quantize_rgb444(palette[labels])


def palette_quantized(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    out = compose(rgb, width, height, "contain", Image.Resampling.BOX, True)
    palette, _ = weighted_kmeans_oklab(out, min(ctx.palette_size, 8))
    return quantize_rgb444(map_palette(out, palette))


def floyd_steinberg(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    work = compose(rgb, width, height, "contain", Image.Resampling.BOX, True).copy()
    for y in range(height):
        xs = range(width) if y % 2 == 0 else range(width - 1, -1, -1)
        direction = 1 if y % 2 == 0 else -1
        for x in xs:
            old = work[y, x].copy(); new = np.round(np.clip(old, 0, 1) * 15) / 15
            work[y, x] = new; err = old - new
            for dx, dy, weight in ((direction, 0, 7/16), (-direction, 1, 3/16), (0, 1, 5/16), (direction, 1, 1/16)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and ny < height: work[ny, nx] += err * weight
    return np.clip(work, 0, 1)


def jjn_dither(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    work=compose(rgb,width,height,"contain",Image.Resampling.BOX,True).copy()
    weights=((1,0,7),(2,0,5),(-2,1,3),(-1,1,5),(0,1,7),(1,1,5),(2,1,3),(-2,2,1),(-1,2,3),(0,2,5),(1,2,3),(2,2,1))
    for y in range(height):
        direction=1 if y%2==0 else -1; xs=range(width) if direction==1 else range(width-1,-1,-1)
        for x in xs:
            old=work[y,x].copy();new=np.round(np.clip(old,0,1)*15)/15;work[y,x]=new;err=old-new
            for dx,dy,weight in weights:
                nx,ny=x+dx*direction,y+dy
                if 0<=nx<width and ny<height:work[ny,nx]+=err*weight/48
    return np.clip(work,0,1)


BAYER4 = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) + 0.5) / 16 - 0.5


def ordered_dither(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    out = compose(rgb, width, height, "contain", Image.Resampling.BOX, True)
    threshold = np.tile(BAYER4, (math.ceil(height / 4), math.ceil(width / 4)))[:height, :width]
    return np.clip(np.floor(out * 15 + 0.5 + threshold[..., None]) / 15, 0, 1)


def blue_noise_dither(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    out=compose(rgb,width,height,"contain",Image.Resampling.BOX,True)
    rng=np.random.default_rng(20260901); noise=rng.normal(size=(16,16)); noise-=ndimage.gaussian_filter(noise,1.2)
    ranks=np.empty(noise.size,int);ranks[np.argsort(noise,axis=None)]=np.arange(noise.size)
    mask=(ranks.reshape(noise.shape)+.5)/noise.size-.5
    threshold=np.tile(mask,(math.ceil(height/16),math.ceil(width/16)))[:height,:width]
    return np.clip(np.floor(out*15+.5+threshold[...,None])/15,0,1)


def structure_aware_dither(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    work=compose(rgb,width,height,"contain",Image.Resampling.BOX,True).copy(); edge=sobel_magnitude(luminance(work))>.22
    for y in range(height):
        direction=1 if y%2==0 else -1;xs=range(width) if direction==1 else range(width-1,-1,-1)
        for x in xs:
            old=work[y,x].copy();new=np.round(np.clip(old,0,1)*15)/15;work[y,x]=new
            if edge[y,x]:continue
            err=old-new
            for dx,dy,weight in ((direction,0,7/16),(-direction,1,3/16),(0,1,5/16),(direction,1,1/16)):
                nx,ny=x+dx,y+dy
                if 0<=nx<width and ny<height and not edge[ny,nx]:work[ny,nx]+=err*weight
    return np.clip(work,0,1)


def saliency_photo(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    return quantize_rgb444(compose(rgb, width, height, "saliency-cover", Image.Resampling.BOX, True))


def center_cover(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    return quantize_rgb444(compose(rgb, width, height, "cover", Image.Resampling.BOX, True))


def foreground_trim(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    corners=np.stack((rgb[0,0],rgb[0,-1],rgb[-1,0],rgb[-1,-1])); bg=np.median(corners,axis=0)
    distance=np.linalg.norm(srgb_to_oklab(rgb)-srgb_to_oklab(bg),axis=-1)
    mask=distance>.035
    if not np.any(mask): return linear_area(rgb,width,height,ctx)
    ys,xs=np.where(mask); pad=max(1,round(.025*max(rgb.shape[:2])))
    y0,y1=max(0,int(ys.min())-pad),min(rgb.shape[0],int(ys.max())+pad+1)
    x0,x1=max(0,int(xs.min())-pad),min(rgb.shape[1],int(xs.max())+pad+1)
    return quantize_rgb444(contain(rgb[y0:y1,x0:x1],width,height,Image.Resampling.BOX,True))


def _remove_vertical_seam(rgb: np.ndarray) -> np.ndarray:
    gray=luminance(rgb); energy=np.abs(ndimage.sobel(gray,0))+np.abs(ndimage.sobel(gray,1))
    h,w=gray.shape; cost=energy.copy(); parent=np.zeros((h,w),np.int8)
    for y in range(1,h):
        previous=np.pad(cost[y-1],(1,1),constant_values=np.inf)
        choices=np.stack((previous[:-2],previous[1:-1],previous[2:]),axis=0)
        step=np.argmin(choices,axis=0); parent[y]=step-1; cost[y]+=np.min(choices,axis=0)
    seam=np.empty(h,np.int32); seam[-1]=int(np.argmin(cost[-1]))
    for y in range(h-2,-1,-1): seam[y]=np.clip(seam[y+1]+parent[y+1,seam[y+1]],0,w-1)
    keep=np.ones((h,w),bool); keep[np.arange(h),seam]=False
    return rgb[keep].reshape(h,w-1,3)


def seam_carve(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    # A bounded composition experiment: normalize the long side to 64 pixels,
    # carve only the aspect-ratio mismatch, then perform the actual reduction.
    sh,sw=rgb.shape[:2]; base=64
    scale=base/max(sw,sh); work=resize_rgb(rgb,max(2,round(sw*scale)),max(2,round(sh*scale)),Image.Resampling.BOX,True)
    target_aspect=width/height
    while work.shape[1]/work.shape[0] > target_aspect and work.shape[1]>2: work=_remove_vertical_seam(work)
    while work.shape[1]/work.shape[0] < target_aspect and work.shape[0]>2: work=np.transpose(_remove_vertical_seam(np.transpose(work,(1,0,2))),(1,0,2))
    return quantize_rgb444(resize_rgb(work,width,height,Image.Resampling.BOX,True))


def mild_stretch(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    return quantize_rgb444(compose(rgb, width, height, "stretch", Image.Resampling.BOX, True))


def controlled_aspect(rgb: np.ndarray, width: int, height: int, ctx: Context) -> np.ndarray:
    sh,sw=rgb.shape[:2]; contain_scale=min(width/sw,height/sh); base_w=max(1,round(sw*contain_scale));base_h=max(1,round(sh*contain_scale))
    desired_x=width/base_w; stretch_x=min(1.35,desired_x); dw=min(width,max(1,round(base_w*stretch_x)))
    small=resize_rgb(rgb,dw,base_h,Image.Resampling.BOX,True);out=np.zeros((height,width,3));x=(width-dw)//2;y=(height-base_h)//2;out[y:y+base_h,x:x+dw]=small
    return quantize_rgb444(out)


METHODS = (
    Method("nearest", ("all",), "contain", "none", "sRGB", "RGB444 after", "none", baseline(Image.Resampling.NEAREST)),
    Method("bilinear", ("all",), "contain", "none", "sRGB", "RGB444 after", "none", baseline(Image.Resampling.BILINEAR)),
    Method("bicubic", ("all",), "contain", "none", "sRGB", "RGB444 after", "none", baseline(Image.Resampling.BICUBIC)),
    Method("lanczos", ("all",), "contain", "none", "sRGB", "RGB444 after", "none", baseline(Image.Resampling.LANCZOS)),
    Method("linear-area", ("all",), "contain", "none", "linear RGB", "RGB444 after", "none", linear_area),
    Method("rgb444-before", ("all",), "contain", "device RGB444", "linear RGB", "RGB444 before and after", "none", device_before),
    Method("edge-enhanced", ("artwork", "line", "text", "mixed", "photo"), "contain", "none", "linear RGB + OKLab L", "RGB444 after", "none", edge_enhanced),
    Method("perceptual-palette", ("artwork", "line", "text", "mixed", "photo"), "contain", "OKLab k-means medoids", "OKLab", "palette then RGB444", "none", palette_quantized),
    Method("palette-region", ("artwork", "line", "text", "mixed"), "contain", "OKLab semantic regions", "OKLab", "RGB444 during", "none", palette_region),
    Method("contour-reraster", ("artwork", "line", "text", "mixed"), "contain + contour simplification", "OKLab regions", "OKLab + polygons", "RGB444 during", "none", contour_reraster),
    Method("sdf-gridfit", ("artwork", "line", "text", "mixed"), "contain + optical grid fit", "OKLab regions", "OKLab + signed distance", "RGB444 during", "none", sdf_gridfit),
    Method("sdf-controlled", ("artwork", "line", "text", "mixed"), "max 1.35x aspect stretch + optical grid fit", "OKLab regions", "OKLab + signed distance", "RGB444 during", "none", sdf_gridfit_controlled),
    Method("framebuffer-opt", ("artwork", "line", "text", "mixed"), "contain + optical grid fit", "OKLab regions", "OKLab", "RGB444 during", "none", topology_opt),
    Method("floyd-steinberg", ("photo", "gradient", "cartoon"), "contain", "device RGB444", "linear RGB", "RGB444 during", "serpentine Floyd–Steinberg", floyd_steinberg),
    Method("jarvis-jjn", ("photo", "gradient", "cartoon"), "contain", "device RGB444", "linear RGB", "RGB444 during", "serpentine Jarvis/JJN", jjn_dither),
    Method("ordered-bayer", ("photo", "gradient", "cartoon"), "contain", "device RGB444", "linear RGB", "RGB444 during", "4x4 Bayer", ordered_dither),
    Method("blue-noise", ("photo", "gradient", "cartoon"), "contain", "device RGB444", "linear RGB", "RGB444 during", "deterministic high-pass rank mask", blue_noise_dither),
    Method("structure-dither", ("photo",), "contain", "device RGB444", "linear RGB", "RGB444 during", "Floyd–Steinberg excluded from edges", structure_aware_dither),
    Method("center-cover", ("photo", "artwork", "mixed"), "center cover", "none", "linear RGB", "RGB444 after", "none", center_cover),
    Method("saliency-cover", ("photo",), "saliency cover", "none", "linear RGB", "RGB444 after", "none", saliency_photo),
    Method("foreground-trim", ("artwork", "line", "text", "mixed"), "automatic corner-background trim", "none", "linear RGB", "RGB444 after", "none", foreground_trim),
    Method("seam-carve", ("photo", "artwork", "mixed"), "bounded gradient seam carving", "none", "linear RGB", "RGB444 after", "none", seam_carve),
    Method("controlled-aspect", ("photo", "artwork", "mixed"), "contain plus max 1.35x horizontal optical stretch", "none", "linear RGB", "RGB444 after", "none", controlled_aspect),
    Method("full-stretch", ("photo", "artwork", "mixed"), "full nonuniform stretch", "none", "linear RGB", "RGB444 after", "none", mild_stretch),
)


def applicable(method: Method, content_type: str) -> bool:
    return "all" in method.content_types or content_type in method.content_types


def luminance(rgb: np.ndarray) -> np.ndarray:
    return srgb_to_oklab(rgb)[..., 0]


def sobel_magnitude(gray: np.ndarray) -> np.ndarray:
    mag = np.hypot(ndimage.sobel(gray, 0, mode="nearest"), ndimage.sobel(gray, 1, mode="nearest"))
    peak = float(np.max(mag))
    return mag / peak if peak > 1e-12 else mag


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    # Wang et al. local SSIM with a compact sigma suited to a 32x16 target.
    a, b = luminance(a), luminance(b)
    mu_a, mu_b = ndimage.gaussian_filter(a, 1.0), ndimage.gaussian_filter(b, 1.0)
    va = ndimage.gaussian_filter(a * a, 1.0) - mu_a * mu_a
    vb = ndimage.gaussian_filter(b * b, 1.0) - mu_b * mu_b
    cov = ndimage.gaussian_filter(a * b, 1.0) - mu_a * mu_b
    value = ((2 * mu_a * mu_b + 0.01**2) * (2 * cov + 0.03**2)) / ((mu_a**2 + mu_b**2 + 0.01**2) * (va + vb + 0.03**2))
    return float(np.mean(value))


def foreground_mask(rgb: np.ndarray) -> np.ndarray:
    lab = srgb_to_oklab(rgb)
    return (lab[..., 0] > 0.11) | (np.linalg.norm(lab[..., 1:], axis=-1) > 0.055)


def component_count(mask: np.ndarray) -> int:
    return int(ndimage.label(mask, structure=np.ones((3, 3)))[1])


def holes_count(mask: np.ndarray) -> int:
    filled = ndimage.binary_fill_holes(mask)
    return component_count(filled & ~mask)


def isolated_count(mask: np.ndarray) -> int:
    neighbors = ndimage.convolve(mask.astype(np.int8), np.ones((3, 3), np.int8), mode="constant")
    return int(np.count_nonzero(mask & (neighbors <= 2)))


def metric_bundle(reference: np.ndarray, output: np.ndarray, symmetric: bool) -> dict[str, float | int]:
    ref_edge, out_edge = sobel_magnitude(luminance(reference)) > 0.24, sobel_magnitude(luminance(output)) > 0.24
    tp = np.count_nonzero(ref_edge & out_edge); precision = tp / max(1, np.count_nonzero(out_edge)); recall = tp / max(1, np.count_nonzero(ref_edge))
    edge_f1 = 2 * precision * recall / max(1e-9, precision + recall)
    ref_dist, out_dist = ndimage.distance_transform_edt(~ref_edge), ndimage.distance_transform_edt(~out_edge)
    chamfer = 0.5 * (float(np.mean(ref_dist[out_edge])) if np.any(out_edge) else 32.0) + 0.5 * (float(np.mean(out_dist[ref_edge])) if np.any(ref_edge) else 32.0)
    hausdorff = max(float(np.max(ref_dist[out_edge])) if np.any(out_edge) else 32.0, float(np.max(out_dist[ref_edge])) if np.any(ref_edge) else 32.0)
    ref_mask, out_mask = foreground_mask(reference), foreground_mask(output)
    union = np.count_nonzero(ref_mask | out_mask)
    iou = np.count_nonzero(ref_mask & out_mask) / max(1, union)
    component_error = abs(component_count(ref_mask) - component_count(out_mask))
    hole_error = abs(holes_count(ref_mask) - holes_count(out_mask))
    topology = 1 / (1 + component_error + hole_error)
    symmetry = float(np.mean(output != np.fliplr(output))) if symmetric else 0.0
    ref_energy, out_energy = np.sum(sobel_magnitude(luminance(reference))), np.sum(sobel_magnitude(luminance(output)))
    return {
        "ssim": ssim(reference, output),
        "oklab_delta": float(np.mean(np.linalg.norm(srgb_to_oklab(reference) - srgb_to_oklab(output), axis=-1))),
        "edge_f1": float(edge_f1), "chamfer": chamfer, "hausdorff": hausdorff,
        "silhouette_iou": float(iou), "topology_score": float(topology), "symmetry_error": symmetry,
        "isolated_pixels": isolated_count(out_mask), "edge_energy_ratio": float(out_energy / max(1e-9, ref_energy)),
    }


def make_fixture_corpus() -> list[Fixture]:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default(size=24)

    def save(name: str, draw_fn: Callable[[ImageDraw.ImageDraw, Image.Image], None], mode: str = "RGB", size=(256, 128), bg=(0, 0, 0, 255)) -> Path:
        image = Image.new("RGBA", size, bg)
        draw_fn(ImageDraw.Draw(image), image)
        path = FIXTURES / name
        image.save(path)
        return path

    def primary(draw: ImageDraw.ImageDraw, image: Image.Image) -> None:
        gray, orange = (196, 200, 204, 255), (255, 112, 24, 255)
        hexagon = [(57, 13), (199, 13), (238, 64), (199, 115), (57, 115), (18, 64), (57, 13)]
        draw.line(hexagon, fill=gray, width=9, joint="curve")
        for cx, color in ((82, gray), (128, orange), (174, gray)):
            draw.polygon([(cx, 29), (cx-20, 52), (cx-9, 52), (cx-9, 91), (cx+9, 91), (cx+9, 52), (cx+20, 52)], fill=color)

    save("logo_hex_arrows_proxy.png", primary)
    save("flat_3color_logo.png", lambda d, i: (d.rounded_rectangle((20, 20, 236, 108), 24, fill=(25, 50, 92), outline=(240, 196, 40), width=8), d.polygon([(60, 80), (100, 40), (140, 80)], fill=(240, 196, 40)), d.ellipse((154, 38, 204, 88), fill=(230, 70, 64))))
    save("thin_line_icon.png", lambda d, i: (d.ellipse((49, 13, 207, 113), outline=(245,245,245), width=3), d.line([(66,89),(105,55),(132,76),(190,31)], fill=(255,130,20), width=3), d.line([(190,31),(180,32),(187,42)], fill=(255,130,20), width=3)))
    save("circle_curved_icon.png", lambda d, i: (d.ellipse((70, 8, 186, 124), outline=(235,235,235), width=11), d.arc((91, 29, 165, 103), 35, 325, fill=(50,180,255), width=9)))
    save("text_heavy.png", lambda d, i: (d.text((12, 15), "MATRIX", font=font, fill=(255,255,255)), d.text((12, 52), "SMITH 32x16", font=font, fill=(255,125,20)), d.text((12, 91), "LED", font=font, fill=(180,185,190))))
    save("black_on_white.png", lambda d, i: (d.rectangle((0,0,255,127), fill=(255,255,255)), d.polygon([(35,64),(100,18),(100,45),(220,45),(220,83),(100,83),(100,110)], fill=(0,0,0))))
    save("white_on_black.png", lambda d, i: d.line([(24,102),(76,30),(128,102),(180,30),(232,102)], fill=(255,255,255), width=7, joint="curve"))
    save("asymmetric_logo.png", lambda d, i: (d.rounded_rectangle((20,22,223,106),18,outline=(220,220,220),width=7), d.polygon([(40,64),(94,34),(94,51),(153,51),(153,77),(94,77),(94,94)],fill=(50,210,160)), d.ellipse((177,42,221,86), fill=(255,80,70))))
    save("transparent.png", lambda d, i: (d.ellipse((40,8,216,124), fill=(0,0,0,0), outline=(255,90,40,220), width=10), d.polygon([(128,20),(160,100),(128,82),(96,100)], fill=(60,190,255,190))), bg=(0,0,0,0))
    save("gradient.png", lambda d, i: None)
    grad = np.zeros((128,256,4), dtype=np.uint8); grad[...,3]=255
    xx=np.linspace(0,1,256)[None,:]; yy=np.linspace(0,1,128)[:,None]
    grad[...,0]=np.uint8(255*xx); grad[...,1]=np.uint8(255*yy); grad[...,2]=np.uint8(255*(1-xx)*(.3+.7*yy))
    Image.fromarray(grad).save(FIXTURES/"gradient.png")
    save("colorful_cartoon.png", lambda d, i: (d.rectangle((0,72,255,127),fill=(25,110,65)),d.ellipse((174,12,224,62),fill=(255,215,35)),d.polygon([(0,76),(65,26),(122,76)],fill=(55,145,210)),d.polygon([(75,76),(154,14),(230,76)],fill=(90,175,230)),d.rectangle((91,61,136,98),fill=(225,75,55)),d.polygon([(84,61),(113,37),(144,61)],fill=(255,205,60))))
    # Deliberately authored 16x12, then saved without resampling.
    sprite = Image.new("RGBA", (16,12),(0,0,0,255)); sd=ImageDraw.Draw(sprite)
    sd.rectangle((5,1,10,2),fill=(250,200,80)); sd.rectangle((3,3,12,8),fill=(230,80,60)); sd.rectangle((1,5,14,7),fill=(230,80,60)); sd.rectangle((4,9,6,11),fill=(80,150,250)); sd.rectangle((9,9,11,11),fill=(80,150,250)); sd.point((5,5),fill=(255,255,255)); sd.point((10,5),fill=(255,255,255))
    sprite.save(FIXTURES/"pixel_art_sprite.png")
    # Photo-like deterministic fixtures remain fallbacks when external NASA
    # public-domain images have not been downloaded.
    rng=np.random.default_rng(7)
    yy,xx=np.mgrid[0:192,0:320]
    landscape=np.zeros((192,320,3),dtype=float)
    landscape[...,0]=.15+.35*(1-yy/192); landscape[...,1]=.30+.45*(1-yy/192); landscape[...,2]=.45+.45*(1-yy/192)
    ridge=103+18*np.sin(xx/35)+12*np.sin(xx/13)
    landscape[yy>ridge]=np.stack((.10+.12*xx/320,.22+.18*xx/320,.11+.05*xx/320),axis=-1)[yy>ridge]
    landscape += rng.normal(0,.025,landscape.shape)
    array_to_image(landscape).save(FIXTURES/"landscape_photo_synthetic.png")
    portrait=np.zeros((240,180,3),float); portrait[:]=(.10,.14,.18)
    py,px=np.mgrid[0:240,0:180]; face=((px-90)/47)**2+((py-105)/65)**2<1
    portrait[face]=(.73,.48,.35); hair=((px-90)/54)**2+((py-76)/59)**2<1; portrait[hair&~face]=(.12,.06,.035)
    for cx in (73,107): portrait[(px-cx)**2+(py-102)**2<18]=(.06,.04,.03)
    portrait[((px-90)/18)**2+((py-139)/7)**2<1]=(.35,.08,.07)
    portrait += rng.normal(0,.018,portrait.shape)
    array_to_image(portrait).save(FIXTURES/"portrait_photo_synthetic.png")
    hf=np.clip(rng.random((160,256,3))*.45 + np.sin(xx[:160,:256,None]/2.1)*.15 + .3,0,1)
    array_to_image(hf).save(FIXTURES/"high_frequency_photo_synthetic.png")

    provenance = """# Fixture provenance\n\nAll fixtures ending in `_synthetic.png`, plus the icons, artwork, gradient,\ntransparent image, text graphic, and pixel-art sprite, are deterministically\ngenerated by `benchmark.py` for this research pass and may be used without\nrestriction. They are tests, not MatrixSmith brand assets.\n\n`atsk-logo.png` is the exact user-supplied primary fixture copied from\n`/Users/joshuahansen/dev/atsk-site/out/atsk-logo.png`; SHA-256\n`0efa6c6376e83345dd036917bb398f9564d45b7bcadb325294f08d133b10666c`.\nIt has transparent pixels, which the LED path composites over true black.\n`logo_hex_arrows_proxy.png` is retained only as a disclosed supplementary\nstress case reconstructed from the earlier written acceptance criteria.\n\nExternal photos were retrieved 2026-09-01 from the scikit-image data repository\n(https://gitlab.com/scikit-image/data):\n\n- `portrait_photo.png`: `astronaut.png`, astronaut Eileen Collins; NASA source.\n  Used here for non-promotional image-processing research under NASA's media\n  usage guidelines. The fixture is a documented 320x160 face crop.\n- `landscape_photo.jpg`: `rocket.jpg`, SpaceX DSCOVR launch photograph; the\n  scikit-image documentation records it as released into the public domain.\n- `high_frequency_photo.png`: `grass.png`, a CC0 texture fixture as documented\n  by the scikit-image dataset.\n\nThe harness records the exact SHA-256 of every source in each result row.\n"""
    (FIXTURES/"PROVENANCE.md").write_text(provenance)
    return discover_fixtures()


def discover_fixtures() -> list[Fixture]:
    specs = {
        "atsk-logo.png": ("artwork",3,True,True), "logo_hex_arrows_proxy.png": ("artwork", 3, True, False), "flat_3color_logo.png": ("artwork",3,False,False),
        "thin_line_icon.png": ("line",3,True,False), "circle_curved_icon.png": ("line",3,True,False),
        "text_heavy.png": ("text",4,False,False), "pixel_art_sprite.png": ("pixel-art",5,False,False),
        "gradient.png": ("gradient",8,False,False), "transparent.png": ("artwork",3,True,False),
        "black_on_white.png": ("line",2,False,False), "white_on_black.png": ("line",2,True,False),
        "colorful_cartoon.png": ("cartoon",7,False,False), "asymmetric_logo.png": ("artwork",4,False,False),
        "portrait_photo_synthetic.png": ("photo",8,False,False), "landscape_photo_synthetic.png": ("photo",8,False,False),
        "high_frequency_photo_synthetic.png": ("photo",8,False,False),
        "portrait_photo.png": ("photo",8,False,False), "landscape_photo.jpg": ("photo",8,False,False),
        "high_frequency_photo.png": ("photo",8,False,False),
    }
    return [Fixture(FIXTURES/name, *spec) for name,spec in specs.items() if (FIXTURES/name).exists()]


def source_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


HUMAN_EVALUATION: dict[str,dict[str,tuple[int,str]]] = {
    "atsk-logo.png": {
        "sdf-controlled": (1,"best overall: three arrows, center dominance, hex corners, black, and semantic colors survive with bounded 1.35x optical widening"),
        "sdf-gridfit": (2,"clean semantic colors and topology, but strict contain spends only about half the panel width"),
        "controlled-aspect": (3,"bounded widening improves apparent-size recognition; coverage shades still soften the structure"),
        "palette-region": (4,"clean palette and separable arrows, with less stable corner/stem decisions than SDF grid fitting"),
        "edge-enhanced": (5,"recognizable and faithful but still carries many transition shades"),
        "contour-reraster": (6,"faithful geometry; automatic tracing plus coverage does not beat the SDF result"),
        "linear-area": (7,"faithful reference-like thumbnail but visually soft at real size"),
        "full-stretch": (9,"recognizable but the 2x horizontal deformation is identity-changing"),
        "nearest": (12,"source/grid phase breaks the hex and merges arrow features"),
        "center-cover": (13,"fills the panel by discarding most of the enclosing hexagon"),
        "seam-carve": (14,"preserves energy while badly distorting the logo geometry"),
        "framebuffer-opt": (15,"metric-seeking false orange regions and topology changes"),
    },
    "logo_hex_arrows_proxy.png": {
        "sdf-gridfit": (1,"cleanest topology, three arrows separable, black and semantic colors stable"),
        "palette-region": (2,"clean and faithful palette; slightly coarser corner/stem decisions"),
        "contour-reraster": (3,"good geometry but coverage creates unnecessary gray ramps"),
        "edge-enhanced": (4,"recognizable with good hierarchy; still visibly antialiased"),
        "linear-area": (5,"faithful but gray transition pixels weaken the designed look"),
        "perceptual-palette": (10,"clean palette but orange is lost in this automatic clustering run"),
        "nearest": (11,"correct colors but arrowheads merge and source/grid phase dominates"),
        "framebuffer-opt": (12,"objective exploits metrics by contaminating gray structure orange"),
    },
    "thin_line_icon.png": {
        "edge-enhanced": (1,"best line continuity without repainting the icon"),
        "contour-reraster": (2,"clean curve and ellipse; some coverage softness remains"),
        "sdf-gridfit": (3,"preserves the thin path but color/outline competition is visible"),
        "palette-region": (4,"clean but local region voting creates a bright boundary defect"),
        "linear-area": (5,"faithful yet too dim at actual apparent size"),
        "framebuffer-opt": (12,"gross false-color expansion and topology change"),
    },
    "pixel_art_sprite.png": {
        "nearest": (1,"preserves authored pixel blocks and exact palette"),
        "linear-area": (2,"clean but averages when phase is not integral"),
        "rgb444-before": (2,"same visible result on this already device-realizable palette"),
        "bicubic": (3,"recognizable but invents transition colors"),
        "bilinear": (4,"softens deliberate block boundaries"),
        "lanczos": (5,"ringing and the largest false palette"),
    },
    "portrait_photo.png": {
        "edge-enhanced": (1,"best facial feature visibility at LED and apparent size"),
        "bicubic": (2,"stable face with moderate softness"),
        "lanczos": (3,"good detail but slight ringing/noise"),
        "linear-area": (4,"clean tonal hierarchy, softer eyes and mouth"),
        "bilinear": (5,"recognizable but soft"),
        "structure-dither": (6,"minor tonal help without damaging major edges"),
        "floyd-steinberg": (8,"small tonal benefit outweighed by LED-scale noise"),
        "jarvis-jjn": (9,"diffuse noise is visible; no recognition gain"),
        "ordered-bayer": (10,"patterning visible with no structure gain"),
        "blue-noise": (10,"noise remains individually resolvable at 512 LEDs"),
        "perceptual-palette": (12,"posterization removes identity cues"),
    },
}


def human_evaluation(fixture: str, method: str) -> tuple[int|None,str]:
    return HUMAN_EVALUATION.get(fixture,{}).get(method,(None,"not manually ranked"))


def classification_signals(rgb: np.ndarray, target_width: int, target_height: int) -> dict[str,float|int|str]:
    h,w=rgb.shape[:2]
    q=np.uint8(np.clip(rgb,0,1)*15+.5).reshape(-1,3)
    _,counts=np.unique(q,axis=0,return_counts=True); probabilities=counts/counts.sum()
    entropy=float(-np.sum(probabilities*np.log2(probabilities)))
    dominant4=float(np.sort(probabilities)[-4:].sum())
    gray=luminance(rgb); gradient=sobel_magnitude(gray)
    edge_density=float(np.mean(gradient>.22))
    flat_neighbors=float(.5*(np.mean(np.all(q.reshape(h,w,3)[:,1:]==q.reshape(h,w,3)[:,:-1],axis=2))+np.mean(np.all(q.reshape(h,w,3)[1:]==q.reshape(h,w,3)[:-1],axis=2))))
    small=int(w<=target_width*2 and h<=target_height*2)
    if small and len(counts)<=32: predicted="pixel-art"
    elif len(counts)<=12 or (entropy<2.6 and dominant4>.90): predicted="artwork"
    elif edge_density>.23 and entropy<4.2: predicted="line/text"
    elif entropy<4.4 and flat_neighbors>.72: predicted="cartoon/mixed"
    else: predicted="photo/gradient"
    return {"source_width":w,"source_height":h,"quantized_colors":int(len(counts)),"palette_entropy":entropy,"dominant4_coverage":dominant4,"edge_density":edge_density,"flat_neighbor_ratio":flat_neighbors,"small_source":small,"predicted":predicted}


def led_view(rgb: np.ndarray, pitch: int = 9) -> Image.Image:
    h,w=rgb.shape[:2]; image=Image.new("RGB",(w*pitch,h*pitch),(0,0,0)); draw=ImageDraw.Draw(image)
    radius=pitch*.34
    for y in range(h):
        for x in range(w):
            color=tuple(np.uint8(np.clip(rgb[y,x],0,1)*255+.5))
            cx,cy=(x+.5)*pitch,(y+.5)*pitch
            draw.ellipse((cx-radius,cy-radius,cx+radius,cy+radius),fill=color)
    glow=image.filter(ImageFilter.GaussianBlur(pitch*.18))
    return Image.blend(image,glow,.28)


def contact_sheet(fixture: Fixture, outputs: list[tuple[str,np.ndarray]], destination: Path) -> None:
    cols=4; card_w,card_h=330,230; rows=math.ceil(len(outputs)/cols)
    sheet=Image.new("RGB",(cols*card_w,rows*card_h),(20,22,25)); draw=ImageDraw.Draw(sheet)
    font=ImageFont.load_default(size=14)
    for idx,(name,rgb) in enumerate(outputs):
        ox=(idx%cols)*card_w; oy=(idx//cols)*card_h
        draw.text((ox+8,oy+7),f"{chr(65+idx)}  {name}",font=font,fill=(235,235,235))
        grid=array_to_image(rgb).resize((256,128),Image.Resampling.NEAREST)
        sheet.paste(grid,(ox+8,oy+30))
        led=led_view(rgb,5).resize((160,80),Image.Resampling.LANCZOS)
        sheet.paste(led,(ox+8,oy+165))
        small=array_to_image(rgb).filter(ImageFilter.GaussianBlur(.35))
        sheet.paste(small,(ox+200,oy+174))
        draw.text((ox+198,oy+208),"apparent 32x16",font=font,fill=(150,155,160))
    destination.parent.mkdir(parents=True,exist_ok=True); sheet.save(destination)
    labels={chr(65+i):name for i,(name,_) in enumerate(outputs)}
    destination.with_suffix(".labels.json").write_text(json.dumps(labels,indent=2)+"\n")


def run_fixture(fixture: Fixture, width: int, height: int, output_dir: Path) -> tuple[list[Record],list[tuple[str,np.ndarray]]]:
    rgb=image_to_array(Image.open(fixture.path)); ctx=Context(fixture.palette_size,fixture.symmetric,fixture.content_type)
    reference=compose(rgb,width,height,"contain",Image.Resampling.BOX,True)
    records=[]; outputs=[]; fixture_dir=output_dir/fixture.path.stem; fixture_dir.mkdir(parents=True,exist_ok=True)
    for method in METHODS:
        if not applicable(method,fixture.content_type): continue
        started=time.perf_counter(); out=method.reducer(rgb,width,height,ctx); runtime=(time.perf_counter()-started)*1000
        out=np.clip(out,0,1); path=fixture_dir/f"{method.name}.png"; array_to_image(out).save(path)
        metrics=metric_bundle(reference,out,fixture.symmetric)
        unique=len(np.unique(np.uint8(out*255+.5).reshape(-1,3),axis=0))
        rank,notes=human_evaluation(fixture.path.name,method.name)
        records.append(Record(fixture.path.name,source_hash(fixture.path),fixture.content_type,method.name,method.composition,method.palette,method.color_space,method.quantization,method.dithering,unique,runtime_ms=runtime,human_rank=rank,human_notes=notes,output=str(path.relative_to(ROOT)),**metrics))
        outputs.append((method.name,out))
    return records,outputs


def write_records(records: list[Record], output_dir: Path) -> None:
    output_dir.mkdir(parents=True,exist_ok=True)
    fields=list(asdict(records[0]).keys()) if records else []
    with (output_dir/"benchmark.csv").open("w",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=fields); writer.writeheader(); writer.writerows(asdict(r) for r in records)
    (output_dir/"benchmark.json").write_text(json.dumps([asdict(r) for r in records],indent=2)+"\n")


def write_classification(fixtures: list[Fixture], width: int, height: int, output_dir: Path) -> None:
    rows=[]
    for fixture in fixtures:
        rgb=image_to_array(Image.open(fixture.path)); signals=classification_signals(rgb,width,height)
        expected="pixel-art" if fixture.content_type=="pixel-art" else "artwork" if fixture.content_type in ("artwork",) else "line/text" if fixture.content_type in ("line","text") else "cartoon/mixed" if fixture.content_type in ("cartoon","mixed") else "photo/gradient"
        rows.append({"fixture":fixture.path.name,"expected":expected,"correct":signals["predicted"]==expected,**signals})
    with (output_dir/"classification.csv").open("w",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0].keys()));writer.writeheader();writer.writerows(rows)
    (output_dir/"classification.json").write_text(json.dumps(rows,indent=2)+"\n")


def parse_target(value: str) -> tuple[int,int]:
    try: w,h=(int(x) for x in value.lower().split("x",1))
    except Exception as exc: raise argparse.ArgumentTypeError("target must be WIDTHxHEIGHT") from exc
    if w<1 or h<1: raise argparse.ArgumentTypeError("target dimensions must be positive")
    return w,h


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources",nargs="*",type=Path)
    parser.add_argument("--target",default="32x16",type=parse_target)
    parser.add_argument("--output",default=DEFAULT_RESULTS,type=Path)
    parser.add_argument("--generate-fixtures",action="store_true")
    args=parser.parse_args(); width,height=args.target
    fixtures=make_fixture_corpus() if args.generate_fixtures else discover_fixtures()
    if args.sources:
        fixtures=[Fixture(path,"mixed",6) for path in args.sources]
    if not fixtures: parser.error("no sources; pass --generate-fixtures or image paths")
    records=[]
    required={"atsk-logo","logo_hex_arrows_proxy","thin_line_icon","pixel_art_sprite","portrait_photo","portrait_photo_synthetic"}
    for fixture in fixtures:
        fixture_records,outputs=run_fixture(fixture,width,height,args.output); records.extend(fixture_records)
        if fixture.path.stem in required: contact_sheet(fixture,outputs,args.output/f"contact-sheet-{fixture.path.stem}.png")
        print(f"{fixture.path.name}: {len(outputs)} candidates")
    write_records(records,args.output)
    write_classification(fixtures,width,height,args.output)
    print(f"wrote {len(records)} benchmark rows to {args.output}")


if __name__ == "__main__": main()
