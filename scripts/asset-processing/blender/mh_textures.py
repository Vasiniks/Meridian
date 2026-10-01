"""Meridian Hex — deterministic surface-texture synthesis (numpy only).

All maps are periodic (FFT-filtered noise), so they tile with no seams and no
visible repetition at the UV density the builder uses (1 UV unit = 1 model
unit = ~10 mm of real pencil).

Maps
----
grain_n    tangent-space normal map of a bead-blasted / frosted metal surface:
           a narrow band of isotropic micro-relief (wavelength ~5-10 texels
           ~ 0.05-0.1 mm), nothing coarser, so it reads as frost, never as
           leather or hammer-tone. OpenGL (+Y up) convention, as glTF.
grain_orm  packed occlusion/roughness/metal (glTF channel layout):
           R = 1 (no baked AO), G = roughness multiplier ~0.86-1.0
           (fine, uncorrelated with the dimples so the sparkle breaks up),
           B = 1 (metal; the material factor scales it).
turned_n   1-D lathe "turning marks" (~0.1 mm feed lines) for turned parts:
           only varies along V (the pencil axis), so highlights stretch
           along the axis like a real turned / bead-polished finish.

Everything is seeded: running the builder twice gives byte-identical maps.
"""
import numpy as np

TAU = 2.0 * np.pi


def _radial_freq(n):
    f = np.fft.fftfreq(n) * n  # cycles per tile
    fx, fy = np.meshgrid(f, f)
    return np.sqrt(fx * fx + fy * fy)


def band_noise(n, f_lo, f_hi, seed, slope=0.0, edge=0.2):
    """Periodic isotropic noise with energy between f_lo..f_hi cycles/tile
    (raised-cosine edges of relative width `edge`), optional 1/f^slope tilt.
    Zero mean, unit variance."""
    rng = np.random.default_rng(seed)
    w = rng.standard_normal((n, n))
    F = np.fft.fft2(w)
    fr = _radial_freq(n)
    lo_w = edge * f_lo
    hi_w = edge * f_hi
    win = np.ones_like(fr)
    a = (fr - (f_lo - lo_w)) / (2 * lo_w)
    win *= np.where(fr < f_lo - lo_w, 0.0,
                    np.where(fr < f_lo + lo_w, 0.5 - 0.5 * np.cos(np.pi * np.clip(a, 0, 1)), 1.0))
    b = (fr - (f_hi - hi_w)) / (2 * hi_w)
    win *= np.where(fr > f_hi + hi_w, 0.0,
                    np.where(fr > f_hi - hi_w, 0.5 + 0.5 * np.cos(np.pi * np.clip(b, 0, 1)), 1.0))
    if slope:
        win *= np.where(fr > 0, (np.maximum(fr, 1.0) / f_lo) ** (-slope), 0.0)
    win[0, 0] = 0.0
    h = np.real(np.fft.ifft2(F * win))
    h -= h.mean()
    h /= h.std() + 1e-12
    return h


def height_to_normal(h, strength):
    """Periodic central differences -> OpenGL tangent-space normal (RGB 0..1).
    Rows = +V, columns = +U (Blender image order: row 0 is the bottom)."""
    dhdu = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dhdv = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx = -strength * dhdu
    ny = -strength * dhdv
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5


def grain_maps(n=1024):
    """Returns (normal RGB, orm RGB) float32 arrays in 0..1, shape (n,n,3).
    Bead-blast frost = a narrow band of isotropic micro-relief only: no
    low-frequency content at all (that is what reads as leather / hammered /
    orange-peel), no crater bias. Wavelength 0.05-0.1 mm at 1 tile = 10 mm.
    Normal slope RMS ~0.25 at normalScale 1 (materials scale it down)."""
    s = n / 1024.0
    fine = band_noise(n, 105 * s, 190 * s, seed=11)
    micro = band_noise(n, 190 * s, 320 * s, seed=12)
    h = fine + 0.35 * micro
    h = (h - h.mean()) / (h.std() + 1e-12)
    nrm = height_to_normal(h, strength=0.29 * s)
    rough_fine = band_noise(n, 100 * s, 260 * s, seed=21)
    rough = 0.935 + 0.04 * np.tanh(rough_fine * 0.9)
    rough = np.clip(rough, 0.85, 1.0)
    orm = np.stack([np.ones_like(rough), rough, np.ones_like(rough)], axis=-1)
    return nrm.astype(np.float32), orm.astype(np.float32)


def _blend_normals(a, b, wb):
    """Whiteout-style blend: a + wb*b detail (both encoded 0..1)."""
    na = a * 2 - 1
    nb = b * 2 - 1
    x = na[..., 0] + wb * nb[..., 0]
    y = na[..., 1] + wb * nb[..., 1]
    z = na[..., 2]
    ln = np.sqrt(x * x + y * y + z * z)
    return np.stack([x / ln, y / ln, z / ln], axis=-1) * 0.5 + 0.5


def turned_map(h_px=1024, w_px=32):
    """Lathe feed marks along V: 104 feed lines per model unit (~0.1 mm feed)
    with per-line jitter plus faint chatter. Periodic in V. Slope RMS ~0.12
    at normalScale 1 — meant to be felt as an axial sheen, not seen as
    grooves."""
    rng = np.random.default_rng(31)
    v = np.arange(h_px) / h_px
    lines = 104
    ph = TAU * lines * v
    amp = 1.0 + 0.3 * np.interp(v * lines, np.arange(lines + 1), rng.standard_normal(lines + 1))
    feed = amp * (np.sin(ph) - 0.15 * np.sin(2 * ph))
    k = np.arange(1, h_px // 3)
    spec = rng.standard_normal(len(k)) * np.exp(-((k - 300) / 70.0) ** 2)
    phase = rng.random(len(k)) * TAU
    chatter = (spec[None, :] * np.cos(TAU * k[None, :] * v[:, None] + phase[None, :])).sum(1)
    chatter /= chatter.std() + 1e-12
    h = feed + 0.3 * chatter
    h = (h - h.mean()) / (h.std() + 1e-12)
    dhdv = (np.roll(h, -1) - np.roll(h, 1)) * 0.5
    ny = -0.2 * dhdv
    nz = np.ones_like(ny)
    ln = np.sqrt(ny * ny + nz * nz)
    col = np.stack([np.zeros_like(ny), ny / ln, nz / ln], axis=-1) * 0.5 + 0.5
    img = np.repeat(col[:, None, :], w_px, axis=1)
    return img.astype(np.float32)


if __name__ == "__main__":
    nrm, orm = grain_maps(256)
    print(nrm.shape, nrm.min(), nrm.max(), orm[..., 1].min(), orm[..., 1].max())
    t = turned_map()
    print(t.shape, t.min(), t.max())
