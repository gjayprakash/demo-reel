#!/usr/bin/env node
// Build a video palette from a brand's own website / app, so every video matches
// the platform it promotes instead of reusing one fixed look.
//
//   node theme.mjs --url https://app.example.com            # load the site with Playwright
//   node theme.mjs --html ./local-build/index.html           # a local page
//   node theme.mjs --probe probe.json [--shot shot.png]      # evidence gathered in a browser tool
//   node theme.mjs --colors "#2a3170,#ff5e8a,#f4f3fb"        # brand colours given by the user
//   options: --mode auto|dark|light   --out theme   (writes theme.json + theme.css)
//
// The probe (theme-probe.js) collects CSS variables, button / heading / gradient colours,
// fonts and a screenshot histogram. This script clusters them by hue, picks the brand
// accent(s) and the brand's dark tone, chooses dark or light mode, and derives every
// role the stage needs. All text roles are checked against WCAG contrast.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); // CommonJS resolution (honours NODE_PATH / global installs)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]]) : a), []));
const OUT = args.out || 'theme';

// ---------- colour maths (sRGB <-> OKLCH, WCAG) ----------
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const delin = (c) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, v)) * 255); };
function rgb2oklch([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, Bb), h: (Math.atan2(Bb, A) * 180 / Math.PI + 360) % 360 };
}
function oklch2rgbRaw({ L, C, h }) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
function oklch2rgb(c) { // reduce chroma until in sRGB gamut
  let C = c.C; for (let i = 0; i < 40; i++) { const v = oklch2rgbRaw({ ...c, C }); if (v.every(x => x >= -0.001 && x <= 1.001)) return v.map(delin); C *= 0.93; }
  return oklch2rgbRaw({ ...c, C: 0 }).map(delin);
}
const hex = (rgb) => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const rgba = (rgb, a) => `rgba(${rgb.join(',')},${a})`;
const ok = (L, C, h) => oklch2rgb({ L, C, h });
function ensureContrast(c, bg, min, dir) { // move lightness until contrast >= min
  let o = { ...c }; for (let i = 0; i < 60 && contrast(oklch2rgb(o), bg) < min; i++) o.L = Math.min(0.99, Math.max(0.02, o.L + dir * 0.012));
  return o;
}

// ---------- gather evidence ----------
async function probeWithPlaywright(target) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, bypassCSP: true });
  await page.goto(target, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => page.goto(target, { waitUntil: 'load', timeout: 45000 }));
  await page.waitForTimeout(1200);
  await page.addScriptTag({ path: path.join(HERE, 'theme-probe.js') });
  const probe = await page.evaluate(() => window.__themeProbe());
  const shot = (await page.screenshot()).toString('base64');
  probe.pixels = await page.evaluate((d) => window.__pixelHist(d), 'data:image/png;base64,' + shot);
  await browser.close();
  return probe;
}
async function histOfFile(file) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch(); const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ path: path.join(HERE, 'theme-probe.js') });
  const d = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  const r = await page.evaluate((x) => window.__pixelHist(x), d); await browser.close(); return r;
}

let probe;
if (args.url) probe = await probeWithPlaywright(args.url);
else if (args.html) probe = await probeWithPlaywright('file://' + path.resolve(args.html));
else if (args.probe) { probe = JSON.parse(fs.readFileSync(args.probe, 'utf8')); if (args.shot) probe.pixels = await histOfFile(args.shot); }
else if (args.colors) {
  const cs = String(args.colors).split(',').map(s => fromHex(s.trim()));
  probe = { vars: cs.map((rgb, i) => ({ name: i === 0 ? '--primary' : '--brand-' + i, rgb })), buttons: [], links: [], headings: [], surfaces: [], gradients: [], body: { bg: cs.find(c => lum(c) > 0.8) || [255, 255, 255], color: [20, 20, 30] }, fonts: {} };
} else { console.error('give --url, --html, --probe or --colors'); process.exit(1); }

