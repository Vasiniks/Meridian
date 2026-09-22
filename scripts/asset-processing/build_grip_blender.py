"""Meridian Hex grip — Blender hard-surface modeling pass (headless).

Workflow (per blender-hard-surface-modeling skill):
  Reference: waffle/diamond knurl — raised truncated-pyramid pads with flat
  tops + beveled flanks over a recessed field, FULL surface coverage.
  1. Blockout: single diamond pad unit (clean quad topology, open bottom).
  2. Detail via Array modifiers (non-destructive): columns + rows per face.
     NOTE (Blender 5 API): constant offsets require use_constant_offset=True;
     relative offsets default ON and must be disabled, or copies stack/drift.
  3. Six face instances rotated about the pencil axis.
  4. Deterministic bake via depsgraph evaluation, manual join, export.

  AXIS CONVENTION (critical): Blender is Z-up and the glTF exporter maps
  Blender (X, Y, Z) -> glTF (X, Z, -Y). The pencil axis MUST be modeled
  along Blender +Z so the export lands on the pipeline's +Y axis with a
  proper rotation (no mirrored winding). Pad-local frame: X = face tangent,
  Y = face normal, Z = pencil axis.

Run:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
      --python scripts/asset-processing/build_grip_blender.py

Output: public/models/source/grip_lattice.glb (single joined mesh). The
asset builder imports this file for the `gripLattice` part.
"""
import math
import os

import bpy

ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
OUT = os.path.join(ROOT, "public", "models", "source", "grip_lattice.glb")

# ---- design parameters (must match build_pencil_glb.py grip zone) ----
APOTHEM = 0.44 * math.cos(math.pi / 6)  # hex face plane distance
PAD_BASE = 0.052   # bottom half-diagonal of diamond pad
PAD_TOP = 0.036    # top half-diagonal (shallow beveled flank)
PAD_H = 0.022      # pad height above embed plane
EMBED = 0.006      # bottom ring sunk into the underlay
COLS = (-0.115, 0.0, 0.115)
STAGGER = 0.0625   # alternate-row offset for diamond rhythm
CLAMP = 0.125      # keep staggered pads inside the face
V0, PITCH, ROWS = -1.19, 0.125, 20

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---- pad unit: diamond truncated pyramid, quad topology, open bottom ----
# local frame: X = face tangent, Y = face normal, Z = pencil axis.
verts = []
for sx, sz in ((1, 0), (0, 1), (-1, 0), (0, -1)):
    verts.append((sx * PAD_BASE, -EMBED, sz * PAD_BASE))
for sx, sz in ((1, 0), (0, 1), (-1, 0), (0, -1)):
    verts.append((sx * PAD_TOP, -EMBED + PAD_H, sz * PAD_TOP))
faces = [
    (0, 1, 5, 4),
    (1, 2, 6, 5),
    (2, 3, 7, 6),
    (3, 0, 4, 7),
    (4, 5, 6, 7),  # flat pad top
]
mesh = bpy.data.meshes.new("GripPad")
mesh.from_pydata(verts, [], faces)
mesh.update()
pad_obj = bpy.data.objects.new("GripPad", mesh)
bpy.context.scene.collection.objects.link(pad_obj)

# ---- per-face grids via Array modifiers (kept non-destructive) ----
# Face th: normal n=(cos th, sin th, 0), tangent t=(sin th, -cos th, 0)
# (t, n) is right-handed about +Z, so R_z(a) maps local X->t, Y->n
# with a = th - pi/2. Verified: R_z(a) sends +X to (cos a, sin a, 0)
# = (sin th, -cos th, 0) = t, and +Y to (-sin a, cos a, 0)
# = (cos th, sin th, 0) = n.
face_objs = []


