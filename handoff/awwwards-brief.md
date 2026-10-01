# Meridian Hex: Awwwards-level upgrade brief

Audience: engineers working on `/home/user/Meridian` (Vite, React 19, three 0.184, WebGLRenderer + EffectComposer, alpha canvas over CSS paper `#F5F3EE`).
Sources: web search snippets (Awwwards, Codrops, case studies, 2024–2026). The award sites themselves were blocked by network egress, so I could not fetch them. Library internals were read from npm tarballs: `lenis@1.3.26`, `perfect-freehand@1.2.3`, `postprocessing@6.39.5`. Repo facts were read from source.

**Bottom line.** Recent winners (Oryzo/Lusion SOTM Apr 2026, Igloo Inc SOTY 2024, Opal Tadpole e-com SOTY 2024, Cartier W&W 2026/Immersive Garden) each pick **one strong idea** and carry it out with physical weight: inertia, dwell, real light. Meridian's idea should be **"the drawing becomes the object"**. Graphite, technical-drawing linework and tolerances run through every interaction: the cursor draws, the preloader drafts the pencil, dimensions draw themselves, and the X-ray is a scan line. Everything else stays quiet.

**Repo facts that shape the plan**
- `index.html`/CSS never load the fonts. `Inter Tight` / `IBM Plex Mono` are named in `tokens.css`, but there is no `@font-face` or Google Fonts link, so every visitor sees system fallbacks. **This is the cheapest big fix.**
- `#gl` uses `alpha:true` with clear alpha 0 and ACES tone mapping at exposure 1.12. Its passes are RenderPass + OutputPass, with MSAA ×4 on high quality. The ground is a `ShadowMaterial` at 0.16 opacity.
- Scroll uses native `window.scrollY` and maps to `p` in [0,1] (`data/scroll.ts` keys). The camera is damped with `1-exp(-5dt)`.
- Lineup is a DOM horizontal track of PNG renders plus one tinted 3D pencil. X-ray is a shell opacity fade (`1 - xr*0.85`).
- `.panel{pointer-events:none}` and `#gl` has pointer-events off. Any 3D interaction therefore needs a DOM hit layer.

---

## 1. Reference sites (what to take from each)

| # | Site | URL | Technique worth taking |
|---|------|-----|-------------------|
| 1 | **Oryzo AI** (Lusion, SOTM Apr 2026 + Dev) | https://oryzo.ai | A single hero object with real inertia. The camera travels through true Z depth instead of sliding 2D layers. **The 3D object shrinks into a functional UI element (3D→2D handoff)** as one continuous move. Grain and soft light leaks keep it from reading as a tech demo. |
| 2 | **Igloo Inc** (Abeto × Bureaux, SOTY 2024) | https://www.igloo.inc | Refractive ice blocks and particles baked from VDB volumes that re-form per link. Only 3 sections, each joined by a choreographed transition: few sections with high transition craft. |
| 3 | **Opal Tadpole** (E-commerce SOTY 2024; Claudio Guglieri) | https://opalcamera.com (Tadpole page) | "Show, don't tell": blueprint and SVG line drawings animate to explain the product, plus the "hand flip" sequence. **This is the closest analogue to Meridian's technical-drawing language.** |
| 4 | **Cartier Watches & Wonders 2026** (Immersive Garden, SOTD) | https://www.awwwards.com/sites/cartier-watches-wonders-2026 | Six "alcoves", one self-contained 3D scene per timepiece, with hidden gestures that reward curiosity. This is the model for giving each lineup variant its own moment. |
| 5 | **Aether 1** (OFF+BRAND, Codrops case study) | https://tympanus.net/codrops/?p=98287 | Faux depth of field, *selective* bloom, a fluid cursor and GPU-friendly materials hold 60 fps on mobile. This is the reference for cheap-DOF thinking. |
| 6 | **Lando Norris** (OFF+BRAND, SOTY 2025) | https://landonorris.com | A cursor-driven reveal mask on the hero, using blob shapes from the helmet's graphic language. Transitions are fast and expressive. **The pointer effect speaks the brand's visual language**, which is the logic behind a graphite trail for Meridian. |
| 7 | **Lusion v3** (SOTY 2023) | https://lusion.co | Objects react physically to the pointer, and scroll is choreographed into 3D-to-page transitions. |
| 8 | **AP Code 11.59 Universelle** (Cannes Lions Digital Craft) | https://lovethework.com/work-awards/campaigns/the-code-1159-by-audemars-piguet-universelle-website-landing-page-1544737 | A tunnel through the mechanism with natural dynamic lighting and a tightly optimized 3D pipeline. **This is the precedent for the Mechanism and X-ray sections.** |
| 9 | **Codrops "On-Scroll 3D Carousel"** (May 2025) | https://tympanus.net/codrops/2025/05/07/on-scroll-3d-carousel/ | A ring that rotates with scroll, built with the rewritten GSAP SplitText. It is the base pattern for the Lineup ring. |
| 10 | **Apple AirPods Pro / iPhone pages** (AirPods Pro: Dev SOTM Jan 2020) | https://www.apple.com/airpods-pro/ | The pacing benchmark: pinned copy over scrubbed product, one message per viewport, light sweeps across materials, huge whitespace. |
| 11 | **Oura Ring product pages** (Instrument) | https://ouraring.com | A tiny precision object shown as macro material studies, with calm pacing and no gimmicks. |
| 12 | **Teenage Engineering** | https://teenage.engineering | Monospace only, ALL-CAPS labels, tabular spec alignment, and the product as the protagonist against a clean ground. |
| 13 | **Nothing** | https://nothing.tech | Near-monochrome, uppercase mono labels and dot-matrix accents. It shows how far a mono label system can carry a brand. |
| 14 | **Locomotive** (Scroll v5 is built on Lenis) | https://locomotive.ca | Baseline smooth scroll, masked line reveals and a restrained editorial grid. |
| 15 | **darkroom.engineering** (Lenis authors) | https://darkroom.engineering | Restraint, and smooth scroll as infrastructure rather than effect. |
| 16 | **Hubtown** (Unseen Studio, SOTD Jun 2026) | via awwwards.com/sites | One monolith object with cinematic framing on a reflective ground: object staging. |
| 17 | **Ciao Energy launch** (SOTD Jul 2026) | https://www.awwwards.com/sites/ciao-energy-launch-website | One interactive 3D object, sound design and a minimal identity. It is proof that a single-product launch can win. |

