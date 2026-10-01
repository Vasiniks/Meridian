#!/usr/bin/env python3
"""Meridian Hex — Cycles look-dev / verification renders + lineup cards.

Builds the desktop scene with build_pencil.build_scene() (same code path as
the export), lights it with the site's studio HDRI on a warm-paper ground,
and renders named views. Also renders the four lineup card images
(public/variants/{core,pro,studio,limited}.png, 800x320, paper background).

Run:  python3 scripts/asset-processing/blender/render_views.py --views hero,grip,nose,exploded
      python3 scripts/asset-processing/blender/render_views.py --cards
Options: --out DIR  --samples N  --width W  --tier desktop|mobile
"""
import argparse
import math
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402

import build_pencil  # noqa: E402
import mh_materials  # noqa: E402
from mh_parts import PARTS  # noqa: E402

ROOT = build_pencil.ROOT
HDRI = os.path.join(ROOT, "public", "environments", "studio_small_09_1k.hdr")
PAPER = (0xF5, 0xF3, 0xEE)

# Variant finishes (keep in sync with src/three/finishes.ts)
FINISHES = {
    "core": (0x2B2F36, 0.46),
    "pro": (0xC59B55, 0.38),
    "studio": (0x1E2F4F, 0.44),
    "limited": (0x8E8F8C, 0.50),
}


def paper_lin():
    return tuple(mh_materials.srgb_to_lin(c) for c in PAPER)


def setup_render(width, height, samples, transparent=False):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except TypeError:
        pass
    sc.cycles.max_bounces = 8
    sc.cycles.glossy_bounces = 6
    sc.cycles.transparent_max_bounces = 8
    sc.render.resolution_x = width
    sc.render.resolution_y = height
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 3
    try:
        sc.view_settings.view_transform = 'Khronos PBR Neutral'
    except TypeError:
        sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'