def _grid(name, base_x, base_z, n_cols, col_pitch, n_rows, row_pitch):
    o = pad_obj.copy()
    o.data = pad_obj.data.copy()
    o.name = name
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = (0.0, 0.0, th - math.pi / 2)
    o.location = (0.0, 0.0, 0.0)
    arr_x = o.modifiers.new("Cols", "ARRAY")
    arr_x.fit_type = 'FIXED_COUNT'
    arr_x.count = n_cols
    arr_x.use_constant_offset = True
    arr_x.use_relative_offset = False
    arr_x.constant_offset_displace = (col_pitch, 0.0, 0.0)
    arr_z = o.modifiers.new("Rows", "ARRAY")
    arr_z.fit_type = 'FIXED_COUNT'
    arr_z.count = n_rows
    arr_z.use_constant_offset = True
    arr_z.use_relative_offset = False
    arr_z.constant_offset_displace = (0.0, 0.0, row_pitch)
    # base offset baked into mesh-local space (arrays tile from origin)
    for v in o.data.vertices:
        v.co.x += base_x
        v.co.y += APOTHEM
        v.co.z += base_z
    face_objs.append(o)


for f in range(6):
    th = f * math.tau / 6
    # even rows: full 3-column grid
    _grid(f"GripFace{f}A", COLS[0], V0, 3, 0.115, 10, 2 * PITCH)
    # odd rows: staggered half-step, edge-clamped to 2 columns
    _grid(f"GripFace{f}B", COLS[0] + STAGGER, V0 + PITCH, 2, 0.115,
          10, 2 * PITCH)
    # edge rails frame the pattern (clean termination at the arrises)
    for side in (-1.0, 1.0):
        rv = []
        hw, hh, hl = 0.015, 0.010, 1.25
        for sx in (-1.0, 1.0):
            for sy in (-1.0, 1.0):
                for sz in (-1.0, 1.0):
                    rv.append((sx * hw, sy * hh, sz * hl))
        rf = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
              (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        rm = bpy.data.meshes.new(f"GripRail{f}{side:+}")
        rm.from_pydata(rv, [], rf)
        rm.update()
        ro = bpy.data.objects.new(rm.name, rm)
        bpy.context.scene.collection.objects.link(ro)
        ro.rotation_euler = (0.0, 0.0, th - math.pi / 2)
        # local X = tangent, Y = normal, Z = axis
        ro.location = (0.0, 0.0, 0.0)
        for v in ro.data.vertices:
            v.co.x += side * 0.20
            v.co.y += APOTHEM + 0.002
        face_objs.append(ro)

# ---- deterministic bake: depsgraph evaluate each face, join manually ----
depsgraph = bpy.context.evaluated_depsgraph_get()
all_verts = []
all_faces = []
for o in face_objs:
    ev = o.evaluated_get(depsgraph)
    m = ev.to_mesh()
    base = len(all_verts)
    mat = o.matrix_world
    for v in m.vertices:
        c = mat @ v.co
        all_verts.append((c.x, c.y, c.z))
    for p in m.polygons:
        all_faces.append(tuple(v + base for v in p.vertices))
    ev.to_mesh_clear()
print(f"baked faces: {len(all_faces)} (expect {(3 + 2) * 10 * 6 * 5 + 12 * 6})")

joined = bpy.data.meshes.new("gripLattice")
joined.from_pydata(all_verts, [], all_faces)
joined.update()
grip = bpy.data.objects.new("gripLattice", joined)
bpy.context.scene.collection.objects.link(grip)

for o in face_objs + [pad_obj]:
    bpy.data.objects.remove(o, do_unlink=True)

# ---- validate (Blender Z-up: axis = Z, faces around it) ----
xs = [c[0] for c in all_verts]
ys = [c[1] for c in all_verts]
zs = [c[2] for c in all_verts]
print(f"pads: {(3 + 2) * 10 * 6} + 12 rails, verts: {len(all_verts)}, "
      f"quads: {len(all_faces)}")
print(f"bounds x[{min(xs):.3f},{max(xs):.3f}] "
      f"y[{min(ys):.3f},{max(ys):.3f}] z[{min(zs):.3f},{max(zs):.3f}]")
assert abs(min(xs)) < 0.6 and abs(max(xs)) < 0.6, "X out of range"
assert abs(min(ys)) < 0.6 and abs(max(ys)) < 0.6, "Y out of range"
assert min(zs) > -1.4 and max(zs) < 1.4, "Z(axis) out of range"

# ---- export selection ----
bpy.ops.object.select_all(action='DESELECT')
grip.select_set(True)
bpy.context.view_layer.objects.active = grip
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_yup=True,
)
print(f"saved {OUT}")