Patterns from 2025–26 winners (utsubo "8 Best Three.js Websites of 2026" and Awwwards jury commentary):
- One hard idea executed cleanly beats stacked effects.
- Scroll is the storytelling engine: sequence 3D scenes, don't just move a 2D page.
- High mobile Lighthouse scores and `prefers-reduced-motion` support are now part of how juries judge craft.

**Premium vs. gimmicky.**
- Premium means: dwell time on each beat; motion with mass (damped, never linear); one accent colour; durations of 0.8–1.2 s for reveals and ≤0.25 s for hovers; effects tied to the narrative (the scan line *is* the X-ray).
- Gimmicky means: effects with no story reason (RGB fluid cursors, glitch, bloom on paper), char-by-char reveals on body copy, elastic bounces on serious UI, instructions like "Vertical scroll drives horizontal travel", and fake 0→100 preloaders that stall.

---

## 2. Technique cookbook

### 2.0 Shared motion tokens and helpers (put in `src/motion/` and `tokens.css`)
```css
:root{
  --ease-out: cubic-bezier(0.16,1,0.3,1);        /* expo.out: reveals, rolls (already in repo) */
  --ease-standard: cubic-bezier(0.22,1,0.36,1);  /* quint.out: UI state (already in repo) */
  --ease-inout: cubic-bezier(0.76,0,0.24,1);     /* quart.inOut: wipes, curtains, preloader exit */
  --ease-draw: cubic-bezier(0.65,0,0.35,1);      /* cubic.inOut: hairline/SVG draw-ons */
  --ease-back: cubic-bezier(0.34,1.56,0.64,1);   /* magnetic release ONLY */
  --t-hover:220ms; --t-ui:420ms; --t-reveal:1100ms; --t-wipe:1000ms; --t-draw:900ms;
}
```
```ts
// Frame-rate-independent smoothing (Lenis uses the same form internally: lerp(x,y,1-exp(-λ·dt)))
export const damp = (a:number,b:number,λ:number,dt:number)=> a+(b-a)*(1-Math.exp(-λ*dt))
// λ guide: 4 = heavy object (~250ms to 63%), 8 = UI follow, 18 = cursor ring, 35 = near-instant
// Semi-implicit spring (mass 1). Critical damping c = 2√k. Use ζ≈0.75–0.9 for "precise" overshoot.
export function spring(s:{x:number,v:number}, target:number, k:number, c:number, dt:number){
  const a = -k*(s.x-target) - c*s.v; s.v += a*dt; s.x += s.v*dt; return s.x }
// Presets: cursor ring k=320,c=30 · magnetic k=180,c=18 · ring snap k=90,c=17 · part click k=300,c=18
export const smoothstep=(a:number,b:number,x:number)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t)}
```
Rules:
- Clamp `dt` to ≤ 1/30 s so tab-switch spikes don't explode springs.
- Every effect reads one `motionOK` flag. Wire it to the existing Chrome toggle and to `prefers-reduced-motion`.

### 2.1 Graphite cursor trail (signature move)
**What it looks like.** A 0.5 mm-lead line, 0.7–2.4 CSS px wide, warm graphite `#2E2D2B`, with visible paper tooth. Fast flicks draw thin and slow drags draw thicker, which is physically right because pressure drops with speed. The tail thins and retracts within about 0.9 s. When the pointer stops, the line finishes its retraction and nothing remains. Over buttons and inputs the "pencil lifts" and draws nothing.

**Implementation: Canvas 2D, not WebGL.** It needs a single filled polygon per frame, and keeping it off the 3D pipeline means no composer cost.
- **Layer.** A `position:fixed; inset:0; pointer-events:none` canvas with `mix-blend-mode:multiply`, between `#gl` and the content. Multiply makes it darken paper like real graphite and nearly vanish over the dark pencil, which is free occlusion.
- **Input.** Listen to `pointermove` with `pointerType==='mouse'`. Use `e.getCoalescedEvents?.()` for sub-frame points (it is in the TS DOM lib). Apply streamline: `pt = lerp(prev, raw, 0.35)`.
- **Width from velocity.** Port perfect-freehand's `simulatePressure`: `sp=min(1,dist/size); rp=1-sp; pressure += (rp-pressure)*sp*0.275`. The radius is `size*(0.5 - thinning*(0.5-pressure))`; use `size≈2.6`, `thinning≈0.6`. Average the first ~10 points so the stroke doesn't start fat.
- **Fade by geometry, not alpha.** The per-point radius `r_i = w_i * (1-age_i)^1.3` with `life=900ms`. Build the outline polygon (left/right offsets along normals with a round head cap), then `ctx.fill()` once with a constant `globalAlpha≈0.6`. Stroking segments one by one with varying alpha causes beading at the joints, where alpha accumulates. Avoid it.
- **Graphite texture.** Generate a 128² tile once with two octaves of value noise, alpha 0.55–1, and faint 15° fibre streaks. Use it via `createPattern(tile,'repeat')` as `fillStyle`. The pattern is anchored to the canvas, not the stroke, so the grain stays still while the line moves. That is exactly how paper tooth behaves.
- **Budget.** Keep at most 160 points, with DPR `min(devicePixelRatio,2)`. Cost is under 0.3 ms per frame. Stop rAF when the point list is empty (the site loop already sleeps).
- **Off switches.** Turn the trail off under `(pointer:coarse)`, `(prefers-reduced-motion:reduce)`, motion toggle off, `document.hidden`, and when the pointer is over `a,button,input,select,textarea,[data-cursor],[data-no-trail]`. Fade the last stroke out in that case; never cut it.
- **Pitfalls.**
  - `desynchronized:true` can tear on some GPUs; leave it off.
  - Resize: re-set canvas size and the transform, and re-create the pattern after `ctx.reset()`.
  - Never draw over long-form text at full strength. Halve alpha inside `.lede, p` if it competes.
