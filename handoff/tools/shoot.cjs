// Usage: [STOPS=0,0.25,0.5] node shoot.cjs <url> <outdir> [w] [h]
// Errors from fonts/cert noise can be ignored.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
(async () => {
  const [url, out, w = 1440, h = 900] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const stops = process.env.STOPS ? process.env.STOPS.split(',').map(Number) : [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  for (const s of stops) {
    await page.evaluate(y => window.scrollTo(0, y), Math.round(max * s));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/p${String(Math.round(s * 100)).padStart(3, '0')}.png` });
  }
  console.log('errors:', JSON.stringify(errs));
  await browser.close();
})();
