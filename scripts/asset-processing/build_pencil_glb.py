#!/usr/bin/env python3
"""Meridian Hex — parametric source builder for the hexagonal mechanical pencil.

This script IS the editable source asset. It generates, from named parametric
profiles (no Blender required):
  public/models/desktop/mechanical-pencil.glb  (full tessellation)
  public/models/mobile/mechanical-pencil-mobile.glb (reduced tessellation)
  public/models/source/manifest.json           (part registry)

Design language: hard-edged hexagonal hull, planar faces, flat shading,
inverse-crisscross machined grip lattice (real geometry), machined internals.
Pencil axis = +Y, tip at y~-7, button crown at y~+8 (matches camera choreography).

Usage: python3 scripts/asset-processing/build_pencil_glb.py
Requires: numpy, pygltflib
"""
import json
import math
import os
import sys

import numpy as np
from pygltflib import (
    Accessor,
    Buffer,
    BufferView,
    GLTF2,
    Material,
    Mesh as GMesh,
    Node,
    PbrMetallicRoughness,
    Primitive,
    Scene,
)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DESKTOP = os.path.join(ROOT, "public", "models", "desktop", "mechanical-pencil.glb")
MOBILE = os.path.join(ROOT, "public", "models", "mobile", "mechanical-pencil-mobile.glb")
MANIFEST = os.path.join(ROOT, "public", "models", "source", "manifest.json")
# Blender-modeled grip lattice (build_grip_blender.py output). When present,
# the `gripLattice` part uses this mesh instead of the procedural fallback.

TAU = math.tau


# ---------------------------------------------------------------- mesh helpers
class MeshBuilder:
    """Collects triangles as (3,3) arrays; normals derived flat per-face."""

    def __init__(self):
        self.tris = []

    def tri(self, a, b, c):
        self.tris.append(
            np.array([a, b, c], dtype=np.float64).reshape(3, 3)
        )

    def quad(self, a, b, c, d, out_ref=None):
        """Two tris; auto-flip so the face normal points away from out_ref."""
        a, b, c, d = (np.asarray(p, dtype=np.float64) for p in (a, b, c, d))
        n = np.cross(b - a, c - a)
        if out_ref is not None:
            ctr = (a + b + c + d) / 4.0
            if float(np.dot(n, ctr - np.asarray(out_ref, dtype=np.float64))) < 0:
                a, b, c, d = a, d, c, b
        self.tri(a, b, c)
        self.tri(a, c, d)

    def finish(self, uv_scale=2.5):
        if not self.tris:
            z = np.zeros((0, 3), np.float32)
            return z, z, np.zeros((0, 2), np.float32)
        t = np.stack(self.tris).reshape(-1, 3)
        tri = t.reshape(-1, 3, 3)
        n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        ln = np.linalg.norm(n, axis=1, keepdims=True)
        ln[ln == 0] = 1.0
        n = n / ln
        # box-projected UVs from the dominant face-normal axis —
        # sufficient for isotropic micro-grain (no continuity needed)
        an = np.abs(n)
        uv = np.zeros((len(tri), 3, 2), dtype=np.float64)
        for i in range(len(tri)):
            if an[i, 1] >= an[i, 0] and an[i, 1] >= an[i, 2]:
                uv[i] = tri[i][:, [0, 2]]
            elif an[i, 0] >= an[i, 2]:
                uv[i] = tri[i][:, [2, 1]]
            else:
                uv[i] = tri[i][:, [0, 1]]
        uv *= uv_scale
        return (t.astype(np.float32),
                n.repeat(3, axis=0).astype(np.float32),
                uv.reshape(-1, 2).astype(np.float32))


def hex_ring(y, r, rot=0.0):
    return [
        (r * math.cos(rot + k * TAU / 6), y, r * math.sin(rot + k * TAU / 6))
        for k in range(6)
    ]


def hex_stack(mb, levels, rot=0.0, capped=True, axis_ref=(0, 0, 0)):
    """levels: [(y, r)] bottom→top. Builds a faceted hex hull."""
    rings = [hex_ring(y, r, rot) for y, r in levels]
    for lo, hi in zip(rings[:-1], rings[1:]):
        for k in range(6):
            mb.quad(lo[k], lo[(k + 1) % 6], hi[(k + 1) % 6], hi[k],
                     out_ref=axis_ref)
    if capped:
        y0, r0 = levels[0]
        c0 = (0.0, y0, 0.0)
        ring0 = rings[0]
        for k in range(6):
            mb.quad(c0, ring0[(k + 1) % 6], ring0[k], c0,
                     out_ref=(0, y0 - 1, 0))
        y1, _ = levels[-1]
        c1 = (0.0, y1, 0.0)
        ring1 = rings[-1]
        for k in range(6):
            mb.quad(c1, ring1[k], ring1[(k + 1) % 6], c1,
                     out_ref=(0, y1 + 1, 0))