```ts
type Pt={x:number,y:number,t:number,w:number}
export class GraphiteTrail{
  pts:Pt[]=[]; p=0.25; last?:Pt; on=true; ctx:CanvasRenderingContext2D; dpr=Math.min(devicePixelRatio,2)
  constructor(public cv:HTMLCanvasElement, public o={life:900,size:2.6,thin:0.6,alpha:0.6,max:160}){
    this.ctx=cv.getContext('2d')!; this.ctx.fillStyle=this.ctx.createPattern(graphiteTile(),'repeat')!
    addEventListener('pointermove',e=>{ if(!this.on||e.pointerType!=='mouse')return
      if((e.target as Element).closest?.('a,button,input,select,textarea,[data-cursor],[data-no-trail]')){this.last=undefined;return}
      for(const ev of (e.getCoalescedEvents?.()??[e])) this.add(ev.clientX,ev.clientY,ev.timeStamp)},{passive:true})
  }
  add(x:number,y:number,t:number){ const l=this.last
    if(l){ x=l.x+(x-l.x)*0.35; y=l.y+(y-l.y)*0.35 }                 // streamline
    const d=l?Math.hypot(x-l.x,y-l.y):0, sp=Math.min(1,d/this.o.size)
    this.p=Math.min(1,this.p+((1-sp)-this.p)*sp*0.275)                 // perfect-freehand pressure sim
    const w=this.o.size*(0.5-this.o.thin*(0.5-this.p))
    if(!l||d>0.6){ const pt={x,y,t,w}; this.pts.push(pt); this.last=pt; if(this.pts.length>this.o.max)this.pts.shift() }
  }
  frame(now:number){ const {ctx,o}=this; ctx.clearRect(0,0,this.cv.width,this.cv.height)
    this.pts=this.pts.filter(p=>now-p.t<o.life); const n=this.pts.length; if(n<2)return false
    const L:number[][]=[],R:number[][]=[]
    for(let i=0;i<n;i++){ const a=this.pts[Math.max(0,i-1)],b=this.pts[Math.min(n-1,i+1)],p=this.pts[i]
      let nx=-(b.y-a.y),ny=b.x-a.x; const m=Math.hypot(nx,ny)||1; nx/=m; ny/=m
      const r=p.w*Math.pow(1-(now-p.t)/o.life,1.3)
      L.push([p.x+nx*r,p.y+ny*r]); R.push([p.x-nx*r,p.y-ny*r]) }
    ctx.globalAlpha=o.alpha; ctx.beginPath(); ctx.moveTo(L[0][0],L[0][1])
    for(const q of L)ctx.lineTo(q[0],q[1]); for(const q of R.reverse())ctx.lineTo(q[0],q[1]); ctx.fill(); return true
  }
}
```
Set `ctx.setTransform(dpr,0,0,dpr,0,0)` on resize. Add a round head cap with an `arc` at the last point.

**Optional P2 easter egg: test pad.** In Buy, a hairline-boxed "test sheet" (`data-no-trail` removed, `data-pad`). Pointer-down there draws *persistent* strokes in the selected lead grade (HB/2B maps to alpha and size), with a "Clear sheet" mono button. Stationery shops have these, which makes it on-brand and memorable.

### 2.2 Cursor states and magnetism
**What it looks like.**
- **Default:** the OS cursor is hidden only on `(pointer:fine)`. A 6 px graphite "nib" dot sits exactly at the pointer, with zero lag; lag on the primary cursor reads as sluggish. The trail comes out of it.
- **Context states:** set by `data-cursor` on elements, with the nib morphing over 420 ms `--ease-standard`.
  - `link`: a 40 px hairline ring in ink with the nib centred.
  - `drag`: a 72×28 pill reading mono `DRAG ⟷`, ink fill, paper text.
  - `view`: a 64 px disc reading `VIEW`.
  - `part`: a pill reading `PART 04 · CLUTCH JAW` in Exploded.
  - `text`: a 1.5×22 px caret bar.
  - `hidden`: hides the custom cursor over form inputs, where the native cursor comes back.
- **Following:** the ring and pill follow with a spring (`k=320, c=30`). The nib does not.
- **Magnetic:** `.btn-solid`, `.btn-line`, nav items and ring arrows.
  - Within the element rect plus 24 px padding, translate the element by `(pointer-centre)*s`. Use `s=0.3` for small buttons and `0.15` for wide CTAs.
  - The inner label moves `1.6×s` for depth.
  - The cursor ring snaps to the element's rect: width, height and radius transition to the button box (the "sticky cursor").
  - On leave, spring back with `k=180,c=18` (or the CSS `--ease-back` at 600 ms).
