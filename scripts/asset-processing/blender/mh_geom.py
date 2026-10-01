"""Meridian Hex — geometry kernel for the Blender builder.

Everything is authored in Blender space with the pencil axis on +Z (the glTF
exporter's +Y-up conversion maps Blender (x, y, z) -> glTF (x, z, -y)).
Hex sections put a VERTEX on +X (same orientation as the legacy numpy
builder), so faces sit at 30 + 60k degrees; the clip rides the face at -90
degrees (Blender -Y == glTF +Z).

`Geo` collects polygons with explicit outward hints (winding is fixed per
face, so there are no inside-out faces), material roles, per-edge bevel
weights / sharp flags, per-face shading and optional explicit per-corner
normals. `Geo.to_mesh()` welds by position and produces a bpy mesh.

Two shading pipelines are used by the parts:
  * "bevel":    Bevel modifier (limit = edge weight, harden normals) — for
                hex / hard-surface parts: flat faces stay flat, highlights
                roll over real rounded arrises.
  * "explicit": analytic per-corner normals written as custom normals — for
                turned (round) parts, springs and threads, where the true
                surface normal is known exactly.
"""
import math

import bpy
from mathutils import Vector

TAU = math.tau
HEX_COS = math.cos(math.pi / 6)  # apothem / vertex radius


def ekey(a, b):
    return (a, b) if a < b else (b, a)