def open_hex_tube(mb, y0, y1, r, rot=0.0):
    hex_stack(mb, [(y0, r), (y1, r)], rot=rot, capped=False)


def cyl(mb, y0, y1, r, seg=12):
    pts0 = [(r * math.cos(k * TAU / seg), y0, r * math.sin(k * TAU / seg))
            for k in range(seg)]
    pts1 = [(r * math.cos(k * TAU / seg), y1, r * math.sin(k * TAU / seg))
            for k in range(seg)]
    for k in range(seg):
        mb.quad(pts0[k], pts0[(k + 1) % seg], pts1[(k + 1) % seg], pts1[k],
                 out_ref=(0, (y0 + y1) / 2, 0))
    # caps
    c0 = (0.0, y0, 0.0)
    for k in range(seg):
        mb.quad(c0, pts0[(k + 1) % seg], pts0[k], c0, out_ref=(0, y0 - 1, 0))
    c1 = (0.0, y1, 0.0)
    for k in range(seg):
        mb.quad(c1, pts1[k], pts1[(k + 1) % seg], c1, out_ref=(0, y1 + 1, 0))


def _rot_y(p, ang):
    c, s = math.cos(ang), math.sin(ang)
    x, y, z = p
    return (c * x + s * z, y, -s * x + c * z)


def box(mb, center, size, rot_y=0.0, tilt_z=0.0, tilt_x=0.0):
    """Axis-aligned box (optionally rotated) centred at `center`."""
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    v = [(x, y, z) for x in (-sx, sx) for y in (-sy, sy) for z in (-sz, sz)]
    # order: (-,-,-),(+,-,-),(+,-,+),(-,-,+)... build faces explicitly
    cx, cy, cz = center
    # local corners
    L = {
        (i, j, k): (cx + (sx if i else -sx), cy + (sy if j else -sy),
                    cz + (sz if k else -sz))
        for i in (0, 1) for j in (0, 1) for k in (0, 1)
    }

    def X(p):
        # rotate about centre
        x, y, z = p[0] - cx, p[1] - cy, p[2] - cz
        if tilt_z:
            c, s = math.cos(tilt_z), math.sin(tilt_z)
            x, y = c * x - s * y, s * x + c * y
        if tilt_x:
            c, s = math.cos(tilt_x), math.sin(tilt_x)
            y, z = c * y - s * z, s * y + c * z
        if rot_y:
            x, y, z = _rot_y((x, y, z), rot_y)
        return (x + cx, y + cy, z + cz)

    c = {k: X(p) for k, p in L.items()}
    faces = [
        (c[0, 0, 0], c[1, 0, 0], c[1, 0, 1], c[0, 0, 1]),
        (c[0, 1, 0], c[0, 1, 1], c[1, 1, 1], c[1, 1, 0]),
        (c[0, 0, 0], c[0, 0, 1], c[0, 1, 1], c[0, 1, 0]),
        (c[1, 0, 0], c[1, 1, 0], c[1, 1, 1], c[1, 0, 1]),
        (c[0, 0, 0], c[0, 1, 0], c[1, 1, 0], c[1, 0, 0]),
        (c[0, 0, 1], c[1, 0, 1], c[1, 1, 1], c[0, 1, 1]),
    ]
    for f in faces:
        mb.quad(*f, out_ref=center)


