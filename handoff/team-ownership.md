# Meridian upgrade — who owns what (6 parallel Opus agents, each in its own git worktree)

The lead merges all branches at the end. Stay in your lane; if you must touch a file outside it,
keep the change minimal and list it in your final report.

| Area | Owner | Files |
|---|---|---|
| Pencil model / GLB / textures | MODEL agent | scripts/asset-processing/**, public/models/**, public/variants/*.png, src/three/assembly.ts (materials, loader), numbers in src/three/finishes.ts |
| Lineup ring + buy pose | RING agent | src/three/ring.ts, lineup / buy-pose / tint-chase code in experience.ts, lineup+buy KEYS in src/data/scroll.ts, Lineup.tsx, lineup.css, Buy.tsx + buy.css (variant sync), lineup part of FrameFallback.tsx, `// ---- lineup` block of registerModules.ts |
| DOM effects layer | FX agent | src/fx/** (bus.ts/pointer.ts are shared: extend, don't break), src/motion/**, tokens/base/sections/nav/responsive/stage css (incl. replacing .scrim), Chrome.tsx (preloader, nav, scene label), Hero/Detail/Exploded/Mechanism/Reassembly/Philosophy/Footer markup, index.html, Lenis + the two scroll-smoothing constants in experience.ts, loader progress wiring |
| 3D look | LOOK agent | src/three/stage.ts, src/three/look/** (pointer rig, env light sweep, post FX, contact shadows, tilt-shift), `// ---- look` block of registerModules.ts |
| Technical drawing + X-ray + mechanism | DRAWING agent | src/three/drawing/**, src/overlay/**, x-ray portion of experience.ts, Xray.tsx + its CSS, mechanism-part animation code in experience.ts, `// ---- drawing` block of registerModules.ts |

Shared contracts (already on the base branch):
- src/three/modules.ts — SceneModule API (preUpdate/update/wantsFrame/onResize/onMotionChange). Prefer writing a module over editing experience.ts.
- src/fx/bus.ts — typed events: `cursor` {mode,label}, `variant:active`, `variant:select`, `pencil:click`. Add new event types if you need them (keep existing ones).
- src/fx/pointer.ts — shared pointer state (`pointer.nx/ny/x/y/vx/vy/down/active/coarse`).
- src/three/finishes.ts — per-variant barrel finish.
- Renderer uses NeutralToneMapping @ exposure 1.0 (stage.ts).
- `window.__exp` is the PencilExperience (debug); FX agent will expose `window.__lenis` if Lenis is added (autoRaf).
- Fonts are self-hosted via @fontsource (src/main.tsx).

Dev servers (strict ports): MODEL 8101, FX 8102, RING 8103, LOOK 8104, DRAWING 8105. Never use 8100.
Screenshot helper: `STOPS=0,0.1,... node /tmp/claude-0/-home-user-Meridian/a83ae02c-d76c-53ef-b61d-c446ecd692e7/scratchpad/shoot.cjs http://localhost:<port>/ <outdir> [w] [h]`
(Playwright + SwiftShader WebGL; STOPS = fractions of total page scroll). Copy/adapt freely into your own scratch folder.
Baseline screenshots of the old site: /tmp/claude-0/-home-user-Meridian/a83ae02c-d76c-53ef-b61d-c446ecd692e7/scratchpad/baseline/
Research brief: /tmp/claude-0/-home-user-Meridian/a83ae02c-d76c-53ef-b61d-c446ecd692e7/scratchpad/research/awwwards-brief.md

Approx page-progress map (p = scrollY / max): 0 hero · 0.05–0.16 detail macro · 0.15–0.45 exploded · 0.32–0.57 x-ray · 0.44–0.56 mechanism macro · 0.55–0.68 reassembly · ~0.63 philosophy/object · 0.62–0.96 lineup · 0.96–1 buy.

## UPDATE — public asset URLs (base branch commit 99a76b7)
The site deploys to GitHub Pages under /Meridian/, so root-absolute URLs ("/models/x.glb") 404 in production.
Base branch now has `src/assetUrl.ts`: `export const asset = (path) => import.meta.env.BASE_URL + path.replace(/^\/+/, '')`.
Every URL into /public (models, textures, HDRs, draco/meshopt decoders, frames, variants, noise tiles, fonts you add to public) MUST be built with `asset('models/…')`. Never a leading slash.
If your worktree predates this, create the identical file (same contents) and use it — the lead will merge.