// ---------- score candidates ----------
const cands = [];
const add = (rgb, w, tag) => { if (!rgb || w <= 0) return; const o = rgb2oklch(rgb); cands.push({ rgb, tag, ...o, w: w * Math.min(2, Math.max(0.5, o.C / 0.09)) }); }; // vivid colours count more
const brandVar = /(primary|brand|accent|main|cta|highlight|secondary|theme)/i;
for (const v of probe.vars || []) add(v.rgb, brandVar.test(v.name) ? 6 : 0.6, 'var');
for (const b of probe.buttons || []) { const w = 3 + Math.min(6, (b.area || 0) / 25000); add(b.bg, w, 'button'); (b.grad || []).forEach(g => add(g, w, 'button-grad')); }
for (const h of probe.headings || []) { add(h.color, 1.5, 'heading'); (h.grad || []).forEach(g => add(g, 7, 'heading-grad')); }
for (const l of probe.links || []) add(l, 1.2, 'link');
for (const g of probe.gradients || []) g.stops.forEach(s => add(s, 3, 'gradient'));
for (const s of probe.surfaces || []) add(s.bg, Math.min(4, s.area / 300000), 'surface');
if (probe.meta?.themeColor) add(probe.meta.themeColor, 4, 'meta');
for (const p of probe.pixels || []) add(p.rgb, p.share * 12, 'pixels');

// accents are the 'pop' colours: saturated and not too dark (dark brand tones become the backdrop instead)
let chromatic = cands.filter(c => c.C >= 0.06 && c.L >= 0.45 && c.L <= 0.93);
if (!chromatic.length) chromatic = cands.filter(c => c.C >= 0.05 && c.L >= 0.3 && c.L <= 0.93);
const clusters = [];
for (const c of [...chromatic].sort((a, b) => b.w - a.w)) {
  const k = clusters.find(k => hueDist(k.h, c.h) < 22);
  if (k) { k.w += c.w; k.members.push(c); } else clusters.push({ h: c.h, w: c.w, members: [c] });
}
clusters.sort((a, b) => b.w - a.w);
const repOf = (k) => k.members.slice().sort((a, b) => (b.w * (0.5 + b.C)) - (a.w * (0.5 + a.C)))[0];

const siteBg = probe.body?.bg || [255, 255, 255];
const siteBgO = rgb2oklch(siteBg);
const darkSite = siteBgO.L < 0.45;
let accent = clusters[0] ? repOf(clusters[0]) : null;
if (!accent) { // monochrome brand: use the strongest non-neutral we have, or a calm default
  const any = cands.filter(c => c.C >= 0.02).sort((a, b) => b.w - a.w)[0];
  accent = any || { ...rgb2oklch([79, 70, 229]), rgb: [79, 70, 229] };
}
const k2 = clusters.find(k => hueDist(k.h, accent.h) >= 30);
let accent2 = k2 ? repOf(k2) : { L: accent.L, C: accent.C, h: (accent.h + 38) % 360 };
// a brand "dark" is a deep, clearly coloured tone used for surfaces, buttons or brand variables
// (navy hero, dark green header...). Plain text colours (near-black slate) don't count.
const darkTags = new Set(['surface', 'button', 'button-grad', 'gradient', 'meta', 'pixels', 'var']);
const brandDark = cands.filter(c => darkTags.has(c.tag) && c.L < 0.42 && c.L > 0.08 && c.C >= 0.05 && (c.tag !== 'var' || c.w >= 6) && (c.tag !== 'pixels' || c.w >= 0.6))
  .sort((a, b) => b.w - a.w)[0];

let mode = args.mode && args.mode !== 'auto' ? args.mode : (darkSite ? 'dark' : brandDark ? 'dark' : 'light');