def helix_tube(mb, coils, R, y0, y1, wire, steps_per_coil=24, wire_seg=8):
    """Round wire swept along a helix. Curves are mechanically justified."""
    n = int(coils * steps_per_coil)
    ts = np.linspace(0, 1, n + 1)
    ang = ts * coils * TAU
    cy = y0 + ts * (y1 - y0)
    spine = np.stack([R * np.cos(ang), cy, R * np.sin(ang)], axis=1)
    # tangent via central differences
    tan = np.gradient(spine, axis=0)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True) + 1e-12
    # stable frame: radial reference
    rings = []
    for i in range(n + 1):
        t = tan[i]
        # pick helper not parallel to t
        h = np.array([0.0, 1.0, 0.0])
        if abs(float(np.dot(h, t))) > 0.9:
            h = np.array([1.0, 0.0, 0.0])
        n1 = h - np.dot(h, t) * t
        n1 /= np.linalg.norm(n1) + 1e-12
        n2 = np.cross(t, n1)
        ring = [
            spine[i] + wire * (math.cos(a) * n1 + math.sin(a) * n2)
            for a in np.linspace(0, TAU, wire_seg, endpoint=False)
        ]
        rings.append(ring)
    for r0, r1 in zip(rings[:-1], rings[1:]):
        mid = (np.mean(r0, axis=0) + np.mean(r1, axis=0)) / 2
        for k in range(wire_seg):
            mb.quad(r0[k], r0[(k + 1) % wire_seg],
                     r1[(k + 1) % wire_seg], r1[k], out_ref=tuple(mid))


# ---------------------------------------------------------------- part builders
# Each returns (MeshBuilder, material_name). Geometry is LOCAL (part origin at
# y=0 centre); node translation carries the assembled base position.
def P(builder_fn):
    mb = MeshBuilder()
    mat = builder_fn(mb)
    return mb, mat


# ------------------------------------------------------------------ registry
PARTS = []  # (node_name, parent_path, baseY, explode, kind, mech, extra)


def part(name, parent, base_y, explode, kind, mech="static", extra=None):
    PARTS.append({"name": name, "parent": parent, "baseY": base_y,
                  "explode": explode, "kind": kind, "mech": mech,
                  "extra": extra or {}})


def define_assembly():
    # ---- Exterior -------------------------------------------------
    part("buttonHex", "Exterior", 7.55, 3.3, "shell", "button")
    part("buttonStem", "Exterior", 6.95, 3.5, "inner", "stem")
    part("eraser", "Exterior", 6.95, 2.8, "inner", "static")
    part("eraserSleeve", "Exterior", 6.85, 2.85, "inner", "static")
    part("buttonSpring", "Exterior", 6.62, 2.9, "inner", "springBtn")
    part("topCollar", "Exterior", 6.15, 2.5, "shell", "static")
    part("actuatorCone", "Internal", 6.05, 2.4, "inner", "actuator")
    part("actuatorSleeve", "Internal", 5.85, 2.3, "inner", "actuator")
    part("washerTop", "Internal", 6.40, 2.6, "inner", "static")
    part("feedRod", "Internal", 3.90, 1.3, "inner", "rod")
    part("shaftMid", "Internal", 3.10, 1.1, "inner", "rod")
    part("reservoirHex", "Internal", 2.00, 0.9, "inner", "static")
    part("resPlug", "Internal", 3.60, 1.15, "inner", "static")
    part("clutchHousing", "Internal", 5.35, 1.95, "inner", "clutch")
    part("jawA", "Internal", 5.15, 2.06, "inner", "jaw",
         {"jawAngle": 0.0})
    part("jawB", "Internal", 5.15, 2.20, "inner", "jaw",
         {"jawAngle": 2.0944})
    part("jawC", "Internal", 5.15, 2.34, "inner", "jaw",
         {"jawAngle": 4.1888})
    part("retainerHex", "Internal", 5.42, 2.25, "inner", "static")
    part("seatLow", "Internal", 3.95, 1.5, "inner", "static")
    part("returnSpring", "Internal", 4.55, 1.6, "inner", "springMain")
    part("seatUp", "Internal", 5.15, 1.9, "inner", "static")
    part("stabilizerSpring", "Internal", 2.60, 0.7, "inner", "springStab")
    part("guideTube", "Internal", -1.60, -0.3, "inner", "static")
    part("threadRing", "Internal", -0.15, 0.35, "inner", "static")
    part("spacerTube", "Internal", 0.90, 0.6, "inner", "static")
    part("noseWasher", "Internal", -3.55, -1.25, "inner", "static")
    part("stopCollar", "Internal", 4.35, 1.7, "inner", "static")
    # ---- shell ----------------------------------------------------
    part("barrelHex", "Exterior", 2.60, 0.0, "shell", "static")
    part("barrelGrooves", "Exterior", 2.60, 0.0, "shell", "static")
    part("clipBlade", "Exterior", 0.0, 0.15, "shell", "static")
    part("clipFoot", "Exterior", 5.75, 0.3, "shell", "static")
    part("clipScrew", "Exterior", 5.75, 0.55, "inner", "static")
    part("gripSleeve", "Exterior", -1.95, -0.8, "shell", "static")
    part("gripUnderlay", "Exterior", -1.95, -0.8, "shell", "static")
    part("gripLattice", "Exterior", -1.95, -0.8, "shell", "static")
    part("gripRingTop", "Exterior", -0.45, 0.6, "shell", "static")
    part("gripRingBot", "Exterior", -3.30, -1.0, "shell", "static")
    part("noseHex", "Exterior", -4.85, -1.6, "shell", "static")
    part("noseTip", "Exterior", -5.00, -2.2, "shell", "static")
    part("noseInsert", "Internal", -4.75, -2.2, "inner", "static")
    part("leadSleeve", "Internal", -5.55, -2.7, "inner", "sleeve")
    part("lead", "Internal", -6.55, -3.1, "inner", "lead")


