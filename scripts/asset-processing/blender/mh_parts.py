"""Meridian Hex — part registry + per-part geometry (Blender space, +Z axis).

The registry is the LOAD-BEARING contract with the site (exploded view,
x-ray, mechanism, lineup): 42 part nodes, their parent group, base height,
explode scalar, kind (shell|inner), mechanism role and jawAngle extras.
Values are identical to the legacy numpy builder's define_assembly().

Each builder returns a Geo in ASSEMBLED coordinates (the pencil as it sits
fully assembled, axis = +Z, tip at z~-7.2, crown at z~+8.1). The build script
subtracts the node location to obtain node-local geometry, so every mating
surface is authored once, in one frame, and parts fit by construction.

Units: 1 unit = 10 mm of real pencil (barrel across-flats 7.8 mm).
"""
import math

import bpy
from mathutils import Vector

from mh_geom import (A, C, Geo, H, HEX_COS, TAU, catmull, clip_poly, helix_spring,
                     lathe, seamless_rref, thread, tube)

# ----------------------------------------------------------------- registry
PARTS = []


def part(name, parent, base_y, explode, kind, mech="static", extra=None):
    PARTS.append({"name": name, "parent": parent, "baseY": base_y,
                  "explode": explode, "kind": kind, "mech": mech,
                  "extra": extra or {}})


def define_assembly():
    PARTS.clear()
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
    part("jawA", "Internal", 5.15, 2.06, "inner", "jaw", {"jawAngle": 0.0})
    part("jawB", "Internal", 5.15, 2.20, "inner", "jaw", {"jawAngle": 2.0944})
    part("jawC", "Internal", 5.15, 2.34, "inner", "jaw", {"jawAngle": 4.1888})
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
    return PARTS


# glTF node translations (glTF Y-up). Clip parts ride off-axis.
GLTF_TRANSLATION_OVERRIDES = {
    "clipBlade": [0.0, 4.85, 0.0],
    "clipFoot": [0.0, 5.75, 0.42],
    "clipScrew": [0.0, 5.75, 0.50],
}


def gltf_translation(spec):
    return list(GLTF_TRANSLATION_OVERRIDES.get(spec["name"], [0.0, spec["baseY"], 0.0]))


def blender_location(spec):
    x, y, z = gltf_translation(spec)
    return (x, -z, y)  # glTF (x, y, z) -> Blender (x, -z, y)


# ------------------------------------------------------------ dimensions
R_BAR = 0.45      # barrel hex vertex radius (across flats 7.8 mm)
R_GRIP = 0.44     # grip hex vertex radius
R_RING = 0.472    # steel ferrule rings
BORE_BAR = 0.352
BORE_GRIP = 0.335
APO_BAR = R_BAR * HEX_COS
APO_GRIP = R_GRIP * HEX_COS
TEXT_FACE = 5     # hex face between vertices 5 and 0 (Blender -30 deg == glTF +30 deg)

# Quality tiers
TIERS = {
    "desktop": dict(nseg=48, bevel_seg=3, spc=28, wseg=10, knurl_nu=4, text_res=5,
                    nose_seg=72, nose_dz=0.03, clip_n=84, clip_sec=5, thread_seg=36,
                    jaw_seg=10, small_seg=36),
    "mobile": dict(nseg=24, bevel_seg=2, spc=14, wseg=6, knurl_nu=3, text_res=2,
                   nose_seg=36, nose_dz=0.06, clip_n=44, clip_sec=3, thread_seg=18,
                   jaw_seg=5, small_seg=18),
}

# Per-part finishing: pipeline 'bevel' (width, segments) or 'explicit'.
FINISH = {
    "barrelHex": ("bevel", 0.032),
    "barrelGrooves": ("explicit", 0),
    "gripSleeve": ("bevel", 0.03),
    "gripLattice": ("flat", 0),
    "gripUnderlay": ("explicit", 0),
    "gripRingTop": ("bevel", 0.03),
    "gripRingBot": ("bevel", 0.03),
    "noseWasher": ("bevel", 0.02),
    "noseHex": ("explicit", 0),
    "noseTip": ("explicit", 0),
    "noseInsert": ("explicit", 0),
    "leadSleeve": ("explicit", 0),
    "lead": ("explicit", 0),
    "topCollar": ("bevel", 0.03),
    "buttonHex": ("bevel", 0.024),
    "buttonStem": ("explicit", 0),
    "eraser": ("explicit", 0),
    "eraserSleeve": ("explicit", 0),
    "buttonSpring": ("explicit", 0),
    "returnSpring": ("explicit", 0),
    "stabilizerSpring": ("explicit", 0),
    "washerTop": ("explicit", 0),
    "actuatorCone": ("explicit", 0),
    "actuatorSleeve": ("explicit", 0),
    "clutchHousing": ("explicit", 0),
    "jawA": ("bevel", 0.008),
    "jawB": ("bevel", 0.008),
    "jawC": ("bevel", 0.008),
    "retainerHex": ("bevel", 0.008),
    "seatUp": ("explicit", 0),
    "seatLow": ("explicit", 0),
    "stopCollar": ("explicit", 0),
    "feedRod": ("explicit", 0),
    "shaftMid": ("explicit", 0),
    "resPlug": ("bevel", 0.012),
    "reservoirHex": ("bevel", 0.006),
    "spacerTube": ("explicit", 0),
    "threadRing": ("explicit", 0),
    "guideTube": ("explicit", 0),
    "clipBlade": ("smooth", 0),
    "clipFoot": ("bevel", 0.022),
    "clipScrew": ("explicit", 0),
}


def hexface_frame(k, R):
    """Face k sits between hex vertices k and k+1. Returns (n, t, apothem)."""
    psi = math.radians(60 * k + 30)
    n = Vector((math.cos(psi), math.sin(psi), 0.0))
    t = Vector((-math.sin(psi), math.cos(psi), 0.0))
    return n, t, R * HEX_COS


def hexv(k, R, z):
    a = math.radians(60 * (k % 6))
    return (R * math.cos(a), R * math.sin(a), z)


# ===================================================================== parts
def build_barrel(q):
    g = Geo("barrelHex")
    g.uv_rref = seamless_rref(APO_BAR)
    zt0, zt1 = 0.30, 2.98
    prof = tube(
        [H(-0.46, 0.425, 0.3), H(-0.44, R_BAR, 0.3),
         H(zt0, R_BAR), H(zt1, R_BAR),
         # two turned grooves (round floor cut into the hex: deeper at arrises,
         # exactly like a lathe groove on hex bar stock)
         H(4.884, R_BAR, 0.22), C(4.884, 0.371), C(4.916, 0.371), H(4.916, R_BAR, 0.22),
         H(5.044, R_BAR, 0.22), C(5.044, 0.371), C(5.076, 0.371), H(5.076, R_BAR, 0.22),
         # end chamfer: apothem 0.364 stays outside the 0.352 bore, and the
         # two ring bevels (0.0064 + 0.0016) fit in the 0.012 annulus
         H(5.705, R_BAR, 0.45), H(5.75, 0.420, 0.2)],
        [C(5.75, BORE_BAR, 0.05), C(-0.46, BORE_BAR, 0.12)],
    )
    lathe(g, prof, "anodized", q["nseg"], closed=True, arris=1.0)
    # replace the lettering face segment with the etched face
    n, t, apo = hexface_frame(TEXT_FACE, R_BAR)
    removed = g.remove_faces(lambda P: len(P) == 4 and all(zt0 - 1e-6 <= p.z <= zt1 + 1e-6 for p in P)
                             and all(abs(p.dot(n) - apo) < 1e-6 for p in P))
    assert removed == 1, removed
    etched_face(g, q, n, t, apo, zt0, zt1, R_BAR)
    return g


