import { store, emit, begin, commit, change, select, legendColor, nodeRadius, layoutRing } from './state.js';
import { edgeGeom, defaultBend, ui } from './render.js';
import { uid, clamp } from './util.js';

let svg, wrap, colorInput;
const DRAG_PX = 4;

export function svgPoint(evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function targetOf(evt) {
  // during a drag the scene is re-rendered under the pointer, so resolve by position
  const el = document.elementFromPoint(evt.clientX, evt.clientY);
  const hit = el?.closest?.('[data-kind]');
  if (!hit || !svg.contains(hit)) return null;
  return { kind: hit.dataset.kind, id: hit.dataset.id, part: el.closest('[data-part]')?.dataset.part, el: hit };
}

const nodeAt = (evt) => {
  const t = targetOf(evt);
  return t?.kind === 'node' ? t.id : null;
};

export function setupInteraction(svgEl, wrapEl) {
  svg = svgEl;
  wrap = wrapEl;
  colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'hidden-color';
  wrap.append(colorInput);

  let st = null; // pointer session
  let lastClick = { t: 0, key: '' };

  svg.addEventListener('pointerdown', (evt) => {
    if (evt.button !== 0 || editor) {
      if (editor) finishEdit(true);
      if (evt.button !== 0) return;
    }
    // the canvas never takes focus, so release any panel field explicitly (commits its edit)
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const t = targetOf(evt);
    const p = svgPoint(evt);
    st = { t, start: p, last: p, cx: evt.clientX, cy: evt.clientY, dragging: false };
    svg.setPointerCapture(evt.pointerId);
    evt.preventDefault();
  });

  svg.addEventListener('pointermove', (evt) => {
    if (!st) {
      if (store.tool === 'connect' && ui.pendingFrom) {
        const p = svgPoint(evt);
        const a = store.doc.nodes.find((n) => n.id === ui.pendingFrom);
        ui.rubber = a ? { a, p } : null;
        const over = nodeAt(evt);
        ui.hoverNode = over && over !== ui.pendingFrom ? over : null;
        emit();
      }
      return;
    }
    const p = svgPoint(evt);
    if (!st.dragging) {
      if (Math.hypot(evt.clientX - st.cx, evt.clientY - st.cy) < DRAG_PX) return;
      st.dragging = startDrag(st);
      if (!st.dragging) return;
    }
    st.dragging.move(p, evt);
    st.last = p;
    emit();
  });

  const end = (evt) => {
    if (!st) return;
    const s = st;
    st = null;
    if (s.dragging) {
      s.dragging.end?.(evt);
      commit();
      return;
    }
    // a click
    const key = s.t ? `${s.t.kind}:${s.t.id}:${s.t.part}` : 'bg';
    const now = performance.now();
    const dbl = now - lastClick.t < 380 && lastClick.key === key;
    lastClick = { t: now, key };
    onClick(s.t, s.start, dbl, evt);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', () => {
    if (st?.dragging) commit();
    st = null;
  });
}

function startDrag(st) {
  const t = st.t, doc = store.doc;
  if (store.tool === 'connect' && t?.kind === 'node') {
    const a = doc.nodes.find((n) => n.id === t.id);
    ui.pendingFrom = t.id;
    return {
      move(p, evt) {
        ui.rubber = { a, p };
        const over = nodeAt(evt);
        ui.hoverNode = over && over !== a.id ? over : null;
      },
      end(evt) {
        const over = nodeAt(evt);
        clearRubber();
        if (over && over !== a.id) createEdge(a.id, over);
      },
    };
  }
  if (!t) return null;
  begin();
  const dx = (obj) => st.start.x - obj.x, dy = (obj) => st.start.y - obj.y;
  switch (t.kind) {
    case 'node': {
      const n = doc.nodes.find((x) => x.id === t.id);
      const ox = dx(n), oy = dy(n);
      select({ kind: 'node', id: n.id });
      return {
        move(p) {
          n.pinned = true;
          n.x = p.x - ox;
          n.y = p.y - oy;
        },
        end() {
          layoutRing(store.doc);
        },
      };
    }
    case 'edge-handle':
    case 'edge': {
      const e = doc.edges.find((x) => x.id === t.id);
      select({ kind: 'edge', id: e.id });
      return {
        move(p) {
          const g = edgeGeom(doc, e);
          const ddx = g.B.x - g.A.x, ddy = g.B.y - g.A.y, len2 = ddx * ddx + ddy * ddy || 1, len = Math.sqrt(len2);
          const rx = p.x - g.A.x, ry = p.y - g.A.y;
          e.bend = { u: clamp((rx * ddx + ry * ddy) / len2, 0.1, 0.9), v: clamp((rx * -ddy + ry * ddx) / len2, -1.2, 1.2) };
        },
      };
    }
    case 'title':
    case 'legend':
    case 'legend-item':
    case 'legend-add': {
      const obj = t.kind === 'title' ? doc.title : doc.legend;
      const ox = dx(obj), oy = dy(obj);
      select({ kind: t.kind === 'title' ? 'title' : 'legend' });
      return {
        move(p) {
          obj.x = p.x - ox;
          obj.y = p.y - oy;
        },
      };
    }
    case 'text': {
      const tx = doc.texts.find((x) => x.id === t.id);
      const ox = dx(tx), oy = dy(tx);
      select({ kind: 'text', id: tx.id });
      return {
        move(p) {
          tx.x = p.x - ox;
          tx.y = p.y - oy;
        },
      };
    }
  }
  commit();
  return null;
}

