"""Meridian Hex — material roles (glTF-exportable Principled BSDF graphs).

Role names are the runtime contract with src/three/assembly.ts tuneLookdev():
anodized, dlc, steel, polished, brass, spring, recess, polymer, mechdark,
reservoir, eraser, lead (+ etch, new: laser-etched lettering).

Metals share ONE frosted micro-grain normal map and ONE packed ORM map
(R=1, G=roughness multiplier, B=1 metal); the factor on each material sets
the base roughness / normal strength. Turned parts use a 1-D lathe-mark
normal map instead. Albedo stays flat (the runtime tints barrel colour).
"""
import os

import bpy
import numpy as np

import mh_textures as T


def srgb_to_lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h):
    return (srgb_to_lin((h >> 16) & 255), srgb_to_lin((h >> 8) & 255), srgb_to_lin(h & 255))


# role: (linear base rgb, alpha, metallic, roughness, normal map, normal strength)
ROLES = {
    "anodized": (hex_lin(0x2B2F36), 1.0, 1.0, 0.44, "grain", 0.30),
    "dlc": ((0.036, 0.038, 0.041), 1.0, 1.0, 0.46, "grain", 0.32),
    "steel": ((0.56, 0.57, 0.585), 1.0, 1.0, 0.32, "grain", 0.25),
    "polished": ((0.74, 0.745, 0.755), 1.0, 1.0, 0.30, "turned", 0.12),
    "brass": ((0.80, 0.60, 0.30), 1.0, 1.0, 0.34, "grain", 0.25),
    "spring": ((0.50, 0.51, 0.53), 1.0, 1.0, 0.34, "grain", 0.18),
    "recess": ((0.012, 0.012, 0.014), 1.0, 0.4, 0.55, None, 0.0),
    "polymer": ((0.02, 0.02, 0.024), 1.0, 0.0, 0.50, None, 0.0),
    "mechdark": ((0.05, 0.052, 0.056), 1.0, 0.8, 0.42, "grain", 0.28),
    "reservoir": ((0.23, 0.24, 0.26), 0.45, 0.1, 0.15, None, 0.0),
    "eraser": ((0.85, 0.54, 0.63), 1.0, 0.0, 0.90, None, 0.0),
    "lead": ((0.05, 0.05, 0.055), 1.0, 0.35, 0.45, None, 0.0),
    "etch": ((0.70, 0.71, 0.73), 1.0, 1.0, 0.46, "grain", 0.45),
}


def _save_jpeg(name, rgb, path, quality):
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name + "_tmp", w, h, alpha=False, float_buffer=False)
    rgba = np.concatenate([rgb, np.ones((h, w, 1), np.float32)], axis=2)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'JPEG'
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)
    out = bpy.data.images.load(path)
    out.name = name
    out.colorspace_settings.name = 'Non-Color'
    return out


def _down2(a):
    return 0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])


def make_textures(tier, tmpdir):
    nrm, orm = T.grain_maps(1024)
    turned = T.turned_map(1024, 32)
    if tier == "mobile":
        nrm = _down2(nrm)
        v = nrm * 2 - 1
        v /= np.linalg.norm(v, axis=2, keepdims=True)
        nrm = v * 0.5 + 0.5
        orm = _down2(orm)
        turned = _down2(turned)
    os.makedirs(tmpdir, exist_ok=True)
    return {
        "grain": _save_jpeg("grain_normal", nrm, os.path.join(tmpdir, f"grain_normal_{tier}.jpg"), 90),
        "orm": _save_jpeg("grain_orm", orm, os.path.join(tmpdir, f"grain_orm_{tier}.jpg"), 88),
        "turned": _save_jpeg("turned_normal", turned, os.path.join(tmpdir, f"turned_normal_{tier}.jpg"), 92),
    }


def make_materials(tex):
    mats = {}
    for role, (rgb, alpha, metal, rough, nmap, nstr) in ROLES.items():
        m = bpy.data.materials.new(role)
        m.use_nodes = True
        m.use_backface_culling = False
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        out = nt.nodes["Material Output"]
        bsdf.location = (300, 0)
        out.location = (600, 0)
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
        if alpha < 1.0:
            bsdf.inputs["Alpha"].default_value = alpha
            try:
                m.surface_render_method = 'BLENDED'
            except AttributeError:
                m.blend_method = 'BLEND'
        if nmap is not None:
            # packed ORM: G -> roughness (x factor), B -> metal (x factor)
            t_orm = nt.nodes.new("ShaderNodeTexImage")
            t_orm.image = tex["orm"]
            t_orm.location = (-500, 200)
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            sep.location = (-200, 200)
            nt.links.new(t_orm.outputs["Color"], sep.inputs["Color"])
            mr = nt.nodes.new("ShaderNodeMath")
            mr.operation = 'MULTIPLY'
            mr.inputs[1].default_value = rough
            mr.location = (50, 250)
            nt.links.new(sep.outputs["Green"], mr.inputs[0])
            nt.links.new(mr.outputs[0], bsdf.inputs["Roughness"])
            mm = nt.nodes.new("ShaderNodeMath")
            mm.operation = 'MULTIPLY'
            mm.inputs[1].default_value = metal
            mm.location = (50, 100)
            nt.links.new(sep.outputs["Blue"], mm.inputs[0])
            nt.links.new(mm.outputs[0], bsdf.inputs["Metallic"])
            t_n = nt.nodes.new("ShaderNodeTexImage")
            t_n.image = tex["grain" if nmap == "grain" else "turned"]
            t_n.location = (-500, -200)
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.inputs["Strength"].default_value = nstr
            nm.location = (-200, -200)
            nt.links.new(t_n.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        mats[role] = m
    return mats
