import { store, nodeRadius, legendColor, ringGeometry, imageFrame } from './state.js';
import { strokePaths, arrowPaths, quadTangent } from './stroke.js';
import { esc, clamp } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
export const SANS = `"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",system-ui,sans-serif`;
export const HAND = `"Caveat","Long Cang",${SANS}`;
export const fontFor = (k) => (k === 'hand' ? HAND : SANS);

let svg, defs, layers;

export function mountStage(el) {
  svg = el;
  svg.innerHTML = `<defs id="img-defs"></defs><rect id="bg" x="0" y="0"></rect>
    <g id="l-edges"></g><g id="l-nodes"></g><g id="l-texts"></g><g id="l-title"></g><g id="l-legend"></g><g id="l-ui" class="ui-only"></g>`;
  defs = svg.querySelector('#img-defs');
  layers = {
    edges: svg.querySelector('#l-edges'),
    nodes: svg.querySelector('#l-nodes'),
    texts: svg.querySelector('#l-texts'),
    title: svg.querySelector('#l-title'),
    legend: svg.querySelector('#l-legend'),
    ui: svg.querySelector('#l-ui'),
  };
}

// Images are defined once in <defs> and referenced with <use>, so re-rendering
// the scene on every drag frame never re-decodes a picture.
function syncImageDefs(doc) {
  const used = new Set(doc.nodes.map((n) => n.img).filter(Boolean));
  if (doc.title.img) used.add(doc.title.img);
  const have = new Map([...defs.children].map((el) => [el.id.slice(3), el]));
  for (const id of used) {
    if (have.has(id)) continue;
    const meta = store.images.get(id);
    if (!meta) continue;
    const im = document.createElementNS(NS, 'image');
    im.id = 'im-' + id;
    im.setAttribute('href', meta.src);
    im.setAttribute('width', meta.w);
    im.setAttribute('height', meta.h);
    im.setAttribute('preserveAspectRatio', 'none');
    defs.append(im);
  }
  for (const [id, el] of have) if (!used.has(id)) el.remove();
}

// ---------- geometry ----------

const GAP = 10;

/** Endpoints, control point and on-curve handle of an edge. */
export function edgeGeom(doc, e) {
  const A = doc.nodes.find((n) => n.id === e.a), B = doc.nodes.find((n) => n.id === e.b);
  if (!A || !B) return null;
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;
  const H = { x: A.x + dx * e.bend.u + px * e.bend.v * len, y: A.y + dy * e.bend.u + py * e.bend.v * len };
  const toward = (P, r) => {
    const l = Math.hypot(H.x - P.x, H.y - P.y) || 1;
    return { x: P.x + ((H.x - P.x) / l) * r, y: P.y + ((H.y - P.y) / l) * r };
  };
  const Ps = toward(A, nodeRadius(doc, A) + GAP), Pe = toward(B, nodeRadius(doc, B) + GAP);
  const C = { x: 2 * H.x - (Ps.x + Pe.x) / 2, y: 2 * H.y - (Ps.y + Pe.y) / 2 };
  return { A, B, Ps, Pe, C, H, len };
}

/** Bend for a new edge: neighbours arc around the outside; everything else bows toward the centre so it stays clear of the other avatars. */
export function defaultBend(doc, a, b) {
  const g = ringGeometry(doc, doc.nodes.length);
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const mx = (a.x + b.x) / 2 - g.cx, my = (a.y + b.y) / 2 - g.cy;
  const outward = Math.sign((-dy / len) * mx + (dx / len) * my) || 1;
  const jitter = (Math.random() - 0.5) * 0.03;
  // circles that nearly touch leave no room for a line between them, so loop outside
  const room = (len - nodeRadius(doc, a) - nodeRadius(doc, b)) / len;
  if (room < 0.45) return { u: 0.5, v: outward * (0.62 + jitter) };
  const t = clamp(len / (2 * g.r), 0, 1);
  return { u: 0.5 + (Math.random() - 0.5) * 0.06, v: -outward * (0.2 * (1 - t) + 0.05 * t + jitter) };
}

// ---------- scene ----------

