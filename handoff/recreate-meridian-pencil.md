# Handoff: Recreate the Meridian Hex Mechanical Pencil Site (Exact Rebuild)

Target: a single-page, scroll-driven 3D product site for the Meridian Hex.
The product is a hexagonal-barrel mechanical pencil. The page is drawn in
technical-drawing language: graphite, hairlines, one accent `#A63D22`. The
pencil comes apart, gets x-rayed and runs its mechanism, then sells itself
from a spinning ring of four variants.

Read this entire file before writing any code. Every section marked
**LOAD-BEARING** is something cheap rebuilds get wrong. Do not skip it.

Companion docs: `handoff/awwwards-brief.md` (motion and design research,
easing tokens, avoid list) and `handoff/recreate-any-object.md` (the
transferable method).

---

## 1. What "good" looks like (the bar)

- **"The drawing becomes the object."** The site must feel like a precision
  instrument drafted and then disassembled as you scroll, not a webpage with
  a 3D widget on it. That means:
  - a graphite cursor trail;
  - a preloader that drafts the pencil from real load progress;
  - SVG callouts anchored to real 3D parts;
  - an x-ray scan line that inverts the page to ink.
- **A real multi-part assembly**: 26 named parts, every one a real
  component of a clutch-type drafting pencil (Pentel P205 / Rotring 600 /
  Staedtler 925 class), never a textured cylinder and never an invented
  "actuator". The exploded view pulls the mechanism out of the front:
  cap and eraser, barrel, lead tube, grip, return spring, brass collet,
  clutch ring and ring stop, cone and lead retainer, lead sleeve and lead.
  See §3.3 and §3.5.
- **The x-ray is a scan.** A hairline sweeps down the viewport. Above it, the
  shells render as a hatched, rim-lit ghost and the page turns to ink. Below
  it, the object is still solid on paper.
- **The scroll is a camera choreography**: 9 sheets (Reveal, Detail,
  Exploded, X-Ray, Mechanism, Reassembly, Principles, Lineup, Order), each
  timed to the copy it sits under.
- **The metal reads as frosted, bead-blasted anodized metal**, never chrome,
  never matte plastic. That comes from Blender-authored micro-grain normal
  and roughness maps plus lighting discipline.
- **The grip is real geometry**: a machined diamond knurl, not a bump map.
- **The lineup is a 3D ring of pencils that scroll spins**, not a horizontal
  card track.
- **Mobile gets a decimated asset and reduced effects**, not the desktop
  scene with the canvas hidden.
- **A zero-GPU path exists**: pre-rendered frames plus a static CSS prism.

It has failed, and you should start over from §3, if your rebuild has any of
these:
- a single-mesh pencil
- generic orbit controls
- a RoomEnvironment-only light rig
- bloom
- AI-purple glassmorphism UI

---

## 2. Stack (exact)

- **Vite 7, React 19, TypeScript and three@0.184.0**, bundled from npm.
  Never use CDN imports: they cause duplicate-Three-instance bugs.
  `@types/three` must match the three version, or `tsc` fails on addons.
- **Lenis** smooth scroll (`autoRaf`), exposed as `window.__lenis`. Anything
  that jumps the scroll (ring detents, QA scripts) must go through
  `__lenis.scrollTo(y, {immediate:true})`.
- Fonts are self-hosted with `@fontsource`: Hanken Grotesk (display and
  body), Newsreader italic for emphasis, and DM Mono. Fallbacks are
  metric-matched (`base.css`, measured from the font files with fontTools),
  which keeps CLS at about 0.0001.
- Logo: the "Hex & lead" mark (`src/components/BrandMark.tsx`), a hex
  outline with the lead dot in the accent colour. It is used in the nav and
  the favicon.
- No Tailwind, no UI kit, no animation library. CSS is hand-written:
  - `src/styles/*`: tokens, base, stage, nav, sections, lineup,
    responsive
  - `src/overlay/*.css`: drawing and x-ray
  - Visual language: warm paper `#F5F3EE`, near-black ink, hairline borders,
    sharp 2px radii.
- **Every URL into `/public` goes through `asset('…')`** (`src/assetUrl.ts`,
  which prefixes `import.meta.env.BASE_URL`). The site deploys to GitHub
  Pages under `/Meridian/`, so a root-absolute `/models/x.glb` URL 404s
  there, and the live site falls back to SVG.
