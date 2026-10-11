import { store } from './state.js';

// Web fonts referenced by the "hand" font option. An SVG rendered through <img>
// cannot fetch anything, so for export the font files are inlined as data URLs —
// only the unicode-range subsets that the chart's text actually needs.
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Long+Cang&display=swap';
const fontCache = new Map();

const toDataURL = (blob) =>
  new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });

function inRanges(cp, ranges) {
  return ranges.some(([a, b]) => cp >= a && cp <= b);
}

function parseRanges(s) {
  return s.split(',').map((part) => {
    const m = part.trim().replace(/^U\+/i, '');
    if (m.includes('-')) {
      const [a, b] = m.split('-');
      return [parseInt(a, 16), parseInt(b, 16)];
    }
    if (m.includes('?')) return [parseInt(m.replace(/\?/g, '0'), 16), parseInt(m.replace(/\?/g, 'F'), 16)];
    const v = parseInt(m, 16);
    return [v, v];
  });
}

async function embeddedFontCSS(text) {
  let css;
  try {
    css = await (await fetch(FONT_CSS)).text();
  } catch {
    return ''; // offline or blocked: the export falls back to system fonts
  }
  const cps = new Set([...text].map((c) => c.codePointAt(0)));
  const blocks = css.match(/@font-face\s*{[^}]*}/g) || [];
  const out = [];
  for (const b of blocks) {
    const ur = b.match(/unicode-range:\s*([^;]+);/);
    const url = b.match(/url\(([^)]+)\)/)?.[1];
    if (!url) continue;
    if (ur) {
      const ranges = parseRanges(ur[1]);
      if (![...cps].some((cp) => inRanges(cp, ranges))) continue;
    }
    try {
      if (!fontCache.has(url)) fontCache.set(url, await toDataURL(await (await fetch(url)).blob()));
      out.push(b.replace(url, fontCache.get(url)));
    } catch {
      /* skip this subset */
    }
  }
  return out.join('\n');
}

export async function renderPNG(scale = 1) {
  const src = document.getElementById('stage');
  const clone = src.cloneNode(true);
  clone.querySelectorAll('.ui-only').forEach((e) => e.remove());
  const { w, h } = store.doc.canvas;
  clone.removeAttribute('style');
  clone.removeAttribute('class');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', w * scale);
  clone.setAttribute('height', h * scale);

  const st = store.doc.style;
  if (st.labelFont === 'hand' || st.titleFont === 'hand') {
    const text = [...clone.querySelectorAll('text')].map((t) => t.textContent).join('');
    const css = await embeddedFontCSS(text);
    if (css) {
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.textContent = css;
      clone.prepend(style);
    }
  }

  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = w * scale;
    cv.height = h * scale;
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise((res) => cv.toBlob(res, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- project files ----------

export function projectJSON() {
  const doc = store.doc;
  const used = new Set(doc.nodes.map((n) => n.img).filter(Boolean));
  if (doc.title.img) used.add(doc.title.img);
  const images = {};
  for (const id of used) if (store.images.has(id)) images[id] = store.images.get(id);
  return { app: 'ship-chart', version: 1, doc, images };
}

export function parseProject(obj) {
  if (!obj || obj.app !== 'ship-chart' || !obj.doc) throw new Error('不是有效的工程文件');
  return { doc: obj.doc, images: new Map(Object.entries(obj.images || {})) };
}