class Geo:
    def __init__(self, name):
        self.name = name
        self.V = []
        self.F = []  # list of [idx...]
        self.FM = []  # material role per face
        self.FSM = []  # smooth flag per face
        self.FN = []  # None or list of per-corner normals
        self.FUV = []  # None or list of per-corner uvs
        self.FK = []  # uv kind per face: None (auto) | 'hex' (perimeter-linear)
        self.BW = {}
        self.SHARP = set()
        self.uv_mode = "cyl"
        self.uv_rref = None  # cylindrical reference radius (seamless wrap)
        self.uv_axis = None  # (origin, axis) for non-Z cylindrical mapping

    # ---------------------------------------------------------------- basic
    def v(self, co):
        self.V.append((float(co[0]), float(co[1]), float(co[2])))
        return len(self.V) - 1

    def f(self, idx, mat, out=None, smooth=True, normals=None, uvs=None, uvk=None):
        idx = list(idx)
        if len(set(idx)) < 3:
            return None
        if out is not None:
            n = self.newell(idx)
            if n.length > 1e-16 and n.dot(Vector(out)) < 0:
                idx.reverse()
                if normals is not None:
                    normals = list(reversed(normals))
                if uvs is not None:
                    uvs = list(reversed(uvs))
        self.F.append(idx)
        self.FM.append(mat)
        self.FSM.append(smooth)
        self.FN.append(normals)
        self.FUV.append(uvs)
        self.FK.append(uvk)
        return len(self.F) - 1

    def remove_faces(self, pred):
        """Drop faces whose vertex positions satisfy pred(list_of_Vectors)."""
        n = 0
        for i, f in enumerate(self.F):
            if f and pred([Vector(self.V[j]) for j in f]):
                self.F[i] = []
                n += 1
        return n

    def split_edge(self, pa, pb, new_idx, tol=1e-7):
        """Insert vertices (ordered from pa to pb) into every face that has the
        edge pa->pb or pb->pa (matched by position) — removes T-junctions."""
        pa, pb = Vector(pa), Vector(pb)
        hits = 0
        for fi, f in enumerate(self.F):
            if not f:
                continue
            n = len(f)
            for i in range(n):
                a = Vector(self.V[f[i]])
                b = Vector(self.V[f[(i + 1) % n]])
                if (a - pa).length < tol and (b - pb).length < tol:
                    ins = list(new_idx)
                elif (a - pb).length < tol and (b - pa).length < tol:
                    ins = list(reversed(new_idx))
                else:
                    continue
                self.F[fi] = f[:i + 1] + ins + f[i + 1:]
                if self.FUV[fi] is not None or self.FN[fi] is not None:
                    self.FUV[fi] = None
                    self.FN[fi] = None
                hits += 1
                break
        return hits

    def newell(self, idx):
        n = Vector((0.0, 0.0, 0.0))
        P = [Vector(self.V[i]) for i in idx]
        for i in range(len(P)):
            a, b = P[i], P[(i + 1) % len(P)]
            n.x += (a.y - b.y) * (a.z + b.z)
            n.y += (a.z - b.z) * (a.x + b.x)
            n.z += (a.x - b.x) * (a.y + b.y)
        return n

    def bw(self, a, b, w):
        if w <= 0:
            return
        k = ekey(a, b)
        self.BW[k] = max(self.BW.get(k, 0.0), w)

    def sharp(self, a, b):
        self.SHARP.add(ekey(a, b))

    def extend(self, other):
        off = len(self.V)
        self.V.extend(other.V)
        for i in range(len(other.F)):
            self.F.append([j + off for j in other.F[i]])
            self.FM.append(other.FM[i])
            self.FSM.append(other.FSM[i])
            self.FN.append(other.FN[i])
            self.FUV.append(other.FUV[i])
            self.FK.append(other.FK[i])
        for k, w in other.BW.items():
            self.BW[(k[0] + off, k[1] + off)] = w
        for k in other.SHARP:
            self.SHARP.add((k[0] + off, k[1] + off))

    def map_points(self, fn):
        self.V = [tuple(fn(Vector(p))) for p in self.V]

    def map_normals(self, fn):
        self.FN = [None if ns is None else [tuple(fn(Vector(n))) for n in ns] for ns in self.FN]

    def translate(self, d):
        d = Vector(d)
        self.V = [tuple(Vector(p) + d) for p in self.V]

    def tri_count(self):
        return sum(len(f) - 2 for f in self.F if f)

    def bounds(self):
        xs = [p[0] for p in self.V]
        ys = [p[1] for p in self.V]
        zs = [p[2] for p in self.V]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

    # ------------------------------------------------------------- to bpy
    def to_mesh(self, mat_slots, weld=1e-6):
        """mat_slots: ordered list of role names (material slot order)."""
        key = {}
        remap = []
        newV = []
        q = 1.0 / weld
        for p in self.V:
            k = (round(p[0] * q), round(p[1] * q), round(p[2] * q))
            if k not in key:
                key[k] = len(newV)
                newV.append(p)
            remap.append(key[k])
        faces = []
        keep = []
        for fi, f in enumerate(self.F):
            if not f:
                continue
            g = []
            for i in f:
                j = remap[i]
                if not g or g[-1] != j:
                    g.append(j)
            if len(g) > 1 and g[0] == g[-1]:
                g.pop()
            if len(g) >= 3 and len(set(g)) == len(g):
                faces.append(g)
                keep.append(fi)
        # drop duplicate faces (same vertex set) — e.g. folded thread ends —
        # and zero-area slivers (collinear fill triangles): they carry no
        # surface but poison per-vertex tangent frames (MikkTSpace)
        seen = set()
        f2, k2 = [], []
        for f, fi in zip(faces, keep):
            sig = tuple(sorted(f))
            if sig in seen:
                continue
            P = [Vector(newV[j]) for j in f]
            nn = Vector((0.0, 0.0, 0.0))
            for i in range(len(P)):
                a, b = P[i], P[(i + 1) % len(P)]
                nn.x += (a.y - b.y) * (a.z + b.z)
                nn.y += (a.z - b.z) * (a.x + b.x)
                nn.z += (a.x - b.x) * (a.y + b.y)
            if nn.length * 0.5 < 1e-13:
                continue
            seen.add(sig)
            f2.append(f)
            k2.append(fi)
        faces, keep = f2, k2
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(newV, [], faces)
        me.update()
        for name in mat_slots:
            me.materials.append(bpy.data.materials[name])
        slot = {n: i for i, n in enumerate(mat_slots)}
        me.polygons.foreach_set("material_index", [slot[self.FM[fi]] for fi in keep])
        me.polygons.foreach_set("use_smooth", [bool(self.FSM[fi]) for fi in keep])
        BW = {}
        for (a, b), w in self.BW.items():
            k = ekey(remap[a], remap[b])
            BW[k] = max(BW.get(k, 0.0), w)
        SH = {ekey(remap[a], remap[b]) for (a, b) in self.SHARP}
        if BW:
            att = me.attributes.new("bevel_weight_edge", 'FLOAT', 'EDGE')
            att.data.foreach_set("value", [BW.get(ekey(*e.vertices), 0.0) for e in me.edges])
        if SH:
            att = me.attributes.get("sharp_edge") or me.attributes.new("sharp_edge", 'BOOLEAN', 'EDGE')
            att.data.foreach_set("value", [ekey(*e.vertices) in SH for e in me.edges])
        uvl = me.uv_layers.new(name="UVMap")
        uvs = []
        for pi, fi in enumerate(keep):
            poly = me.polygons[pi]
            given = self.FUV[fi]
            if given is not None and len(given) == poly.loop_total:
                uvs.extend(given)
            else:
                uvs.extend(self.auto_uv([newV[v] for v in poly.vertices], poly.normal, self.FK[fi]))
        uvl.data.foreach_set("uv", [c for uv in uvs for c in uv])
        if any(self.FN[fi] is not None for fi in keep):
            loop_normals = []
            for pi, fi in enumerate(keep):
                poly = me.polygons[pi]
                ns = self.FN[fi]
                if ns is None or len(ns) != poly.loop_total:
                    n = tuple(poly.normal)
                    loop_normals.extend([n] * poly.loop_total)
                else:
                    loop_normals.extend([tuple(Vector(n).normalized()) for n in ns])
            me.normals_split_custom_set(loop_normals)
        me.update()
        return me

    def auto_uv(self, pts, normal, kind=None):
        if self.uv_mode == "box":
            return box_uv(pts, normal)
        nrm = Vector(normal)
        if kind == "hex" and self.uv_axis is None and abs(nrm.z) < 0.75:
            # perimeter-linear: exactly linear on every flat hex face and
            # continuous across the arrises (consistent tangent frames)
            P = (self.uv_rref or 0.45) * TAU
            psi = math.degrees(math.atan2(nrm.y, nrm.x)) % 360.0
            k = int(round((psi - 30.0) / 60.0)) % 6
            a = math.radians(60 * k + 30)
            nk = (math.cos(a), math.sin(a))
            tk = (-math.sin(a), math.cos(a))
            res = []
            for p in pts:
                ap = p[0] * nk[0] + p[1] * nk[1]
                tp = p[0] * tk[0] + p[1] * tk[1]
                f = 0.5 + tp / (2.0 * max(ap, 1e-6) * math.tan(math.pi / 6))
                res.append(((k + f) * P / 6.0, p[2]))
            return res
        o = Vector((0, 0, 0))
        ax = Vector((0, 0, 1))
        if self.uv_axis is not None:
            o, ax = Vector(self.uv_axis[0]), Vector(self.uv_axis[1]).normalized()
        ref = Vector((1, 0, 0)) if abs(ax.x) < 0.9 else Vector((0, 1, 0))
        e1 = (ref - ax * ref.dot(ax)).normalized()
        e2 = ax.cross(e1)
        if abs(Vector(normal).dot(ax)) > 0.75:
            return [((Vector(p) - o).dot(e1), (Vector(p) - o).dot(e2)) for p in pts]
        angs, rads, zs = [], [], []
        for p in pts:
            d = Vector(p) - o
            x, y = d.dot(e1), d.dot(e2)
            angs.append(math.atan2(y, x))
            rads.append(math.hypot(x, y))
            zs.append(d.dot(ax))
        a0 = angs[0]
        un = []
        for a in angs:
            while a - a0 > math.pi:
                a -= TAU
            while a - a0 < -math.pi:
                a += TAU
            un.append(a)
        r = self.uv_rref if self.uv_rref is not None else max(1e-4, sum(rads) / len(rads))
        return [(a * r, z) for a, z in zip(un, zs)]