function clearRubber() {
  ui.rubber = null;
  ui.pendingFrom = null;
  ui.hoverNode = null;
  emit();
}

export function createEdge(a, b) {
  const doc = store.doc;
  const A = doc.nodes.find((n) => n.id === a), B = doc.nodes.find((n) => n.id === b);
  const e = { id: uid('e'), a, b, colors: [store.pen], label: '', arrow: 'none', width: 1, bend: defaultBend(doc, A, B), seed: (Math.random() * 1e9) | 0 };
  change((d) => d.edges.push(e));
  select({ kind: 'edge', id: e.id });
}

function onClick(t, p, dbl, evt) {
  const doc = store.doc;
  if (store.tool === 'connect') {
    if (t?.kind === 'node') {
      if (!ui.pendingFrom) {
        ui.pendingFrom = t.id;
        emit();
      } else if (ui.pendingFrom !== t.id) {
        const from = ui.pendingFrom;
        clearRubber();
        createEdge(from, t.id);
      } else clearRubber();
      return;
    }
    if (ui.pendingFrom) {
      clearRubber();
      return;
    }
  }
  if (store.tool === 'text' && (!t || t.kind === 'node' || t.kind === 'edge')) {
    const tx = { id: uid('t'), x: p.x, y: p.y, text: '', size: 40, rot: 0, color: store.pen };
    doc.texts.push(tx); // committed when editing finishes
    select({ kind: 'text', id: tx.id });
    store.tool = 'select';
    document.dispatchEvent(new CustomEvent('toolchange'));
    requestAnimationFrame(() => editText(tx, true));
    return;
  }
  if (!t) return select(null);
  switch (t.kind) {
    case 'node':
      select({ kind: 'node', id: t.id });
      break;
    case 'edge':
    case 'edge-handle': {
      const e = doc.edges.find((x) => x.id === t.id);
      if (t.kind === 'edge-handle' && dbl) {
        change(() => (e.bend = defaultBend(doc, doc.nodes.find((n) => n.id === e.a), doc.nodes.find((n) => n.id === e.b))));
        return;
      }
      select({ kind: 'edge', id: t.id });
      if (dbl) requestAnimationFrame(() => editEdgeLabel(e));
      break;
    }
    case 'legend-item': {
      const item = doc.legend.items.find((c) => c.id === t.id);
      select({ kind: 'legend' });
      if (t.part === 'dot') pickColor(item.color, (c) => change(() => (item.color = c)));
      else requestAnimationFrame(() => editLegendLabel(item));
      break;
    }
    case 'legend-add':
      select({ kind: 'legend' });
      document.dispatchEvent(new CustomEvent('legend-add'));
      break;
    case 'legend':
      select({ kind: 'legend' });
      break;
    case 'title':
      select({ kind: 'title' });
      requestAnimationFrame(() => editTitle(t.part === 'sub' ? 'sub' : 'text'));
      break;
    case 'text': {
      const tx = doc.texts.find((x) => x.id === t.id);
      select({ kind: 'text', id: t.id });
      requestAnimationFrame(() => editText(tx));
      break;
    }
  }
}

export function pickColor(value, onPick) {
  colorInput.value = value;
  const handler = () => onPick(colorInput.value);
  colorInput.oninput = null;
  colorInput.onchange = handler;
  colorInput.click();
}

// ---------- inline text editing ----------

let editor = null;