- **Implementation.** One fixed `<div id="cursor">` with `transform: translate3d()`, updated in the site's single rAF.
  - Read state through `pointerover` delegation: `closest('[data-cursor]')`. Don't use one listener per element.
  - Use `will-change: transform` on the cursor only.
  - Labels are mono, 10 px, `letter-spacing:.08em`, uppercase.
- **Accessibility.**
  - Never hide `:focus-visible` (2 px `--accent` outline, offset 3 px).
  - Keep the native cursor for text inputs.
  - Everything is off on touch.
  - With `prefers-reduced-motion`: keep the nib, drop the springs (snap), drop magnetism.
- **Pitfalls.**
  - Magnetism plus `transform` on the button breaks hit-testing at the edges; transform an inner wrapper instead.
  - Don't magnetize anything larger than about 240 px.
  - Recompute rects on scroll (cache them during Lenis `scroll` events).

### 2.3 Smooth scroll (Lenis 1.3.x)
- **Config:** `new Lenis({ lerp: 0.09, wheelMultiplier: 0.9, smoothWheel: true, syncTouch: false, anchors: true, autoRaf: false, stopInertiaOnNavigate: true })`. Defaults are `lerp 0.1` and `duration 1.2` with the expo easing `t=>Math.min(1,1.001-2**(-10t))`; duration and easing are ignored when lerp is set. Keep touch native (`syncTouch:false`): iOS inertia is better than any emulation, and syncTouch is "unstable on iOS < 16".
- **Integration:** call `lenis.raf(t)` **inside `PencilExperience.loop` before `readProgress()`**, then read `lenis.progress` (0–1), `lenis.velocity` (px per frame, animated), `lenis.direction` and `lenis.isScrolling`. Keep the loop awake while `isScrolling` is truthy.
- **Avoid double smoothing.** The camera already damps with `λ=5`. With Lenis in front, raise the camera to `λ≈9`, or the camera will float about 300 ms behind the page and copy will desync from the 3D.
- **Reduced motion:** Lenis 1.3 forces `lerp=1` and makes `scrollTo` instant automatically. Check `lenis.prefersReducedMotion`.
- **Snapping:** `lenis/snap` (`type:'proximity', distanceThreshold:'30%', debounce:300, duration:0.9`). Use it **only** for the Lineup dwell points. Mandatory snap anywhere else feels like scroll-jacking.
- **Pitfalls.**
  - Add `data-lenis-prevent` to any scrollable overlays.
  - Pinned sections should use CSS `position:sticky` (as now), not JS pinning.
  - Never change the document height after init without calling `lenis.resize()`. `experience.ts` sets the `#lineup` height in JS, so call it after.

### 2.4 Text reveals
**What it looks like.** Headlines rise line by line out of hairline-thin masks. Eyebrows and mono labels type on quickly. Body copy only fades and lifts 12 px. **Never use char splits on body copy.**

**Parameters (as used across SOTD sites):**

| Element | Motion | Duration | Stagger | Ease | Trigger |
|---|---|---|---|---|---|
| Line mask (H1/H2) | `translateY(105%)→0` (use 110% for descenders) | 1.1 s | 70–90 ms per line | expo.out `cubic-bezier(.16,1,.3,1)` | top of element at about 82% of the viewport |
| Char reveal (display words of ≤3 words, the numerals) | same | 0.7 s | 15–25 ms per char | same | same |
| Body copy | `opacity 0→1; translateY(12px)→0` | 0.9 s | — | `--ease-standard` | same |

- **Splitting without GSAP:**
  1. Wait for `document.fonts.ready`.
  2. Wrap words in spans.
  3. Group them by `offsetTop` into lines.
  4. Emit `<span class="l"><span class="li" style="--i:n">…</span></span>`.
  5. Re-split on a `ResizeObserver` with a 150 ms debounce.
  6. Put `aria-label` with the original text on the host and `aria-hidden` on the splits.
- **Alternative:** GSAP 3.13+ (now free) SplitText `{type:'lines', mask:'lines', autoSplit:true, onSplit}` handles re-splitting on font load and resize, plus screen readers.
```css
.l{display:block;overflow:clip;padding-bottom:.08em;margin-bottom:-.08em} /* room for descenders */
.li{display:block;transform:translateY(105%);transition:transform var(--t-reveal) var(--ease-out) calc(var(--i)*80ms)}
.is-in .li{transform:none}
@media (prefers-reduced-motion:reduce){.li{transform:none;transition:opacity .2s;opacity:0}.is-in .li{opacity:1}}
```
- **Pitfalls.**
  - Splitting before fonts load produces wrong line breaks. The repo currently loads no fonts at all, so fix that first.
  - `overflow:hidden` clips italic overhangs; use `overflow:clip` with `overflow-clip-margin` or padding.
  - Reveal once (`IntersectionObserver` then `disconnect`, which the repo already does with `.rv`). Don't replay on scroll-up.