- Asset pipeline: Blender as a Python module (`pip3 install "bpy==4.5.*"`,
  python3.11), plus numpy and pygltflib.

---

## 3. Asset pipeline (LOAD-BEARING — this is most of the quality)

### 3.1 Blender is the source of truth

`scripts/asset-processing/blender/build_pencil.py` builds every part in
headless Blender:
- real bevels with hardened normals
- a machined diamond knurl and a turned-hex nose
- laser-etched lettering and a formed clip
- a closed, ground return spring and a slotted 3-jaw brass collet
  (serrated jaws, cone at the mouth)
- helical threads
- bead-blasted micro-grain textures (turned lathe marks on brass)

It exports:

| Output | Path |
|---|---|
| Desktop GLB | `public/models/desktop/mechanical-pencil.glb` (~74k tris, ~1.8 MB meshopt, 1024 maps) |
| Mobile GLB | `public/models/mobile/mechanical-pencil-mobile.glb` (~35k tris, ~0.8 MB meshopt, 512 maps) |
| Scene | `public/models/source/mechanical-pencil.blend` (desktop, live modifiers) |
| Part registry and stats | `public/models/source/manifest.json` |

The modules are `mh_geom` (primitives), `mh_parts` (the part builders and
the registry), `mh_materials`, `mh_textures` and `render_views` (the Cycles
renders of the lineup cards in `public/variants/*.png`, plus look-dev views:
`--views clutch` renders the internals through the five mechanism steps).

`render_views` reads colour and roughness from `src/three/finishes.ts`. Never
keep a second copy of the finishes.

`scripts/asset-processing/build_pencil_glb.py` is the **reference
registry** (plain Python, no geometry): `define_assembly()` is the
authoritative part table, and the validator checks the manifest against it.
Change a part there AND in `mh_parts.py`.

Geometry is meshopt-compressed after the build by
`scripts/asset-processing/compress_glb.mjs` (the loader registers
`MeshoptDecoder`). `npm run build:assets` chains build → compress →
validate.

### 3.2 Mesh hygiene (each item burned us once)

- **Triangulate every part in Blender** (Triangulate modifier, BEAUTY) before
  its normals are final. The glTF exporter's own triangulation of long n-gons
  creates zero-area triangles.
- **Zero-area faces get the normal +Z in Blender.** That bent the
  lettering-panel normals by up to 46° and caused the "wedge" streaks: dotted
  seams in three.js, broken tangents in Cycles. Fill glyphs from exact,
  collinear-free polylines. Never resample curves.
- **Bevelled parts use `Bevel(harden_normals)`, not WeightedNormal**, which
  tilted panel corners by about 7°.
- Watch for folded or self-intersecting end rings, where normals point
  144–180° off. They hit the barrel top, top collar and cap crown.
- Interpenetrate mating faces by 0.01–0.03 units. Coplanar faces z-fight.
- Blender is Z-up and glTF is Y-up. Model the pencil axis along Blender +Z.

### 3.3 The 26-part assembly contract (LOAD-BEARING)

- **Hierarchy:** glTF root `Pencil` → `Exterior` / `Internal` → exactly 26
  named part nodes, one per real component.
- **Per-part data:** each node has extras `{ex, kind, mech}` and translation
  `[0, baseY, 0]`. The clip parts keep their special offsets.
- **Child bodies:** a component made of several meshes is ONE part node with
  child body nodes (no `mech`): `clutch` → `jawA/jawB/jawC` (extras
  `{jawAngle}` 0, 2.0944, 4.1888; node origin = the jaw's flex hinge at the
  slot root), `grip` → `gripKnurl`, `gripLiner`, and `barrelHex` →
  `barrelInlay`. The runtime anchors on the extras node and collects all
  descendant meshes; it opens a jaw by rotating its node about its local
  tangent axis.
- **Axis and scale:** 1 unit = 10 mm. Y runs from the lead tip (−5.72) to
  the cap crown (+8.10); crown to sleeve end is 136.5 mm. Barrel 7.8 mm
  across flats, lead Ø 0.50 mm.
- **Kinds and roles:** `kind` is `shell` or `inner`. `mech` is one of
  `static|button|tube|clutch|ring|spring|lead`.

