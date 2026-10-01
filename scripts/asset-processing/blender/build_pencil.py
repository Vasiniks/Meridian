#!/usr/bin/env python3
"""Meridian Hex — Blender source of truth for the product model.

Builds the 42-part hexagonal mechanical pencil in Blender (bpy, headless),
with real bevels + weighted normals, a machined diamond knurl, turned-hex
nose, laser-etched lettering, formed spring-steel clip, closed/ground coil
springs, toothed collet jaws, helical threads, and frosted (bead-blasted)
micro-grain textures. Exports:

  public/models/desktop/mechanical-pencil.glb        (full tessellation, 1024 maps)
  public/models/mobile/mechanical-pencil-mobile.glb  (reduced, 512 maps)
  public/models/source/mechanical-pencil.blend       (desktop scene, live modifiers)
  public/models/source/manifest.json                 (part registry + stats)

Run:   python3 scripts/asset-processing/blender/build_pencil.py
       (needs the `bpy` module, numpy, pygltflib; deterministic)
Flags: --tier desktop|mobile   build one tier only
       --no-blend              skip the .blend
       --no-pack               skip meshopt compression (gltfpack)

Contract (verified at the end of every build): glTF root `Pencil` ->
`Exterior` / `Internal` -> 42 named part nodes, each with extras
{ex, kind, mech[, jawAngle]} and translation [0, baseY, 0] (clip parts keep
their special translations); pencil axis = glTF +Y.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

import mh_materials  # noqa: E402
import mh_parts  # noqa: E402
from mh_parts import BUILDERS, FINISH, PARTS, TIERS, blender_location, define_assembly, gltf_translation  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
OUT = {
    "desktop": os.path.join(ROOT, "public", "models", "desktop", "mechanical-pencil.glb"),
    "mobile": os.path.join(ROOT, "public", "models", "mobile", "mechanical-pencil-mobile.glb"),
}
BLEND = os.path.join(ROOT, "public", "models", "source", "mechanical-pencil.blend")
MANIFEST = os.path.join(ROOT, "public", "models", "source", "manifest.json")


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


def build_scene(tier, tmpdir):
    reset()
    q = TIERS[tier]
    define_assembly()
    tex = mh_materials.make_textures(tier, tmpdir)
    mh_materials.make_materials(tex)
    sc = bpy.context.scene
    root = bpy.data.objects.new("Pencil", None)
    sc.collection.objects.link(root)
    groups = {}
    for gname in ("Exterior", "Internal"):
        o = bpy.data.objects.new(gname, None)
        sc.collection.objects.link(o)
        o.parent = root
        groups[gname] = o
    stats = {}
    for spec in PARTS:
        name = spec["name"]
        g = BUILDERS[name](q)
        loc = blender_location(spec)
        g.translate((-loc[0], -loc[1], -loc[2]))
        slots = []
        for m in g.FM:
            if m not in slots:
                slots.append(m)
        me = g.to_mesh(slots)
        me.name = name
        ob = bpy.data.objects.new(name, me)
        sc.collection.objects.link(ob)
        ob.parent = groups[spec["parent"]]
        ob.location = loc
        ob["ex"] = float(spec["explode"])
        ob["kind"] = spec["kind"]
        ob["mech"] = spec["mech"]
        for k, v in spec["extra"].items():
            ob[k] = float(v)
        mode, width = FINISH[name]
        if mode == "bevel":
            bev = ob.modifiers.new("Bevel", 'BEVEL')
            bev.limit_method = 'WEIGHT'
            bev.width = width
            bev.segments = q["bevel_seg"]
            bev.profile = 0.5
            bev.use_clamp_overlap = True
            bev.miter_outer = 'MITER_ARC'
            bev.harden_normals = False
            wn = ob.modifiers.new("WeightedNormal", 'WEIGHTED_NORMAL')
            wn.mode = 'FACE_AREA'
            wn.weight = 50
            wn.keep_sharp = True
            wn.thresh = 0.01
        elif mode == "smooth":
            wn = ob.modifiers.new("WeightedNormal", 'WEIGHTED_NORMAL')
            wn.mode = 'FACE_AREA'
            wn.weight = 50
            wn.keep_sharp = True
        stats[name] = {"source_tris": g.tri_count()}
    return stats


def evaluated_tris(name):
    ob = bpy.data.objects[name]
    dg = bpy.context.evaluated_depsgraph_get()
    m = ob.evaluated_get(dg).to_mesh()
    t = sum(len(p.vertices) - 2 for p in m.polygons)
    ob.evaluated_get(dg).to_mesh_clear()
    return t


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(filepath=path, export_format='GLB', export_extras=True, export_apply=True,
              export_yup=True, export_image_format='AUTO', export_texcoords=True,
              export_normals=True, export_tangents=False, export_materials='EXPORT',
              export_cameras=False, export_animations=False, export_attributes=False,
              use_selection=False)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='NONE', export_lights=False)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)


def postprocess_and_validate(path, tier):
    """Pin exact translations, verify hierarchy/extras/materials."""
    from pygltflib import GLTF2

    g = GLTF2().load(path)
    by_name = {n.name: i for i, n in enumerate(g.nodes)}
    errors = []
    root_i = by_name.get("Pencil")
    if root_i is None:
        errors.append("no Pencil node")
    scene_roots = g.scenes[g.scene or 0].nodes
    if scene_roots != [root_i]:
        errors.append(f"scene roots {scene_roots} != [Pencil]")
    kids = {g.nodes[c].name for c in g.nodes[root_i].children}
    if kids != {"Exterior", "Internal"}:
        errors.append(f"Pencil children {kids}")
    extras_nodes = 0
    for spec in PARTS:
        i = by_name.get(spec["name"])
        if i is None:
            errors.append(f"missing node {spec['name']}")
            continue
        n = g.nodes[i]
        n.translation = [float(v) for v in gltf_translation(spec)]
        n.rotation = None
        n.scale = None
        parent = [p for p, pn in enumerate(g.nodes) if i in (pn.children or [])]
        if not parent or g.nodes[parent[0]].name != spec["parent"]:
            errors.append(f"{spec['name']} parent mismatch")
        want = {"ex": spec["explode"], "kind": spec["kind"], "mech": spec["mech"]}
        want.update(spec["extra"])
        ex = n.extras or {}
        for k, v in want.items():
            if isinstance(v, float):
                ok = abs(float(ex.get(k, 1e9)) - v) < 1e-6
            else:
                ok = ex.get(k) == v
            if not ok:
                errors.append(f"{spec['name']} extras {k}={ex.get(k)} != {v}")
        if n.mesh is None:
            errors.append(f"{spec['name']} has no mesh")
        extras_nodes += 1
    allx = sum(1 for n in g.nodes if n.extras and "mech" in n.extras)
    if allx != 42 or extras_nodes != 42:
        errors.append(f"extras nodes {allx}/{extras_nodes} != 42")
    mats = sorted({m.name for m in g.materials})
    tris = 0
    for me in g.meshes:
        for p in me.primitives:
            a = g.accessors[p.indices] if p.indices is not None else g.accessors[p.attributes.POSITION]
            tris += a.count // 3
    # barrelHex must expose the anodized primitive (tint target)
    bi = g.nodes[by_name["barrelHex"]].mesh
    bmats = [g.materials[p.material].name for p in g.meshes[bi].primitives]
    if "anodized" not in bmats:
        errors.append(f"barrelHex materials {bmats}")
    g.save(path)
    if errors:
        raise SystemExit(f"[{tier}] VALIDATION FAILED:\n  " + "\n  ".join(errors))
    return {"tris": tris, "materials": mats, "images": len(g.images or []),
            "bytes": os.path.getsize(path)}


def gltfpack(path):
    """Meshopt-compress geometry (keeps names, materials, extras, float
    positions so node transforms are untouched). Returns True if applied."""
    exe = shutil.which("gltfpack")
    cmd = [exe] if exe else ["npx", "--yes", "gltfpack@0.25.0"]
    tmp = path + ".pack.glb"
    args = cmd + ["-i", path, "-o", tmp, "-cc", "-kn", "-km", "-ke", "-noq", "-vpf"]
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=600)
    except Exception as e:  # pragma: no cover
        print("  gltfpack unavailable:", e)
        return False
    if r.returncode != 0 or not os.path.exists(tmp):
        print("  gltfpack failed:", r.stderr[-400:])
        return False
    os.replace(tmp, path)
    return True


def validate_packed(path, tier):
    from pygltflib import GLTF2

    g = GLTF2().load(path)
    by_name = {n.name: n for n in g.nodes}
    bad = []
    for spec in PARTS:
        n = by_name.get(spec["name"])
        if n is None:
            bad.append(f"missing {spec['name']}")
            continue
        t = n.translation or [0, 0, 0]
        want = gltf_translation(spec)
        if max(abs(a - b) for a, b in zip(t, want)) > 1e-6:
            bad.append(f"{spec['name']} translation {t} != {want}")
        if n.scale not in (None, [1, 1, 1], [1.0, 1.0, 1.0]) or n.rotation not in (None, [0, 0, 0, 1]):
            bad.append(f"{spec['name']} has scale/rotation {n.scale} {n.rotation}")
        if not n.extras or n.extras.get("mech") != spec["mech"]:
            bad.append(f"{spec['name']} extras {n.extras}")
    pencil = by_name.get("Pencil")
    if pencil is None or {g.nodes[c].name for c in pencil.children} != {"Exterior", "Internal"}:
        bad.append("hierarchy")
    if bad:
        raise SystemExit(f"[{tier}] PACKED VALIDATION FAILED:\n  " + "\n  ".join(bad))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", choices=["desktop", "mobile"], default=None)
    ap.add_argument("--no-blend", action="store_true")
    ap.add_argument("--no-pack", action="store_true")
    a = ap.parse_args([x for x in sys.argv[1:] if x != "--"])
    tiers = [a.tier] if a.tier else ["mobile", "desktop"]
    tmpdir = tempfile.mkdtemp(prefix="meridian_tex_")
    report = {}
    for tier in tiers:
        stats = build_scene(tier, tmpdir)
        part_tris = {name: evaluated_tris(name) for name in stats}
        export_glb(OUT[tier])
        info = postprocess_and_validate(OUT[tier], tier)
        raw = info["bytes"]
        packed = False
        if not a.no_pack:
            packed = gltfpack(OUT[tier])
            if packed:
                validate_packed(OUT[tier], tier)
        info["bytes"] = os.path.getsize(OUT[tier])
        info["raw_bytes"] = raw
        info["meshopt"] = packed
        info["part_tris"] = part_tris
        report[tier] = info
        print(f"[{tier}] {OUT[tier]}: {info['tris']} tris, {info['bytes'] / 1e6:.2f} MB "
              f"(raw {raw / 1e6:.2f} MB, meshopt={packed}), materials={info['materials']}")
        top = sorted(part_tris.items(), key=lambda kv: -kv[1])[:8]
        print("   heaviest:", ", ".join(f"{k}={v}" for k, v in top))
        if tier == "desktop" and not a.no_blend:
            for img in bpy.data.images:
                if img.source == 'FILE' and not img.packed_file:
                    img.pack()
            os.makedirs(os.path.dirname(BLEND), exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
            print(f"[{tier}] saved {BLEND}")
    if a.tier is None:
        write_manifest(report)
    shutil.rmtree(tmpdir, ignore_errors=True)


def write_manifest(report):
    define_assembly()
    mats = {k: {"metallic": v[2], "roughness": v[3], "alpha": "BLEND" if v[1] < 1 else "OPAQUE",
                "normalMap": v[4], "normalScale": v[5]}
            for k, v in mh_materials.ROLES.items()}
    data = {
        "generator": "scripts/asset-processing/blender/build_pencil.py (Blender %s)" % bpy.app.version_string,
        "parts": PARTS,
        "materials": mats,
        "tiers": {t: {"triangles": r["tris"], "bytes": r["bytes"], "meshopt": r["meshopt"],
                      "partTriangles": r["part_tris"]} for t, r in report.items()},
    }
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w") as f:
        json.dump(data, f, indent=1)
    print(f"manifest {MANIFEST} — {len(PARTS)} parts")


if __name__ == "__main__":
    main()