MATERIALS = {
    # name: (baseColor RGBA, metallic, roughness, alphaMode)
    "anodized": ((0.10, 0.16, 0.26, 1.0), 0.9, 0.34, "OPAQUE"),
    "dlc": ((0.07, 0.075, 0.08, 1.0), 0.85, 0.42, "OPAQUE"),
    "steel": ((0.78, 0.80, 0.83, 1.0), 1.0, 0.22, "OPAQUE"),
    "polished": ((0.84, 0.85, 0.87, 1.0), 1.0, 0.14, "OPAQUE"),
    "brass": ((0.62, 0.48, 0.28, 1.0), 1.0, 0.30, "OPAQUE"),
    "spring": ((0.55, 0.57, 0.60, 1.0), 1.0, 0.38, "OPAQUE"),
    "polymer": ((0.07, 0.07, 0.08, 1.0), 0.0, 0.45, "OPAQUE"),
    "mechdark": ((0.10, 0.11, 0.12, 1.0), 0.4, 0.50, "OPAQUE"),
    "reservoir": ((0.23, 0.24, 0.26, 0.45), 0.1, 0.15, "BLEND"),
    "eraser": ((0.85, 0.54, 0.63, 1.0), 0.0, 0.92, "OPAQUE"),
    "lead": ((0.15, 0.16, 0.17, 1.0), 0.25, 0.55, "OPAQUE"),
    "recess": ((0.03, 0.03, 0.035, 1.0), 0.6, 0.60, "OPAQUE"),
}