| Part | Role | What it is |
|---|---|---|
| `cap` | button | steel push-button / eraser cap, pressed onto the eraser holder |
| `eraser`, `eraserHolder` | tube | eraser in a brass ferrule on the top of the lead tube |
| `topCollar` | static | hex collar; its bore guides the eraser holder |
| `barrelHex` (+ `barrelInlay`) | static | anodized 6061 hex barrel, etched lettering |
| `clipBlade`, `clipFoot`, `clipScrew` | static | pocket clip, saddle, screw |
| `grip` (+ `gripKnurl`, `gripLiner`), `gripRingTop`, `gripRingBot`, `threadRing` | static | knurled grip, steel ferrules, brass thread insert |
| `noseHex`, `noseTip`, `noseWasher` | static | turned-hex cone, its tip, cone lock ring |
| `noseInsert` | static | brass bush in the cone that holds the sleeve |
| `leadSleeve` | static | fixed steel lead sleeve, 4 mm proud, Ø 0.84 / 0.57 |
| `leadRetainer` | static | rubber ring; holds the lead by friction while the jaws are open |
| `ringStop` | static | hardened stop washer on a step in the cone bore |
| `clutchRing` | ring | brass clutch ring, Ø 2.7 × 2.6 mm |
| `clutch` (+ 3 jaws) | clutch | brass collet: 3 slotted jaws, shank, spring flange, tube socket |
| `springSeat` | static | body-fixed washer: spring seat on top, ring rear stop below |
| `mainSpring` | spring | return spring, 0.32 mm wire, 9 coils, closed + ground; centred on its node origin |
| `leadTube`, `spareLeads` | tube | smoked lead tube (continuous collet → eraser holder), 3 spare leads |
| `lead` | lead | the working lead, a 30 mm piece |

- **Materials:** `barrelHex` carries `anodized` (the variant tint target)
  plus `etch` (the lettering). Shell parts fade in the x-ray.
- **Material roles:** anodized, dlc, steel, polished, brass, spring, recess,
  polymer, mechdark, reservoir, eraser, lead, etch. Any new role must be
  handled in `tuneLookdev()`.

The exploded view, x-ray, drawing callouts, mechanism and ring all read from
this registry. **Never merge parts to "simplify."**

**Validate every build** with `python3 scripts/asset-processing/validate_glb.py`
(exit 1 on failure). It checks:
- the hierarchy, extras and translations against the manifest, and the
  manifest against `define_assembly()`;
- that the springs are centred;
- the material roles;
- that there are no degenerate triangles or flipped normals;
- the child bodies (jaws carry `jawAngle`);
- the per-tier budgets (compressed): desktop ≤ 2.6 MB and ≤ 150k tris,
  mobile ≤ 1.25 MB and ≤ 60k tris.

### 3.4 Materials (baked into the GLB, tuned at runtime)

`assembly.ts` `tuneLookdev()` is a per-role table:
- **Maps:** it keeps the Blender normal and roughness maps and sets their
  strength per role.
- **Roughness:** it holds roughness at **≥ 0.22**, even after the roughness
  map's minimum, or the metal slides into chrome.
- **Dark metals:** they get an albedo lift (about 1.9×). Near-black albedo
  kills specular highlights.
- **Variant tint:** `barrelMat` takes **only** the anodized material of
  barrelHex, never the etch. Otherwise the tint lands on the letters.
- **Reservoir:** it uses `BLEND` alpha, never `transmission`.

### 3.5 The mechanism (LOAD-BEARING: it must match a real clutch pencil)

How it works, and what `drawing/mechanism.ts` animates (1 unit = 10 mm):