def box_uv(pts, normal):
    n = Vector(normal)
    ax = max(range(3), key=lambda i: abs(n[i]))
    if ax == 0:
        return [(p[1], p[2]) for p in pts]
    if ax == 1:
        return [(p[0], p[2]) for p in pts]
    return [(p[0], p[1]) for p in pts]


def seamless_rref(r_main, density=1.0):
    """Reference radius for cylindrical UVs so the grain tile wraps an
    integer number of times around the part (no seam)."""
    t = max(1, round(TAU * r_main * density))
    return t / (TAU * density)


# ------------------------------------------------------------------ lathe
class S:
    """Profile section: z, radius, shape ('hex'|'round'|'axis'), bevel weight
    of this section's ring edges, explicit sharp flag for its ring edges."""

    __slots__ = ("z", "r", "shape", "bw", "sharp", "n")

    def __init__(self, z, r, shape="round", bw=0.0, sharp=None, n=None):
        self.z, self.r, self.shape, self.bw = z, r, shape, bw
        self.sharp = sharp
        self.n = n  # per-section segment override (round sections)


def H(z, r, bw=0.0, sharp=None):
    return S(z, r, "hex", bw, sharp)


def C(z, r, bw=0.0, sharp=None, n=None):
    return S(z, r, "round", bw, sharp, n)


