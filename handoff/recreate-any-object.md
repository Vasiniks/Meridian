# Handoff: Recreate This KIND of Site for ANY Object (General Method)

This is the transferable method behind the Meridian pencil site: a
scroll-driven 3D product page where a real multi-part assembly disassembles,
x-rays, reanimates, and sells itself. Follow it in order. The failure mode at
every step is "looks like a generic 3D widget" — each section tells you the
specific decision that prevents that.

---

## 0. Pick an object that earns this treatment

The method only works for objects with **internal structure worth revealing**.
Good candidates: mechanical watch, folding knife, camera lens, espresso portafilter,
headphone driver, keyboard switch, bicycle hub, lighter mechanism. Bad
candidates: a mug, a chair, a sneaker with nothing inside (no x-ray payoff),
anything you can't decompose into 15+ meaningful parts.

Requirement before you start: write down the part list (aim 25–45 parts) with
each part's mechanical role in one line. If you can't — if parts would be
"decorative cylinder #3" — pick another object. The part list IS the project;
everything downstream (exploded view, x-ray, mechanism copy) reads from it.

## 1. Design the page as 8 chapters first (copy before code)

Fixed narrative spine — adapt the nouns, keep the structure:

1. **Reveal** (hero: name, one-line promise, price CTA)
2. **Detail** (macro shot of the signature surface/texture)
3. **Exploded** (tall section, the money shot — full assembly on one axis)
4. **X-ray** (shell goes quiet, core stays lit)
5. **Mechanism** (numbered steps, each highlighting as you scroll)
6. **Reassembly** (everything snaps home — payoff moment)
7. **Object/Philosophy** (rest beat, brand values as spec rows)
8. **Lineup + Buy** (pinned horizontal variants, then purchase form)

Write all copy before modeling. Short headlines (≤8 words), sub-paragraphs
≤25 words, one CTA per hero. Numbers must be real (tolerances, weights, part
counts from your part list) — never invent engineering precision the object
doesn't claim.

## 2. Stack (non-negotiable for reliability)

- **Vite + React + TypeScript + three (npm-bundled, one instance).** No CDN
  three, no R3F/Drei abstraction over the scene, no Tailwind/UI kit — hand CSS
  in the brand's voice (paper/ink/hairline discipline beats glassmorphism
  every time for physical products).
- Python + numpy + pygltflib asset pipeline (section 3). Blender headless only
  for `.blend` regen, QA renders, and variant thumbnails — never primary
  modeling.
- Playwright + real Chromium for all visual QA. Never declare anything "done"
  from code inspection alone.

## 3. Model parametrically, in code (the core skill)

**Why not Blender-first:** a parametric builder is diffable, regenerable, and
generates repetitive engineering geometry (springs, threads, knurling, Dante
teeth, repeated holes) exactly instead of approximately. Blender enters later
for validation renders.

### 3.1 Set up the primitive kit (port these from the pencil builder)

- `MeshBuilder` collecting non-indexed triangles with `tri()` and an
  auto-winding-correcting `quad()` (flip so normals face away from a reference
  point) + `finish()` producing flat per-face normals and box-projected UVs
  (dominant face-normal axis — enough for isotropic grain).
- Profile primitives for YOUR object's symmetry: the pencil used hex
  rings/stacks (true hexagonal prism, not a 64-gon cylinder — the silhouette
  must read faceted immediately). A watch would use cylinders + box lugs; a
  knife, flat slabs + bevels. Match the primitive kit to the object's real
  manufacturing language.
- `helix_tube()` for any coil (springs, cords, wound elements) with
  parallel-transport frames. If your object has no coils, you still need the
  pattern for threads: stacked thin tori read as threading at product scale.

### 3.2 Declare the assembly as data, then build to it

```python
part(name, parent, baseY, explode, kind, mech, extra)
# kind: shell (fades in x-ray) | inner (stays lit)
# mech: static | button | stem | actuator | rod | clutch | jaw |
#        springMain | springBtn | springStab | lead | sleeve
# extra: jawAngle etc.
```

Adapt `mech` roles to your mechanism (e.g. watch: crown/stem/mainspring/
escapement/hairspring/balance). Rules:
- 25–45 parts, every one mechanically justifiable. No decorative blobs.
- Repeated subassemblies get real multiplicity: 3 clutch jaws at 120°, not
  one "jaw blob" (viewers unconsciously check this).
- Axis convention: pick ONE assembly axis (pencil: +Y, tip −7, crown +8)
  and place every part's node translation on it. Exploded view = translate
  along this axis by `explode` scalar. Off-axis parts (clip, crown) get
  explicit side offsets.
- Overlapping contacts beat abutting ones: sink mating faces 0.01–0.03 INTO
  each other (interpenetration never z-fights; coplanar faces always do).

### 3.3 Signature surface = real geometry, always

Whatever the object's "grip equivalent" is (watch bezel knurling, lens focus
ring ribs, knife G10 texture), model it as geometry: instanced ribs/studs in
an integer grid per face with intentional termination (edge rails, plain
bands — never chopped cells). Test at three distances: hero (reads instantly),
macro (clean close-up), mobile thumbnail (no shimmer field). If it shimmers,
reduce count and widen elements — density is the enemy on small screens.

### 3.4 Materials: PBR table + runtime retune

Bake base PBR into the GLB (metallic/roughness per role), then retune at load
per material name: the pencil's key discovery was that **dark metals need an
albedo lift** (near-black albedo kills all specular; ~1.9× lift keeps the dark
character while letting highlights survive) and roughness ≥0.22 or everything
slides into chrome. Keep a strict material count (~12); every metal shares one
environment.