1. **Press.** The cap pushes the lead tube; the collet (press-fit on the
   tube's front end), the clutch ring wedged on its jaws and the gripped
   lead all move forward together, compressing the return spring
   (`tube = −0.05`, lead `+0.05`).
2. **Ring stops.** After 0.5 mm the clutch ring lands on the ring stop. The
   collet keeps going (`tube = −0.12`).
3. **Jaws open.** The collet's cone slides out of the stopped ring and the
   jaws spring open (they flex about the slot root; the mouth moves ~0.2 mm
   out) at the full 2.5 mm stroke (`tube = −0.25`). The rubber lead
   retainer in the cone holds the lead where it is.
4. **Release.** The spring drives the tube back; the open jaws slide up the
   stationary lead (`tube = −0.13`).
5. **Regrip.** The jaws re-enter the ring and close; the collet carries the
   ring back onto the spring seat (its rear stop). Net: the lead is 0.5 mm
   further out.

Runtime rules: only `tube` and `lead` are posed (five poses; step timing
`MECH_P0` 0.412 + 0.012 per step to `MECH_END` 0.48 in `drawing/state.ts`).
The ring is derived, `ring = max(tube, −0.05)`, and the jaw opening follows
`ring − tube` (0 at 0.03, full at 0.2), so no frame can show open jaws in a
seated ring or a ring past its stop. The spring scales by
`1 + tube / length` and slides by `tube / 2`, so its seat end stays put.
Nothing rotates except the jaws' flex. A hero click plays the full stroke
and leaves the lead 0.5 mm further out (up to 5 clicks; reset on explode).
`render_views.py` mirrors the poses (`MECH_POSES`) for Cycles checks.

---

## 4. Runtime architecture (`src/three/`, `src/fx/`)

### 4.1 Core

- **`config.ts`:** the tier is `high` unless (touch AND a viewport ≤900px
  wide) or ≤4 CPU cores. DPR caps are 2 and 1.5. MSAA 4× applies only on the
  desktop high tier, through a multisampled composer target constructed with
  samples.
- **`stage.ts`:**
  - Renderer: **NeutralToneMapping** at exposure 1.0. ACES desaturated the
    brass and the ink blue.
  - Environment: a procedural PMREM studio (`buildStudioEnv()`, a dark room
    with HDR softbox, edge and bounce cards).
  - Lights: 5 directional lights inside a `lightRig` group. The look module
    rotates it together with `scene.environmentRotation`, so highlights stay
    coherent.
  - No shadow-map ground: contact shadows replace it.
  - Composer: `RenderPass`, then look's post FX, then `OutputPass`. No bloom,
    ever.
- **`assembly.ts`:** loads the GLB with `GLTFLoader`, never embedded in JS.
  - Anchor the part registry on the extras-carrying node, not the mesh.
  - Clone each shell material once, so x-ray fading never leaks into
    internal parts that share it.
  - Thin springs and the lead get `castShadow = false`.
- **`cameraRig.ts`:** `sampleCam()` smoothstep-interpolates position, target
  and FOV across `KEYS` (`src/data/scroll.ts`). Runtime macro overrides
  track the real `grip` node and the first collet jaw (`asm.jawNodes[0]`,
  inside the cone) for side views that never look down the axis. The
  mechanism macro sits ~1.9 world units from the clutch (a ~14 mm field), so
  the 0.5 mm ring travel and the jaw opening read.
- **`experience.ts`:** the frame loop.
  - Allocation-free: temp vectors are preallocated.
  - Damping: camera λ=9 (`1−exp(−9dt)`); attitude written absolutely each
    frame.
  - Parts: per-part explode offsets plus mechanism special cases.
  - Settled-frame early-out: skip the render unless scroll moved or a module
    returns `wantsFrame() === true`.

### 4.2 Scene modules (`modules.ts`; LOAD-BEARING for parallel work)

**Prefer writing a `SceneModule` over editing `experience.ts`.** The frame
order is:
1. `preUpdate(ctx)` undoes last frame's transient offsets.
2. The built-in choreography runs.
3. `update(ctx)` applies offsets, uniforms and DOM sync, then the frame
   renders.

Modules also get `wantsFrame`, `onResize` and `onMotionChange`. `FrameCtx`
carries `p`, `rawP`, `scrollVel`, `dt`, `stage`, `asm`, `cfg` and
`motionOK`. Registration lives in `registerModules.ts`, one block per area:
- **look** (`src/three/look/`):
  - `rig.ts`: pointer parallax.
  - `light.ts`: environment-rotation light sweep, plus `streak()` on
    reassembly and the Limited crescendo.
  - `contactShadows.ts`: warm contact shadows.
  - `postfx.ts`: velocity chromatic aberration and macro tilt-shift.
- **drawing** (`src/three/drawing/`, `src/overlay/`):
  - `overlay.ts`: the SVG overlay, with callouts projected from 3D anchors.
  - `picking.ts`: exploded-part picking and cursor labels.
  - `xray.ts`: the x-ray scan (clipping plane, ghost shader, DOM ink sheet).
  - `mechanism.ts` and `spring.ts`: mechanism poses, spring physics and the
    pencil click (§3.5).
- **lineup** (`ring.ts`):
  - the hero glides into the ring's front slot;
  - the 4 variants spin on scroll detents, with a dial, click and drag;
  - the page ends on the ring: past `FREE_SPIN_U` it spins indefinitely
    (wheel, swipe or arrow-down past the bottom, drag, dial, clicks) and the
    Order button sells the variant in front. There is no separate Buy section.

Shared contracts:
- `src/fx/bus.ts` is a typed event bus: `cursor`, `variant:active`,
  `variant:select`, `pencil:click`, `load:progress`, `intro`, `motion`,
  `chapter`, `look:streak` and `mech:step`. Extend it; don't break it.
- `src/fx/pointer.ts` holds the shared pointer state.
- `src/three/finishes.ts` is the per-variant finish: colour, roughness,
  metalness and envIntensity.

### 4.3 DOM effects (`src/fx/`, `src/motion/`)

- **Motion system:** tokens, damp and spring helpers, and a motion flag
  (reduced motion plus the "Pause motion" toggle) on a shared DOM ticker.
- **Graphite cursor** (`graphite.ts`, `cursor.ts`): a velocity-width pencil
  trail, a nib, a context ring that renders bus `cursor` states, and
  magnetic CTAs.
- **Reveals** (`reveal.ts`, `odometer.ts`): attribute driven
  (`data-reveal=…`), with line masks, body fades, mono type-on and odometers.
- **Preloader** (`preloader.ts`, `loadProgress.ts`): drafts the pencil from
  real GLB and HDR byte progress, never stalls, and lifts on `#loader.done`.
- **Page chrome** (`chrome.ts`, `grain.ts`): a title-block nav ("SHEET 03/09
  — EXPLODED"), CSS grain, a warm vignette and a spec marquee.

### 4.4 Zero-GPU path

`FrameFallback.tsx` takes over for `?static=1`, no WebGL, ≤2 cores or low
memory, and save-data. It shows pre-rendered JPEGs (`public/frames/desktop`
80, `mobile` 60) driven by scroll, and a CSS "static prism" ring for the
lineup.

Regenerate the frames LAST with `scripts/frames/render-frames.cjs`. It forces
8 cores for the desktop tier and scrolls through Lenis.

---

## 5. Scroll choreography (`src/data/scroll.ts`; LOAD-BEARING)

**Global envelopes** (smoothstep products on page progress `p`; tuned at
desktop 1440×900):

| Envelope | Value |
|---|---|
| `explodeF` | `sstep(0.15,0.24)·(1−sstep(0.34,0.41))` |
| `xrayF` | `sstep(0.32,0.36)·(1−sstep(0.48,0.53))` |
| `mechF` | `sstep(0.40,0.44)·(1−sstep(0.46,0.50))` |
| `detailF` | `sstep(0.05,0.08)·(1−sstep(0.13,0.16))` |
| `reOffF` | `sstep(0.51,0.54)·(1−sstep(0.59,0.64))` |

**Camera keys:** Reveal 0, Detail 0.08, Exploded 0.20, X-Ray 0.335,
Mechanism 0.40, Reassembly 0.52, Object 0.63, Lineup 0.65.

**Drawing thresholds** (`drawing/state.ts`):
- the x-ray scan `SCAN` runs entry 0.285→0.33, ink retract 0.352→0.386 and
  restore 0.482→0.522;
- mechanism steps run from `MECH_P0` 0.412 in 0.012 increments to
  `MECH_END` 0.48;
- `REASSEMBLY_ON` is 0.532–0.586;
- look's `REASSEMBLED_AT` is 0.545.

**Rule:** a 3D beat must play while its copy is on screen. The mechanism
macro runs while the Mechanism copy is pinned, and Reassembly lands under
"Snaps back. Exactly." If a layout change moves sections, re-measure the
section positions in a real browser and shift a whole block's constants
together (camera key, envelope, drawing thresholds, light). Never move just
one of them.

**The lineup mapping is section-local.** It uses `u` = viewport heights
since `#lineup` pinned, so it survives layout changes. Constants:
- `LINEUP_VH` 5.45. The lineup is the last section; it absorbed the old Buy
  section and footer so the total page length (and every page-progress key
  above) stayed the same. Change the page length and every envelope moves.
- `RING_MOVES` and `RING_SNAPS` (detents; the move into Limited is about
  1.3× longer, the crescendo; a last move carries Limited round to Core)
- `RING_IN` (the hero handoff) and `RING_RISE`
- `FREE_SPIN_U` 3.72: from here to the end of the page the ring is free. The
  `#order` marker (the ninth sheet, and the nav/hero CTA target) sits here.

**Free spin** (`lineupNav.ts`): `spin.target` is an unbounded whole-detent
offset added to the scroll mapping.
- Wheel past the bottom steps one variant per ~90 px (one notch), at most one
  every 160 ms.
- A swipe steps one variant per ~70 px of upward finger travel, counted from
  touchstart, so it doesn't depend on touchmove event rate.
- Drag, dial and ring clicks set the offset directly; the dial takes the
  shortest way round.
- Scrolling up is never intercepted. Outside the free stretch the offset
  resolves to a whole turn, so the scroll mapping shows the same variant.
- `--ring` is written raw (unbounded); CSS wraps it with `mod()`, so a wrap
  never animates backwards.

The 3D ring, the DOM overlay, the static CSS ring and the dial all read the
same numbers.

**Reversibility:** every animation value derives from scroll weights, never
accumulated state. The one exception is the monotonic turntable spin.

---

## 6. X-ray implementation (exact recipe)

1. Shell parts are flagged `kind: 'shell'`. Each unique shell material is
   cloned once at load.
2. **Entry sweep:** a screen-space hairline moves top to bottom. A world clip
   plane through the camera and that screen line splits the scene:
   - **above** it: shells render as a hatched, rim-lit ghost (a custom
     shader with `uInkY0/1`, `uPitch`, `uLineW`), and a DOM ink sheet
     (`#dr-ink`, `clip-path: inset(...)`) turns the page black. The x-ray
     card swaps to a negative copy clipped to the sheet;
   - **below** it: the solid object on paper.
3. While fully in x-ray, the shell materials are hidden and the ghosts carry
   the silhouette. Internals get an emissive lift proportional to the x-ray
   weight.
4. **Exit:** the ink retracts upward before the Mechanism copy, and a final
   restore sweep brings back the solid shell.
5. **Reduced motion:** no sweep. Shells cross-fade (opacity floor, with
   `depthWrite` flipped only on state change).
6. Never use `transmission`: it allocates a render target and kills scroll
   performance.

---

## 7. QA checklist (run these; don't eyeball)

- `npx tsc --noEmit -p .` is clean and `npm run build` succeeds, with three
  in its own chunk.
- `python3 scripts/asset-processing/validate_glb.py` exits 0.
- **Playwright with real Chromium:**
  - Launch with SwiftShader: `--use-angle=swiftshader
    --enable-unsafe-swiftshader`.
  - **Override `navigator.hardwareConcurrency` to 8 for desktop shots.**
    Sandboxes often have 4 cores, which silently selects the mobile tier.
  - Jump scroll through `__lenis.scrollTo(y,{immediate:true})`.
  - High tier under SwiftShader renders slowly, and `dt` is clamped to
    0.05 s, so wait 6–10 s per stop or frames show the previous pose.
  - Sizes: desktop 1440×900, mobile 390×844, plus one awkward size.
  - Screenshot every chapter in forward and **reverse** order, with
    `reducedMotion: 'reduce'`, and with `?static=1`.
  - Pass criteria: zero console errors, zero failed requests, no horizontal
    overflow.
- **Production under the subpath:** `npx vite build --base /Meridian/ &&
  npx vite preview --base /Meridian/`. Expect no 404s and the 3D pencil, not
  the SVG fallback.
- The ring passes Core → Pro → Studio → Limited → Core on scroll. At the
  bottom, single wheel notches and swipes keep spinning it, the first
  wheel-up leaves at once, the dial spins without scrolling, and the Order
  button confirms the variant in front.

## 8. Known traps (each burned us once)

- Duplicate Three instances from CDN or mixed imports: use a single npm
  `three`.
- Root-absolute public URLs break under the GitHub Pages subpath: use
  `asset()`.
- **A fixed SVG overlay squashed into another compositor layer** (Chromium,
  small screens, under the lineup stage) stops repainting moved or hidden
  children. The result is ghost scan lines. `#drawing` has
  `will-change: transform; transform: translateZ(0)`.
- MSAA must be set when the composer target is constructed.
- A `page.check` on an already-checked radio fires no events, which makes
  QA pass falsely.
- React StrictMode double-mounts effects, which puts two WebGL contexts on
  one canvas. Keep init and dispose airtight.
- `modifier_apply` context pitfalls in headless Blender. Array `fit_type`
  must be `FIXED_COUNT`.
- The Bevel modifier's UVs on bevel facets vary at float-noise level between
  runs. Everything else is reproducible.
- A stale-closure colour snap: always chase targets, never set them.
