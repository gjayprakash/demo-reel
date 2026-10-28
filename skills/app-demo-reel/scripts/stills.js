const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const times = (process.argv[2] || '1.6,4.9,9.6,10.7,12.9,14.9,15.9,18.8').split(',').map(Number);
  const out = process.argv[3] || '.';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('console', m => console.log('console:', m.text()));
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto('file://' + path.resolve(process.cwd(), 'index.html'));
  await page.waitForFunction('window.READY === true', null, { timeout: 30000 });
  // walk the timeline forward so relative tweens record correctly
  let last = 0;
  for (const t of times) {
    for (let s = last; s < t; s += 1 / 30) await page.evaluate(x => window.seek(x), s);
    await page.evaluate(x => window.seek(x), t);
    last = t;
    await page.screenshot({ path: path.join(out, `still_${t.toFixed(1)}.png`) });
  }
  await browser.close();
})();