def A(z):
    return S(z, 0.0, "axis")


def ring_pts(sec, nseg, phase=0.0, sector=None):
    if sec.shape == "axis" or sec.r <= 1e-12:
        return [(0.0, 0.0, sec.z)], [0.0]
    if sector is not None:
        a0, a1, ns = sector
        angs = [a0 + (a1 - a0) * k / ns for k in range(ns + 1)]
        return [(sec.r * math.cos(a), sec.r * math.sin(a), sec.z) for a in angs], angs
    n = 6 if sec.shape == "hex" else (sec.n or nseg)
    angs = [phase + k * TAU / n for k in range(n)]
    return [(sec.r * math.cos(a), sec.r * math.sin(a), sec.z) for a in angs], angs


def _out3(dr, dz, ang):
    # outward normal for a CCW (r, z) profile traversal: (dz, -dr)
    return (dz * math.cos(ang), dz * math.sin(ang), -dr)


def _n3(dr, dz, ang):
    v = Vector(_out3(dr, dz, ang))
    return tuple(v.normalized()) if v.length > 1e-14 else (0.0, 0.0, 1.0)


def _eff_r(sec):
    if sec.shape == "axis":
        return 0.0
    return sec.r * (HEX_COS if sec.shape == "hex" else 1.0)


def lathe(g, secs, mat, nseg, closed=False, arris=0.0, smooth=True, phase=0.0,
          sector=None, auto_sharp=35.0, arris_sharp=False, explicit=False):
    """Revolve a profile. `secs` must be ordered so that walking them goes
    counter-clockwise in the (r, z) half plane (outer surface upward, top cap
    inward, bore downward, bottom cap outward) — faces then point outward.
    Hex <-> round neighbours are bridged with balanced fans (turned grooves /
    shoulders on hex stock). `sector=(a0, a1, n)` makes an open angular
    sector (collet jaws). `explicit=True` writes analytic per-corner normals
    (smooth turned surfaces, crisp profile corners)."""
    loops = []
    for s in secs:
        pts, angs = ring_pts(s, nseg, phase, sector)
        loops.append(([g.v(p) for p in pts], angs))
    nsec = len(secs)
    pairs = list(range(nsec - 1))
    if closed:
        pairs.append(nsec - 1)
    for i, s in enumerate(secs):
        idx, _ = loops[i]
        if len(idx) < 2:
            continue
        sh = s.sharp
        if sh is None:
            prv = secs[i - 1] if (i > 0 or closed) else None
            nxt = secs[(i + 1) % nsec] if (i < nsec - 1 or closed) else None
            sh = False
            if prv is not None and nxt is not None:
                d0 = (_eff_r(s) - _eff_r(prv), s.z - prv.z)
                d1 = (_eff_r(nxt) - _eff_r(s), nxt.z - s.z)
                l0, l1 = math.hypot(*d0), math.hypot(*d1)
                if l0 > 1e-9 and l1 > 1e-9:
                    c = (d0[0] * d1[0] + d0[1] * d1[1]) / (l0 * l1)
                    sh = math.degrees(math.acos(max(-1, min(1, c)))) > auto_sharp
        m = len(idx) if sector is None else len(idx) - 1
        for k in range(m):
            a, b = idx[k], idx[(k + 1) % len(idx)]
            if s.bw > 0:
                g.bw(a, b, s.bw)
            elif sh:
                g.sharp(a, b)
    for i in pairs:
        j = (i + 1) % nsec
        A_, aa = loops[i]
        B_, ba = loops[j]
        si, sj = secs[i], secs[j]
        dr = _eff_r(sj) - _eff_r(si)
        dz = sj.z - si.z
        if abs(dr) < 1e-12 and abs(dz) < 1e-12:
            continue
        nf0 = len(g.F)
        _bridge(g, A_, aa, B_, ba, mat, dr, dz, smooth, sector is not None, explicit,
                si.shape == "hex" or sj.shape == "hex")
        if si.shape == "hex" and sj.shape == "hex" and sector is None:
            for fi in range(nf0, len(g.F)):
                g.FK[fi] = "hex"
        if si.shape == "hex" and sj.shape == "hex" and abs(dz) > 1e-9:
            # chamfer segments (radius changes) are short: a full-width
            # arris bevel there collides with the two ring bevels and folds
            # the corner triangles over
            w_ar = arris if abs(si.r - sj.r) < 1e-9 else arris * 0.35
            for k in range(len(A_)):
                if arris > 0:
                    g.bw(A_[k], B_[k], w_ar)
                elif arris_sharp:
                    g.sharp(A_[k], B_[k])
    return loops