const f1 = (v) => Math.round(v * 10) / 10;

function textLines(lines, { x = 0, y, size, lh = 1.2, anchor = 'start', attrs = '' }) {
  return lines
    .map((ln, i) => `<text x="${x}" y="${f1(y + i * size * lh)}" font-size="${size}" text-anchor="${anchor}" ${attrs}>${esc(ln) || ' '}</text>`)
    .join('');
}

function renderEdges(doc) {
  const w0 = doc.style.lineWidth, style = doc.style.stroke;
  let out = '';
  for (const e of doc.edges) {
    const g = edgeGeom(doc, e);
    if (!g) continue;
    const { Ps, Pe, C } = g;
    const width = w0 * (e.width || 1);
    const colors = e.colors.map(legendColor);
    let paths = strokePaths(Ps, C, Pe, { width, colors, seed: e.seed, style });
    if (e.arrow === 'end' || e.arrow === 'both') {
      const t = quadTangent(Ps, C, Pe, 1);
      paths = paths.concat(arrowPaths(Pe, t, { width, color: colors[colors.length - 1], seed: e.seed + 1, style }));
    }
    if (e.arrow === 'start' || e.arrow === 'both') {
      const t = quadTangent(Ps, C, Pe, 0);
      paths = paths.concat(arrowPaths(Ps, { x: -t.x, y: -t.y }, { width, color: colors[0], seed: e.seed + 2, style }));
    }
    const curve = `M${f1(Ps.x)} ${f1(Ps.y)}Q${f1(C.x)} ${f1(C.y)} ${f1(Pe.x)} ${f1(Pe.y)}`;
    let label = '';
    if (e.label) {
      const rev = Pe.x < Ps.x;
      const lp = rev ? `M${f1(Pe.x)} ${f1(Pe.y)}Q${f1(C.x)} ${f1(C.y)} ${f1(Ps.x)} ${f1(Ps.y)}` : curve;
      const fs = Math.round(44 * (e.labelSize || 1));
      label = `<path id="lp-${e.id}" d="${lp}" fill="none" stroke="none"/>
        <text font-size="${fs}" fill="${colors[0]}" font-family='${fontFor(doc.style.labelFont)}' dy="${-(width / 2 + 9)}"><textPath href="#lp-${e.id}" startOffset="50%" text-anchor="middle">${esc(e.label)}</textPath></text>`;
    }
    out += `<g data-kind="edge" data-id="${e.id}">
      ${paths.map((p) => `<path d="${p.d}" fill="${p.color}"${p.opacity < 1 ? ` fill-opacity="${p.opacity}"` : ''}/>`).join('')}
      ${label}
      <path class="ui-only hit" d="${curve}" fill="none" stroke="transparent" stroke-width="${Math.max(22, width * 3)}" stroke-linecap="round"/>
    </g>`;
  }
  layers.edges.innerHTML = out;
}

function renderNodes(doc) {
  let out = '';
  const font = fontFor(doc.style.titleFont);
  for (const n of doc.nodes) {
    const r = nodeRadius(doc, n), d = r * 2;
    const meta = n.img && store.images.get(n.img);
    let img = '';
    if (meta) {
      const { s, W, H } = imageFrame(meta, r, n.zoom || 1);
      const fx = clamp(n.fx, r / W, 1 - r / W), fy = clamp(n.fy, r / H, 1 - r / H);
      img = `<clipPath id="cp-${n.id}"><circle r="${f1(r)}"/></clipPath>
        <g clip-path="url(#cp-${n.id})"><use href="#im-${n.img}" transform="translate(${f1(-fx * W)} ${f1(-fy * H)}) scale(${s.toFixed(5)})"/></g>`;
    } else {
      img = `<text y="${f1(r * 0.18)}" font-size="${f1(r * 0.55)}" text-anchor="middle" fill="#9a9aa5" font-family='${font}'>${esc((n.name || '?').slice(0, 2))}</text>`;
    }
    const name = doc.style.showNames && n.name
      ? `<text y="${f1(r + 34)}" font-size="30" text-anchor="middle" fill="#222" font-family='${font}' font-weight="600">${esc(n.name)}</text>`
      : '';
    out += `<g data-kind="node" data-id="${n.id}" transform="translate(${f1(n.x)} ${f1(n.y)})">
      <circle r="${f1(r)}" fill="#ececf1"/>${img}
      ${doc.style.border ? `<circle r="${f1(r)}" fill="none" stroke="#1d1d1f" stroke-width="${f1(Math.max(2, r * 0.035))}"/>` : ''}
      ${name}
    </g>`;
  }
  layers.nodes.innerHTML = out;
}

