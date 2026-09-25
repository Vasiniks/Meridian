# Handoff: Recreate the Meridian Hex Mechanical Pencil Site (Exact Rebuild)

Target: a single-page, scroll-driven 3D product site for the Meridian Hex —
a hexagonal-barrel mechanical pencil — that ends in a variant lineup and buy
section. Read this entire file before writing any code. Every section marked
**LOAD-BEARING** is something cheap rebuilds get wrong; do not skip it.

---

## 1. What "good" looks like (the bar)

The finished site must feel like a precision instrument being disassembled in
front of you as you scroll — not a webpage with a 3D widget on it. Concretely:

- The pencil is a **real multi-part assembly** (~40 named parts), not a
  textured cylinder. The exploded view separates into individually readable
  components (button, springs, clutch jaws, feed rod, grip, nose cone, lead).
- The **x-ray view fades only the shell** and lights the internals with an
  emissive lift, so the mechanism reads through the body.
- The scroll is a **camera choreography**: 8 labeled chapters
  (Reveal → Detail → Exploded → X-Ray → Mechanism → Reassembly → Object →
  Lineup), each a camera keyframe with smoothstep-blended position, target,
  and FOV.
- The metal reads as **frosted/satin anodized metal**, never chrome, never
  matte plastic. This comes from lighting + roughness discipline, not texture.
- The grip is **real geometry** (instanced diamond-knurl lattice), not a
  bump map.
- Mobile gets a **decimated asset + reduced effects**, not the desktop scene
  with the canvas hidden.

If your rebuild has a single-mesh pencil, a generic orbit control, a
RoomEnvironment-only light rig, or AI-purple glassmorphism UI — it failed.
Start over from section 3.

---

## 2. Stack (exact)

- **Vite + React 19 + TypeScript + three@0.184.0** (npm, bundled — never CDN
  `esm.sh` in production; CDN imports cause duplicate-Three-instance bugs).
- No Tailwind, no UI kit, no animation library. Styling is 8 hand-written CSS
  files under `src/styles/` (tokens, base, stage, nav, sections, lineup, buy,
  responsive). The visual language is warm paper (`#F5F3EE`), near-black ink,
  hairline borders, sharp 2px radii, Inter Tight + IBM Plex Mono.
- `@types/three` pinned to match the three version or `tsc` fails on addons.
- Python 3 + `numpy` + `pygltflib` for the asset pipeline. Blender 5 headless
  for `.blend` regeneration and render verification (NOT for primary modeling).

---

## 3. Asset pipeline (LOAD-BEARING — this is 70% of the quality)

### 3.1 The source of truth is a parametric builder, not a .blend

File: `scripts/asset-processing/build_pencil_glb.py` (~700 lines). It builds
every part from math primitives and writes desktop + mobile GLBs plus a part
manifest. This exists because a Blender-authored file can't be diffed,
regenerated deterministically, or procedurally detailed (springs, knurling,
threads). The `.blend` (`public/models/source/mechanical-pencil.blend`) is a
DERIVED artifact regenerated from the GLB via `glb_to_blend.py` — never the
other way around.

### 3.2 Mesh primitives to implement (all flat-shaded, non-indexed triangles)

- `MeshBuilder` class: collects `tri(a,b,c)` / `quad(a,b,c,d,out_ref)` calls.
  `quad` **auto-flips winding** so the face normal points away from `out_ref`
  — this eliminates 90% of inside-out-face bugs. `finish()` derives flat
  per-face normals + **box-projected UVs** (dominant axis of face normal;
  needed later for grain textures).
- `hex_ring(y, r, rot)` / `hex_stack(levels)` — the entire exterior language.
  The barrel is a true hexagonal prism (6 faces), NOT a high-segment cylinder.
- `open_hex_tube`, `cyl`, `box` (with rot_y/tilt), `helix_tube` (springs swept
  along a helix with parallel-transport frames — real coil geometry).

### 3.3 The 42-part assembly (exact registry)