def _bridge(g, A_, aa, B_, ba, mat, dr, dz, smooth, open_ring, explicit, anyhex):
    na, nb = len(A_), len(B_)
    if na == 1 and nb == 1:
        return
    sm_ex = explicit and not anyhex
    if na == 1 or nb == 1:
        c = A_[0] if na == 1 else B_[0]
        L, la = (B_, ba) if na == 1 else (A_, aa)
        n = len(L)
        m = n - 1 if open_ring else n
        for k in range(m):
            k2 = (k + 1) % n
            ang = 0.5 * (la[k] + la[k2]) if open_ring else la[k] + math.pi / n
            ns = [_n3(dr, dz, ang), _n3(dr, dz, la[k]), _n3(dr, dz, la[k2])] if sm_ex else None
            g.f([c, L[k], L[k2]], mat, out=_out3(dr, dz, ang), smooth=smooth, normals=ns)
        return
    if na == nb:
        m = na - 1 if open_ring else na
        for k in range(m):
            k2 = (k + 1) % na
            ang = 0.5 * (aa[k] + aa[k2]) if open_ring else aa[k] + math.pi / na
            ns = None
            if sm_ex:
                ns = [_n3(dr, dz, aa[k]), _n3(dr, dz, aa[k2]), _n3(dr, dz, aa[k2]), _n3(dr, dz, aa[k])]
            g.f([A_[k], A_[k2], B_[k2], B_[k]], mat, out=_out3(dr, dz, ang), smooth=smooth, normals=ns)
        return
    # hex (6) <-> round (n): balanced fans per hex side (flat shoulders)
    if na < nb:
        Sm, sa, Bg = A_, aa, B_
    else:
        Sm, sa, Bg = B_, ba, A_
    ns_, nbg = len(Sm), len(Bg)
    mper = nbg // ns_
    half = mper // 2
    for k in range(ns_):
        s0, s1 = Sm[k], Sm[(k + 1) % ns_]
        b = [Bg[(k * mper + j) % nbg] for j in range(mper + 1)]
        o = _out3(dr, dz, sa[k] + math.pi / ns_)
        for j in range(half):
            g.f([s0, b[j], b[j + 1]], mat, out=o, smooth=smooth)
        g.f([s0, b[half], s1], mat, out=o, smooth=smooth)
        for j in range(half, mper):
            g.f([s1, b[j], b[j + 1]], mat, out=o, smooth=smooth)


def tube(outer, inner):
    """Closed CCW profile from an outer list (bottom->top) and an inner list
    (top->bottom)."""
    return list(outer) + list(inner)