# ---------------------------------------------------------------- geometry
def build_part_geometry(name, q):
    """q in {'desktop','mobile'} — returns (MeshBuilder, material)."""
    mb = MeshBuilder()
    R = 0.45
    spc = 24 if q == "desktop" else 10  # spring steps per coil
    ws = 8 if q == "desktop" else 5     # spring wire segments
    cyl_seg = 18 if q == "desktop" else 10

    if name == "barrelHex":
        # hexagonal hull with chamfered ends, local y -3.15..3.15
        hex_stack(mb, [(-3.15, 0.36), (-3.0, 0.44), (-2.9, R),
                       (2.9, R), (3.0, 0.44), (3.15, 0.36)])
        return mb, "anodized"
    if name == "barrelGrooves":
        # two recessed hex groove rings near the top of the barrel
        # r=0.465: deliberately ~0.015 proud of the hull (r=0.45) so the
        # bands interpenetrate the hull instead of hovering 0.002 above it
        for dy in (2.30, 2.46):
            hex_stack(mb, [(dy - 0.035, 0.465), (dy + 0.035, 0.465)],
                       capped=True)
        return mb, "recess"
    if name == "gripSleeve":
        hex_stack(mb, [(-1.35, 0.40), (-1.25, 0.44), (1.28, 0.44),
                       (1.42, 0.40)])
        return mb, "dlc"
    if name == "gripUnderlay":
        # same metal as the sleeve: knurling is cut into one material
        # r=0.410 keeps a clear 0.03 gap to the sleeve wall (r=0.44)
        hex_stack(mb, [(-1.30, 0.410), (1.30, 0.410)], capped=False)
        return mb, "dlc"
    if name == "gripLattice":
        # Seamless honeycomb knurl: truncated HEXAGONAL pyramids (flat tops)
        # tiling each face with shared edges — zero gaps by construction.
        # Flat-top hexes: columns spaced 1.5R, rows R√3, alternate columns
        # offset half a row. Footprints crossing a face boundary are clamped
        # onto it, so edge/end cells read as machined cut cells.
        apo = 0.44 * math.cos(math.pi / 6)
        HU, HV = 0.22, 1.30  # face half-width / half-length (cut bounds)
        R = 0.055 if q == "desktop" else 0.075
        top, h, foot = 0.7 * R, 0.018, 0.006
        col_step, row_step = 1.5 * R, R * math.sqrt(3.0)
        s = top / R

        def clamp_u(u):
            return min(HU, max(-HU, u))

        def clamp_v(v):
            return min(HV, max(-HV, v))

        for f in range(6):
            th = (f + 0.5) * TAU / 6  # face centers, not vertices
            nx, nz = math.cos(th), math.sin(th)
            ux, uz = -nz, nx  # face tangent

            def P(u, v, hgt):
                return (nx * (apo - foot + hgt) + ux * u,
                        v,
                        nz * (apo - foot + hgt) + uz * u)

            ci = 0
            u = -HU - R
            while u <= HU + R + 1e-9:
                # alternate columns offset half a row for honeycomb interlock
                v_off = (row_step / 2) if ci % 2 else 0.0
                v = -HV - R + v_off
                while v <= HV + R + 1e-9:
                    if (u > -HU - R and u < HU + R
                            and v > -HV - R and v < HV + R):
                        B = []
                        for k in range(6):
                            a = k * math.pi / 3
                            B.append((clamp_u(u + R * math.cos(a)),
                                      clamp_v(v + R * math.sin(a))))
                        T = []
                        for (uu, vv) in B:
                            tu = u + (uu - u) * s
                            tv = v + (vv - v) * s
                            T.append((clamp_u(tu), clamp_v(tv)))
                        B3 = [P(uu, vv, 0.0) for (uu, vv) in B]
                        T3 = [P(uu, vv, h) for (uu, vv) in T]
                        for k in range(6):
                            k2 = (k + 1) % 6
                            mid = ((B[k][0] + B[k2][0]) / 2,
                                   (B[k][1] + B[k2][1]) / 2)
                            mb.quad(B3[k], B3[k2], T3[k2], T3[k],
                                     out_ref=P(mid[0], mid[1], 0.0))
                        # top fan wound opposite (corners run clockwise
                        # seen from outside the face)
                        for k in (4, 3, 2, 1):
                            mb.tri(T3[0], T3[k + 1], T3[k])
                    v += row_step
                u += col_step
                ci += 1
        return mb, "dlc"
    if name in ("gripRingTop", "gripRingBot"):
        # chamfered hex collar ring; bottom extended 0.02 on gripRingTop
        # so its face interpenetrates the barrel end instead of sitting
        # coplanar with it (gripRingBot already straddles the sleeve end)
        lo = -0.12 if name == "gripRingTop" else -0.10
        hex_stack(mb, [(lo, 0.40), (-0.05, 0.465), (0.05, 0.465),
                       (0.10, 0.40)])
        return mb, "steel"
    if name == "noseHex":
        # faceted nose cone: tapers toward the lead (down, -Y).
        # Local y=0 is the NARROW (lead-side) end, y=2.10 the WIDE end that
        # mates with the grip above. (Previously inverted: wide end down.)
        hex_stack(mb, [(0.0, 0.075), (0.15, 0.10), (0.60, 0.17),
                       (1.20, 0.28), (1.85, 0.40), (2.10, 0.42)])
        return mb, "polished"
    if name == "noseTip":
        # tip ferrule: tapers toward the lead (down). Top (cone-side)
        # r=0.075 meets the cone's narrow end flush; bottom r=0.055 meets
        # the leadSleeve (r=0.055) flush. (Previously inverted.)
        # tip ferrule: tapers toward the lead (down). Top r=0.075 sinks
        # 0.03 INTO the cone's narrow end instead of ending flush at its face
        hex_stack(mb, [(-0.15, 0.055), (0.10, 0.070), (0.18, 0.075)])
        return mb, "polished"
    if name == "noseInsert":
        hex_stack(mb, [(-0.40, 0.045), (0.0, 0.055), (0.40, 0.095)])
        return mb, "brass"
    if name == "leadSleeve":
        # r=0.048: clear 0.007 step inside the tip bore (r=0.055),
        # was exactly coplanar (0.055/0.055) over the 0.10 overlap
        cyl(mb, -0.50, 0.50, 0.048, seg=cyl_seg)
        return mb, "steel"
    if name == "lead":
        cyl(mb, -0.65, 0.65, 0.025, seg=8)
        return mb, "lead"
    if name == "topCollar":
        # hex collar with two machined grooves
        hex_stack(mb, [(-0.28, 0.36), (-0.22, 0.42), (-0.10, 0.44),
                       (-0.04, 0.40), (0.02, 0.44), (0.14, 0.44),
                       (0.20, 0.40), (0.28, 0.34)])
        return mb, "polymer"
    if name == "buttonHex":
        # faceted push-button: tapered hex + crown pad
        hex_stack(mb, [(-0.55, 0.30), (-0.45, 0.33), (0.35, 0.33),
                       (0.48, 0.30), (0.55, 0.22)])
        return mb, "polymer"
    if name == "buttonStem":
        # bottom extended 0.07 so it sinks into washerTop instead of
        # floating 0.055 above it
        hex_stack(mb, [(-0.52, 0.13), (0.45, 0.13)], capped=True)
        return mb, "steel"
    if name == "eraser":
        cyl(mb, -0.31, 0.31, 0.18, seg=cyl_seg)
        return mb, "eraser"
    if name == "eraserSleeve":
        # bottom extended 0.06 to sink INTO washerTop (was a 0.045 float)
        open_hex_tube(mb, -0.42, 0.36, 0.22)
        return mb, "brass"
    if name == "buttonSpring":
        helix_tube(mb, 5, 0.20, -0.25, 0.25, 0.026, spc, ws)
        return mb, "spring"
    if name == "returnSpring":
        # ends extended 0.03 so coils sink 0.02 INTO seatLow/seatUp
        # instead of hovering 0.01 off their faces
        helix_tube(mb, 8, 0.26, -0.58, 0.58, 0.032, spc, ws)
        return mb, "spring"
    if name == "stabilizerSpring":
        # R 0.33->0.35: coil inner clears the reservoir vertices (0.31)
        # by 0.018 (was a 0.002 graze)
        helix_tube(mb, 6, 0.35, -0.40, 0.40, 0.022, spc, ws)
        return mb, "spring"
    if name == "actuatorCone":
        hex_stack(mb, [(-0.30, 0.12), (-0.20, 0.18), (0.15, 0.30),
                       (0.30, 0.30)])
        return mb, "mechdark"
    if name == "actuatorSleeve":
        open_hex_tube(mb, -0.35, 0.35, 0.19)
        return mb, "mechdark"
    if name == "feedRod":
        cyl(mb, -0.60, 0.60, 0.15, seg=cyl_seg)
        # hollow look: dark inner cap ring
        return mb, "polished"
    if name == "shaftMid":
        hex_stack(mb, [(-0.55, 0.16), (0.55, 0.16)], capped=True)
        return mb, "steel"
    if name == "reservoirHex":
        open_hex_tube(mb, -1.50, 1.50, 0.31)
        return mb, "reservoir"
    if name == "resPlug":
        hex_stack(mb, [(-0.17, 0.28), (0.17, 0.31)], capped=True)
        return mb, "mechdark"
    if name == "clutchHousing":
        hex_stack(mb, [(-0.42, 0.16), (-0.36, 0.24), (-0.22, 0.26),
                       (0.23, 0.26), (0.37, 0.22), (0.42, 0.16)])
        return mb, "brass"
    if name in ("jawA", "jawB", "jawC"):
        # tapered clutch jaw wedge with chamfered tip
        # each jaw rotated by its jawAngle: the three wedges were built
        # identical at the origin (triple-coplanar) — now clocked 120°
        # apart so faces interpenetrate at angles instead of coinciding
        ang = {"jawA": 0.0, "jawB": 2.0944, "jawC": 4.1888}[name]
        mb2 = mb
        # wedge: box tapering toward -Y tip
        yT, yB = 0.31, -0.31
        wT, wB = 0.055, 0.075
        d = 0.045
        # 8 corners
        T = [_rot_y(p, ang) for p in
             [(-wT, yT, -d), (wT, yT, -d), (wT, yT, d), (-wT, yT, d)]]
        B = [_rot_y(p, ang) for p in
             [(-wB, yB, -d), (wB, yB, -d), (wB, yB, d), (-wB, yB, d)]]
        faces = [
            (T[0], T[1], T[2], T[3]),
            (B[0], B[3], B[2], B[1]),
            (T[0], B[0], B[1], T[1]),
            (T[2], B[2], B[3], T[3]),
            (T[1], B[1], B[2], T[2]),
            (T[3], B[3], B[0], T[0]),
        ]
        for f in faces:
            mb2.quad(*f, out_ref=(0, 0, 0))
        return mb, "brass"
    if name == "retainerHex":
        hex_stack(mb, [(-0.14, 0.21), (-0.10, 0.235), (0.10, 0.235),
                       (0.14, 0.21)])
        return mb, "mechdark"
    if name in ("seatLow", "seatUp"):
        hex_stack(mb, [(-0.04, 0.30), (0.04, 0.30)], capped=True)
        return mb, "mechdark"
    if name == "washerTop":
        # bottom sinks 0.015 into the actuator cone top; top stands 0.025
        # proud of the collar face (was 0.005/0.015 near-touching both)
        hex_stack(mb, [(-0.065, 0.32), (0.055, 0.32)], capped=True)
        return mb, "mechdark"
    if name == "noseWasher":
        hex_stack(mb, [(-0.05, 0.36), (0.05, 0.36)], capped=True)
        return mb, "mechdark"
    if name == "stopCollar":
        hex_stack(mb, [(-0.09, 0.24), (0.09, 0.24)], capped=True)
        return mb, "brass"
    if name == "guideTube":
        open_hex_tube(mb, -0.80, 0.80, 0.20)
        return mb, "brass"
    if name == "threadRing":
        hex_stack(mb, [(-0.30, 0.38), (-0.22, 0.40), (0.22, 0.40),
                       (0.30, 0.38)])
        # thread ridges: 0.012 proud of the ring wall (was 0.005 hover)
        for dy in (-0.12, 0.0, 0.12):
            r0, r1 = [], []
            for k in range(6):
                a0 = k * TAU / 6
                r0.append((0.412 * math.cos(a0), dy - 0.018,
                           0.412 * math.sin(a0)))
                r1.append((0.412 * math.cos(a0), dy + 0.018,
                           0.412 * math.sin(a0)))
            for k in range(6):
                mb.quad(r0[k], r0[(k + 1) % 6], r1[(k + 1) % 6], r1[k],
                         out_ref=(0, dy, 0))
        return mb, "brass"
    if name == "spacerTube":
        open_hex_tube(mb, -0.45, 0.45, 0.34)
        return mb, "mechdark"
    if name == "clipBlade":
        # faceted flat clip: 3 planar segments stepping off the barrel
        # local: blade runs along +Y, stands off +Z face of hex barrel
        seg1 = [(-0.08, -1.5, 0.0), (0.08, -1.5, 0.0),
                (0.08, 0.4, 0.0), (-0.08, 0.4, 0.0)]
        # offset outward in +Z by standoff, with thickness via two faces
        t = 0.035
        for (y0, y1, zc) in ((-1.5, 0.75, 0.52),):
            a = (-0.085, y0, zc)
            b = (0.085, y0, zc)
            c = (0.085, y1, zc + 0.02)
            d = (-0.085, y1, zc + 0.02)
            mb.quad(a, b, c, d, out_ref=(0, (y0 + y1) / 2, zc + 1))
            mb.quad((a[0], a[1], a[2] - t), (d[0], d[1], d[2] - t),
                     (c[0], c[1], c[2] - t), (b[0], b[1], b[2] - t),
                     out_ref=(0, (y0 + y1) / 2, zc - 1))
        # top tab bends inward (-Z) to sink INTO the clip foot front
        # (foot front z=0.47 after seating; tab ends at z=0.44, y=5.80)
        mb.quad((-0.085, 0.75, 0.54), (0.085, 0.75, 0.54),
                 (0.085, 0.95, 0.44), (-0.085, 0.95, 0.44),
                 out_ref=(0, 0.85, 1))
        # bent tip tab
        mb.quad((-0.085, -1.5, 0.52), (0.085, -1.5, 0.52),
                 (0.085, -1.78, 0.46), (-0.085, -1.78, 0.46),
                 out_ref=(0, -1.6, 1))
        return mb, "steel"
    if name == "clipFoot":
        box(mb, (0, 0, 0), (0.17, 0.34, 0.10))
        return mb, "mechdark"
    if name == "clipScrew":
        cyl(mb, -0.03, 0.03, 0.055, seg=6)
        return mb, "mechdark"
    raise ValueError(f"unknown part {name}")