def _text_splines(body, font_path, size, space=1.0):
    cu = bpy.data.curves.new("tmp_text", 'FONT')
    cu.body = body
    cu.font = bpy.data.fonts.load(font_path, check_existing=True)
    cu.size = size
    cu.space_character = space
    ob = bpy.data.objects.new("tmp_text", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    ce = ob.evaluated_get(dg).to_curve(dg)
    spl = []
    for s in ce.splines:
        pts = [(tuple(b.co), tuple(b.handle_left), tuple(b.handle_right),
                b.handle_left_type, b.handle_right_type) for b in s.bezier_points]
        spl.append(pts)
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs = [p[0][0] for s in spl for p in s]
    return spl, (min(xs), max(xs))


def _bez(p0, p1, p2, p3, t):
    s = 1.0 - t
    return tuple(s * s * s * p0[k] + 3 * s * s * t * p1[k] + 3 * s * t * t * p2[k] + t * t * t * p3[k]
                 for k in range(2))


def _seg_dist(p, a, b):
    ax, ay = b[0] - a[0], b[1] - a[1]
    L2 = ax * ax + ay * ay
    if L2 < 1e-24:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    return abs((p[0] - a[0]) * ay - (p[1] - a[1]) * ax) / math.sqrt(L2)


def _clean_ring(pts, tol=2e-6):
    """Drop near-duplicate and collinear points of a closed polyline, in
    double precision. Collinear runs are what made the fill emit zero-area
    triangles (Blender gives those the fallback normal +Z, which poisoned
    the smooth vertex normals and the MikkTSpace tangents = the 'wedge')."""
    pts = list(pts)
    changed = True
    while changed and len(pts) > 3:
        changed = False
        out = []
        n = len(pts)
        for i in range(n):
            a, p, b = pts[i - 1] if not out else out[-1], pts[i], pts[(i + 1) % n]
            if math.hypot(p[0] - a[0], p[1] - a[1]) < tol or _seg_dist(p, a, b) < tol:
                changed = True
                continue
            out.append(p)
        pts = out
    return pts


def _polylines(splines, res):
    """Exact closed polylines from Bezier glyph splines: straight segments
    contribute only their end points (no resampled collinear points),
    curved segments `res` steps."""
    rings = []
    for s in splines:
        n = len(s)
        ring = []
        for i in range(n):
            p0 = s[i][0][:2]
            p1 = s[i][2][:2]
            p2 = s[(i + 1) % n][1][:2]
            p3 = s[(i + 1) % n][0][:2]
            ring.append(p0)
            if max(_seg_dist(p1, p0, p3), _seg_dist(p2, p0, p3)) > 1e-7:
                for k in range(1, res):
                    ring.append(_bez(p0, p1, p2, p3, k / res))
        ring = _clean_ring(ring)
        if len(ring) >= 3:
            rings.append(ring)
    return rings


def _tri_alt(verts, t):
    a, b, c = (verts[i] for i in t)
    dbl = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
    L = max(math.dist(a, b), math.dist(b, c), math.dist(c, a))
    return dbl / max(L, 1e-30)


def _fix_degenerate(verts, tris, eps=1e-6):
    """Remove zero-area triangles from a planar triangulation without
    opening cracks: a degenerate triangle (a, c, b) with c on its long edge
    a-b is dropped and the neighbour across a-b is split at c. Blender's
    scanfill emits these when glyph vertices are collinear (e.g. the feet
    of an M on one baseline)."""
    tris = [tuple(t) for t in tris]
    for _ in range(10000):
        bad = next((i for i, t in enumerate(tris) if _tri_alt(verts, t) < eps), None)
        if bad is None:
            return tris
        t = tris[bad]
        # c = the vertex opposite the longest edge
        L = [math.dist(verts[t[(k + 1) % 3]], verts[t[(k + 2) % 3]]) for k in range(3)]
        k = max(range(3), key=lambda j: L[j])
        c, a, b = t[k], t[(k + 1) % 3], t[(k + 2) % 3]
        del tris[bad]
        for j, u in enumerate(tris):
            for e in range(3):
                x, y, z = u[e], u[(e + 1) % 3], u[(e + 2) % 3]
                if {x, y} == {a, b}:
                    tris[j] = (x, c, z)
                    tris.append((c, y, z))
                    break
            else:
                continue
            break
    raise RuntimeError("degenerate repair did not converge")


def _fill_mesh(rings, rect=None):
    """Triangulate closed 2D polylines (POLY splines, so Blender only fills,
    never resamples). Output vertices are snapped back to the exact double
    input points, so coplanar faces stay exactly coplanar."""
    cu = bpy.data.curves.new("tmp_fill", 'CURVE')
    cu.dimensions = '2D'
    cu.fill_mode = 'BOTH'
    src = []
    for ring in list(rings) + ([rect] if rect is not None else []):
        s = cu.splines.new('POLY')
        s.points.add(len(ring) - 1)
        for p, co in zip(s.points, ring):
            p.co = (co[0], co[1], 0.0, 1.0)
        s.use_cyclic_u = True
        src.extend(ring)
    ob = bpy.data.objects.new("tmp_fill", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    m = ob.evaluated_get(dg).to_mesh()
    verts = []
    for v in m.vertices:
        x, y = v.co.x, v.co.y
        best = min(src, key=lambda q: (q[0] - x) ** 2 + (q[1] - y) ** 2)
        if (best[0] - x) ** 2 + (best[1] - y) ** 2 < 1e-10:
            verts.append((best[0], best[1], 0.0))
        else:
            verts.append((x, y, 0.0))
    tris = [tuple(p.vertices) for p in m.polygons]
    ob.evaluated_get(dg).to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    tris = _fix_degenerate(verts, tris)
    edges_used = {}
    for ti, t in enumerate(tris):
        for i in range(3):
            k = tuple(sorted((t[i], t[(i + 1) % 3])))
            edges_used.setdefault(k, []).append(ti)
    boundary = [(k, fl[0]) for k, fl in edges_used.items() if len(fl) == 1]
    cent = {ti: tuple(sum(verts[i][k] for i in t) / 3 for k in range(3)) for ti, t in enumerate(tris)}
    return verts, tris, boundary, cent


def _xform_splines(spl, sx, x0, y0):
    out = []
    for s in spl:
        o = []
        for co, hl, hr, tl, tr in s:
            f = lambda p: (p[0] * sx + x0, p[1] * sx + y0, 0.0)  # noqa: E731
            o.append((f(co), f(hl), f(hr), tl, tr))
        out.append(o)
    return out


ETCH_DEPTH = 0.0028
FONT_BRAND = "/usr/share/fonts/truetype/freefont/FreeSans.ttf"
FONT_SPEC = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


def etched_face(g, q, n, t, apo, z0, z1, R):
    """Laser-etched lettering on one hex face. Text runs along the axis
    (reading tip -> crown); 2D layout space X = axial z, Y = -tangent.
    The anodized face keeps exact rect corners (welds to the lathe), letters
    are recessed ETCH_DEPTH with crisp walls and a bright satin 'etch' floor
    (laser ablation exposes raw aluminium)."""
    cap_b, cap_s = 0.092, 0.050
    brand, bx = _text_splines("MERIDIAN", FONT_BRAND, 1.0, 1.32)
    spec, sx = _text_splines("HEX 0.5 · ±0.02", FONT_SPEC, 1.0, 1.0)
    ch_b, ch_s = 0.729, 0.729  # cap height / em for both faces
    kb, ks = cap_b / ch_b, cap_s / ch_s
    wb, ws = (bx[1] - bx[0]) * kb, (sx[1] - sx[0]) * ks
    gap = 0.20
    total = wb + gap + ws
    zc = 0.5 * (z0 + z1) - 0.18
    xb = zc - total / 2 - bx[0] * kb
    xs = zc - total / 2 + wb + gap - sx[0] * ks
    letters = _xform_splines(brand, kb, xb, -cap_b / 2) + _xform_splines(spec, ks, xs, -cap_s / 2)
    half = R / 2
    inset = half - 0.06  # lettering panel stays clear of the beveled arrises
    # plain 4-corner panel: NO collinear subdivision points on its sides
    # (collinear runs are what produced zero-area fill / n-gon triangles).
    # Long thin triangles are harmless here: every vertex lies exactly on
    # the face plane and the UVs are exactly linear across the face.
    zs = [z0, z1]
    rect = [(z0, -inset), (z1, -inset), (z1, inset), (z0, inset)]
    rings = _polylines(letters, q["text_res"])

    def to3(x, y, h):
        u = -y
        return tuple(n * (apo + h) + t * u + Vector((0, 0, x)))

    corners = {(round(x, 6), round(y, 6)): to3(x, y, 0.0) for x, y in rect}
    # splice the panel's inset points into the lathe faces above/below
    for zz in (z0, z1):
        ins = [g.v(to3(zz, -inset, 0.0)), g.v(to3(zz, inset, 0.0))]
        hit = g.split_edge(to3(zz, -half, 0.0), to3(zz, half, 0.0), ins)
        assert hit == 1, (zz, hit)
    # strips between the arrises and the panel: one quad each (single
    # straight arris edge for the bevel)
    for ys in (-1, 1):
        a0 = g.v(to3(z0, ys * half, 0.0))
        a1 = g.v(to3(z1, ys * half, 0.0))
        inner = [g.v(to3(z, ys * inset, 0.0)) for z in reversed(zs)]
        g.f([a0, a1] + inner, "anodized", out=tuple(n), smooth=True, uvk="hex")
        g.bw(a0, a1, 1.0)

    def snap(x, y):
        p3 = corners.get((round(x, 6), round(y, 6)))
        if p3 is not None:
            return p3
        for (cx, cy), p3 in corners.items():
            if abs(x - cx) < 2e-5 and abs(y - cy) < 2e-5:
                return p3
        return None

    # anodized face with letter-shaped holes
    fv, ftris, _, _ = _fill_mesh(rings, rect)
    idx = []
    for (x, y, _z) in fv:
        p = snap(x, y)
        idx.append(g.v(p if p is not None else to3(x, y, 0.0)))
    for tri in ftris:
        g.f([idx[i] for i in tri], "anodized", out=tuple(n), smooth=True, uvk="hex")
    # etched floor + walls
    lv, ltris, lbound, lcent = _fill_mesh(rings)
    top = [g.v(to3(x, y, 0.0)) for (x, y, _z) in lv]
    bot = [g.v(to3(x, y, -ETCH_DEPTH)) for (x, y, _z) in lv]
    for tri in ltris:
        g.f([bot[i] for i in tri], "etch", out=tuple(n), smooth=False, uvk="hex")
    for (a, b), pi in lbound:
        c = lcent[pi]
        pa, pb = Vector(lv[a]), Vector(lv[b])
        mid = (pa + pb) / 2
        inward2 = Vector((c[0], c[1], 0)) - mid  # toward the letter interior
        out3 = n * 0.0 + Vector(to3(mid.x + inward2.x, mid.y + inward2.y, 0.0)) - Vector(to3(mid.x, mid.y, 0.0))
        g.f([top[a], top[b], bot[b], bot[a]], "etch", out=tuple(out3), smooth=False)
        g.sharp(top[a], top[b])


def build_barrel_grooves(q):
    # dark inlay rings seated in the two turned grooves (stop 0.01 below flats)
    g = Geo("barrelGrooves")
    g.uv_rref = seamless_rref(0.38)
    for zc in (4.90, 5.06):
        lathe(g, tube([C(zc - 0.0155, 0.381, 0.0), C(zc + 0.0155, 0.381)],
                      [C(zc + 0.0155, 0.364), C(zc - 0.0155, 0.364)]),
              "recess", q["nseg"], closed=True, explicit=True)
    return g


def build_ring(name, z0, z1, bore):
    g = Geo(name)
    g.uv_rref = seamless_rref(R_RING * HEX_COS)
    lathe(g, tube([H(z0, R_RING, 0.3), H(z1, R_RING, 0.3)],
                  [H(z1, bore, 0.1), H(z0, bore, 0.1)]),
          "steel", 6, closed=True, arris=1.0)
    return g


def build_nose_washer(q):
    g = Geo("noseWasher")
    g.uv_rref = seamless_rref(0.37)
    lathe(g, tube([H(-3.462, 0.432, 0.4), H(-3.402, 0.432, 0.4)],
                  [C(-3.402, 0.296, 0.0), C(-3.462, 0.296)]),
          "mechdark", q["nseg"], closed=True, arris=1.0)
    return g


# --------------------------------------------------------------- grip
GRIP_Z0, GRIP_Z1 = -3.31, -0.48
GRIP_V0, GRIP_V1 = -3.06, -0.71
GRIP_LAND = 0.034
KNURL_DEPTH = 0.026


def build_grip_sleeve(q):
    g = Geo("gripSleeve")
    g.uv_rref = seamless_rref(APO_GRIP)
    zc0, zc1 = GRIP_Z0 + 0.03, GRIP_Z1 - 0.03
    prof = tube([H(GRIP_Z0, 0.41, 0.3), H(zc0, R_GRIP, 0.3), H(GRIP_V0, R_GRIP), H(GRIP_V1, R_GRIP),
                 H(zc1, R_GRIP, 0.3), H(GRIP_Z1, 0.41, 0.3)],
                [C(GRIP_Z1, BORE_GRIP, 0.1), C(GRIP_Z0, BORE_GRIP, 0.1)])
    lathe(g, prof, "dlc", q["nseg"], closed=True, arris=1.0)
    # remove the outer hex faces between the chamfers; rebuild as lands
    # framing a knurl pocket on each face
    g.remove_faces(lambda P: len(P) == 4 and all(zc0 - 1e-6 <= p.z <= zc1 + 1e-6 for p in P)
                   and min(math.hypot(p.x, p.y) for p in P) > APO_GRIP - 1e-4)
    U = R_GRIP / 2 - GRIP_LAND
    for k in range(6):
        n, t, a = hexface_frame(k, R_GRIP)

        def Q(u, z):
            return g.v(tuple(n * a + t * u + Vector((0, 0, z))))

        Pk = {z: g.v(hexv(k, R_GRIP, z)) for z in (zc0, GRIP_V0, GRIP_V1, zc1)}
        Pk1 = {z: g.v(hexv(k + 1, R_GRIP, z)) for z in (zc0, GRIP_V0, GRIP_V1, zc1)}
        qm0, qp0, qm1, qp1 = Q(-U, GRIP_V0), Q(U, GRIP_V0), Q(-U, GRIP_V1), Q(U, GRIP_V1)
        o = tuple(n)
        g.f([Pk[zc0], Pk1[zc0], Pk1[GRIP_V0], qp0, qm0, Pk[GRIP_V0]], "dlc", out=o, uvk="hex")
        g.f([Pk[GRIP_V0], qm0, qm1, Pk[GRIP_V1]], "dlc", out=o, uvk="hex")
        g.f([qp0, Pk1[GRIP_V0], Pk1[GRIP_V1], qp1], "dlc", out=o, uvk="hex")
        g.f([Pk[GRIP_V1], qm1, qp1, Pk1[GRIP_V1], Pk1[zc1], Pk[zc1]], "dlc", out=o, uvk="hex")
        for zA, zB in ((zc0, GRIP_V0), (GRIP_V0, GRIP_V1), (GRIP_V1, zc1)):
            g.bw(Pk[zA], Pk[zB], 1.0)
            g.bw(Pk1[zA], Pk1[zB], 1.0)
        # crisp machined pocket rim
        for a_, b_ in ((qm0, qp0), (qp0, qp1), (qp1, qm1), (qm1, qm0)):
            g.sharp(a_, b_)
    return g


def build_grip_lattice(q):
    """Diamond knurl cut into a pocket on each hex face: truncated pyramids
    (small flats on top, sharp V grooves), clipped exactly to the pocket
    rectangle so the cut cells terminate against vertical pocket walls."""
    g = Geo("gripLattice")
    g.uv_mode = "box"
    U = R_GRIP / 2 - GRIP_LAND
    nu = q["knurl_nu"]
    p = 2 * U / nu
    L = GRIP_V1 - GRIP_V0
    nv = max(1, round(L / (1.2 * p)))
    qv = L / nv
    Hh = 0.030
    cap = 0.80
    for k in range(6):
        n, t, a = hexface_frame(k, R_GRIP)
        floor = a - KNURL_DEPTH
        land = a

        def P3(u, v, hfrac=None, hreal=None):
            hh = floor + Hh * hfrac if hreal is None else hreal
            return tuple(n * hh + t * u + Vector((0, 0, v)))

        def uv_of(s1, s2):
            return -U + p * (s1 + s2) / 2, GRIP_V0 + qv * (s1 - s2) / 2

        # clip planes in s-space: 0<=s1+s2<=2nu ; 0<=s1-s2<=2nv
        planes = [(1, 1, 0), (-1, -1, 2 * nu), (1, -1, 0), (-1, 1, 2 * nv)]
        boundary_pts = {0: [], 1: [], 2: [], 3: []}
        c2 = (1 - cap) / 2
        for i in range(-1, nu + nv + 2):
            for j in range(-nv - 2, nu + 2):
                b00, b10, b11, b01 = (i, j, 0), (i + 1, j, 0), (i + 1, j + 1, 0), (i, j + 1, 0)
                t00 = (i + 0.5 - c2, j + 0.5 - c2, cap)
                t10 = (i + 0.5 + c2, j + 0.5 - c2, cap)
                t11 = (i + 0.5 + c2, j + 0.5 + c2, cap)
                t01 = (i + 0.5 - c2, j + 0.5 + c2, cap)
                polys = [[b00, b10, t10, t00], [b10, b11, t11, t10], [b11, b01, t01, t11],
                         [b01, b00, t00, t01], [t00, t10, t11, t01]]
                for poly in polys:
                    cp = poly
                    for (aa, bb, cc) in planes:
                        cp = clip_poly(cp, aa, bb, cc)
                        if len(cp) < 3:
                            break
                    if len(cp) < 3:
                        continue
                    # drop slivers
                    area = 0.0
                    for m in range(len(cp)):
                        x1, y1, _ = cp[m]
                        x2, y2, _ = cp[(m + 1) % len(cp)]
                        area += x1 * y2 - x2 * y1
                    if abs(area) < 1e-9:
                        continue
                    pts3 = []
                    for (s1, s2, hf) in cp:
                        u, v = uv_of(s1, s2)
                        pts3.append(P3(u, v, hf))
                        for bi, (aa, bb, cc) in enumerate(planes):
                            if abs(aa * s1 + bb * s2 + cc) < 1e-9:
                                boundary_pts[bi].append((u, v, hf))
                    idx = [g.v(pp) for pp in pts3]
                    uvs = [(Vector(pp).dot(t), pp[2]) for pp in pts3]
                    g.f(idx, "dlc", out=tuple(n), smooth=False, uvs=uvs)
        # pocket walls: from the clipped knurl profile up to the land
        for bi, pts in boundary_pts.items():
            if bi in (0, 1):
                key = lambda e: e[1]  # noqa: E731  (u fixed, sort by v)
            else:
                key = lambda e: e[0]  # noqa: E731
            uniq = {}
            for e in pts:
                kk = round(key(e), 7)
                uniq[kk] = max(uniq.get(kk, -1), e[2])
            ks = sorted(uniq)
            if len(ks) < 2:
                continue
            for m in range(len(ks) - 1):
                if bi in (0, 1):
                    u = -U if bi == 0 else U
                    pa, pb = (u, ks[m]), (u, ks[m + 1])
                    inward = t * (1 if bi == 0 else -1)
                else:
                    v = GRIP_V0 if bi == 2 else GRIP_V1
                    pa, pb = (ks[m], v), (ks[m + 1], v)
                    inward = Vector((0, 0, 1 if bi == 2 else -1))
                ha, hb = uniq[ks[m]], uniq[ks[m + 1]]
                va = g.v(P3(pa[0], pa[1], ha))
                vb = g.v(P3(pb[0], pb[1], hb))
                wa = g.v(P3(pa[0], pa[1], hreal=land))
                wb_ = g.v(P3(pb[0], pb[1], hreal=land))
                pts3 = [g.V[va], g.V[vb], g.V[wb_], g.V[wa]]
                uvs = [(Vector(pp).dot(t) if bi > 1 else pp[2], Vector(pp).dot(n)) for pp in pts3]
                g.f([va, vb, wb_, wa], "dlc", out=tuple(inward), smooth=False, uvs=uvs)
    return g


def build_grip_underlay(q):
    g = Geo("gripUnderlay")
    g.uv_rref = seamless_rref(0.32)
    lathe(g, tube([C(-3.27, 0.322), C(-3.25, 0.333), C(-0.54, 0.333), C(-0.52, 0.322)],
                  [C(-0.52, 0.300), C(-3.27, 0.300)]),
          "dlc", q["nseg"], closed=True, explicit=True)
    return g


# --------------------------------------------------------------- nose
NOSE_TOP, NOSE_BOT = -3.462, -4.85
NOSE_RC_TOP, NOSE_RC_BOT = 0.50, 0.090
NOSE_R = 0.432
NOSE_CH = 0.008  # top edge chamfer on the hex flats
NOSE_GROOVES = (-4.60, -4.675)


def _nose_rc(z):
    t = (z - NOSE_BOT) / (NOSE_TOP - NOSE_BOT)
    r = NOSE_RC_BOT + (NOSE_RC_TOP - NOSE_RC_BOT) * t
    dr = (NOSE_RC_TOP - NOSE_RC_BOT) / (NOSE_TOP - NOSE_BOT)
    for gz in NOSE_GROOVES:
        d = abs(z - gz)
        if d < 0.0065:
            r -= 0.0042 * (1 - d / 0.0065)
            dr += (0.0042 / 0.0065) * (1 if z > gz else -1)
    return r, dr


def build_nose(q):
    """Turned hex: a cone turned on hex bar stock. Near the top the hex flats
    survive (with crisp curved run-outs where the cone breaks through), lower
    down the section is fully round and carries two fine turned V-grooves.
    Normals are analytic (flat facets vs cone) so the run-out reads sharp."""
    g = Geo("noseHex")
    g.uv_rref = seamless_rref(0.25)
    ns = q["nose_seg"]
    apo = NOSE_R * HEX_COS
    zs = []
    z = NOSE_BOT
    step = q["nose_dz"]
    facet_lo = NOSE_TOP - (NOSE_RC_TOP - apo) / ((NOSE_RC_TOP - NOSE_RC_BOT) / (NOSE_TOP - NOSE_BOT)) - 0.02
    while z < NOSE_TOP - 1e-9:
        zs.append(z)
        dz = step * (0.45 if z > facet_lo else 1.0)
        z += dz
    for gz in NOSE_GROOVES:
        zs += [gz - 0.0065, gz, gz + 0.0065]
    zs += [NOSE_TOP - NOSE_CH, NOSE_TOP, NOSE_BOT + 0.006]
    zs = sorted(set(round(v, 7) for v in zs if NOSE_BOT <= v <= NOSE_TOP))
    angs = [TAU * k / ns for k in range(ns)]

    def hex_r(th, z):
        k = math.floor(th / (TAU / 6))
        psi = (k + 0.5) * TAU / 6
        a = apo - max(0.0, z - (NOSE_TOP - NOSE_CH))
        return a / math.cos(th - psi), psi

    rows, nrows = [], []
    for z in zs:
        rc, drc = _nose_rc(z)
        if z < NOSE_BOT + 0.006:
            rc = rc - (NOSE_BOT + 0.006 - z) * 0.9  # bottom edge break
        row, nr = [], []
        for th in angs:
            hr, psi = hex_r(th, z)
            if hr < rc - 1e-7:
                r = hr
                if z > NOSE_TOP - NOSE_CH:
                    nv = Vector((math.cos(psi), math.sin(psi), 1.0)).normalized()
                else:
                    nv = Vector((math.cos(psi), math.sin(psi), 0.0))
            else:
                r = rc
                nv = Vector((math.cos(th), math.sin(th), -drc)).normalized()
                if abs(hr - rc) < 2e-3:
                    nf = Vector((math.cos(psi), math.sin(psi), 0.0))
                    nv = (nv + nf).normalized()
            row.append(g.v((r * math.cos(th), r * math.sin(th), z)))
            nr.append(nv)
        rows.append(row)
        nrows.append(nr)
    for i in range(len(zs) - 1):
        for k in range(ns):
            k2 = (k + 1) % ns
            qd = [rows[i][k], rows[i][k2], rows[i + 1][k2], rows[i + 1][k]]
            nn = [nrows[i][k], nrows[i][k2], nrows[i + 1][k2], nrows[i + 1][k]]
            th = angs[k] + math.pi / ns
            g.f(qd, "polished", out=(math.cos(th), math.sin(th), 0.0), normals=nn)
    # top annulus (hex outline -> spigot) and spigot / bore / bottom
    top = rows[-1]
    spig_r = 0.290
    ring_s = [g.v((spig_r * math.cos(th), spig_r * math.sin(th), NOSE_TOP)) for th in angs]
    for k in range(ns):
        k2 = (k + 1) % ns
        g.f([top[k], top[k2], ring_s[k2], ring_s[k]], "polished", out=(0, 0, 1),
            normals=[(0, 0, 1)] * 4)
    # threaded spigot (screws into the grip) — lighter ring count than the cone
    ts = q["thread_seg"]
    lathe(g, [C(NOSE_TOP, spig_r), C(NOSE_TOP + 0.04, spig_r), C(NOSE_TOP + 0.04, spig_r - 0.016, n=ts)],
          "polished", ns, explicit=True)
    thread(g, "polished", NOSE_TOP + 0.04, -3.06, spig_r - 0.016, spig_r, 0.05, ts)
    lathe(g, [C(-3.06, spig_r - 0.016, n=ts), C(-3.03, spig_r - 0.016, n=ts), C(-3.02, spig_r - 0.03, n=ts),
              C(-3.02, 0.205, n=ts), C(-4.30, 0.205, n=ts), C(-4.30, 0.0725), C(NOSE_BOT, 0.0725)],
          "polished", ns, explicit=True)
    bot = rows[0]
    ring_b = [g.v((0.0725 * math.cos(th), 0.0725 * math.sin(th), NOSE_BOT)) for th in angs]
    for k in range(ns):
        k2 = (k + 1) % ns
        g.f([bot[k], bot[k2], ring_b[k2], ring_b[k]], "polished", out=(0, 0, -1),
            normals=[(0, 0, -1)] * 4)
    return g


def build_nose_insert(q):
    g = Geo("noseInsert")
    g.uv_rref = seamless_rref(0.07)
    lathe(g, tube([C(-5.10, 0.054), C(-4.905, 0.054), C(-4.905, 0.072), C(-4.900, 0.078),
                   C(-4.856, 0.078), C(-4.851, 0.072), C(-4.851, 0.0705), C(-4.405, 0.0705),
                   C(-4.40, 0.066)],
                  [C(-4.40, 0.0435), C(-5.10, 0.0435)]),
          "brass", q["small_seg"], closed=True, explicit=True)
    return g


def build_nose_tip(q):
    g = Geo("noseTip")
    g.uv_rref = seamless_rref(0.06)
    lathe(g, tube([C(-5.15, 0.0465), C(-5.142, 0.0515), C(-5.05, 0.0560), C(-5.046, 0.0545),
                   C(-5.040, 0.0545), C(-5.036, 0.0568), C(-4.912, 0.0655), C(-4.905, 0.0635)],
                  [C(-4.905, 0.0560), C(-5.10, 0.0560), C(-5.10, 0.0438), C(-5.15, 0.0438)]),
          "polished", q["small_seg"], closed=True, explicit=True)
    return g


def build_lead_sleeve(q):
    g = Geo("leadSleeve")
    g.uv_rref = seamless_rref(0.04)
    lathe(g, tube([C(-6.05, 0.036), C(-6.042, 0.042), C(-5.05, 0.042)],
                  [C(-5.05, 0.0285), C(-6.05, 0.0285)]),
          "steel", q["small_seg"], closed=True, explicit=True)
    return g


def build_lead(q):
    g = Geo("lead")
    lathe(g, [A(-7.20), C(-7.20, 0.017), C(-7.188, 0.025), C(-5.90, 0.025), A(-5.90)],
          "lead", max(12, q["small_seg"] // 2), explicit=True)
    return g


# --------------------------------------------------------------- top end
def build_top_collar(q):
    g = Geo("topCollar")
    g.uv_rref = seamless_rref(APO_BAR)
    prof = tube([H(5.752, 0.420, 0.2), H(5.797, R_BAR, 0.45),
                 H(5.985, R_BAR, 0.22), C(5.985, 0.373), C(6.015, 0.373), H(6.015, R_BAR, 0.22),
                 H(6.105, R_BAR, 0.22), C(6.105, 0.373), C(6.135, 0.373), H(6.135, R_BAR, 0.22),
                 H(6.375, R_BAR, 0.45), H(6.43, 0.395, 0.2)],
                [C(6.43, 0.330, 0.1), C(6.338, 0.330), C(6.338, 0.302), C(5.752, 0.302, 0.1)])
    lathe(g, prof, "dlc", q["nseg"], closed=True, arris=1.0)
    return g


def build_button(q):
    g = Geo("buttonHex")
    g.uv_rref = seamless_rref(0.3)
    Rb = 0.33
    grooves = []
    z = 7.30
    for _ in range(5):
        grooves += [H(z, Rb, 0.25), C(z, 0.272), C(z + 0.026, 0.272), H(z + 0.026, Rb, 0.25)]
        z += 0.058
    prof = ([C(6.89, 0.246, 0.15), H(6.89, 0.31, 0.5), H(6.915, Rb, 0.5)] + grooves +
            [H(7.86, Rb, 0.5), H(7.915, 0.292, 0.5), C(7.915, 0.232, 0.3), C(8.065, 0.232, 0.6),
             C(8.10, 0.205, 0.6), C(8.096, 0.13), C(8.090, 0.05), A(8.089),
             A(7.555), C(7.555, 0.246, 0.15)])
    lathe(g, prof, "steel", q["nseg"], closed=True, arris=1.0)
    return g


def build_button_stem(q):
    g = Geo("buttonStem")
    lathe(g, [A(6.435), C(6.435, 0.055), C(6.445, 0.068), C(6.50, 0.068), C(6.50, 0.105),
              C(6.508, 0.112), C(6.552, 0.112), C(6.56, 0.105), C(6.56, 0.068), C(7.392, 0.068),
              C(7.40, 0.058), A(7.40)],
          "steel", q["small_seg"], explicit=True)
    return g


def build_eraser(q):
    g = Geo("eraser")
    lathe(g, tube([C(6.645, 0.165), C(6.655, 0.171), C(7.215, 0.171), C(7.245, 0.160), C(7.262, 0.135)],
                  [C(7.262, 0.074), C(6.645, 0.074)]),
          "eraser", q["nseg"], closed=True, explicit=True)
    return g


def build_eraser_sleeve(q):
    g = Geo("eraserSleeve")
    g.uv_rref = seamless_rref(0.18)
    lathe(g, tube([C(6.458, 0.186), C(6.47, 0.19), C(7.19, 0.19), C(7.197, 0.194), C(7.207, 0.194),
                   C(7.212, 0.188)],
                  [C(7.212, 0.176), C(6.458, 0.176)]),
          "brass", q["nseg"], closed=True, explicit=True)
    return g


def build_washer_top(q):
    g = Geo("washerTop")
    g.uv_rref = seamless_rref(0.3)
    lathe(g, tube([C(6.338, 0.312), C(6.346, 0.320), C(6.448, 0.320), C(6.455, 0.313),
                   C(6.455, 0.244), C(6.372, 0.244), C(6.372, 0.188), C(6.455, 0.188)],
                  [C(6.455, 0.082), C(6.338, 0.082)]),
          "mechdark", q["nseg"], closed=True, explicit=True)
    return g


def build_actuator_cone(q):
    g = Geo("actuatorCone")
    lathe(g, tube([C(5.752, 0.112), C(5.762, 0.122), C(6.17, 0.142), C(6.24, 0.282), C(6.248, 0.290),
                   C(6.322, 0.290), C(6.330, 0.282)],
                  [C(6.330, 0.080), C(5.752, 0.080)]),
          "mechdark", q["nseg"], closed=True, explicit=True)
    return g


def build_actuator_sleeve(q):
    g = Geo("actuatorSleeve")
    lathe(g, tube([C(5.482, 0.182), C(5.49, 0.189), C(6.112, 0.189), C(6.112, 0.226), C(6.12, 0.232),
                   C(6.172, 0.232), C(6.18, 0.224)],
                  [C(6.18, 0.151), C(5.482, 0.151)]),
          "mechdark", q["nseg"], closed=True, explicit=True)
    return g


def build_clutch_housing(q):
    g = Geo("clutchHousing")
    g.uv_rref = seamless_rref(0.2)
    lathe(g, tube([C(5.222, 0.160), C(5.232, 0.170), C(5.300, 0.170), C(5.306, 0.200),
                   C(5.312, 0.206), C(5.69, 0.206), C(5.70, 0.214), C(5.73, 0.214), C(5.735, 0.206),
                   C(5.77, 0.200)],
                  [C(5.77, 0.196), C(5.45, 0.196), C(5.45, 0.156), C(5.222, 0.156)]),
          "brass", q["nseg"], closed=True, explicit=True)
    return g


def build_retainer(q):
    g = Geo("retainerHex")
    g.uv_rref = seamless_rref(0.22)
    # end chamfers stay outside the bore at mid-flat (apothem 0.213 > 0.2075)
    lathe(g, tube([H(5.322, 0.246, 0.3), H(5.334, 0.252, 0.5), H(5.506, 0.252, 0.5), H(5.518, 0.246, 0.3)],
                  [C(5.518, 0.2075, 0.2), C(5.322, 0.2075, 0.2)]),
          "mechdark", q["nseg"], closed=True, arris=1.0)
    return g


def build_jaw(q, name, jaw_angle):
    """One of three collet jaws: a 110-degree sector of a turned collet head
    (gripping lip with three internal teeth, conical head the clutch ring
    rides on, short shank). Built where it sits assembled: the runtime puts
    the node at radius 0.11 along jawAngle, so geometry is offset back."""
    g = Geo(name)
    g.uv_mode = "box"
    phi = -jaw_angle  # glTF (cos a, sin a) in XZ -> Blender angle -a
    half = math.radians(56.0)
    ns = q["jaw_seg"]
    outer = [C(5.092, 0.088, 0.6), C(5.10, 0.098, 0.6), C(5.142, 0.146, 0.6), C(5.165, 0.146, 0.6),
             C(5.205, 0.118, 0.6), C(5.212, 0.112, 0.6), C(5.232, 0.112, 0.6)]
    inner = [C(5.232, 0.052, 0.6), C(5.152, 0.052, 0.4), C(5.146, 0.036, 0.3)]
    zt = 5.146
    for k in range(3):  # teeth
        inner += [C(zt - 0.012, 0.036), C(zt - 0.016, 0.029), C(zt - 0.020, 0.036)]
        zt -= 0.016
    inner += [C(5.098, 0.036, 0.3), C(5.092, 0.042, 0.6)]
    prof = outer + inner
    loops = lathe(g, prof, "brass", 0, closed=True, sector=(phi - half, phi + half, ns))
    # side (slot) faces: polygon of the profile at each sector end
    for end, sgn in ((0, -1), (-1, 1)):
        ids = [lp[0][end] for lp in loops]
        ang = phi + sgn * half
        out = (-math.sin(ang) * sgn, math.cos(ang) * sgn, 0.0)
        g.f(ids, "brass", out=out)
        for m in range(len(ids)):
            g.bw(ids[m], ids[(m + 1) % len(ids)], 0.6)
    off = Vector((0.11 * math.cos(phi), 0.11 * math.sin(phi), 0.0))
    g.translate(-off)
    return g


def build_seat(q, name, z0, z1, r_in):
    g = Geo(name)
    g.uv_rref = seamless_rref(0.26)
    lathe(g, tube([C(z0, 0.292), C(z0 + 0.008, 0.300), C(z1 - 0.008, 0.300), C(z1, 0.292)],
                  [C(z1, r_in + 0.006), C(z1 - 0.006, r_in), C(z0 + 0.006, r_in), C(z0, r_in + 0.006)]),
          "mechdark", q["nseg"], closed=True, explicit=True)
    return g


def build_stop_collar(q):
    g = Geo("stopCollar")
    lathe(g, tube([C(4.262, 0.188), C(4.27, 0.198), C(4.33, 0.198), C(4.33, 0.186), C(4.37, 0.186),
                   C(4.37, 0.198), C(4.43, 0.198), C(4.438, 0.188)],
                  [C(4.438, 0.153), C(4.262, 0.153)]),
          "brass", q["nseg"], closed=True, explicit=True)
    return g


def build_feed_rod(q):
    g = Geo("feedRod")
    g.uv_rref = seamless_rref(0.15)
    lathe(g, tube([C(3.352, 0.142), C(3.36, 0.150), C(4.49, 0.150), C(4.50, 0.141)],
                  [C(4.50, 0.120), C(3.352, 0.120)]),
          "polished", q["nseg"], closed=True, explicit=True)
    return g


def build_shaft_mid(q):
    g = Geo("shaftMid")
    lathe(g, [A(2.552), C(2.552, 0.095), C(2.56, 0.108), C(2.86, 0.108), C(2.86, 0.118),
              C(2.94, 0.118), C(2.94, 0.108), C(3.642, 0.108), C(3.65, 0.098), A(3.65)],
          "steel", q["small_seg"], explicit=True)
    return g


def build_res_plug(q):
    g = Geo("resPlug")
    g.uv_rref = seamless_rref(0.25)
    lathe(g, tube([H(3.432, 0.268, 0.4), H(3.44, 0.276, 0.4), H(3.50, 0.276, 0.4), H(3.50, 0.31, 0.5),
                   H(3.62, 0.31, 0.5), C(3.62, 0.205, 0.3), C(3.765, 0.205, 0.4), C(3.772, 0.196, 0.4)],
                  [C(3.772, 0.153, 0.2), C(3.432, 0.153, 0.2)]),
          "mechdark", q["nseg"], closed=True, arris=1.0)
    return g


def build_reservoir(q):
    g = Geo("reservoirHex")
    g.uv_rref = seamless_rref(0.26)
    lathe(g, tube([H(0.50, 0.29, 0.5), H(0.512, 0.30, 0.5), H(3.488, 0.30, 0.5), H(3.50, 0.29, 0.5)],
                  [H(3.50, 0.272), H(0.50, 0.272)]),
          "reservoir", q["nseg"], closed=True, arris=1.0)
    return g


def build_spacer(q):
    g = Geo("spacerTube")
    g.uv_rref = seamless_rref(0.33)
    lathe(g, tube([C(0.452, 0.337), C(0.46, 0.345), C(1.34, 0.345), C(1.348, 0.337)],
                  [C(1.348, 0.312), C(0.452, 0.312)]),
          "mechdark", q["nseg"], closed=True, explicit=True)
    return g


def build_thread_ring(q):
    g = Geo("threadRing")
    g.uv_rref = seamless_rref(0.32)
    seg = q["thread_seg"]
    z0, z1 = -0.45, 0.15
    thread(g, "brass", z0 + 0.06, z1 - 0.06, 0.318, 0.343, 0.05, seg)
    lathe(g, [C(z1 - 0.06, 0.318), C(z1 - 0.012, 0.318), C(z1, 0.306), C(z1, 0.205),
              C(z0, 0.205), C(z0, 0.306), C(z0 + 0.012, 0.318), C(z0 + 0.06, 0.318)],
          "brass", seg, explicit=True)
    return g


def build_guide_tube(q):
    g = Geo("guideTube")
    g.uv_rref = seamless_rref(0.12)
    lathe(g, tube([C(-2.40, 0.150), C(-2.37, 0.160), C(-2.34, 0.160), C(-2.34, 0.118),
                   C(-0.86, 0.118), C(-0.86, 0.160), C(-0.83, 0.160), C(-0.80, 0.150)],
                  [C(-0.80, 0.082), C(-2.40, 0.082)]),
          "brass", q["nseg"], closed=True, explicit=True)
    return g


# --------------------------------------------------------------- clip
CLIP_HT = 0.0175  # half thickness (0.35 mm spring steel)


def _clip_center(z):
    pts = [(3.07, 0.418), (3.13, 0.4122), (3.19, 0.4095), (3.30, 0.420), (3.55, 0.452),
           (4.20, 0.480), (4.90, 0.492), (5.40, 0.497), (5.56, 0.491), (5.64, 0.4875),
           (5.90, 0.4875)]
    # parametrise by index via z (monotonic)
    zs = [p[0] for p in pts]
    i = 0
    while i < len(zs) - 2 and z > zs[i + 1]:
        i += 1
    tt = (z - zs[i]) / (zs[i + 1] - zs[i])
    return catmull(pts, i + max(0.0, min(1.0, tt)))[1]


def build_clip(q):
    """Formed spring-steel clip: rounded-rectangle section swept along a bent
    centerline (flat on the foot under the screw, a gentle S out, a long
    lightly-preloaded blade, an inward kink to a contact dimple near the tip),
    tapering width, round ends, and a stamped center flute."""
    g = Geo("clipBlade")
    g.uv_mode = "box"
    zb, zt = 3.07, 5.90
    n = q["clip_n"]
    cs = q["clip_sec"]
    zs = [zb + (zt - zb) * (i / n) ** 1.0 for i in range(n + 1)]
    # densify ends for the round caps
    extra = [zb + 0.003 * k for k in range(1, 12)] + [zt - 0.003 * k for k in range(1, 12)]
    zs = sorted(set([round(z, 6) for z in zs + extra]))

    def half_w(z):
        w = 0.079 - 0.013 * max(0.0, min(1.0, (5.5 - z) / 2.2))
        r = w
        if z < zb + r:
            d = (zb + r - z) / r
            w = w * math.sqrt(max(0.0, 1 - d * d))
        if z > zt - r:
            d = (z - (zt - r)) / r
            w = w * math.sqrt(max(0.0, 1 - d * d))
        return max(w, 0.004)

    def flute(z):
        a, b, f = 3.62, 5.30, 0.10
        if z < a or z > b:
            return 0.0
        x = min(1.0, (z - a) / f, (b - z) / f)
        return x * x * (3 - 2 * x)

    rc = 0.0115
    rows = []
    for z in zs:
        s = _clip_center(z)
        ds = (_clip_center(z + 1e-4) - _clip_center(z - 1e-4)) / 2e-4
        T = Vector((0.0, ds, 1.0)).normalized()  # (x, standoff, z)
        N = Vector((0.0, 1.0, -ds)).normalized()  # outward (away from barrel)
        hw = half_w(z)
        rcz = min(rc, hw * 0.9, CLIP_HT * 0.95)
        sec = []
        # rounded rectangle, CCW looking down the path: start at outer face
        # center, go toward -w ... (flute on the outer face)
        nouter = 2 * cs + 1
        for i in range(nouter):
            w = (hw - rcz) * (1 - 2 * i / (nouter - 1))
            dep = 0.0055 * flute(z) * max(0.0, math.cos(min(math.pi / 2, abs(w) / 0.016 * math.pi / 2))) ** 2
            sec.append((w, CLIP_HT - dep))
        for i in range(1, 5):
            a = math.pi / 2 + (math.pi / 2) * i / 4
            sec.append((-(hw - rcz) + rcz * math.cos(a), (CLIP_HT - rcz) + rcz * math.sin(a)))
        for i in range(1, 5):
            a = math.pi + (math.pi / 2) * i / 4
            sec.append((-(hw - rcz) + rcz * math.cos(a), -(CLIP_HT - rcz) + rcz * math.sin(a)))
        for i in range(1, nouter - 1):
            w = -(hw - rcz) + 2 * (hw - rcz) * i / (nouter - 1)
            sec.append((w, -CLIP_HT))
        for i in range(0, 5):
            a = -math.pi / 2 + (math.pi / 2) * i / 4
            sec.append(((hw - rcz) + rcz * math.cos(a), -(CLIP_HT - rcz) + rcz * math.sin(a)))
        for i in range(1, 4):
            a = (math.pi / 2) * i / 4
            sec.append(((hw - rcz) + rcz * math.cos(a), (CLIP_HT - rcz) + rcz * math.sin(a)))
        row = []
        for (w, tt) in sec:
            p = Vector((w, s, z)) + N * tt
            row.append(g.v((p.x, -p.y, p.z)))  # standoff -> Blender -Y
        rows.append((row, Vector((0, s, z))))
    m = len(rows[0][0])
    for i in range(len(rows) - 1):
        ra, ca = rows[i]
        rb, cb = rows[i + 1]
        for k in range(m):
            k2 = (k + 1) % m
            qd = [ra[k], ra[k2], rb[k2], rb[k]]
            ctr = sum((Vector(g.V[j]) for j in qd), Vector()) / 4
            cc = (ca + cb) / 2
            cc3 = Vector((0.0, -cc.y, cc.z))
            g.f(qd, "steel", out=tuple(ctr - cc3))
    for (row, cc), sgn in ((rows[0], -1), (rows[-1], 1)):
        cpt = sum((Vector(g.V[j]) for j in row), Vector()) / m
        ci = g.v(cpt)
        for k in range(m):
            g.f([ci, row[k], row[(k + 1) % m]], "steel", out=(0, 0, sgn))
    return g


def build_clip_foot(q):
    """Machined clip saddle straddling the barrel/collar joint."""
    g = Geo("clipFoot")
    g.uv_mode = "box"
    x0, x1 = -0.088, 0.088
    s0, s1 = 0.384, 0.470
    z0, z1 = 5.585, 5.915
    c = [(x, s, z) for x in (x0, x1) for s in (s0, s1) for z in (z0, z1)]

    def V(ix, is_, iz):
        x = (x0, x1)[ix]
        s = (s0, s1)[is_]
        z = (z0, z1)[iz]
        return g.v((x, -s, z))

    ids = {(i, j, k): V(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)}
    faces = [((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1), (0, 1, 0)),   # back (s0) out -s => +y
             ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0), (0, -1, 0)),  # front
             ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0), (0, 0, -1)),
             ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1), (0, 0, 1)),
             ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0), (-1, 0, 0)),
             ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1), (1, 0, 0))]
    for a, b, cc, d, out in faces:
        g.f([ids[a], ids[b], ids[cc], ids[d]], "mechdark", out=out)
    for a in ids:
        for b in ids:
            if sum(abs(a[i] - b[i]) for i in range(3)) == 1 and a < b:
                # back edges (against the barrel) stay sharp: it sits flush
                w = 0.0 if (a[1] == 0 and b[1] == 0) else 1.0
                if w:
                    g.bw(ids[a], ids[b], w)
    return g