# ------------------------------------------------------------- sweeps
def helix_spring(g, mat, R, wire, half_len, coils, steps_per_coil, wire_seg, dead=1.0):
    """Compression spring centred on the origin (runtime scales it in Z about
    its node origin). One closed dead coil per end (pitch = wire dia) blends
    into the open active coils; the ends are then ground flat — vertices are
    clamped to the end planes so the end coils show the ground 'D' faces."""
    d = 2 * wire
    total_th = coils * TAU
    n = int(round(coils * steps_per_coil))
    ts = [i / n for i in range(n + 1)]

    def w_active(t):
        e = min(coils * t, coils * (1 - t))
        x = max(0.0, min(1.0, (e - dead * 0.55) / (dead * 0.9)))
        return x * x * (3 - 2 * x)

    wsum = sum(w_active((ts[i] + ts[i + 1]) / 2) for i in range(n)) / n
    span = 2 * half_len - d * 0.35
    pa = (span / coils - d * (1 - wsum)) / max(wsum, 1e-6)
    zc = [0.0]
    for i in range(n):
        p = d + (pa - d) * w_active((ts[i] + ts[i + 1]) * 0.5)
        zc.append(zc[-1] + p * coils / n)
    off = zc[-1] / 2
    zc = [z - off for z in zc]
    rings, norms = [], []
    for i in range(n + 1):
        th = total_th * ts[i]
        c, s_ = math.cos(th), math.sin(th)
        i0, i1 = max(0, i - 1), min(n, i + 1)
        dzdth = (zc[i1] - zc[i0]) / (total_th * (ts[i1] - ts[i0]))
        T = Vector((-s_ * R, c * R, dzdth)).normalized()
        Nr = Vector((c, s_, 0.0))
        Bn = T.cross(Nr).normalized()
        ring, rn = [], []
        for k in range(wire_seg):
            a = TAU * k / wire_seg
            dirv = Nr * math.cos(a) + Bn * math.sin(a)
            p = Vector((R * c, R * s_, zc[i])) + dirv * wire
            ground = abs(p.z) > half_len
            p.z = max(-half_len, min(half_len, p.z))
            ring.append(g.v(p))
            rn.append(Vector((0, 0, 1 if p.z > 0 else -1)) if ground else dirv)
        rings.append(ring)
        norms.append(rn)
    for i in range(n):
        thm = total_th * (ts[i] + ts[i + 1]) / 2
        axisp = Vector((R * math.cos(thm), R * math.sin(thm), 0.5 * (zc[i] + zc[i + 1])))
        for k in range(wire_seg):
            k2 = (k + 1) % wire_seg
            q = [rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]]
            ns = [norms[i][k], norms[i][k2], norms[i + 1][k2], norms[i + 1][k]]
            ctr = sum((Vector(g.V[j]) for j in q), Vector()) / 4
            g.f(q, mat, out=tuple(ctr - axisp), smooth=True, normals=ns)
    for i, sign in ((0, -1), (n, 1)):
        ring = rings[i]
        th = total_th * ts[i]
        T = Vector((-math.sin(th), math.cos(th), 0.0)) * sign
        cpt = sum((Vector(g.V[j]) for j in ring), Vector()) / len(ring)
        ci = g.v(cpt)
        for k in range(wire_seg):
            g.f([ci, ring[k], ring[(k + 1) % wire_seg]], mat, out=tuple(T), smooth=True,
                normals=[tuple(T)] * 3)


