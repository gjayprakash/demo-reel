// Preview stills: [SIZE=1080x1920] node stills.js [t1,t2,...|auto] [outdir]
// Walks the stage timeline forward and saves still_<t>.png at each time (8 evenly spaced times if omitted).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[3] || '.';
  const url = 'file://' + path.resolve(process.cwd(), 'index.html') + (process.env.QUERY ? '?' + process.env.QUERY : '');
  const browser = await chromium.launch();
  const probe = await browser.newPage();
  probe.on('pageerror', e => console.log('pageerror:', e.message));
  await probe.goto(url);
  await probe.waitForFunction('window.READY === true', null, { timeout: 30000 });
  const { DUR, SIZE } = await probe.evaluate(() => ({ DUR: window.DUR, SIZE: window.SIZE }));
  await probe.close();
  const [VW, VH] = process.env.SIZE ? process.env.SIZE.split('x').map(Number) : (SIZE || [1080, 1920]);
  const arg = process.argv[2];
  const times = !arg || arg === 'auto' ? Array.from({ length: 8 }, (_, i) => +(DUR * (i + 0.6) / 8).toFixed(2)) : arg.split(',').map(Number);
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  page.on('console', m => console.log('console:', m.text()));
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto(url);
  await page.waitForFunction('window.READY === true', null, { timeout: 30000 });
  let last = 0;
  for (const t of times) {
    for (let s = last; s < t; s += 1 / 30) await page.evaluate(x => window.seek(x), s); // walk forward
    await page.evaluate(x => window.seek(x), t);
    last = t;
    await page.screenshot({ path: path.join(out, `still_${t.toFixed(1)}.png`) });
  }
  console.log(JSON.stringify({ DUR, size: [VW, VH], times }));
  await browser.close();
})();