function renderTitle(doc) {
  const t = doc.title;
  const font = fontFor(doc.style.titleFont);
  let y = 0, out = '';
  const logo = t.img && store.images.get(t.img);
  if (logo) {
    const s = t.imgW / logo.w;
    out += `<use href="#im-${t.img}" transform="scale(${s.toFixed(5)})"/>`;
    y = logo.h * s + 16;
  }
  const lines = t.text ? t.text.split('\n') : [];
  if (lines.length) {
    out += textLines(lines, { y: y + t.size * 0.85, size: t.size, attrs: `font-weight="800" fill="#111" font-family='${font}' data-part="text"` });
    y += lines.length * t.size * 1.2;
  }
  const sub = t.sub ? t.sub.split('\n') : [];
  if (sub.length) {
    const s = Math.round(t.size * 0.45);
    out += textLines(sub, { y: y + s * 0.9 + 6, size: s, lh: 1.35, attrs: `font-weight="600" fill="#333" font-family='${font}' data-part="sub"` });
  }
  if (!logo && !lines.length && !sub.length) {
    out = `<text class="ui-only" y="${t.size * 0.85}" font-size="${t.size * 0.6}" fill="#b9b9c2" font-family='${font}' font-weight="700">+ 点击添加标题</text>`;
  }
  layers.title.innerHTML = `<g data-kind="title" transform="translate(${f1(t.x)} ${f1(t.y)})">${out}</g>`;
}

function renderLegend(doc) {
  const L = doc.legend;
  if (!L.show) {
    layers.legend.innerHTML = '';
    return;
  }
  const s = L.size, font = fontFor(doc.style.titleFont);
  let out = '';
  L.items.forEach((c, i) => {
    const y = i * s * 1.55 + s * 0.6;
    const pen = store.tool === 'connect' && store.pen === c.id;
    out += `<g data-kind="legend-item" data-id="${c.id}" transform="translate(0 ${f1(y)})">
      ${pen ? `<circle class="ui-only" cx="${s * 0.45}" r="${s * 0.62}" fill="none" stroke="${c.color}" stroke-width="3" stroke-dasharray="6 5"/>` : ''}
      <circle data-part="dot" cx="${s * 0.45}" r="${s * 0.42}" fill="${c.color}"/>
      ${c.label
        ? `<text data-part="label" x="${s * 1.2}" y="${s * 0.36}" font-size="${s}" font-weight="700" fill="#111" font-family='${font}'>${esc(c.label)}</text>`
        : `<text data-part="label" class="ui-only" x="${s * 1.2}" y="${s * 0.36}" font-size="${s * 0.8}" fill="#b9b9c2" font-family='${font}'>点击输入含义</text>`}
    </g>`;
  });
  const ay = L.items.length * s * 1.55 + s * 0.45;
  out += `<g class="ui-only" data-kind="legend-add" transform="translate(0 ${f1(ay)})">
    <rect x="0" y="${-s * 0.5}" width="${s * 4.2}" height="${s}" rx="${s * 0.5}" fill="#f2f2f6"/>
    <text x="${s * 2.1}" y="${s * 0.17}" font-size="${s * 0.5}" text-anchor="middle" fill="#777" font-family='${SANS}'>＋ 添加一项</text></g>`;
  layers.legend.innerHTML = `<g data-kind="legend" transform="translate(${f1(L.x)} ${f1(L.y)})">${out}</g>`;
}

