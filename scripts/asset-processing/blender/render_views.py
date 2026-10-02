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
HDRI = os.path.join(ROOT, "public", "environments", "studio_small_09_512.hdr")
PAPER = (0xF5, 0xF3, 0xEE)

FINISHES_TS = os.path.join(ROOT, "src", "three", "finishes.ts")


def load_finishes():
    """Variant finishes straight from src/three/finishes.ts (the runtime's
    single source of truth): {variant: (sRGB hex, roughness)}."""
    import re
    src = open(FINISHES_TS).read()
    out = {}
    for name, body in re.findall(r"^\s*(Core|Pro|Studio|Limited)\s*:\s*\{([^}]*)\}", src, re.M):
        col = int(re.search(r"color:\s*0x([0-9a-fA-F]{6})", body).group(1), 16)
        rough = float(re.search(r"roughness:\s*([0-9.]+)", body).group(1))
        out[name.lower()] = (col, rough)
    assert set(out) == {"core", "pro", "studio", "limited"}, out
    return out


FINISHES = load_finishes()


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


# Mechanism poses, mirrored from src/three/drawing/mechanism.ts POSES
# (units: 1 = 10 mm; tube/ring/lead = axial offsets; ring = max(tube, -0.05)
# and the jaw opening follows ring - tube, as in the runtime).
JAW_OPEN = 0.05  # rad: jaw mouth swings ~0.2 mm out about the slot root
MECH_POSES = [
    dict(tube=0.0, ring=0.0, lead=0.0),       # rest
    dict(tube=-0.05, ring=-0.05, lead=0.05),  # 01 press
    dict(tube=-0.12, ring=-0.05, lead=0.05),  # 02 ring stops
    dict(tube=-0.25, ring=-0.05, lead=0.05),  # 03 jaws open
    dict(tube=-0.13, ring=-0.05, lead=0.05),  # 04 release
    dict(tube=0.0, ring=0.0, lead=0.05),      # 05 regrip
]


def pose(ex=0.0, step=0, explode_scale=0.7):
    """Mirror the runtime part animation (Blender Z = glTF Y)."""
    m = MECH_POSES[step]
    opening = min(1.0, max(0.0, (m["ring"] - m["tube"] - 0.03) / 0.17))  # as the runtime
    for spec in PARTS:
        ob = bpy.data.objects[spec["name"]]
        base = build_pencil.blender_location(spec)
        z = base[2] + spec["explode"] * ex * explode_scale
        role = spec["mech"]
        ob.scale = (1, 1, 1)
        if role in ("button", "tube", "clutch"):
            z += m["tube"]
        elif role == "ring":
            z += m["ring"]
        elif role == "lead":
            z += m["lead"]
        elif role == "spring":
            # seat end fixed: scale about the centre, slide by half the travel
            zs = [v[2] for v in ob.bound_box]
            half = 0.5 * (max(zs) - min(zs))
            ob.scale = (1, 1, 1 + m["tube"] / (2 * half))
            z += 0.5 * m["tube"]
        ob.location = (base[0], base[1], z)
        for child in ob.children:
            if "jawAngle" in child:
                phi = -float(child["jawAngle"])
                child.rotation_mode = 'AXIS_ANGLE'
                child.rotation_axis_angle = (opening * JAW_OPEN, math.sin(phi), -math.cos(phi), 0.0)


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
        for slot in [sl for o in [ob, *ob.children] for sl in o.material_slots]:
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
    pose(step=3)
    xray()
    root_transform(spin=math.radians(-20))
    add_camera((1.3, -2.2, -3.1), (0, 0, -3.75), lens=80)
    render(os.path.join(a.out, "mechanism.png"))


@view
def clutch(a):
    """Internals only (shells hidden), the five mechanism steps."""
    for spec in PARTS:
        if spec["kind"] == "shell" or spec["name"] in ("noseWasher", "threadRing"):
            ob = bpy.data.objects[spec["name"]]
            ob.hide_render = True
            for c in ob.children:
                c.hide_render = True
    root_transform(spin=math.radians(-20))
    add_camera((1.1, -1.9, -3.7), (0, 0, -3.95), lens=70)
    for k in range(6):
        pose(step=k)
        render(os.path.join(a.out, f"clutch_{k}.png"))
    for spec in PARTS:
        ob = bpy.data.objects[spec["name"]]
        ob.hide_render = False
        for c in ob.children:
            c.hide_render = False


@view
def xrayfull(a):
    pose()
    xray()
    root_transform(tilt=math.radians(58), spin=math.radians(-25))
    add_camera((1.6, -24.0, 1.6), (0.35, 0, 0.35), lens=58)
    render(os.path.join(a.out, "xray.png"))


def _write_png_rgb(path, rgb8):
    """Minimal RGB PNG writer (numpy uint8 HxWx3, row 0 = top)."""
    import struct
    import zlib
    h, w, _ = rgb8.shape
    raw = b"".join(b"\x00" + rgb8[y].tobytes() for y in range(h))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) +
                chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def composite_paper(src_rgba, dst_rgb):
    """Alpha-over the transparent-film render onto the exact card paper
    colour (display space), so the PNG background is #F5F3EE to the byte and
    melts into the lineup card."""
    import numpy as np
    img = bpy.data.images.load(src_rgba)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    px = px.reshape(h, w, 4)[::-1]  # bpy rows are bottom-up
    a = px[..., 3:4]
    paper = np.array(PAPER, np.float32) / 255.0
    rgb = px[..., :3] * a + paper * (1.0 - a)
    _write_png_rgb(dst_rgb, np.clip(np.round(rgb * 255.0), 0, 255).astype(np.uint8))


def cards(a):
    """Lineup card renders: 800x320, pencil horizontal (tip right), on the
    card paper. Barrel finish = src/three/finishes.ts (colour + roughness).
    A wide softbox above/in front of the camera puts a soft gradient on the
    upper hex faces so the tint reads (the HDRI behind an orthographic
    camera is mostly dark, which turned every finish near-black)."""
    setup_render(800, 320, a.samples, transparent=True)
    add_area("CardSoftbox", (0.0, -16.0, 12.0), (0, 0, 0), 26.0, 5200, (1.0, 0.985, 0.96), size_y=6.0)
    add_area("CardFloor", (0.0, -10.0, -9.0), (0, 0, 0), 26.0, 900, (1.0, 0.97, 0.94), size_y=4.0)
    tmp = tempfile.mkdtemp(prefix="meridian_cards_")
    for v in ("core", "pro", "studio", "limited"):
        set_finish(v)
        pose()
        root_transform(tilt=math.radians(-90), spin=math.radians(40))
        for o in [o for o in bpy.data.objects if o.type == 'CAMERA']:
            bpy.data.objects.remove(o)
        add_camera((-0.45, -40, 0.0), (-0.45, 0, 0.0), ortho=17.4)
        raw = os.path.join(tmp, f"{v}_rgba.png")
        render(raw)
        composite_paper(raw, os.path.join(a.cards_out, f"{v}.png"))
        print("card", v, FINISHES[v])


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
            for slot in [sl for o in [ob, *ob.children] for sl in o.material_slots]:
                if slot.link == 'OBJECT':
                    slot.material = None
                    slot.link = 'DATA'
        VIEWS[name](a)


if __name__ == "__main__":
    main()