### 2.5 Scroll-velocity effects (restrained)
Read the velocity once per frame: `v = clamp(lenis.velocity/40, -1, 1)`, then `vs = damp(vs, v, 6, dt)`. Uses:
1. **3D pencil inertia.** Add `rotation.z += vs*0.06` and a `position.y` lag of `vs*0.08`. The object feels heavy (Oryzo's "weight").
2. **Chromatic aberration** on the canvas only: radial, `amount = 0.0012*|vs|`, so it is zero at rest. See 2.9.
3. **Marquee:** one spec ticker between Philosophy and Lineup. Base 40 px/s; speed `*(1+|vs|*4)`; direction follows `lenis.direction`.
4. **Hairline rules:** section dividers `scaleX` from 0.985 to 1 with `|vs|`, which is very subtle.
- **Avoid** skewY on text or images: it was an agency cliché by 2019, it hurts legibility, and it reads cheap on a precision brand.

### 2.6 Preloader: "the drawing becomes the object"
**What it looks like.**
1. A paper screen. A 1 px ink technical elevation of the pencil (SVG, side view with centre-line and a dimension of `L 142.0`) draws itself with `stroke-dashoffset`, driven by **real** load progress.
2. A mono counter at bottom-left reads `LOADING 000 → 100` in `tabular-nums`, with a title block bottom-right: `MERIDIAN HEX · SHEET 01/09 · SCALE 1:1 · REV C`.
3. At 100, the drawing holds for 250 ms. The 3D render then fades in **exactly registered** over the line drawing (the camera key at p=0 must match the SVG projection) while the linework fades to 0 over 600 ms.
4. The paper curtain lifts: `clip-path: inset(0 0 0 0) → inset(0 0 100% 0)`, 1000 ms, `--ease-inout`.
5. The hero lines reveal at +150 ms.

**Logic.**
- `real` comes from `THREE.LoadingManager.onProgress` (GLB, HDR) together with `document.fonts.ready`.
- `shown = max(damp(shown, real, 6, dt), 0.9*easeOutCubic(min(1, t/2.4s)))` so the counter never stalls.
- On complete, run to 100 over 350 ms.
- Show it for at least 1.2 s and at most about 3 s on fast connections.
- Skip to a 400 ms version on repeat visits (`sessionStorage`), and in reduced-motion mode show a simple crossfade.

**Pitfalls.**
- Get the SVG path from a real orthographic render of the GLB silhouette. Export it from Blender (Freestyle SVG) or trace it, so the registration holds.
- Never fake 100% before the GLB has decoded. Await `renderer.compileAsync(scene, camera)` to avoid a first-frame hitch.

### 2.7 3D ring carousel (Lineup): see §3 for staging
- **Geometry.** Four pencils stand upright on a horizontal ring ("lazy Susan"): radius `R≈1.9` (scene units; the pencil is about 7 long), spacing `STEP=π/2`.
  - Front slot at θ=0: `x=R·sinθ`, `z=R·cosθ`.
  - Camera elevation 10–14°, FOV 28–32, so the back pencil peeks just above the front one's shoulder.
  - The ring centre sits behind the front slot. On entry, the hero pencil is *already* the front slot (no jump).
- **Scroll mapping with dwell plateaus.** This is the key to readability.
```ts
const N=4, STEP=Math.PI*2/N
// s = lineup-local progress 0..1 over a sticky section of height (N+1)*85vh (+0.5 segment lead-in/out)
export function ringAngle(s:number){
  const x=Math.min(N-1, Math.max(0, s*(N-0.001)-0.5))       // 0..3 with half-segment padding
  const i=Math.floor(x), f=x-i
  const e=easeInOutQuart(smoothstep(0.3,0.8,f))            // hold 30% · move 50% · hold 20%
  return -(i+e)*STEP }
export const focus=(θ:number)=>Math.pow(Math.max(0,Math.cos(θ)),4)    // 1 at front, 0 at sides/back
```
- **Per-pencil response to focus `w`:**
  - `scale = 0.86 + 0.14w`
  - `envMapIntensity × (0.5 + 0.5w)`
  - self-spin `0.25 rad/s × (1 - w)`
  - the front pencil eases (`λ=4`) to a "hero facet" angle so a hex face catches the key light
  - depth fade from `scene.fog = new Fog(paperCalibrated, near, far)`
- **Fog pitfall.** With tone mapping on, a fog colour of `#F5F3EE` will *not* render as `#F5F3EE`. Tune it by eyedropper against the CSS paper, or switch to `NeutralToneMapping` (see 2.9), which deviates less.
- **One source of truth: scroll position.**
  - Drag (pointer on a DOM hit-area over the ring, `touch-action: pan-y`) sets a temporary visual offset `dx/(R_px)` rad.
  - On release, take velocity × 0.25 s, round to the nearest index, then `lenis.scrollTo(snapY[i], {duration:1.1, easing:easeInOutQuart})`.
  - Clicking a side pencil (raycast) and `←/→` keys while the ring has focus do the same.
  - `lenis/snap` proximity points sit at each plateau centre.
- **Labels and UI (DOM, not WebGL text).**
  - A giant name (`Core`, `Pro`, `Studio`, `Limited`) in display type at left. It changes with a masked vertical roll: the old line goes `-105%`, the new one comes from `105%`, 700 ms expo.out.
  - A mono `02 / 04` counter rolls like an odometer.
  - A spec stack (`C360 BRASS · 23.0 g · CLUTCH`) and a price that rolls digit by digit.
  - A hairline leader runs from the label to the front pencil's projected tip (`Vector3.project` each frame).
  - Side pencils get `data-cursor="view"` and the hit area `drag`.
  - An accessible equivalent: a visually minimal `role="radiogroup"` with 4 radios that call the same `scrollTo`, plus an `aria-live="polite"` announcement ("Pro, brass, selected").
- **Materials.** Clone the assembly with geometry shared and only the barrel and clip materials cloned.

| Variant | Colour | Metalness | Roughness | Notes |
|---|---|---|---|---|
| Core stainless | `#C8CACB` | 1 | 0.26 | brushed: anisotropy 0.4 (`MeshPhysicalMaterial.anisotropy`) |
| Pro brass | `#C59B55` | 1 | 0.30 | warmer rim |
| Studio ink-blue anodised Al | `#1E2F4F` (repo `ANODIZED`) | 0.85 | 0.38 | anodising is more diffuse |
| Limited titanium | `#8E8F8C` | 1 | 0.42 | bead-blasted, tiny warm tint |

- **Mobile (≤900 px).**
  - Use the existing mobile GLB for all 4 pencils, DPR ≤ 1.5, ring `R≈1.5`, camera pulled back.
  - Shorter dwell (65vh per variant).
  - Labels stack *below* the ring, not floating.
  - Swipe on the hit area changes the variant; vertical scroll stays native via `touch-action: pan-y`.
  - Merge static sub-meshes per clone to cut draw calls. No gyroscope (permission prompts on iOS are not worth it).
- **Pitfalls.**
  - Four full clones means 4× draw calls and 4× shadow casting. Only the front pencil should cast into the 2048 shadow map; the others get contact blobs.
  - Don't let the ring rotate continuously; idle spin destroys the dwell.

### 2.8 Pointer-reactive 3D
- **Rig.** Insert a `pointerRig` group between scene and `asm.group`, so pointer motion never fights the scroll choreography in `experience.ts`.
  - `nx, ny` in [-1,1] from the pointer, with `rigX = damp(rigX, -ny*0.10, 4, dt)` and `rigY = damp(rigY, nx*0.16, 4, dt)` (radians).
  - Camera parallax: `camera.position.x += nx*0.06`, applied to the per-frame target, not the integrated value.
- **Light sweep from the pointer** (the best one for a hex barrel): `scene.environmentRotation.y = damp(..., baseScrollRot + nx*0.35, 3, dt)`. `scene.environmentRotation` has been an Euler since r162 and is present in 0.184. The specular highlight then slides facet to facet across the hex as you move, with no object motion.
- **Scroll light sweeps:** drive `baseScrollRot` from `p` (for example 0 → 0.9 rad through Hero→Detail, and a fast 0.6 rad streak over 0.4 s when Reassembly completes).
- **Idle breathing:** after 3 s without input, ±0.6° at 0.15 Hz.
- **Touch:** no pointer rig. Optionally drive a small `nx` from scroll velocity instead.
- **Pitfall:** compute `nx/ny` relative to the canvas rect, and freeze it while the cursor is in a `drag` state.

### 2.9 Post FX that reads premium on paper
The canvas is transparent over CSS paper, so **anything that must touch the paper (grain, vignette) belongs in CSS**. Shader passes only see the pencil's pixels.
- **Tone mapping:** switch ACES to `THREE.NeutralToneMapping` (Khronos PBR Neutral, built for colour-accurate product rendering). ACES shifts hue and desaturates, which will wreck brass and ink-blue. Re-tune exposure to about 1.0 and re-check the HDRI.
- **Grain (CSS):** a fixed full-viewport `div`, `pointer-events:none`, with a 160² noise PNG (or one generated at boot into a blob URL).
  - `mix-blend-mode:multiply; opacity:.05`, and `.035` on mobile.
  - Animate by stepping `background-position` at 8 fps (`steps(1)` keyframes over 6 positions), so it doesn't fight scrolling.
  - It covers DOM type and 3D alike, which is what makes them read as one printed surface.
  - Pause it when `motionOK` is false.
- **Vignette (CSS, warm, not black):** `radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(120,100,70,.07))` with `mix-blend-mode:multiply`. A black vignette on paper looks dirty.
- **Chromatic aberration (one ShaderPass after OutputPass):** sample R, G and B at `uv ± dir*amt`, with `dir = normalize(uv-0.5)*dot(uv-0.5, uv-0.5)` and `amt = 0.0012*|vs|`. Set `alpha = max` of the three samples. It is zero at rest and appears only on the pencil's edges in motion. **Skip the pass** (`enabled=false`) when `amt < 1e-4` to save a full-screen blit.
- **DOF only in macro shots (Detail, Mechanism jaw):** three's `HorizontalTiltShiftShader` + `VerticalTiltShiftShader` (both in `examples/jsm/shaders`).
  - Use a focal line at the projected grip y, `r≈0.35`, max blur about 4 px.
  - Enable only while `detailF(p)>0.01 || mechF(p)>0.01`.
  - A long, thin pencil suits a tilt-shift band better than BokehPass, which is expensive and haloes on alpha.
- **Bloom:** none on paper; it washes out. If X-ray goes dark (see §3), selective bloom on emissive internals is allowed there only: threshold 0.9, intensity ≤0.35, `mipmapBlur`.
- **Contact shadows:** port three's `webgl_shadow_contact` example. Orthographic camera under the object, depth override material, two H/V blur passes, render target 256 (mobile) or 512, applied as a plane with opacity 0.4. Tint it warm (`#3A2E25`), not black.
  - Use two layers: a tight one (`blur 1.2`) plus a wide one (`blur 4`, opacity 0.18).
  - Re-render only when the object moves (`frames` gating).
  - Keep the existing `ShadowMaterial` only for the front pencil's long shadow, or drop it.
- **Pitfall:** grain applied *inside* WebGL over a transparent buffer is invisible on paper and double-counts on the pencil. Use CSS.

### 2.10 Technical-drawing overlays
- **Vocabulary**, all hairline 1 px, ink at 55% and `--accent` for the *active* item only:
  - **Dimension lines:** extension lines with a 2 px gap from the object, ISO filled arrowheads or 45° architectural ticks, and centred mono values, for example `Ø 0.50 ±0.02`, `A/F 8.00` ("across flats" is correct hex terminology, a good detail), `L 142.0`.
  - **Centre lines:** dash-dot `stroke-dasharray: 14 3 2 3`.
  - **Numbered balloons:** 18 px circles with mono numerals, leader lines with a 1.5 px dot terminal.
  - **Section hatching:** 45° lines, 4 px pitch, on cut parts in X-ray.
  - **Title block:** the nav or footer becomes `DRAWN · CHECKED · SCALE · SHEET 03/09 · REV C`, and section labels read `SHEET 04 — X-RAY`.
- **Anchoring to 3D:** a single full-viewport SVG layer. Each frame, for at most 12 anchors (empties in the GLB or offsets from part nodes), compute `v.copy(anchor).applyMatrix4(node.matrixWorld).project(camera)` and convert to px. Write `setAttribute('x1',…)`, and only when the value changed by more than 0.25 px. Hide anchors that are facing away (normal · view direction > 0) or off-screen.
- **Draw-on:** give each path `pathLength="1"` so no `getTotalLength()` is needed; use `stroke-dasharray:1; stroke-dashoffset:1 → 0` over 900 ms with `--ease-draw` and a 60 ms stagger. Values appear *after* their line: opacity plus a 120 ms mono "settle", or a 300 ms character scramble for mono only, used at most once per section.
- **Pitfalls.**
  - Use `vector-effect: non-scaling-stroke` for hairlines.
  - Keep text out of the 3D layer for crispness.
  - Never let more than about 6 callouts be visible at once.

### 2.11 Numbers, marquee, section transitions
- **Odometer digits:** each digit is a column `0–9`, `transform: translateY(calc(-1em * n))`, 900 ms expo.out, staggered 40 ms right-to-left, `font-variant-numeric: tabular-nums`. Use it for the price, `01/04`, `0.5`, click counts. **Don't count up from 0**; roll from the previous value.
- **Marquee:** a single hairline-bordered mono ticker, `0.5 MM LEAD · HEX A/F 8.0 · 23 G · C360 BRASS · 6061 AL · GRADE 5 TI ·`, duplicated content and `translate3d` in rAF with speed from §2.5, plus `aria-hidden` and a static sr-only list.
- **Section transitions:**
  - Mostly *no* transitions: continuous paper, with the 3D carrying continuity.
  - Exactly **one** tonal inversion: X-ray (see §3).
  - Curtain and wipe timing: 1000 ms `--ease-inout`.

---

## 3. Recommended plan for Meridian (prioritized)

**P0: foundation (do first; each is small and lifts everything)**
1. **Load the fonts.**
   - Self-host Inter Tight (variable, 400–700) and IBM Plex Mono 400/500 as woff2. Preload the display weight, use `font-display:swap`, and add `size-adjust` fallback metrics to kill CLS.
   - Add **one editorial serif for `<em>` only**: *Instrument Serif Italic* is the trendier choice; *Newsreader Italic* (opsz 72) is the more bookish one. Use it for 1–2 words per headline, never body.
   - Display H1/H2: Inter Tight 500, `letter-spacing:-0.035em`, `line-height:.92`, at 9–11vw for the hero.
   - Mono labels: 10–11 px uppercase, `.08em` tracking.
2. **Motion system:** add the tokens and helpers from §2.0 and a single rAF owner (the existing `PencilExperience.loop`) that ticks Lenis, the trail, the cursor, the SVG overlay and odometers. One loop, one `motionOK`.
3. **Lenis** wired into the loop as in §2.3. Raise camera damping to `λ≈9`. Replace `window.scrollY` reads with `lenis.scroll`/`progress`.
4. **NeutralToneMapping**, CSS grain and warm vignette, plus the contact-shadow pair (§2.9). Re-check that variant colours read true.
5. **Line-mask reveals** on every H1/H2 and body fades (§2.4), replacing the generic `.rv` fade.

**P1: signature moves**

6. **Hero:**
   - Preloader "drawing becomes the object" (§2.6).
   - The H1 reveals line by line, with the serif-italic word last.
   - Pointer rig and environment-rotation light sweep across the hex facets (§2.8).
   - The scroll cue becomes a 48 px vertical hairline with a graphite dot sliding down (1.8 s loop, `--ease-inout`).
7. **Graphite trail and nib cursor** site-wide on fine pointers (§2.1, §2.2). Magnetic CTAs in Hero, Buy and nav.
8. **Detail (grip macro):**
   - Tilt-shift DOF band on the grip.
   - The environment rotation sweeps 0→0.9 rad, so a highlight streaks across the knurl/honeycomb as you scroll.
   - An `A/F 8.00` across-flats dimension draws on beside the barrel, with a `Ø 0.50` callout at the tip.
9. **Exploded:**
   - As parts separate, numbered balloons (①–⑨) draw on with leaders; part names and materials sit in mono.
   - Hovering a balloon or part highlights it (an emissive `--accent` at 0.12 or a hairline outline) and switches the cursor to `PART 04 · CLUTCH JAW`.
   - A giant outlined numeral `9` ("nine parts") at 38vw, `-webkit-text-stroke:1px` ink at 25%, sits behind the parts with 0.85× parallax. **This is the only outlined type on the site.**
10. **X-Ray as a scan (the one tonal inversion):**
    - A horizontal `--accent` hairline sweeps down the pencil, driven by scroll.
    - Use **two renders split by material clipping planes** (`renderer.localClippingEnabled = true`): above the line the solid barrel, below it the x-ray (ghost shells plus visible internals, section hatching on the cut).
    - Behind it, a DOM layer of ink `#141412` reveals with `clip-path: inset(0 0 calc(100% - var(--scan)) 0)` synchronized to the projected scan-plane y, so the page itself turns "film negative" below the line.
    - Paper-coloured hairlines and labels in the dark zone. Selective bloom on internals is allowed here only.
    - The scan reverses on exit.
11. **Mechanism:**
    - The "Five moves. One click." steps become an odometer `1/5…5/5`.
    - Each step fires a spring on the jaw/clutch nodes (`k=300, c=18`, a tiny overshoot = the click).
    - Macro tilt-shift on the jaw.
    - Optional P3: a single real click sample, **off by default**, behind the sound toggle.
12. **Reassembly:**
    - Parts return with staggered springs (40 ms apart).
    - On completion, a fast environment-rotation streak (0.6 rad over 0.4 s) "seals" the object, and a `L 142.0` overall-length dimension draws on once.
13. **Philosophy:** "Fewer parts. Tighter tolerances." gets line reveals, then **the tracking literally tightens** with section progress: `letter-spacing` from `.06em` to `-.035em` on the H2 (layout is limited to one element). Rows get hairline rules that draw on left to right.
14. **Spec marquee** between Philosophy and Lineup (§2.11), coupled to velocity.
15. **Lineup becomes a 3D ring** (§2.7):
    - Delete the horizontal PNG track and the hint text "Vertical scroll drives horizontal travel".
    - **Handoff:** over `p≈0.62–0.70` the hero pencil glides into the front slot as the camera pulls back. The three other pencils rise from below the frame with a 120 ms-equivalent stagger, out of the fog.
    - Dwell plateaus, snap, the giant name roll, the `01/04` odometer, the price roll, a leader to the tip, drag, click, keys, and the radiogroup with aria-live.
    - Order **Core → Pro → Studio → Limited**, with Limited last as the crescendo: a slightly slower move (1.3×) and the env-rotation streak.
16. **Buy (the 3D→2D handoff, after Oryzo):**
    - The ring collapses: the three unselected pencils sink into fog, and the selected one shrinks into the Buy layout's product slot, becoming the UI element (the existing "shrinks bottom-left" behaviour, now continuous from the ring).
    - Variant radios stay synced both ways with the ring index. The price rolls, and the CTA is magnetic.
    - Optional **test pad** scribble sheet (§2.1).
17. **Chrome/nav:**
    - A title-block aesthetic: `SHEET 0X/09 — SECTION` updates with a vertical roll.
    - A hairline progress rule (existing `#progressFill`) gains small tick marks at each section key.
    - The motion toggle controls *every* effect.
18. **Mobile pass:**
    - No trail, cursor or pointer rig.
    - DPR ≤1.5; the ring uses mobile GLBs and stacked labels.
    - Tilt-shift and CA disabled; grain at 0.035.
    - Shorter pins (about 65vh per beat).
    - Test on iOS Safari with Lenis `syncTouch:false`.
19. **Performance and QA gates:**
    - 60 fps on an M1 Air at DPR 2 through Exploded and Lineup.
    - Mobile Lighthouse ≥ 80, CLS < 0.02, LCP is the H1 (not the canvas).
    - The loop sleeps when idle and not in the Lineup or Buy turntable.
    - `renderer.info.render.calls` < 250 desktop and < 120 mobile.
    - Reduced motion yields the static choreography with crossfades.

**P2/P3 nice-to-haves**

20. A sound toggle with a pencil-click and paper-rustle ambience, off by default and remembered.
21. A "lead grade" micro-interaction in Buy: HB/2B/4B changes the trail's darkness site-wide.
22. A share card: the visitor's graphite scribble exported as PNG with the title block (`canvas.toBlob`).

### Avoid (these cheapen it)
- **Colour and FX:**
  - RGB, fluid or neon cursor effects, glitch, scanline or CRT passes, and bloom on paper.
  - A black vignette.
  - Constant chromatic aberration.
  - Grain above about 6% opacity.
- **Type motion:**
  - Char-by-char reveals on paragraphs.
  - Scramble text everywhere (use it at most once per section, mono only).
  - Rotating circular "scroll down" text badges.
  - Skew on scroll.
- **Layout and pacing:**
  - Outlined giant type in more than one place.
  - Parallax on every element.
  - Mixed easing curves; stick to the 5 tokens.
- **Interaction:**
  - Elastic or overshoot easing on layout or UI (springs are for the *mechanism* and magnet release only).
  - A primary cursor that lags the real pointer.
  - Hiding the native cursor on inputs or touch.
- **Scroll:**
  - Scroll-jacking: mandatory snap outside the Lineup, or hijacked scroll speed.
  - Syncing touch scroll on iOS.
  - Ring idle-spin while the user is reading.
- **Preloader:** a fake preloader that stalls, or one longer than about 3 s; replaying it on every visit.
- **Copy and assets:**
  - Instructional copy ("drag to explore", "scroll horizontally"). The cursor label does that job.
  - PNG renders next to live 3D (inconsistent lighting). Everything in the Lineup must be live.
- **Accent colour:** more than one; `#A63D22` stays reserved for active dimension, scan line, focus ring and CTA.

### Files most affected
- `src/three/experience.ts`: loop owner, Lenis, velocity, pointer rig, ring, X-ray clipping.
- `src/three/stage.ts`: tone mapping, CA pass, tilt-shift, contact shadows, `environmentRotation`.
- `src/three/assembly.ts`: variant clones and materials, anchors.
- `src/data/scroll.ts`: new keys for ring and Buy handoff, scan progress.
- `src/components/Lineup.tsx` and `Buy.tsx`: ring UI and radiogroup.
- `src/components/Chrome.tsx`: title block, motion toggle.
- `src/styles/tokens.css` and `base.css`: fonts, tokens, grain and vignette.
- New: `src/motion/{damp,spring,lenis,reveal,odometer}.ts`, `src/cursor/{GraphiteTrail,Cursor}.ts`, `src/overlay/Dimensions.ts`, `src/components/Preloader.tsx`.
