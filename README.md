# Meridian Hex

A scroll-driven 3D product page for the Meridian Hex, a hexagonal-barrel
mechanical pencil, drawn in technical-drawing language.

**Live:** https://vasiniks.github.io/Meridian/

As you scroll, the 42-part pencil:
1. reveals itself
2. shows its grip in close-up
3. comes apart
4. gets x-rayed by a scan line that turns the page to ink
5. runs its click mechanism
6. snaps back together
7. hands off to a spinning ring of four variants and a buy form

## Highlights

- **Blender-built model.** 42 named parts with real bevels, a machined
  diamond knurl, etched lettering, coil springs, toothed collet jaws and
  frosted micro-grain textures. A desktop and a mobile tier are exported as
  glTF.
- **Scroll choreography.** Camera keyframes and smoothstep envelopes
  (explode, x-ray, mechanism) are timed to the copy they sit under.
- **Technical-drawing overlay.** SVG callouts are anchored to real 3D parts.
  You can pick parts in the exploded view, and the x-ray works as a scan.
- **3D lineup ring.** Scroll spins the four variants (Core, Pro, Studio,
  Limited) to the front, and the chosen one flies into the buy form.
- **Effects.** Lenis smooth scroll, a graphite cursor trail, line-mask
  reveals, a preloader that drafts the pencil from real load progress, a
  pointer-driven light sweep, contact shadows, and subtle velocity post
  effects.
- **Degrades well.** Mobile gets a lighter model and fewer effects. Reduced
  motion and the "Pause motion" toggle switch to static poses. Without
  WebGL, on weak hardware, with save-data, or with `?static=1`, the page
  shows pre-rendered frames instead of the 3D scene.

## Stack

Vite 7, React 19, TypeScript and three.js 0.184, with hand-written CSS (no
UI kit). The asset pipeline uses Blender's Python module (`bpy`), numpy and
pygltflib.

## Run it locally

```bash
npm ci
npm run dev        # http://localhost:8100
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/
```

Useful query flags:

| Flag | Effect |
|---|---|
| `?static=1` | Force the zero-GPU pre-rendered frame path. |
| `?nodraw` | Disable the technical-drawing overlay. |

## Regenerate assets

The pencil model is generated, not hand-edited. Its source of truth is
`scripts/asset-processing/blender/build_pencil.py`.

```bash
pip3 install "bpy==4.5.*" numpy pygltflib   # needs Python 3.11
npm run build:assets   # rebuild both GLB tiers + .blend + manifest, then validate
```

- Build output:
  - `public/models/desktop/mechanical-pencil.glb` (~90k tris, ~3.9 MB)
  - `public/models/mobile/mechanical-pencil-mobile.glb` (~41k tris, ~1.8 MB)
  - `public/models/source/mechanical-pencil.blend` and `manifest.json`
- `scripts/asset-processing/validate_glb.py` checks the 42-part contract
  (hierarchy, extras, materials), mesh hygiene and size budgets. It exits
  non-zero on failure.
- `scripts/asset-processing/blender/render_views.py` renders the variant
  cards in `public/variants/` with Cycles.

After any visual change, regenerate the fallback frames last:

```bash
npm run dev &               # serves on :8100
npm run build:frames        # needs Playwright + Chromium
```

## Project layout

```
src/
  components/      page sections (Hero, Detail, Exploded, Xray, Mechanism, Lineup, Buy, ...)
  data/            copy (content.ts) and scroll envelopes + camera keys (scroll.ts)
  three/           renderer, model loader, camera rig, frame loop
    look/          pointer rig, light sweep, contact shadows, post FX
    drawing/       SVG callouts, part picking, x-ray scan, mechanism
    ring.ts        3D variant ring + buy pose
    finishes.ts    per-variant barrel finishes
  fx/              cursor trail, reveals, preloader, Lenis, event bus
  overlay/         drawing + x-ray styles
  styles/          tokens, layout and section CSS
scripts/
  asset-processing/  Blender builder, GLB validator, reference registry
  frames/            fallback-frame renderer
public/              models, HDR, variant cards, fallback frames
handoff/             rebuild docs and the design/motion brief
```

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`:
1. `npm ci && npm run build`
2. `dist/` is published to the `gh-pages` branch.
3. GitHub Pages serves `gh-pages` at `/Meridian/`. In the repository
   settings, Pages must be set to "Deploy from a branch" with `gh-pages` /
   root.

The Vite base is relative (`./`), and every runtime URL into `public/` goes
through `asset()` (`src/assetUrl.ts`), so the build works under the project
subpath. Never hard-code a leading `/` for public assets.

## Docs

- `handoff/recreate-meridian-pencil.md`: the full architecture and an exact
  rebuild guide, including the asset contract, choreography numbers, x-ray
  recipe, QA checklist and known traps.
- `handoff/recreate-any-object.md`: the same method, generalized to other
  objects.
- `handoff/awwwards-brief.md`: design and motion research behind the
  upgrade.