def thread(g, mat, z0, z1, r_root, r_crest, pitch, nseg, flank_pts=1):
    """Single-start helical V-thread (60-deg-ish) between z0..z1 on a core,
    ends trimmed flat. Analytic normals from the surface gradient."""
    depth = r_crest - r_root
    # profile along one pitch: root flat -> flank -> crest flat -> flank
    prof = [(0.0, 0.0), (0.12, 0.0)]
    for k in range(1, flank_pts + 1):
        prof.append((0.12 + 0.30 * k / flank_pts, depth * k / flank_pts))
    prof.append((0.62, depth))
    for k in range(1, flank_pts + 1):
        prof.append((0.62 + 0.38 * k / flank_pts, depth * (1 - k / flank_pts)))
    prof = prof[:-1]  # last equals next pitch's first
    turns_extra = 2
    nrow_per = len(prof)
    total_rows = int(math.ceil((z1 - z0) / pitch) + turns_extra) * nrow_per
    rows = []
    for rr in range(total_rows + 1):
        cyc, ph = divmod(rr, nrow_per)
        fz, h = prof[ph]
        row = []
        for j in range(nseg + 1):
            th = TAU * j / nseg
            z = z0 - pitch + (cyc + fz) * pitch + pitch * th / TAU
            row.append((th, z, h))
        rows.append(row)

    run = 0.8 * pitch  # thread run-out length at each end

    def runout(z):
        a = max(0.0, min(1.0, (z - z0) / run))
        b = max(0.0, min(1.0, (z1 - z) / run))
        return (a * a * (3 - 2 * a)) * (b * b * (3 - 2 * b))

    # effective height with run-out: the thread vanishes into the core at
    # both ends (no folded geometry), positions clamped to [z0, z1]
    pts = []
    for row in rows:
        pr = []
        for th, z, h in row:
            zc = max(z0, min(z1, z))
            pr.append((th, zc, h * runout(z)))
        pts.append(pr)
    idx = []
    for pr in pts:
        idx.append([g.v(((r_root + h) * math.cos(th), (r_root + h) * math.sin(th), z)) for th, z, h in pr])

    def normal(rr, j):
        # finite differences across the grid (rows ~ along profile, cols ~ around)
        a = Vector(g.V[idx[max(0, rr - 1)][j]])
        b = Vector(g.V[idx[min(total_rows, rr + 1)][j]])
        c = Vector(g.V[idx[rr][max(0, j - 1)]])
        d = Vector(g.V[idx[rr][min(nseg, j + 1)]])
        nv = (d - c).cross(b - a)
        th = pts[rr][j][0]
        radial = Vector((math.cos(th), math.sin(th), 0.0))
        if nv.length < 1e-12:
            return radial
        nv.normalize()
        return nv if nv.dot(radial) >= 0 else -nv

    nrm = [[normal(rr, j) for j in range(nseg + 1)] for rr in range(total_rows + 1)]
    for rr in range(total_rows):
        for j in range(nseg):
            q = [idx[rr][j], idx[rr][j + 1], idx[rr + 1][j + 1], idx[rr + 1][j]]
            ns = [nrm[rr][j], nrm[rr][j + 1], nrm[rr + 1][j + 1], nrm[rr + 1][j]]
            P = [Vector(g.V[k]) for k in q]
            ctr = sum(P, Vector()) / 4
            g.f(q, mat, out=(ctr.x, ctr.y, 0.0), smooth=True, normals=ns)


def clip_poly(poly, a, b, c):
    """Sutherland-Hodgman: keep points with a*x + b*y + c >= 0.
    poly: list of (x, y, h) tuples (h is interpolated linearly)."""
    out = []
    n = len(poly)
    for i in range(n):
        P = poly[i]
        Q = poly[(i + 1) % n]
        fp = a * P[0] + b * P[1] + c
        fq = a * Q[0] + b * Q[1] + c
        if fp >= -1e-12:
            out.append(P)
        if (fp >= -1e-12) != (fq >= -1e-12):
            t = fp / (fp - fq)
            out.append(tuple(P[m] + (Q[m] - P[m]) * t for m in range(3)))
    res = []
    for p in out:
        if not res or max(abs(p[m] - res[-1][m]) for m in range(2)) > 1e-12:
            res.append(p)
    if len(res) > 1 and max(abs(res[0][m] - res[-1][m]) for m in range(2)) < 1e-12:
        res.pop()
    return res


def catmull(points, t):
    """Uniform Catmull-Rom through (x, y) points, t in [0, len-1]."""
    n = len(points)
    i = max(0, min(n - 2, int(math.floor(t))))
    u = t - i
    p0 = points[max(0, i - 1)]
    p1 = points[i]
    p2 = points[i + 1]
    p3 = points[min(n - 1, i + 2)]
    res = []
    for k in range(len(p1)):
        a = 2 * p1[k]
        b = p2[k] - p0[k]
        c = 2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]
        d = -p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]
        res.append(0.5 * (a + b * u + c * u * u + d * u * u * u))
    return tuple(res)
