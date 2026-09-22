"""Import the desktop GLB into Blender headless, organize collections, save .blend.

Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
         --python scripts/asset-processing/glb_to_blend.py
"""
import os

import bpy

ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
GLB = os.path.join(ROOT, "public", "models", "desktop", "mechanical-pencil.glb")
BLEND = os.path.join(ROOT, "public", "models", "source", "mechanical-pencil.blend")

SHELL = {
    "buttonHex", "topCollar", "barrelHex", "barrelGrooves", "clipBlade",
    "clipFoot", "gripSleeve", "gripUnderlay", "gripLattice",
    "gripRingTop", "gripRingBot", "noseHex", "noseTip",
}
MECH = {
    "buttonHex", "buttonStem", "actuatorCone", "actuatorSleeve",
    "feedRod", "shaftMid", "jawA", "jawB", "jawC",
    "returnSpring", "buttonSpring", "stabilizerSpring", "lead",
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

scene_coll = bpy.context.scene.collection
coll_exterior = bpy.data.collections.new("Exterior")
coll_internal = bpy.data.collections.new("Internal")
coll_mech = bpy.data.collections.new("Mechanism")
coll_present = bpy.data.collections.new("Presentation")
for c in (coll_exterior, coll_internal, coll_mech, coll_present):
    scene_coll.children.link(c)

imported = [o for o in bpy.context.scene.objects if o.type == "MESH"]
print(f"imported {len(imported)} mesh objects")

for obj in imported:
    # unlink from the auto-created GLTF collection, keep scene membership
    # via our own collections
    for coll in list(obj.users_collection):
        if coll is not scene_coll:
            coll.objects.unlink(obj)
    target = coll_exterior if obj.name in SHELL else coll_internal
    if obj.name not in target.objects:
        target.objects.link(obj)
    if obj.name in MECH:
        coll_mech.objects.link(obj)
    coll_present.objects.link(obj)

# Remove the now-empty auto import collections / empties
for obj in [o for o in bpy.data.objects if o.type == "EMPTY"]:
    bpy.data.objects.remove(obj, do_unlink=True)
for coll in list(bpy.data.collections):
    if coll not in (coll_exterior, coll_internal, coll_mech, coll_present):
        try:
            scene_coll.children.unlink(coll)
            bpy.data.collections.remove(coll)
        except Exception:
            pass

os.makedirs(os.path.dirname(BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print(f"saved {BLEND}")
print("collections:",
      [(c.name, len(c.objects)) for c in
       (coll_exterior, coll_internal, coll_mech, coll_present)])