def setup_world(strength=1.0, rot=0.0):
    w = bpy.data.worlds.new("Studio")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(HDRI, check_existing=True)
    mapping = nt.nodes.new("ShaderNodeMapping")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mapping.inputs["Rotation"].default_value = (0, 0, rot)
    nt.links.new(tc.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    paper = nt.nodes.new("ShaderNodeBackground")
    paper.inputs["Color"].default_value = (*paper_lin(), 1)
    paper.inputs["Strength"].default_value = 1.0
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(bg.outputs["Background"], mix.inputs[1])
    nt.links.new(paper.outputs["Background"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])


def add_area(name, loc, target, size, energy, color=(1, 1, 1), shape='RECTANGLE', size_y=None):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.color = color
    ld.shape = shape
    ld.size = size
    if size_y is not None:
        ld.size_y = size_y
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def setup_lights(scale=1.0):
    # key (warm, front-right-top), rim (cool, back-left), top strip, kicker
    add_area("Key", (6, -7, 7), (0, 0, 0), 4.0, 900 * scale, (1.0, 0.95, 0.9))
    add_area("Rim", (-7, 6, 3), (0, 0, 0), 1.5, 500 * scale, (0.85, 0.9, 1.0), size_y=8)
    add_area("Top", (0.5, 0.5, 10), (0, 0, 0), 5.0, 300 * scale)
    add_area("Kick", (7, 4, 1), (0, 0, 0), 1.0, 300 * scale, (0.92, 0.95, 1.0), size_y=8)


def add_camera(loc, target, lens=50.0, ortho=None, roll=0.0):
    cd = bpy.data.cameras.new("Cam")
    cd.lens = lens
    cd.clip_start = 0.01
    cd.clip_end = 200
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho
    ob = bpy.data.objects.new("Cam", cd)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    q = d.to_track_quat('-Z', 'Y')
    ob.rotation_euler = q.to_euler()
    if roll:
        ob.rotation_euler.rotate(Euler((0, 0, 0)))
        ob.matrix_world = ob.matrix_world @ Matrix.Rotation(roll, 4, 'Z')
    bpy.context.scene.camera = ob
    return ob


def pose(ex=0.0, mc=0.0, explode_scale=0.7):
    """Mirror experience.ts part animation (Blender Z = glTF Y; glTF Z = -Blender Y)."""
    for spec in PARTS:
        ob = bpy.data.objects[spec["name"]]
        base = build_pencil.blender_location(spec)
        z = base[2] + spec["explode"] * ex * explode_scale
        m = spec["mech"]
        if m == "jaw":
            a = spec["extra"]["jawAngle"]
            r = 0.11 + mc * 0.16 + ex * 0.1
            ob.location = (math.cos(a) * r, -math.sin(a) * r, z - 0.12 * mc)
            continue
        if m in ("button", "stem"):
            z += -0.22 * mc
        if m == "actuator":
            z += -0.18 * mc
        if m == "rod":
            z += -0.14 * mc
        if m == "clutch":
            z += -0.06 * mc
        if m in ("springMain", "springBtn", "springStab"):
            c = 0.32 if m == "springBtn" else 0.28
            ob.scale = (1, 1, 1 - mc * c)
        if m == "lead":
            z += 0.34 * mc
        if m == "sleeve":
            z += 0.1 * mc
        ob.location = (base[0], base[1], z)


def set_finish(variant):
    col, rough = FINISHES[variant]
    m = bpy.data.materials["anodized"]
    bsdf = m.node_tree.nodes["Principled BSDF"]
    lin = mh_materials.hex_lin(col)
    bsdf.inputs["Base Color"].default_value = (*lin, 1)
    for n in m.node_tree.nodes:
        if n.type == 'MATH' and n.operation == 'MULTIPLY' and n.outputs[0].links and \
                n.outputs[0].links[0].to_socket.name == "Roughness":
            n.inputs[1].default_value = rough


def xray(alpha=0.15):
    """Fade shells like the site's x-ray (opacity 15%)."""
    for spec in PARTS:
        if spec["kind"] != "shell":
            continue
        ob = bpy.data.objects[spec["name"]]
        for slot in ob.material_slots:
            m = slot.material
            key = m.name + "_xray"
            mx = bpy.data.materials.get(key)
            if mx is None:
                mx = m.copy()
                mx.name = key
                b = mx.node_tree.nodes["Principled BSDF"]
                b.inputs["Alpha"].default_value = alpha
            slot.link = 'OBJECT'
            slot.material = mx


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("wrote", path)


def root_transform(rot_z=0.0, tilt=0.0, spin=0.0, loc=(0, 0, 0)):
    r = bpy.data.objects["Pencil"]
    r.rotation_mode = 'XYZ'
    r.location = loc
    # spin about the pencil axis, then tilt about Blender X
    r.matrix_world = (Matrix.Translation(loc) @ Matrix.Rotation(rot_z, 4, 'Z') @
                      Matrix.Rotation(tilt, 4, 'Y') @ Matrix.Rotation(spin, 4, 'Z'))


VIEWS = {}


def view(fn):
    VIEWS[fn.__name__] = fn
    return fn


@view
def hero(a):
    pose()
    root_transform(tilt=math.radians(58), spin=math.radians(-25))
    add_camera((1.6, -24.0, 1.6), (0.35, 0, 0.35), lens=58)
    render(os.path.join(a.out, "hero.png"))


@view
def grip(a):
    pose()
    root_transform(spin=math.radians(-20))
    add_camera((2.4, -6.4, -1.3), (0, 0, -2.5), lens=62)
    render(os.path.join(a.out, "grip.png"))


@view
def nose(a):
    pose()
    root_transform(spin=math.radians(-20))
    add_camera((1.3, -3.0, -4.1), (0, 0, -4.8), lens=70)
    render(os.path.join(a.out, "nose.png"))


@view
def top(a):
    pose()
    root_transform(spin=math.radians(-20))
    add_camera((1.6, -3.6, 6.4), (0, 0, 6.0), lens=60)
    render(os.path.join(a.out, "top.png"))


@view
def etch(a):
    pose()
    root_transform(spin=math.radians(5))
    add_camera((1.8, -1.8, 1.7), (0, 0, 1.45), lens=60)
    render(os.path.join(a.out, "etch.png"))


@view
def exploded(a):
    pose(ex=1.0)
    root_transform(spin=math.radians(-20))
    sc = bpy.context.scene
    w, h = sc.render.resolution_x, sc.render.resolution_y
    sc.render.resolution_x, sc.render.resolution_y = int(w * 0.55), int(w * 1.0)
    add_camera((0.0, -40.0, 0.4), (0, 0, 0.4), lens=60)
    render(os.path.join(a.out, "exploded.png"))
    sc.render.resolution_x, sc.render.resolution_y = w, h


@view
def mechanism(a):
    pose(mc=1.0)
    xray()
    root_transform(spin=math.radians(-20))
    add_camera((2.6, -3.6, 5.6), (0, 0, 5.0), lens=70)
    render(os.path.join(a.out, "mechanism.png"))


@view
def xrayfull(a):
    pose()
    xray()
    root_transform(tilt=math.radians(58), spin=math.radians(-25))
    add_camera((1.6, -24.0, 1.6), (0.35, 0, 0.35), lens=58)
    render(os.path.join(a.out, "xray.png"))


def cards(a):
    """Lineup card renders: 800x320, pencil horizontal (tip right), paper."""
    setup_render(800, 320, a.samples)
    for v in ("core", "pro", "studio", "limited"):
        set_finish(v)
        pose()
        root_transform(tilt=math.radians(-90), spin=math.radians(40))
        for o in [o for o in bpy.data.objects if o.type == 'CAMERA']:
            bpy.data.objects.remove(o)
        add_camera((-0.45, -40, 0.0), (-0.45, 0, 0.0), ortho=17.4)
        render(os.path.join(a.cards_out, f"{v}.png"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--views", default="hero,grip,nose,exploded")
    ap.add_argument("--out", default=os.path.join(tempfile.gettempdir(), "meridian_renders"))
    ap.add_argument("--samples", type=int, default=96)
    ap.add_argument("--width", type=int, default=1200)
    ap.add_argument("--height", type=int, default=0)
    ap.add_argument("--tier", default="desktop")
    ap.add_argument("--variant", default="core")
    ap.add_argument("--cards", action="store_true")
    ap.add_argument("--cards-out", default=os.path.join(ROOT, "public", "variants"))
    a = ap.parse_args([x for x in sys.argv[1:] if x != "--"])
    os.makedirs(a.out, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="meridian_tex_")
    build_pencil.build_scene(a.tier, tmp)
    setup_world()
    setup_lights()
    set_finish(a.variant)
    if a.cards:
        cards(a)
        return
    h = a.height or int(a.width * 0.625)
    setup_render(a.width, h, a.samples)
    for name in a.views.split(","):
        # reset per view: fresh camera, shells restored
        for o in [o for o in bpy.data.objects if o.type == 'CAMERA']:
            bpy.data.objects.remove(o)
        for spec in PARTS:
            ob = bpy.data.objects[spec["name"]]
            ob.scale = (1, 1, 1)
            for slot in ob.material_slots:
                if slot.link == 'OBJECT':
                    slot.material = None
                    slot.link = 'DATA'
        VIEWS[name](a)


if __name__ == "__main__":
    main()