function openEditor({ anchor, value, fontSize, multiline, placeholder, color, onCommit, onCancel, align = 'left' }) {
  finishEdit(true);
  const wr = wrap.getBoundingClientRect();
  const scale = svg.getScreenCTM().a;
  const el = document.createElement(multiline ? 'textarea' : 'input');
  el.className = 'inline-editor';
  el.value = value;
  el.placeholder = placeholder || '';
  const fs = Math.max(13, fontSize * scale);
  Object.assign(el.style, {
    left: anchor.x - wr.left + wrap.scrollLeft + 'px',
    top: anchor.y - wr.top + wrap.scrollTop + 'px',
    fontSize: fs + 'px',
    minWidth: Math.max(140, anchor.w || 0) + 'px',
    color: color || '#111',
    textAlign: align,
  });
  if (align === 'center') el.style.transform = 'translateX(-50%)';
  if (multiline) el.rows = Math.max(1, value.split('\n').length);
  wrap.append(el);
  el.focus();
  el.select();
  editor = { el, onCommit, onCancel };
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') finishEdit(false);
    else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      finishEdit(true);
    }
  });
  el.addEventListener('input', () => {
    if (multiline) el.rows = Math.max(1, el.value.split('\n').length);
  });
  el.addEventListener('blur', () => setTimeout(() => editor?.el === el && finishEdit(true), 0));
}

export function finishEdit(save) {
  if (!editor) return;
  const { el, onCommit, onCancel } = editor;
  editor = null;
  el.remove();
  if (save) onCommit(el.value);
  else onCancel?.();
}

const rectOf = (sel) => svg.querySelector(sel)?.getBoundingClientRect();

export function editLegendLabel(item) {
  const r = rectOf(`[data-kind="legend-item"][data-id="${item.id}"] [data-part="label"]`);
  if (!r) return;
  openEditor({
    anchor: { x: r.left - 6, y: r.top - 4, w: r.width + 40 },
    value: item.label,
    fontSize: store.doc.legend.size,
    placeholder: '比如：锁死 / OTP / 可以吃',
    onCommit: (v) => change(() => (item.label = v.trim())),
  });
}

export function editTitle(part = 'text') {
  const t = store.doc.title;
  const grp = svg.querySelector('[data-kind="title"]');
  const target = grp?.querySelector(`[data-part="${part}"]`) || grp;
  const r = target.getBoundingClientRect();
  openEditor({
    anchor: { x: r.left - 6, y: r.top - 4, w: Math.max(r.width, 320) },
    value: part === 'sub' ? t.sub : t.text,
    fontSize: part === 'sub' ? t.size * 0.45 : t.size * 0.8,
    multiline: true,
    placeholder: part === 'sub' ? '副标题（可多行）' : '标题，例如作品名',
    onCommit: (v) => change(() => (t[part] = v.replace(/\s+$/, ''))),
  });
}

function editText(tx, isNew = false) {
  const r = rectOf(`[data-kind="text"][data-id="${tx.id}"]`) || { left: 0, top: 0, width: 0 };
  const p = svg.getScreenCTM();
  const left = r.width ? r.left : p.e + tx.x * p.a;
  const top = r.width ? r.top : p.f + (tx.y - tx.size) * p.d;
  const col = tx.color?.startsWith('#') ? tx.color : legendColor(tx.color);
  openEditor({
    anchor: { x: left - 6, y: top - 4, w: r.width + 40 },
    value: tx.text,
    fontSize: tx.size,
    multiline: true,
    color: col,
    placeholder: '输入文字…',
    onCommit: (v) => {
      const val = v.replace(/\s+$/, '');
      if (isNew) {
        // the text was pushed without an undo step; record its creation now
        store.doc.texts = store.doc.texts.filter((x) => x !== tx);
        if (val) change((d) => d.texts.push({ ...tx, text: val }));
        else select(null);
      } else if (!val) {
        change((d) => (d.texts = d.texts.filter((x) => x.id !== tx.id)));
        select(null);
      } else change(() => (tx.text = val));
    },
    onCancel: () => {
      if (isNew) {
        store.doc.texts = store.doc.texts.filter((x) => x !== tx);
        select(null);
      }
    },
  });
}

export function editEdgeLabel(e) {
  const g = edgeGeom(store.doc, e);
  if (!g) return;
  const m = svg.getScreenCTM();
  openEditor({
    anchor: { x: m.e + g.H.x * m.a, y: m.f + g.H.y * m.d - 30 * m.a - 20, w: 200 },
    value: e.label || '',
    fontSize: 44 * (e.labelSize || 1),
    placeholder: '线上的字，比如：one sided',
    align: 'center',
    color: legendColor(e.colors[0]),
    onCommit: (v) => change(() => (e.label = v.trim())),
  });
}

export const isEditing = () => !!editor;
export { nodeRadius };