# ---------------------------------------------------------------- glTF writer
def write_glb(path, q):
    define_assembly() if not PARTS else None
    blob = bytearray()
    g = GLTF2()
    g.asset.version = "2.0"
    g.asset.generator = "meridian-hex parametric builder"
    g.scenes.append(Scene(nodes=[0]))
    # materials
    mat_index = {}
    for mname, (rgba, metal, rough, alpha) in MATERIALS.items():
        pbr = PbrMetallicRoughness(baseColorFactor=list(rgba),
                                   metallicFactor=metal,
                                   roughnessFactor=rough)
        m = Material(pbrMetallicRoughness=pbr, name=mname,
                     doubleSided=True)
        if alpha == "BLEND":
            m.alphaMode = "BLEND"
        mat_index[mname] = len(g.materials)
        g.materials.append(m)

    def push_array(arr, comp_type, count, kind):
        nonlocal blob
        data = np.asarray(arr).tobytes()
        # pad to 4 bytes
        pad = (-len(data)) % 4
        bv = BufferView(buffer=0, byteOffset=len(blob),
                        byteLength=len(data) + pad)
        g.bufferViews.append(bv)
        blob.extend(data)
        blob.extend(b"\x00" * pad)
        acc = Accessor(
            bufferView=len(g.bufferViews) - 1,
            byteOffset=0,
            componentType=comp_type,
            count=count,
            type=kind,
        )
        g.accessors.append(acc)
        return len(g.accessors) - 1

    FLOAT = 5126
    mesh_index = {}
    for spec in PARTS:
        mb, mname = build_part_geometry(spec["name"], q)
        pos, nor, uv = mb.finish()
        if len(pos) == 0:
            raise ValueError(f"empty geometry for {spec['name']}")
        mn, mx = pos.min(axis=0).tolist(), pos.max(axis=0).tolist()
        pa = push_array(pos, FLOAT, len(pos), "VEC3")
        na = push_array(nor, FLOAT, len(nor), "VEC3")
        ua = push_array(uv, FLOAT, len(uv), "VEC2")
        g.accessors[pa].min = mn
        g.accessors[pa].max = mx
        prim = Primitive(attributes={"POSITION": pa, "NORMAL": na,
                                     "TEXCOORD_0": ua},
                         material=mat_index[mname])
        mesh = GMesh(primitives=[prim], name=spec["name"])
        mesh_index[spec["name"]] = len(g.meshes)
        g.meshes.append(mesh)

    # nodes: Pencil root + groups + parts
    root = Node(name="Pencil", children=[])
    g.nodes.append(root)
    groups = {}
    for grp in ("Exterior", "Internal"):
        n = Node(name=grp, children=[])
        groups[grp] = len(g.nodes)
        g.nodes.append(n)
        root.children.append(groups[grp])
    for spec in PARTS:
        extras = {"ex": spec["explode"], "kind": spec["kind"],
                  "mech": spec["mech"]}
        extras.update(spec["extra"])
        n = Node(name=spec["name"], mesh=mesh_index[spec["name"]],
                 translation=[0.0, spec["baseY"], 0.0], extras=extras)
        # clip parts ride off-axis
        if spec["name"] == "clipBlade":
            n.translation = [0.0, 4.85, 0.0]
        if spec["name"] == "clipFoot":
            # seated 0.02 into the barrel face (was grazing it) —
            # back face z=0.37 vs face apothem ~0.381
            n.translation = [0.0, 5.75, 0.42]
        if spec["name"] == "clipScrew":
            n.translation = [0.0, 5.75, 0.50]
        g.nodes.append(n)
        g.nodes[groups[spec["parent"]]].children.append(len(g.nodes) - 1)

    g.buffers.append(Buffer(byteLength=len(blob)))
    g.set_binary_blob(bytes(blob))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    g.save(path)  # .glb extension → binary container
    size = os.path.getsize(path)
    tris = sum(len(build_part_geometry(s["name"], q)[0].tris)
               for s in PARTS)
    print(f"[{q}] {path} — {size/1024:.0f} KB, ~{tris} tris, "
          f"{len(PARTS)} parts")
    return size


def write_manifest():
    define_assembly() if not PARTS else None
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w") as f:
        json.dump({"parts": PARTS,
                   "materials": {k: {"metallic": v[1], "roughness": v[2],
                                     "alpha": v[3]} for k, v in
                                 MATERIALS.items()}}, f, indent=1)
    print(f"manifest {MANIFEST} — {len(PARTS)} parts")


if __name__ == "__main__":
    PARTS.clear()
    define_assembly()
    write_glb(DESKTOP, "desktop")
    write_glb(MOBILE, "mobile")
    write_manifest()
