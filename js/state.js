import { uid, clamp } from './util.js';

// Each preset reserves room for the title and legend outside the ring:
// portrait puts them in a band above it, landscape in a column beside it,
// square tucks them into the top corners of a slightly smaller ring.
export const CANVAS_PRESETS = {
  portrait: { w: 1800, h: 2400, label: '竖版 3:4（推荐）' },
  square: { w: 2000, h: 2000, label: '方形 1:1' },
  landscape: { w: 2400, h: 1800, label: '横版 4:3' },
};

export function presetLayout(preset) {
  const { w, h } = CANVAS_PRESETS[preset];
  if (preset === 'portrait') return { cx: w / 2, cy: h - w / 2 + 6, outer: w / 2 - 36, title: { x: 90, y: 100 }, legend: { x: w - 470, y: 90 } };
  if (preset === 'landscape') return { cx: h / 2 + 20, cy: h / 2, outer: h / 2 - 36, title: { x: h + 120, y: 140 }, legend: { x: h + 120, y: 760 } };
  return { cx: w / 2, cy: h / 2 + 100, outer: w * 0.43, title: { x: 70, y: 70 }, legend: { x: w - 420, y: 60 } };
}

// How many characters one ring holds before shared images get hard to read
// on a phone (see docs/capacity.md for how these were picked).
export const RING_COMFORT_LIMIT = 36; // still clear without zooming
export const RING_SOFT_LIMIT = 48; // readable only when zoomed in
export const RING_HARD_LIMIT = 60;

export function defaultLegend() {
  return [
    { id: uid('c'), color: '#e0312b', label: '锁死' },
    { id: uid('c'), color: '#f59a1b', label: '喜欢' },
    { id: uid('c'), color: '#25a7e8', label: '友情' },
    { id: uid('c'), color: '#2fb84a', label: '亲情' },
    { id: uid('c'), color: '#1a1a1a', label: '雷' },
  ];
}

export function newDoc(preset = 'portrait') {
  const { w, h } = CANVAS_PRESETS[preset];
  const L = presetLayout(preset);
  return {
    version: 1,
    canvas: { preset, w, h, bg: '#ffffff' },
    style: { stroke: 'brush', lineWidth: 9, labelFont: 'hand', titleFont: 'sans', showNames: false, border: false },
    ring: { size: 0 }, // 0 = auto avatar size
    title: { x: L.title.x, y: L.title.y, text: '', sub: '', size: 88, img: null, imgW: 520 },
    legend: { x: L.legend.x, y: L.legend.y, size: 46, show: true, items: defaultLegend() },
    nodes: [],
    edges: [],
    texts: [],
  };
}

// ---------- ring geometry ----------

/** Ring centre, radius and avatar diameter for `n` characters on this canvas. */
export function ringGeometry(doc, n) {
  const { cx, cy, outer } = presetLayout(doc.canvas.preset);
  const maxD = 230, minD = 40;
  let d = doc.ring.size || maxD;
  let r = outer - d / 2;
  if (!doc.ring.size) {
    // largest avatar that still leaves a small gap between neighbours
    for (let i = 0; i < 6; i++) {
      d = clamp((0.9 * 2 * Math.PI * r) / Math.max(n, 3), minD, maxD);
      r = outer - d / 2;
    }
  }
  return { cx, cy, r, d };
}

// Every character sits on the ring; the list order is the order around it.
export function layoutRing(doc) {
  const nodes = doc.nodes;
  const g = ringGeometry(doc, nodes.length);
  nodes.forEach((nd, i) => {
    const a = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2;
    nd.x = g.cx + g.r * Math.cos(a);
    nd.y = g.cy + g.r * Math.sin(a);
  });
  return g;
}

export function nodeRadius(doc) {
  return ringGeometry(doc, doc.nodes.length).d / 2;
}

// ---------- picture framing inside an avatar ----------
// A node's picture covers its circle at zoom 1; (fx, fy) is the point of the
// picture, as a fraction of its size, that sits at the circle's centre.

export const MAX_ZOOM = 5;

export function imageFrame(meta, r, zoom = 1) {
  const s = (2 * r * zoom) / Math.min(meta.w, meta.h);
  return { s, W: meta.w * s, H: meta.h * s };
}

/** Keep the focus where the picture still fills the whole circle. */
export function clampFocus(n, meta) {
  n.zoom = clamp(n.zoom || 1, 1, MAX_ZOOM);
  const k = Math.min(meta.w, meta.h) / (2 * n.zoom);
  n.fx = clamp(n.fx, k / meta.w, 1 - k / meta.w);
  n.fy = clamp(n.fy, k / meta.h, 1 - k / meta.h);
}

/** Starting focus for a new picture: tall character art is framed near the top, where the face usually is. */
export function defaultFocus(meta) {
  return meta && meta.h > meta.w * 1.2 ? { fx: 0.5, fy: 0.18 } : { fx: 0.5, fy: 0.5 };
}