function renderTexts(doc) {
  layers.texts.innerHTML = doc.texts
    .map((t) => {
      const lines = (t.text || '').split('\n');
      const col = t.color?.startsWith('#') ? t.color : legendColor(t.color);
      return `<g data-kind="text" data-id="${t.id}" transform="translate(${f1(t.x)} ${f1(t.y)}) rotate(${t.rot || 0})">
        ${textLines(lines, { y: 0, size: t.size, lh: 1.15, attrs: `fill="${col}" font-family='${fontFor(doc.style.labelFont)}'` })}</g>`;
    })
    .join('');
}

// ---------- editor overlay (never exported) ----------

function outlineFor(el, pad = 10) {
  if (!el) return;
  const b = el.getBBox();
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('class', 'ui-only sel-box');
  r.setAttribute('x', b.x - pad);
  r.setAttribute('y', b.y - pad);
  r.setAttribute('width', b.width + pad * 2);
  r.setAttribute('height', b.height + pad * 2);
  r.setAttribute('rx', 8);
  el.append(r);
}

export const ui = { rubber: null, pendingFrom: null, hoverNode: null };

function renderUI(doc) {
  let out = '';
  const s = store.sel;
  if (!doc.nodes.length) {
    const g = ringGeometry(doc, 16);
    out += `<circle cx="${g.cx}" cy="${g.cy}" r="${g.r}" fill="none" stroke="#d6d6de" stroke-width="4" stroke-dasharray="14 16"/>
      <text x="${g.cx}" y="${g.cy - 10}" font-size="52" text-anchor="middle" fill="#a3a3ad" font-family='${SANS}' font-weight="700">把角色图片拖进来</text>
      <text x="${g.cx}" y="${g.cy + 60}" font-size="34" text-anchor="middle" fill="#b9b9c2" font-family='${SANS}'>或点「添加图片」/「Bangumi 导入」</text>`;
  }
  if (s?.kind === 'node') {
    const n = doc.nodes.find((x) => x.id === s.id);
    if (n) out += `<circle cx="${n.x}" cy="${n.y}" r="${nodeRadius(doc, n) + 9}" fill="none" class="sel-ring"/>`;
  }
  for (const id of [ui.pendingFrom, ui.hoverNode]) {
    const n = id && doc.nodes.find((x) => x.id === id);
    if (n) out += `<circle cx="${n.x}" cy="${n.y}" r="${nodeRadius(doc, n) + 9}" fill="none" stroke="${legendColor(store.pen)}" stroke-width="6" stroke-dasharray="10 8"/>`;
  }
  if (s?.kind === 'edge') {
    const e = doc.edges.find((x) => x.id === s.id);
    const g = e && edgeGeom(doc, e);
    if (g) {
      out += `<path d="M${f1(g.Ps.x)} ${f1(g.Ps.y)}Q${f1(g.C.x)} ${f1(g.C.y)} ${f1(g.Pe.x)} ${f1(g.Pe.y)}" fill="none" class="sel-curve"/>
        <circle data-kind="edge-handle" data-id="${e.id}" cx="${f1(g.H.x)}" cy="${f1(g.H.y)}" r="17" class="handle"/>`;
    }
  }
  if (ui.rubber) {
    const { a, p } = ui.rubber;
    out += `<line x1="${a.x}" y1="${a.y}" x2="${p.x}" y2="${p.y}" stroke="${legendColor(store.pen)}" stroke-width="5" stroke-dasharray="12 10" stroke-linecap="round"/>`;
  }
  layers.ui.innerHTML = out;
}

export function render() {
  const doc = store.doc;
  const { w, h, bg } = doc.canvas;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const bgEl = svg.querySelector('#bg');
  bgEl.setAttribute('width', w);
  bgEl.setAttribute('height', h);
  bgEl.setAttribute('fill', bg);
  syncImageDefs(doc);
  renderEdges(doc);
  renderNodes(doc);
  renderTexts(doc);
  renderTitle(doc);
  renderLegend(doc);
  renderUI(doc);
  const s = store.sel;
  if (s && ['title', 'legend', 'text'].includes(s.kind)) {
    const q = s.kind === 'text' ? `[data-kind="text"][data-id="${s.id}"]` : `[data-kind="${s.kind}"]`;
    outlineFor(svg.querySelector(q));
  }
}
