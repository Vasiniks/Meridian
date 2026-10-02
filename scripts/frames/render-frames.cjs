#!/usr/bin/env node
/**
 * Regenerates the zero-GPU fallback frames (public/frames/{desktop,mobile})
 * from the live WebGL experience: canvas only (DOM hidden), paper background,
 * motion damping disabled so every frame is the settled pose for its scroll
 * progress. FrameFallback shows frame floor(p * count), so frame i is
 * captured at the centre of its bucket, p = (i + 0.5) / count.
 *
 * Usage: start `npx vite --port 8100`, then
 *   node scripts/frames/render-frames.cjs [baseUrl] [desktop|mobile|all]
 * Resume a tier: FRAMES_TIER=desktop FRAMES_FROM=33 node ... (earlier frames kept)
 * Requires Playwright (globally installed in the cloud dev image).
 */
const path = require('path')
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  ;({ chromium } = require('/opt/node22/lib/node_modules/playwright'))
}

const ROOT = path.resolve(__dirname, '..', '..')
const TIERS = {
  // cores: detectConfig() drops to the mobile tier at <=4 cores, so force
  // 8 for desktop frames (the build sandbox has 4) and keep mobile on its tier.
  desktop: { w: 1440, h: 900, count: 80, quality: 82, cores: 8, settle: 900 },
  mobile: { w: 390, h: 844, count: 60, quality: 80, cores: 4, settle: 450 },
}

async function renderTier(browser, base, name) {
  const t = TIERS[name]
  const page = await browser.newPage({ viewport: { width: t.w, height: t.h } })
  await page.addInitScript((n) => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => n })
  }, t.cores)
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('done'), null, { timeout: 120000 })
  await page.addStyleTag({
    content: `body > *:not(#root), #root > *:not(#gl) { visibility: hidden !important; }
      #gl { visibility: visible !important; opacity: 1 !important; }
      main, footer, header, .scrim, #progress, #sceneLabel { visibility: hidden !important; }
      html { scroll-behavior: auto !important; }`,
  })
  // Settled poses: no damping, no idle turntable drift between captures.
  await page.evaluate(() => window.__exp?.setMotionOK?.(false))
  const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
  // FRAMES_FROM=n resumes a tier at frame n (earlier frames are kept)
  const from = name === (process.env.FRAMES_TIER || name) ? Number(process.env.FRAMES_FROM || 0) : 0
  for (let i = from; i < t.count; i++) {
    const p = (i + 0.5) / t.count
    // Lenis owns scrolling when present; jump it directly (no easing)
    await page.evaluate((y) => {
      const l = window.__lenis
      if (l) l.scrollTo(y, { immediate: true, force: true })
      else window.scrollTo(0, y)
    }, Math.round(max * p))
    await page.waitForTimeout(t.settle)
    const file = path.join(ROOT, 'public', 'frames', name, `f${String(i).padStart(3, '0')}.jpg`)
    // software WebGL can stall a capture on heavy frames: long timeout, one retry
    for (let attempt = 0; ; attempt++) {
      try {
        await page.screenshot({ path: file, type: 'jpeg', quality: t.quality, timeout: 120000 })
        break
      } catch (e) {
        if (attempt >= 1) throw e
        await page.waitForTimeout(2000)
      }
    }
    process.stdout.write(`\r${name} ${i + 1}/${t.count}`)
  }
  process.stdout.write('\n')
  await page.close()
}

;(async () => {
  const base = process.argv[2] || 'http://localhost:8100/'
  const which = process.argv[3] || 'all'
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  for (const name of which === 'all' ? Object.keys(TIERS) : [which]) {
    await renderTier(browser, base, name)
  }
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