// ---------- store ----------

const listeners = new Set();
export const store = {
  doc: newDoc(),
  images: new Map(), // id -> { src, w, h }
  sel: null, // { kind, id }
  tool: 'select', // select | connect | text
  pen: null, // legend item id used for new lines
  multiColor: false,
  zoom: 0, // 0 = fit
};
store.pen = store.doc.legend.items[0].id;

let raf = 0;
export function emit() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    listeners.forEach((fn) => fn());
  });
}
export const subscribe = (fn) => listeners.add(fn);

// ---------- undo history ----------
// Snapshots hold the doc only; image data lives in store.images and is never
// mutated, so undoing a delete still finds its picture.

const undoStack = [], redoStack = [];
let pending = null;

export function begin() {
  if (pending == null) pending = JSON.stringify(store.doc);
}
export function commit() {
  if (pending == null) return;
  const now = JSON.stringify(store.doc);
  if (now !== pending) {
    undoStack.push(pending);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }
  pending = null;
  emit();
  onChange();
}
/** Apply one undoable change. */
export function change(fn) {
  begin();
  fn(store.doc);
  layoutRing(store.doc);
  commit();
}

function restore(json) {
  store.doc = JSON.parse(json);
  if (store.sel && !findSel(store.sel)) store.sel = null;
  if (!store.doc.legend.items.some((c) => c.id === store.pen)) store.pen = store.doc.legend.items[0]?.id;
  layoutRing(store.doc);
  emit();
  onChange();
}
export function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(store.doc));
  restore(undoStack.pop());
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(store.doc));
  restore(redoStack.pop());
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function replaceDoc(doc, images) {
  store.doc = doc;
  if (images) store.images = images;
  store.sel = null;
  undoStack.length = redoStack.length = 0;
  store.pen = doc.legend.items[0]?.id;
  layoutRing(doc);
  emit();
  onChange();
}

let changeHandler = () => {};
export const onDocChange = (fn) => (changeHandler = fn);
const onChange = () => changeHandler();

// ---------- lookups ----------

export function findSel(sel) {
  const d = store.doc;
  if (!sel) return null;
  switch (sel.kind) {
    case 'node': return d.nodes.find((n) => n.id === sel.id);
    case 'edge': return d.edges.find((e) => e.id === sel.id);
    case 'text': return d.texts.find((t) => t.id === sel.id);
    case 'title': return d.title;
    case 'legend': return d.legend;
  }
  return null;
}

export const legendColor = (id) => store.doc.legend.items.find((c) => c.id === id)?.color || '#888';

export function select(sel) {
  store.sel = sel;
  emit();
}

// ---------- mutations used from several places ----------

export function addNodes(list) {
  const room = RING_HARD_LIMIT - store.doc.nodes.length;
  const take = list.slice(0, Math.max(0, room));
  change((d) => {
    for (const it of take) {
      const meta = it.img && store.images.get(it.img);
      const n = { id: uid('n'), name: it.name || '', img: it.img || null, ...defaultFocus(meta), zoom: 1, x: 0, y: 0 };
      if (it.fy != null) Object.assign(n, { fx: it.fx, fy: it.fy });
      if (meta) clampFocus(n, meta);
      d.nodes.push(n);
    }
  });
  return take.length;
}

export function deleteSelection() {
  const s = store.sel;
  if (!s) return;
  change((d) => {
    if (s.kind === 'node') {
      d.nodes = d.nodes.filter((n) => n.id !== s.id);
      d.edges = d.edges.filter((e) => e.a !== s.id && e.b !== s.id);
    } else if (s.kind === 'edge') d.edges = d.edges.filter((e) => e.id !== s.id);
    else if (s.kind === 'text') d.texts = d.texts.filter((t) => t.id !== s.id);
    else if (s.kind === 'title') Object.assign(d.title, { text: '', sub: '', img: null });
    else if (s.kind === 'legend') d.legend.show = false;
  });
  store.sel = null;
  emit();
}

export function removeLegendItem(id) {
  change((d) => {
    if (d.legend.items.length <= 1) return;
    d.legend.items = d.legend.items.filter((c) => c.id !== id);
    const fallback = d.legend.items[0].id;
    for (const e of d.edges) {
      e.colors = e.colors.filter((c) => c !== id);
      if (!e.colors.length) e.colors = [fallback];
    }
    for (const t of d.texts) if (t.color === id) t.color = fallback;
  });
  if (store.pen === id) store.pen = store.doc.legend.items[0].id;
}

export function addLegendItem() {
  const palette = ['#9b5de5', '#f15bb5', '#00bbf9', '#00a878', '#8d6e63', '#ff7043', '#5c6bc0'];
  const used = new Set(store.doc.legend.items.map((c) => c.color));
  const color = palette.find((c) => !used.has(c)) || '#777777';
  const item = { id: uid('c'), color, label: '' };
  change((d) => d.legend.items.push(item));
  return item;
}