def build_clip_screw(q):
    """Cheese-head screw with a hex socket, clamping the clip to the foot.
    Authored along +Z then turned to point out of the clip face (-Y)."""
    g = Geo("clipScrew")
    ns = q["small_seg"]
    h0 = 0.505  # clip outer face (standoff)
    prof = [A(-0.11), C(-0.11, 0.018), C(-0.10, 0.022), C(0.0, 0.022), C(0.0, 0.046),
            C(0.004, 0.050), C(0.017, 0.050), C(0.026, 0.044), C(0.0305, 0.034),
            C(0.0315, 0.026), H(0.0315, 0.0175), H(0.019, 0.0175), A(0.0165)]
    lathe(g, prof, "steel", ns, explicit=True, phase=math.pi / 6)
    # axis +Z -> Blender -Y, origin at the head seat on the clip (standoff h0)
    g.map_points(lambda p: Vector((p.x, -(p.z + h0), p.y + 5.75)))
    g.map_normals(lambda n: Vector((n.x, -n.z, n.y)))
    g.uv_axis = ((0, 0, 5.75), (0, -1, 0))
    return g


# --------------------------------------------------------------- springs
def build_spring(q, name, zc, R, wire, half_len, coils):
    g = Geo(name)
    g.uv_mode = "box"
    helix_spring(g, "spring", R, wire, half_len, coils, q["spc"], q["wseg"])
    g.translate((0, 0, zc))
    return g