// ---------- derive roles ----------
const T = {};
if (mode === 'dark') {
  const h0 = brandDark ? brandDark.h : darkSite ? siteBgO.h : accent.h;
  const c0 = brandDark ? Math.min(brandDark.C * 0.6, 0.07) : darkSite ? Math.min(siteBgO.C, 0.06) : Math.min(accent.C * 0.3, 0.05);
  const L0 = darkSite ? Math.min(siteBgO.L, 0.2) : brandDark ? Math.min(brandDark.L * 0.6, 0.2) : 0.16;
  T.bg = ok(L0, c0, h0); T.bg2 = ok(L0 + 0.1, c0 * 1.25, h0); T.bg3 = ok(Math.max(0.08, L0 - 0.05), c0 * 0.9, h0);
  T.ink = ok(0.985, 0.006, h0); T.inkMuted = ok(0.82, 0.03, h0);
  T.hi1 = oklch2rgb(ensureContrast({ L: Math.max(accent.L, 0.74), C: accent.C, h: accent.h }, T.bg, 4.5, +1));
  T.hi2 = oklch2rgb(ensureContrast({ L: Math.max(accent2.L, 0.74), C: accent2.C, h: accent2.h }, T.bg, 4.5, +1));
  T.frame = ok(0.13, 0.012, h0); T.dots = rgba(T.ink, 0.07);
} else {
  const h0 = accent.h;
  T.bg = siteBgO.L >= 0.93 ? siteBg : ok(0.975, 0.012, h0); T.bg2 = ok(0.93, 0.04, h0); T.bg3 = ok(0.985, 0.008, h0);
  const hc = (probe.headings || [])[0]?.color;
  T.ink = hc && contrast(hc, T.bg) >= 7 ? hc : ok(0.2, Math.min(0.04, accent.C * 0.3), h0); T.inkMuted = ok(0.46, 0.03, h0);
  T.hi1 = oklch2rgb(ensureContrast({ L: Math.min(accent.L, 0.58), C: accent.C, h: accent.h }, T.bg, 4.5, -1));
  T.hi2 = oklch2rgb(ensureContrast({ L: Math.min(accent2.L, 0.58), C: accent2.C, h: accent2.h }, T.bg, 4.5, -1));
  T.frame = ok(0.2, 0.015, h0); T.dots = rgba(T.ink, 0.06);
}
T.accent = oklch2rgb(accent); T.accent2 = oklch2rgb(accent2);
T.ctaInk = contrast([255, 255, 255], T.accent) >= 3 ? [255, 255, 255] : ok(0.18, 0.02, accent.h);
T.surface = siteBg; T.surfaceInk = probe.body?.color || (lum(siteBg) > 0.4 ? [20, 20, 30] : [245, 245, 250]);
T.glow1 = rgba(T.accent, mode === 'dark' ? 0.32 : 0.22); T.glow2 = rgba(T.accent2, mode === 'dark' ? 0.26 : 0.18);
const clean = (f) => (f && !/^(-apple-system|system-ui|BlinkMacSystemFont|Segoe UI|Roboto|Arial|Helvetica|sans-serif|serif|Times New Roman)$/i.test(f)) ? f : null;
const fontDisplay = clean(probe.fonts?.display) || clean(probe.fonts?.body) || 'Inter';
const fontBody = clean(probe.fonts?.body) || fontDisplay;
const slug = (f) => f.toLowerCase().replace(/\s+/g, '-');

const theme = {
  source: probe.url || args.html || args.probe || 'colors', mode,
  colors: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, Array.isArray(v) ? hex(v) : v])),
  fonts: { display: fontDisplay, body: fontBody, packages: [...new Set([fontDisplay, fontBody])].map(f => `@fontsource/${slug(f)}`) },
  radius: Math.round(Math.min(32, Math.max(8, probe.radius || 14))),
  evidence: { accent: hex(oklch2rgb(accent)) + ' (' + (accent.tag || 'derived') + ')', accent2: hex(oklch2rgb(accent2)) + ' (' + (accent2.tag || 'derived') + ')', brandDark: brandDark ? hex(brandDark.rgb) : null, siteBg: hex(siteBg), darkSite, clusters: clusters.slice(0, 5).map(k => ({ hue: Math.round(k.h), weight: +k.w.toFixed(1), rep: hex(repOf(k).rgb) })) },
  contrast: { ink: +contrast(T.ink, T.bg).toFixed(2), inkMuted: +contrast(T.inkMuted, T.bg).toFixed(2), hi1: +contrast(T.hi1, T.bg).toFixed(2), hi2: +contrast(T.hi2, T.bg).toFixed(2), cta: +contrast(T.ctaInk, T.accent).toFixed(2) },
};
const C = theme.colors;
const css = `:root{
  --bg:${C.bg};--bg2:${C.bg2};--bg3:${C.bg3};--ink:${C.ink};--ink-muted:${C.inkMuted};
  --hi1:${C.hi1};--hi2:${C.hi2};--accent:${C.accent};--accent2:${C.accent2};--cta-ink:${C.ctaInk};
  --surface:${C.surface};--surface-ink:${C.surfaceInk};--frame:${C.frame};--dots:${C.dots};
  --glow1:${C.glow1};--glow2:${C.glow2};--radius:${theme.radius}px;
  --font-display:'${fontDisplay}','Inter',system-ui,sans-serif;--font-body:'${fontBody}','Inter',system-ui,sans-serif;
}
`;
fs.writeFileSync(OUT + '.json', JSON.stringify(theme, null, 2));
fs.writeFileSync(OUT + '.css', css);
console.log(`mode=${mode}  accent=${C.accent}  accent2=${C.accent2}  bg=${C.bg}  ink=${C.ink}  hi=${C.hi1}/${C.hi2}`);
console.log(`fonts: ${fontDisplay} / ${fontBody}   contrast: ${JSON.stringify(theme.contrast)}`);
console.log(`wrote ${OUT}.json and ${OUT}.css`);
