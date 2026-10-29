// Brand probe: runs inside a page (Playwright addScriptTag, or pasted into a browser
// console / javascript_tool) and returns raw colour + font evidence as JSON.
// theme.mjs turns this evidence into a video palette.  Usage in a browser tool:
//   paste this file, then run:  JSON.stringify(await window.__themeProbe())
(function () {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const probeEl = document.createElement('i');
  const toRGB = (c) => {
    if (!c || c === 'transparent' || c === 'none') return null;
    probeEl.style.color = ''; probeEl.style.color = c;
    if (!probeEl.style.color) return null;            // not a valid CSS colour
    if (!probeEl.isConnected) document.documentElement.appendChild(probeEl);
    const resolved = getComputedStyle(probeEl).color;  // resolves named / hsl / oklch etc.
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = resolved; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    if (d[3] < 40) return null;                       // (mostly) transparent
    return [d[0], d[1], d[2]];
  };
  const colorsIn = (s) => (String(s).match(/(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\))/gi) || []);
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const area = (el) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(r.width, innerWidth) * Math.min(r.height, 4000)); };
  const fontOf = (el) => el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim() : null;

  window.__themeProbe = async function () {
    const out = { url: location.href, title: document.title, vars: [], buttons: [], links: [], headings: [], surfaces: [], gradients: [], body: {}, fonts: {}, meta: {} };
    // CSS custom properties on :root / html / body
    const seen = new Set();
    for (const el of [document.documentElement, document.body]) {
      const cs = getComputedStyle(el);
      for (let i = 0; i < cs.length; i++) {
        const n = cs[i]; if (!n.startsWith('--') || seen.has(n)) continue; seen.add(n);
        const v = cs.getPropertyValue(n).trim();
        if (!v || v.length > 80 || /var\(|url\(|gradient/.test(v)) continue;
        const rgb = /^(#|rgb|hsl|oklch|oklab|lab|lch|[a-z]+$)/i.test(v) ? toRGB(v) : (/^\d+(\.\d+)?%?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(v) ? toRGB(`hsl(${v})`) : null);
        if (rgb) out.vars.push({ name: n, value: v, rgb });
      }
    }
    const bs = getComputedStyle(document.body), hs = getComputedStyle(document.documentElement);
    out.body = { bg: toRGB(bs.backgroundColor) || toRGB(hs.backgroundColor) || [255, 255, 255], color: toRGB(bs.color), font: fontOf(document.body) };
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) out.meta.themeColor = toRGB(meta.content);
    // headings
    for (const h of [...document.querySelectorAll('h1,h2')].filter(visible).slice(0, 8)) {
      const s = getComputedStyle(h);
      out.headings.push({ tag: h.tagName, color: toRGB(s.color), font: fontOf(h), weight: +s.fontWeight, size: parseFloat(s.fontSize), grad: colorsIn(s.backgroundImage).map(toRGB).filter(Boolean) });
    }
    // buttons / CTAs
    const btns = [...document.querySelectorAll('button, a, [role=button], input[type=submit]')].filter(visible);
    for (const b of btns.slice(0, 300)) {
      const s = getComputedStyle(b);
      const bg = toRGB(s.backgroundColor); const gi = colorsIn(s.backgroundImage).map(toRGB).filter(Boolean);
      if (bg || gi.length) out.buttons.push({ bg, grad: gi, color: toRGB(s.color), radius: parseFloat(s.borderRadius) || 0, area: area(b), text: (b.innerText || '').trim().slice(0, 24) });
      else if (b.tagName === 'A') { const c = toRGB(s.color); if (c) out.links.push(c); }
    }
    // large surfaces and gradients
    for (const el of [...document.querySelectorAll('header, nav, section, main, footer, div')].filter(visible).slice(0, 600)) {
      const s = getComputedStyle(el); const a = area(el);
      if (a < 20000) continue;
      const bg = toRGB(s.backgroundColor); if (bg) out.surfaces.push({ bg, area: a, radius: parseFloat(s.borderRadius) || 0 });
      const g = colorsIn(s.backgroundImage).map(toRGB).filter(Boolean); if (g.length >= 2) out.gradients.push({ stops: g, area: a });
    }
    out.fonts = { display: out.headings[0]?.font || fontOf(document.querySelector('h1,h2,h3')) || out.body.font, body: out.body.font };
    const radii = out.buttons.map(b => b.radius).filter(r => r > 0).sort((a, b) => a - b);
    out.radius = radii.length ? radii[Math.floor(radii.length / 2)] : 12;
    return out;
  };

  // Pixel histogram of an image (used by theme.mjs on a screenshot)
  window.__pixelHist = async function (dataUrl) {
    const img = new Image(); img.src = dataUrl; await img.decode();
    const w = 160, h = Math.round(160 * img.height / img.width);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data; const m = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3);
      const e = m.get(k) || [0, 0, 0, 0]; e[0] += d[i]; e[1] += d[i + 1]; e[2] += d[i + 2]; e[3]++; m.set(k, e);
    }
    const tot = w * h;
    return [...m.values()].sort((a, b) => b[3] - a[3]).slice(0, 40).map(e => ({ rgb: [e[0] / e[3] | 0, e[1] / e[3] | 0, e[2] / e[3] | 0], share: e[3] / tot }));
  };
})();