BUILDERS = {
    "barrelHex": build_barrel,
    "barrelGrooves": build_barrel_grooves,
    "gripRingTop": lambda q: build_ring("gripRingTop", -0.57, -0.35, 0.4515),
    "gripRingBot": lambda q: build_ring("gripRingBot", -3.40, -3.20, 0.4415),
    "noseWasher": build_nose_washer,
    "gripSleeve": build_grip_sleeve,
    "gripLattice": build_grip_lattice,
    "gripUnderlay": build_grip_underlay,
    "noseHex": build_nose,
    "noseInsert": build_nose_insert,
    "noseTip": build_nose_tip,
    "leadSleeve": build_lead_sleeve,
    "lead": build_lead,
    "topCollar": build_top_collar,
    "buttonHex": build_button,
    "buttonStem": build_button_stem,
    "eraser": build_eraser,
    "eraserSleeve": build_eraser_sleeve,
    "washerTop": build_washer_top,
    "actuatorCone": build_actuator_cone,
    "actuatorSleeve": build_actuator_sleeve,
    "clutchHousing": build_clutch_housing,
    "retainerHex": build_retainer,
    "jawA": lambda q: build_jaw(q, "jawA", 0.0),
    "jawB": lambda q: build_jaw(q, "jawB", 2.0944),
    "jawC": lambda q: build_jaw(q, "jawC", 4.1888),
    "seatUp": lambda q: build_seat(q, "seatUp", 5.11, 5.19, 0.176),
    "seatLow": lambda q: build_seat(q, "seatLow", 3.91, 3.99, 0.158),
    "stopCollar": build_stop_collar,
    "feedRod": build_feed_rod,
    "shaftMid": build_shaft_mid,
    "resPlug": build_res_plug,
    "reservoirHex": build_reservoir,
    "spacerTube": build_spacer,
    "threadRing": build_thread_ring,
    "guideTube": build_guide_tube,
    "clipBlade": build_clip,
    "clipFoot": build_clip_foot,
    "clipScrew": build_clip_screw,
    "buttonSpring": lambda q: build_spring(q, "buttonSpring", 6.62, 0.215, 0.022, 0.25, 5),
    "returnSpring": lambda q: build_spring(q, "returnSpring", 4.55, 0.245, 0.029, 0.58, 8),
    "stabilizerSpring": lambda q: build_spring(q, "stabilizerSpring", 2.60, 0.325, 0.020, 0.40, 6),
}
