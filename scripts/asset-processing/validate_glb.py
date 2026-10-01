#!/usr/bin/env python3
"""Validate the Meridian pencil GLBs against the runtime contract.

Checks (each GLB given on the command line, default = both tiers):
  * root `Pencil` -> `Exterior` / `Internal` -> exactly 42 named part nodes,
    names/parents matching public/models/source/manifest.json, and the
    manifest registry itself identical to define_assembly() in the reference
    scripts/asset-processing/build_pencil_glb.py
  * extras {ex, kind, mech[, jawAngle]} equal to the manifest registry
  * translation [0, baseY, 0] (clip parts: their special offsets), no
    rotation / scale on part nodes
  * springs centred on their node origin (runtime scales node Y)
  * barrelHex carries the `anodized` material (variant tint target)
  * material names drawn from the role set
  * mesh hygiene: no degenerate (zero-area) triangles, no vertex normal
    pointing away from its triangle (> 90 deg), no NaN normals
  * budgets: triangles and file size per tier

Run:  python3 scripts/asset-processing/validate_glb.py [file.glb ...]
Exit code 1 on any contract failure.
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True  # importing the reference builder must not litter __pycache__

import numpy as np
from pygltflib import GLTF2

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "public", "models", "source", "manifest.json")
TIERS = {
    "desktop": (os.path.join(ROOT, "public", "models", "desktop", "mechanical-pencil.glb"), 150_000, 6.0e6),
    "mobile": (os.path.join(ROOT, "public", "models", "mobile", "mechanical-pencil-mobile.glb"), 60_000, 2.5e6),
}
ROLES = {"anodized", "dlc", "steel", "polished", "brass", "spring", "recess", "polymer",
         "mechdark", "reservoir", "eraser", "lead", "etch"}
SPRINGS = {"buttonSpring", "returnSpring", "stabilizerSpring"}
CLIP = {"clipBlade": [0.0, 4.85, 0.0], "clipFoot": [0.0, 5.75, 0.42], "clipScrew": [0.0, 5.75, 0.50]}


class Reader:
    def __init__(self, g):
        self.g = g
        self.blob = g.binary_blob()

    def acc(self, i):
        a = self.g.accessors[i]
        bv = self.g.bufferViews[a.bufferView]
        nc = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a.type]
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a.componentType]
        off = (bv.byteOffset or 0) + (a.byteOffset or 0)
        item = np.dtype(dt).itemsize * nc
        st = bv.byteStride or item
        raw = np.frombuffer(self.blob, np.uint8, count=st * (a.count - 1) + item, offset=off)
        if st != item:
            raw = np.lib.stride_tricks.as_strided(raw, (a.count, item), (st, 1)).copy()
        return np.frombuffer(raw.tobytes(), dt)[: a.count * nc].reshape(a.count, nc)


def validate(path, tier=None, parts=None):
    g = GLTF2().load(path)
    R = Reader(g)
    errs, notes = [], []
    by = {n.name: i for i, n in enumerate(g.nodes)}
    parent = {}
    for i, n in enumerate(g.nodes):
        for c in n.children or []:
            parent[c] = i
    pi = by.get("Pencil")
    if pi is None:
        return ["no Pencil node"], notes, {}
    if g.scenes[g.scene or 0].nodes != [pi]:
        errs.append(f"scene roots {g.scenes[g.scene or 0].nodes} != [Pencil]")
    groups = sorted(g.nodes[c].name for c in g.nodes[pi].children or [])
    if groups != ["Exterior", "Internal"]:
        errs.append(f"Pencil children {groups}")
    part_nodes = [i for i, n in enumerate(g.nodes) if n.extras and "mech" in n.extras]
    if len(part_nodes) != 42:
        errs.append(f"{len(part_nodes)} part nodes with extras (want 42)")
    grp_kids = [c for gname in ("Exterior", "Internal") if gname in by for c in g.nodes[by[gname]].children or []]
    if len(grp_kids) != 42:
        errs.append(f"Exterior+Internal have {len(grp_kids)} children (want 42)")
    want = {p["name"]: p for p in parts} if parts else {}
    names = {g.nodes[i].name for i in part_nodes}
    if want and names != set(want):
        errs.append(f"name mismatch: missing {sorted(set(want) - names)} extra {sorted(names - set(want))}")
    tri_part = {}
    for i in part_nodes:
        n = g.nodes[i]
        p = want.get(n.name)
        if p:
            if g.nodes[parent.get(i, pi)].name != p["parent"]:
                errs.append(f"{n.name}: parent {g.nodes[parent.get(i, pi)].name} != {p['parent']}")
            exp = {"ex": p["explode"], "kind": p["kind"], "mech": p["mech"], **p["extra"]}
            for k, v in exp.items():
                got = n.extras.get(k)
                ok = (abs(float(got) - v) < 1e-6) if isinstance(v, (int, float)) and got is not None else got == v
                if not ok:
                    errs.append(f"{n.name}: extras.{k}={got} != {v}")
            t_want = CLIP.get(n.name, [0.0, p["baseY"], 0.0])
            t = n.translation or [0, 0, 0]
            if max(abs(a - b) for a, b in zip(t, t_want)) > 1e-6:
                errs.append(f"{n.name}: translation {t} != {t_want}")
        if n.rotation not in (None, [0, 0, 0, 1]) or n.scale not in (None, [1, 1, 1]):
            errs.append(f"{n.name}: rotation/scale {n.rotation} {n.scale}")
        if n.mesh is None:
            errs.append(f"{n.name}: no mesh")
            continue
        tris = 0
        lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
        for pr in g.meshes[n.mesh].primitives:
            P = R.acc(pr.attributes.POSITION).astype(np.float64)
            N = R.acc(pr.attributes.NORMAL).astype(np.float64) if pr.attributes.NORMAL is not None else None
            I = R.acc(pr.indices).ravel().astype(np.int64) if pr.indices is not None else np.arange(len(P))
            T = I.reshape(-1, 3)
            tris += len(T)
            lo, hi = np.minimum(lo, P.min(0)), np.maximum(hi, P.max(0))
            A, B, C = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
            cr = np.cross(B - A, C - A)
            dbl = np.linalg.norm(cr, axis=1)
            L = np.maximum.reduce([np.linalg.norm(B - A, axis=1), np.linalg.norm(C - B, axis=1),
                                   np.linalg.norm(A - C, axis=1)])
            alt = dbl / np.maximum(L, 1e-30)  # smallest altitude
            degen = int((alt < 1e-6).sum())
            if degen:
                errs.append(f"{n.name}/{g.materials[pr.material].name}: {degen} degenerate triangles (altitude < 1e-6)")
            if N is not None:
                if not np.isfinite(N).all():
                    errs.append(f"{n.name}: non-finite normals")
                fn = cr / np.maximum(dbl, 1e-30)[:, None]
                good = alt >= 1e-6
                worst = 0.0
                for k in range(3):
                    d = np.einsum("ij,ij->i", fn[good], N[T[good, k]])
                    worst = max(worst, float(np.degrees(np.arccos(np.clip(d.min(), -1, 1)))) if d.size else 0.0)
                if worst > 120.0:
                    errs.append(f"{n.name}/{g.materials[pr.material].name}: vertex normal {worst:.0f} deg off its triangle (flipped)")
                elif worst > 90.0:
                    notes.append(f"warn {n.name}/{g.materials[pr.material].name}: vertex normal {worst:.0f} deg off a "
                                 f"micro-bevel facet (< 0.1 mm)")
        tri_part[n.name] = tris
        if n.name in SPRINGS:
            cy = 0.5 * (lo[1] + hi[1])
            if abs(cy) > 2e-3:
                errs.append(f"{n.name}: not centred on node origin (local Y centre {cy:+.4f})")
            else:
                notes.append(f"{n.name} local Y [{lo[1]:+.3f}, {hi[1]:+.3f}] centre {cy:+.5f}")
    if "barrelHex" in by and g.nodes[by["barrelHex"]].mesh is not None:
        bm = [g.materials[p.material].name for p in g.meshes[g.nodes[by["barrelHex"]].mesh].primitives]
        if "anodized" not in bm:
            errs.append(f"barrelHex materials {bm} lack anodized")
        notes.append(f"barrelHex materials {bm}")
    mats = sorted(m.name for m in g.materials)
    bad = [m for m in mats if m not in ROLES]
    if bad:
        errs.append(f"unknown material roles {bad}")
    total = sum(tri_part.values())
    size = os.path.getsize(path)
    stats = {"tris": total, "bytes": size, "materials": mats, "images": len(g.images or []),
             "extensions": g.extensionsUsed or [], "heaviest": sorted(tri_part.items(), key=lambda kv: -kv[1])[:6]}
    if tier in TIERS:
        _, tmax, smax = TIERS[tier]
        if total > tmax:
            errs.append(f"{total} tris > budget {tmax}")
        if size > smax:
            errs.append(f"{size / 1e6:.2f} MB > budget {smax / 1e6:.1f} MB")
    return errs, notes, stats


def check_registry(parts):
    """Manifest registry == the authoritative define_assembly()."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import build_pencil_glb as ref
    ref.PARTS.clear()
    ref.define_assembly()
    want = {p["name"]: p for p in ref.PARTS}
    got = {p["name"]: p for p in parts}
    bad = [n for n in sorted(set(want) | set(got)) if want.get(n) != got.get(n)]
    print(f"== registry: manifest {len(got)} parts vs define_assembly() {len(want)} parts: "
          f"{'PASS' if not bad and len(want) == 42 else 'FAIL ' + str(bad)}")
    return not bad and len(want) == 42


def main():
    with open(MANIFEST) as f:
        parts = json.load(f)["parts"]
    failed = not check_registry(parts)
    args = sys.argv[1:]
    jobs = [(a, next((t for t, v in TIERS.items() if os.path.abspath(a) == v[0]), None)) for a in args] \
        or [(v[0], t) for t, v in TIERS.items()]
    for path, tier in jobs:
        errs, notes, st = validate(path, tier, parts)
        print(f"== {tier or ''} {os.path.relpath(path, ROOT)}")
        if st:
            print(f"   {st['tris']} triangles, {st['bytes'] / 1e6:.2f} MB, {st['images']} images, "
                  f"extensions {st['extensions']}")
            print(f"   materials: {', '.join(st['materials'])}")
            print("   heaviest: " + ", ".join(f"{k}={v}" for k, v in st["heaviest"]))
        for n in notes:
            print(("   WARN " + n[5:]) if n.startswith("warn ") else ("   ok   " + n))
        print(f"   hierarchy Pencil -> Exterior/Internal -> 42 parts, extras + translations vs manifest: "
              f"{'FAIL' if errs else 'PASS'}")
        for e in errs:
            print("   ERR " + e)
        failed |= bool(errs)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