`define_assembly()` declares every part as
`part(name, parent, baseY, explode, kind, mech, extra)` where `kind` is
`shell|inner` and `mech` is one of
`static|button|stem|actuator|rod|clutch|jaw|springMain|springBtn|springStab|lead|sleeve`.
Y axis runs tip (−7, lead end) to button crown (+8). The exact table (name,
baseY, explode scalar) lives in `define_assembly()` — reproduce it part for
part, including: 3 separate clutch jaws at 120° (`jawAngle` 0/2.0944/4.1888),
3 real springs (return/button/stabilizer), feed rod + mid shaft, actuator cone
+ sleeve, reservoir + plug, washers/seats/stops, thread ring with thread
ridges, nose cone + tip + brass insert + lead sleeve + lead, clip
blade/foot/screw, grip sleeve + underlay + lattice + 2 rings, barrel + groove
rings + top collar + button + stem + eraser + sleeve.

**Why this matters:** the exploded view, x-ray, and mechanism animation all
read from this registry. A fake assembly (fewer, merged parts) collapses all
three downstream features. Never merge parts to "simplify."

### 3.4 The grip lattice (the signature detail)

`gripLattice`: ~192 raised diamond ribs over the 6 hex faces + edge rails so
the pattern terminates intentionally (no chopped diamonds at boundaries).
Rules: integer rib counts per face, plain bands top/bottom, ribs as beveled
boxes oriented in the face plane. If it looks noisy at hero distance, reduce
count and widen ribs — never replace it with a bump map.

### 3.5 Materials (baked into the GLB, tuned at runtime)

GLB PBR table (`MATERIALS` dict): anodized barrel, DLC grip, brushed steel,
polished nose steel, brass, spring steel, polymer, dark mech, translucent
reservoir (`BLEND`, opacity 0.45), eraser, graphite lead, near-black recess.
At load, `assembly.ts tuneLookdev()` retunes per role: anodized metalness 1.0
/ roughness ~0.27–0.38 / envMapIntensity up to 2.4 with an albedo lift
(dark albedo kills specular — lifting ~1.9× preserves the dark character
while letting highlights survive). Keep roughness ≥0.22 everywhere or it
slides into chrome.

### 3.6 Export tiers

- Desktop: full tessellation (~11.5k tris total — yes, that low; flat facets
  need few triangles), `mechanical-pencil.glb` ~1 MB.
- Mobile: reduced spring steps/wire segments and simpler lattice (~6k tris).
- Validate every build by re-loading the GLB in Python: assert 42 meshes,
  42 extras-nodes, name match vs manifest. The builder already prints tri
  counts — read them.

---

## 4. Runtime architecture (`src/three/`)

- `config.ts` — quality tiers: `high` unless (touch AND small screen) or
  ≤4 CPU cores. DPR caps 2 / 1.5. MSAA 4× **only on desktop high tier** via a
  custom multisampled composer render target (constructed with samples —
  render-target textures are immutable after creation).
- `stage.ts` — renderer (ACES tone mapping, exposure ~1.0–1.12, sRGB),
  **custom procedural PMREM studio environment** (`buildStudioEnv()`:
  near-black room + 8 HDR softbox/edge/bounce cards — this is what makes dark
  metals reflect; RoomEnvironment alone leaves them near-black),
  5-light rig (warm key 3.2 with shadows high-tier-only, cool rim 2.8, fill
  0.65, top sheen 1.4, edge strip 1.0), shadow-catcher ground plane,
  `EffectComposer(RenderPass + OutputPass)` only.
- `assembly.ts` — loads the external GLB via `GLTFLoader` (never embedded in
  JS). **Critical GLTFLoader fact:** meshes arrive nested under their named
  nodes, so anchor the part registry on the extras-carrying node (which owns
  the base translation), not the mesh. Shell materials get per-material clones
  so x-ray fading never leaks into internal parts sharing a source material.
  Thin springs/lead get `castShadow = false` (kills coil shadow acne).
