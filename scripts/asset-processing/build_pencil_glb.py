#!/usr/bin/env python3
"""Meridian Hex — reference part registry (no Blender, no numpy).

`define_assembly()` is the authoritative part table of the site's runtime
contract. The Blender builder (scripts/asset-processing/blender/mh_parts.py)
carries the same table next to the geometry, writes it into
public/models/source/manifest.json, and scripts/asset-processing/
validate_glb.py fails if the manifest and this table ever differ. Change a
part here AND in mh_parts.py, never in one place only.

The pencil is a clutch-type drafting pencil (Pentel P205 / Rotring 600 /
Staedtler 925 class). 26 real components, tip to crown:

  lead (Ø 0.50) · lead sleeve (fixed, 4 mm) · sleeve bush · lead retainer
  (rubber) · ring stop · clutch ring · brass collet with 3 jaws · spring
  seat · return spring · lead tube + 3 spare leads · eraser holder · eraser
  · cap — inside a turned-hex cone, cone lock ring, knurled grip with two
  ferrules and a thread insert, hex barrel, top collar and pocket clip
  (blade, saddle, screw).

Mechanism roles (`mech`): static | button | tube | clutch | ring | spring |
lead. The cap pushes the lead tube; eraser holder, eraser, spare leads and
the collet ride on the tube; the clutch ring floats 0.5 mm between the
spring seat (rear) and the ring stop (front). The collet's three jaws are
child body nodes of `clutch` (BODIES) with extras {jawAngle}; their node
origin is the jaw's flex hinge.

explode = axial offset in the exploded view divided by the runtime's 0.7.

The legacy numpy geometry builder that used to live here was retired when
the internals were rebuilt as a real clutch mechanism (see git history).
"""
PARTS = []
BODIES = {}

JAW_ANGLES = (0.0, 2.0944, 4.1888)


def part(name, parent, base_y, explode, kind, mech="static", extra=None):
    PARTS.append({"name": name, "parent": parent, "baseY": base_y,
                  "explode": explode, "kind": kind, "mech": mech,
                  "extra": extra or {}})


def body(part_name, name, extra=None):
    BODIES.setdefault(part_name, []).append({"name": name, "extra": extra or {}})


def define_assembly():
    PARTS.clear()
    BODIES.clear()
    # ---- Exterior -------------------------------------------------
    part("cap", "Exterior", 7.55, 2.971, "shell", "button")
    part("eraser", "Exterior", 6.85, 2.314, "inner", "tube")
    part("eraserHolder", "Exterior", 6.70, 1.071, "inner", "tube")
    part("topCollar", "Exterior", 6.15, 0.643, "shell", "static")
    part("barrelHex", "Exterior", 2.60, 0.0, "shell", "static")
    part("clipBlade", "Exterior", 0.0, 0.15, "shell", "static")
    part("clipFoot", "Exterior", 5.75, 0.3, "shell", "static")
    part("clipScrew", "Exterior", 5.75, 0.55, "inner", "static")
    part("gripRingTop", "Exterior", -0.45, -0.36, "shell", "static")
    part("grip", "Exterior", -1.95, -0.79, "shell", "static")
    part("gripRingBot", "Exterior", -3.30, -1.07, "shell", "static")
    part("noseHex", "Exterior", -4.85, -6.286, "shell", "static")
    part("noseTip", "Exterior", -5.00, -6.286, "shell", "static")
    # ---- Internal -------------------------------------------------
    part("leadTube", "Internal", 1.80, -2.857, "inner", "tube")
    part("spareLeads", "Internal", 3.40, -2.857, "inner", "tube")
    part("threadRing", "Internal", -0.15, -0.29, "inner", "static")
    part("mainSpring", "Internal", -3.24, -2.857, "inner", "spring")
    part("clutch", "Internal", -3.30, -2.857, "inner", "clutch")
    part("springSeat", "Internal", -3.68, -2.857, "inner", "static")
    part("clutchRing", "Internal", -3.85, -3.386, "inner", "ring")
    part("ringStop", "Internal", -4.06, -3.429, "inner", "static")
    part("noseWasher", "Internal", -3.55, -1.36, "inner", "static")
    part("leadRetainer", "Internal", -4.37, -3.543, "inner", "static")
    part("noseInsert", "Internal", -4.75, -7.314, "inner", "static")
    part("leadSleeve", "Internal", -5.55, -7.314, "inner", "static")
    part("lead", "Internal", -4.22, -2.357, "inner", "lead")
    # ---- child bodies (one component, several meshes) -------------
    body("barrelHex", "barrelInlay")
    body("grip", "gripKnurl")
    body("grip", "gripLiner")
    for nm, a in zip(("jawA", "jawB", "jawC"), JAW_ANGLES):
        body("clutch", nm, {"jawAngle": a})
    return PARTS


if __name__ == "__main__":
    define_assembly()
    for p in PARTS:
        kids = ", ".join(b["name"] for b in BODIES.get(p["name"], []))
        print(f"{p['name']:<14} {p['parent']:<9} y={p['baseY']:+6.2f} ex={p['explode']:+7.3f} "
              f"{p['kind']:<6} {p['mech']:<7} {kids}")
    print(f"{len(PARTS)} parts")