### 3.5 Export + validate like a pipeline

- Desktop full-tessellation + mobile decimated GLB + JSON manifest.
- Automated validation on every build: parse the GLB, assert mesh count,
  extras-node count, and name match vs manifest. Print tri counts and READ
  them (pencil: ~11.5k desktop / ~6k mobile — flat facets need few triangles;
  if your count is 10× that, your tessellation params are wrong, not rich).

## 4. Light it like product photography, not a game level

- **Custom procedural PMREM studio environment** (dark room + 6–9 HDR
  softbox/edge/bounce cards), NOT RoomEnvironment alone — dark metals reflect
  nothing under neutral environments and read as matte plastic. This single
  decision is the difference between "expensive" and "grey blob."
- 4–5 light rig: warm key (shadows, high-tier only), cool rim (edge
  separation), low fill (never flatten), top sheen (chamfer highlights), edge
  strip (grazing highlights on facets).
- ACES tone mapping, exposure ~1.0–1.12, sRGB output. EffectComposer with
  RenderPass + OutputPass ONLY (no bloom — bloom is the fastest way to make
  precision hardware look like a toy). MSAA 4× on desktop via a multisampled
  composer target constructed with samples (immutable after creation); off on
  mobile.
- One shadow-casting light only; thin parts (springs, leads, hairsprings)
  get `castShadow = false` to kill coil acne. Tight shadow frustum.

## 5. Scroll choreography system (copy the architecture)

- Single progress value `p` (scroll fraction), frame-rate-independent damped
  (`1−exp(−k·dt)` everywhere — never raw lerp factors).
- Camera = 8 keyframes (pos/target/FOV/label) with smoothstep interpolation +
  runtime macro overrides that track REAL part world positions (grip, jaws)
  for close-ups. Never stare down the assembly axis in macro.
- Feature envelopes as smoothstep products: explode in/out, xray in/out,
  mechanism pulse, detail pulse, hero offset, canvas dim. Each feature owns an
  envelope; the loop just evaluates them.
- **X-ray recipe** (port exactly): flag shell materials at load, clone them
  per material so fading can't leak into shared internals; per-frame set
  opacity floor ~0.15 (silhouette survives), flip `depthWrite`/`transparent`
  only on state change; emissive-lift the internals proportional to the x-ray
  weight. Never use `transmission` (allocates a target, kills scroll perf).
- **Exploded view** falls out free: per-part `base + explode·weight` along the
  assembly axis + staggered scalars from the registry. Tune scalars for
  readability (internals spread wider than shell), not physical accuracy.
- **Mechanism animation** = small axial dives/compressions/openings driven by
  the mechanism envelope: buttons/stems/rods dive, springs compress in Y,
  jaws open radially, the working element (lead/hand/geartrain) advances.
  Keep amplitudes tiny (±0.1–0.3 units) — believable, not cartoonish.
- Lineup: pinned horizontal section (height = 4× viewport, recomputed on
  resize), track translate by scroll fraction, live recolor of the hero
  material by active card, variant thumbnails rendered FROM the actual model
  (throwaway render page + canvas screenshots — never hand-drawn SVGs, which
  rot into inconsistency).
- Buy finale: the single model shrinks/settles into the whitespace and keeps
  a slow turntable; variant selection lerps the hero material color (chase a
  target, never snap). Reversing scroll must restore everything — every
  animation value derives from scroll weights, never accumulated state
  (the one allowed exception: monotonic turntable spin, which is
  direction-agnostic by construction).

## 6. Responsive + performance discipline

- Quality gate: high tier unless (touch AND small viewport) or ≤4 cores.
  DPR caps 2/1.5, shadows/MSAA desktop-only.
- Breakpoint AND aspect logic must be LIVE (recomputed on resize, not frozen
  at load): camera pullback factor from aspect, macro-fit compensation
  (`1/min(1,aspect)`), editorial off-center offsets faded to centered on
  portrait. Test by resizing mid-session across the breakpoint, both
  directions — layout must never strand.
- Frame loop: preallocated temp vectors (zero per-frame allocation),
  settled-frame early-out that still ticks while spin/tint chases are live,
  visibility pause, full dispose.
- Textures: near-zero. The pencil ships zero image textures — grain comes
  from geometry + roughness response. Every texture you add must justify its
  bytes against a geometry solution.

## 7. QA protocol (this is what separates the results)

After EVERY modeling/material/choreography change, in a real browser:

1. Desktop 1440×900 + mobile 390×844 (+ one awkward size, e.g. 800×1000).
2. Screenshot all 8 chapters in scroll order; read the scene labels.
3. Zoom mentally into every seam: floating parts, poke-throughs, coplanar
   shimmer, transparent sorting artifacts, shadow acne.
4. Check variant switching, motion toggle, reduced-motion, buy price follows
  variant, no horizontal overflow anywhere.
5. Console: zero errors. `tsc` clean. `vite build` succeeds.
6. Fix in the source of truth (builder → GLB → verify), never patch the
   render to hide a modeling bug. Iterate until the close-ups survive.

Common traps to brief the session on up front: duplicate-Three-instance
imports, Blender Z-up vs glTF Y-up (model long-axis along Blender +Z),
indexed-vs-soup GLB parsing, MSAA-after-construction, StrictMode
double-mounting two GL contexts on one canvas, Playwright `page.check` on an
already-checked radio firing no events (false-pass QA), stale-closure color
snaps (always chase targets, never set).
