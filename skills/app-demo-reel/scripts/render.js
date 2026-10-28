const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
// Usage: W=2 [DUR=15] [QUERY="lang=hi"] node render.js
//   DUR   fit the stage's timeline into this many seconds (default: the stage's own window.DUR).
//         The timeline is re-timed uniformly; keep DUR within about 0.75-1.35x of the natural length,
//         otherwise add or drop scenes / holds in the stage instead.
//   QUERY extra query string passed to index.html (e.g. lang=hi).
const FPS = Number(process.env.FPS || 60);
(async () => {
  const W = Number(process.env.W || 2);
  const url = 'file://' + path.resolve(process.cwd(), 'index.html') + (process.env.QUERY ? '?' + process.env.QUERY : '');
  const browser = await chromium.launch();
  const probe = await browser.newPage();
  await probe.goto(url);
  await probe.waitForFunction('window.READY === true', null, { timeout: 30000 });
  const NAT = await probe.evaluate(() => window.DUR);
  await probe.close();
  const DUR = Number(process.env.DUR || NAT);
  const K = NAT / DUR; // stage seconds per output second
  if (K < 0.74 || K > 1.36) console.log(`warning: ${NAT}s -> ${DUR}s is a ${K.toFixed(2)}x speed change; motion may look rushed or sluggish`);
  const N = Math.round(DUR * FPS);
  const per = Math.ceil(N / W);
  const t0 = Date.now();
  await Promise.all([...Array(W)].map(async (_, w) => {
    const start = w * per, end = Math.min(N, start + per);
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => console.log('pageerror', w, e.message));
    await page.goto(url);
    await page.waitForFunction('window.READY === true', null, { timeout: 30000 });
    for (let s = 0; s < start / FPS * K; s += .25) await page.evaluate(x => window.seek(x), s); // warm-walk
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', String(FPS),
      path.join(process.cwd(), `seg_${w}.mp4`)], { stdio: ['pipe', 'ignore', 'inherit'] });
    for (let f = start; f < end; f++) {
      await page.evaluate(t => window.seek(t), Math.min(NAT, f / FPS * K));
      const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (w === 0 && (f - start) % 60 === 0) console.log(`w0 ${f - start}/${end - start} ${(Date.now() - t0) / 1000}s`);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
    console.log(`worker ${w} done frames ${start}-${end - 1}`);
  }));
  await browser.close();
  console.log('total', (Date.now() - t0) / 1000, 's', N, 'frames', `(${DUR}s output from ${NAT}s stage)`);
})();
