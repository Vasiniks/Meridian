# HANDOFF — Meridian Awwwards upgrade (paused 2026-10-01)

> **Status 2026-10-01 (resumed):** all five workstreams are now integrated on
> `claude/sleepy-rubin-2wimfx` (PR https://github.com/Vasiniks/Meridian/pull/2,
> which supersedes #1). The Blender model is finished for both tiers, and
> the fallback frames were regenerated from the final scene.
> `handoff/recreate-meridian-pencil.md` describes the current architecture.
> The `handoff/wip/*.patch` files below are kept for history only; don't
> re-apply them. Remaining step: merge into `main` and deploy.

Work was **paused on request** mid-flight. Nothing is lost: every parallel workstream is saved as
a patch in `handoff/wip/` against this branch's base commit `99a76b7`.

- Branch: `claude/great-pascal-ps32c7`
- PR (draft): https://github.com/Vasiniks/Meridian/pull/1 (base `main`)
- **When finished, the owner wants it merged and deployed to GitHub Pages.** Pushing to `main` runs
  `.github/workflows/deploy.yml` (`npm ci && npm run build` → `peaceiris/actions-gh-pages` → `gh-pages`
  branch). The site is served under the `/Meridian/` project path.

---

## 1. The ask (owner's words, condensed)

The site is about 6/10 and should be Awwwards level.
1. **Model**: build a more detailed model in **Blender**, textured so it looks natural. Frosted metal looks good.
2. **Animations**: interactive elements such as a special cursor trace or effects, plus scroll animations that are subtle but amazing.
3. **Layout**: replace the static horizontal lineup scroll with a **ring of pens** that scroll spins to bring the next color forward.
4. "Unleash your creativity, fan out Opus agents."

## 2. Already landed on this branch (pushed)

| Commit | What |
|---|---|
| `918ee2e` | Fonts are self-hosted with `@fontsource` (Google Fonts never loaded in practice). Adds `src/three/finishes.ts`, the per-variant finish contract (color, roughness, metalness, envIntensity). |
| `5704435` | Adds **SceneModule hooks** (`src/three/modules.ts`). `PencilExperience.addModule/getModule` run `preUpdate` (undo transient offsets) then the built-in choreography, then `update` (apply) before render. Also adds `wantsFrame`, `onResize`, `onMotionChange`, and scroll velocity in `FrameCtx`. Adds shared `src/fx/pointer.ts`, a typed `src/fx/bus.ts` (`cursor`, `variant:active`, `variant:select`, `pencil:click`) and `.claude/worktrees/` in .gitignore. |
| `e041edc` | Switches from ACES to **NeutralToneMapping**, exposure 1.0 (ACES desaturated brass and ink-blue). |
| `5b6dcd9` | `src/three/registerModules.ts`: one block per area (look / drawing / lineup). |
| `99a76b7` | **Pages bug fix.** `src/assetUrl.ts` `asset()` prefixes `import.meta.env.BASE_URL`. The live bundle requested `/models/*.glb` and `/environments/*.hdr` from the domain root, which 404s under `/Meridian/`, so the **live site never loaded the 3D pencil** and showed the SVG fallback. Verified the fix by serving `vite preview --base /Meridian/`: no 404s, and the 3D renders. **Every public URL must use `asset('…')`.** |
| `1886160` | `scripts/frames/render-frames.cjs` regenerates the zero-GPU fallback frames (`public/frames/{desktop,mobile}`, 80 + 60 JPEGs, canvas only) from the live WebGL scene. Run it LAST, after everything is merged. |

## 3. Paused workstreams (each in `handoff/wip/<name>.patch` + `<name>.commits.txt`)

Every patch was made with `git diff --binary 99a76b7 <agent HEAD>`, and each one applies cleanly by itself
(`git apply --check` passes). Together they **will conflict in shared files** (see §4).

| Name | State at pause | Files |
|---|---|---|
| **fx**: DOM effects | **Most complete**: 7 real commits, clean tree. The last step was a CLS fix (0.025 → 0.0001). | Lenis smooth scroll (autoRaf, `window.__lenis`), 3D smoothing raised to λ9 in `experience.ts`. Motion system (`src/motion/*`, tokens). Instrument Serif italic for emphasis (`Em.tsx`). **Graphite cursor trail** with velocity-width strokes, plus nib, context ring and magnetic CTAs (`src/fx/graphite.ts`, `cursor.ts`). Attribute-driven reveals: line masks, body fades, mono type-on, odometers (`reveal.ts`, `odometer.ts`). **Preloader** that drafts the pencil from real load progress (`preloader.ts`, `loadProgress.ts`). CSS grain, warm vignette, title-block nav (`chrome.ts`, `grain.ts`). Spec marquee, Philosophy tracking-tighten, layout fixes. Touches `index.html`, `package.json`/lock (adds `lenis`, `@fontsource/instrument-serif`), most components, all CSS, `experience.ts`, `bus.ts`, `content.ts`. |
| **ring**: 3D lineup ring | Functionally built: 3 WIP commits + a snapshot. The last step was a reverse-scroll pop check across the hero↔Core swap and the "presenter latch". Budget measured at ~63 draw calls / 55k tris in the ring, 16 calls in Buy. | `src/three/ring.ts` (SceneModule), `Lineup.tsx`, `lineupNav.ts`, `lineup.css`, `Buy.tsx`/`buy.css` (variant sync via bus), lineup/buy KEYS in `scroll.ts`, lineup/buy code in `experience.ts`, FINISHES tuning, a static-mode lineup ("static prism") in `FrameFallback.tsx`, and reduced motion. |
| **look**: 3D look | Built, uncommitted at pause (snapshot commit). It was mid-verification (screenshotting at 1000×625; note that 720 px wide triggers the small-screen layout). | `src/three/look/*`: pointer rig (`rig.ts`), env-rotation light sweep + `streak()` (`light.ts`), warm contact shadows (`contactShadows.ts`), post FX with velocity CA and macro tilt-shift (`postfx.ts`), plus `stage.ts`, `bus.ts` and the look block of `registerModules.ts`. |
| **drawing**: technical drawing | Built, uncommitted at pause (snapshot). It was mid-verification. | `src/three/drawing/*`: 3D-anchored SVG overlay (`overlay.ts`, `profile.ts`), exploded-part picking + cursor labels (`picking.ts`), **X-ray scan** with clipping and page ink inversion (`xray.ts`, `src/overlay/xray.css`, `Xray.tsx`), mechanism springs + pencil click (`mechanism.ts`, `spring.ts`). Also `src/overlay/*`, the x-ray/parts block of `experience.ts`, `content.ts`, `bus.ts`, the drawing block of `registerModules.ts`. |
| **model**: Blender rebuild | **Least finished.** The Blender builder is written; only the **desktop** GLB was regenerated. It stopped while debugging a **shading "wedge" artifact** near the etched lettering: is it the normal-map tangent space (Cycles only) or the exported custom normals? Still to do: mobile GLB tier, `assembly.ts` `tuneLookdev()` keeping normal/roughness maps (it currently nulls them in `plate()`), `.blend` + manifest, re-rendering `public/variants/*.png`, and verification in the site. | `scripts/asset-processing/blender/{build_pencil,mh_geom,mh_parts,mh_materials,mh_textures,render_views}.py`, `public/models/desktop/mechanical-pencil.glb`. ⚠️ Check the new GLB still has the 42-part contract (§5) before shipping. |

Patch sizes: model ~3 MB (binary GLB); the others are 55–150 KB.

## 4. How to resume

```bash
npm ci
pip3 install "bpy==4.5.*" numpy pygltflib   # Blender as a Python module (blender.org is blocked)
git checkout claude/great-pascal-ps32c7

# Integrate in this order. Least overlap first; experience.ts is the hot spot.
git apply --3way handoff/wip/fx.patch       && git add -A && git commit -m "Integrate FX layer"
git apply --3way handoff/wip/look.patch     # conflicts: bus.ts, registerModules.ts
git apply --3way handoff/wip/drawing.patch  # conflicts: experience.ts (x-ray/parts), bus.ts, content.ts, registerModules.ts
git apply --3way handoff/wip/ring.patch     # conflicts: experience.ts (lineup/buy), registerModules.ts, FrameFallback.tsx
git apply --3way handoff/wip/model.patch    # only after finishing it (see §3)
```

Conflict guidance:
- **`registerModules.ts`**: keep all three blocks (look, drawing, lineup).
- **`bus.ts`**: union of the event types.
- **`experience.ts`**: each agent owned a different region:
  - fx: the two smoothing constants (λ9) and load-progress emits.
  - drawing: the x-ray + parts/mechanism block.
  - ring: the `readProgress` lineup block, lineupDolly/tilt/spin, tint chase and buy pose.
- **`content.ts`**: union.
- **Cross-wiring to check after merge:**
  - fx's cursor renders `bus` `cursor` events from ring and drawing.
  - fx's reveal attributes (`data-reveal=…`) are on Lineup/Buy/Xray markup.
  - Ring calls look's `streak()` for the Limited crescendo (guarded `exp.getModule`).
  - Contact shadows behave in the lineup (four pencils).
  - Ring scroll-to-detent uses `window.__lenis` when present.
  - Grep for root-absolute public URLs: none allowed, use `asset()`.

Then:
1. Run `npx tsc --noEmit -p .` and `npm run build`.
2. Screenshot QA at desktop 1440×900 and mobile 390×844, across all chapters, using `handoff/tools/shoot.cjs` (Playwright + SwiftShader; `STOPS=0,0.1,… node handoff/tools/shoot.cjs http://localhost:8100/ out 1440 900`; adjust the require path to Playwright). Include reverse scroll, reduced motion (`page.emulateMedia({reducedMotion:'reduce'})`) and `?static=1`.
3. Regenerate fallback frames: `npx vite --port 8100 &` then `node scripts/frames/render-frames.cjs`.
4. Check a production build under the subpath: `npx vite build && npx vite preview --base /Meridian/`. Expect no 404s and the 3D pencil, not the SVG fallback.
5. Push, update the PR body, then **merge PR #1 into `main`**. Confirm the "Deploy to GitHub Pages" workflow succeeds, then load https://vasiniks.github.io/Meridian/ and confirm the live bundle requests `./models/...`, not `/models/...`.

## 5. Contracts that must survive (load-bearing)

- **GLB:** root `Pencil` → `Exterior` / `Internal` → exactly **42 named part nodes**.
  - Each part keeps extras `{ex, kind, mech, jawAngle?}` and translation `[0, baseY, 0]` (the clip parts are special). See `define_assembly()` in `scripts/asset-processing/build_pencil_glb.py`.
  - Springs are centred on their node origin (the runtime scales Y). The `barrelHex` anodized material is the variant tint target. Shell parts fade in x-ray.
  - Material role names: anodized, dlc, steel, polished, brass, spring, recess, polymer, mechdark, reservoir, eraser, lead (+ new roles must be handled in `tuneLookdev`).
- Asset budgets: desktop GLB ≤ ~6 MB, mobile ≤ ~2.5 MB. Desktop ≲150k tris, mobile ≲60k.
- **Ownership map** for the parallel lanes: `handoff/team-ownership.md`.
- **Research brief** (Awwwards techniques, timings, easing tokens, the 22-move plan, avoid list): `handoff/awwwards-brief.md`. The core idea is **"the drawing becomes the object"**: graphite and technical-drawing language throughout, one accent `#A63D22`, restraint.

## 6. Environment facts (cloud sandbox)

- Network egress is locked down. awwwards.com, codrops, polyhaven and blender.org are blocked. GitHub is limited to this repo; npm and PyPI work; WebSearch works. Research therefore came from search plus library source read from npm tarballs.
- Blender: `pip3 install "bpy==4.5.*"` for python3.11. Cycles CPU rendering works; Eevee doesn't (no GPU). bpy pins numpy 1.26.
- Headless Chromium WebGL: launch with `--use-angle=swiftshader --enable-unsafe-swiftshader`. Playwright is global at `/opt/node22/lib/node_modules/playwright`.
- The old `handoff/recreate-meridian-pencil.md` still describes the pre-upgrade architecture. Update it once this work lands.