- `cameraRig.ts` — `sampleCam()`: smoothstep-interpolated position/target/FOV
  across the 8 KEYS, plus runtime macro overrides that track the real grip /
  jaw world positions for true side-view close-ups (never down-the-axis).
- `experience.ts` — the frame loop. Allocation-free (preallocated temp
  vectors), settled-frame early-out (skip render when scroll + animation state
  are static — but keep ticking while turntable spin or tint chase is live),
  damped camera (`1−exp(−5dt)`), pencil attitude, per-part explode offsets
  (`baseY + explode·ex·0.7`) + mechanism special-cases (jaws open radially,
  springs compress in Y, button/stem/actuator/rods dive, lead advances).

---

## 5. Scroll choreography (`src/data/scroll.ts` + sections)

- Progress `p` = scrollY / (scrollHeight − innerHeight), smoothed with
  `1−exp(−4dt)` frame-rate-independent damping.
- Envelope functions (all smoothstep products): `explodeF` (0.15→0.24 in,
  0.38→0.45 out), `xrayF` (0.32→0.36 / 0.52→0.57), `mechF`
  (0.44→0.48 / 0.52→0.56), `detailF` (0.05→0.08 / 0.13→0.16),
  `heroOffF`, `reOffF`, `canvasDimF`.
- Sections in order with matching copy in `src/data/content.ts`:
  Hero → Detail (grip macro) → Exploded (tall, part legend) → Xray →
  Mechanism (5 described steps, highlighted by scroll) → Reassembly →
  Philosophy → Lineup (pinned horizontal scroll, 4 variants, live barrel
  recolor by active card) → Buy (variant form recolors barrel + buy spinner).
- Lineup mechanics: section height = 4× viewport, sticky pin, track
  `translate3d` by scroll fraction; recompute on resize.

---

## 6. X-ray implementation (exact recipe)

1. Shell parts are flagged `kind: 'shell'` in the registry.
2. At load, each unique shell GLB material is cloned once (shared clones per
   material, assigned to all shell meshes using it).
3. Per frame, `xr = xrayF(p)`: clone opacity = `1 − xr·0.85` (floor 0.15 —
   silhouette preserved), `depthWrite = xr < 0.4`, `transparent` toggled only
   on state change (+ `needsUpdate`).
4. Inner legibility: emissive lift on reservoir/spring/brass materials
   proportional to `xr`.
5. The translucent reservoir uses `BLEND` alpha, never `transmission` (which
   allocates a transmission target and kills scroll perf).

---

## 7. Anti-obvious-failure checklist ( Lil' Wayne: run these, don't eyeball)

- `tsc` clean, `vite build` succeeds, three in its own chunk.
- Playwright (desktop 1440×900 + mobile 390×844, real browser, screenshots):
  all 8 scene labels in order; hero/detail/exploded/xray/mechanism/
  reassembly/lineup/buy each screenshotted; exploded fits frame top-to-bottom;
  tip connects to nose (no floating lead); nose insert doesn't poke through
  the cone; zero console errors (React DevTools notice is fine).
- Variant switching recolors the live barrel; buy form price follows.
- `prefers-reduced-motion` + motion toggle degrade to static.
- FPS: vsync-capped rAF on desktop; no jank during scroll sweep.

## 8. Known traps (each burned us once)

- Duplicate Three instances from CDN/vite-mixed imports → single npm `three`,
  check `renderer.info` sanity, heed the multi-instance warning.
- `modifier_apply` context pitfalls in headless Blender; Array `fit_type`
  must be `FIXED_COUNT` with explicit counts.
- Blender Z-up vs glTF Y-up: model pencil-axis along Blender +Z or the
  export lands rotated 90°.
- Indexed vs non-indexed GLB parsing when merging geometry.
- MSAA must be set at composer-target construction time.
- `page.check` on an already-checked radio fires no events (QA false passes).
- React StrictMode double-mounts effects → two WebGL contexts on one canvas;
  either remove StrictMode or make init/dispose airtight.
