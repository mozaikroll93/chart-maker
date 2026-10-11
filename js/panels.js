import { h, $, clamp, toast } from './util.js';
import {
  store, emit, begin, commit, change, select, findSel, layoutRing, legendColor, ringGeometry,
  removeLegendItem, addLegendItem, CANVAS_PRESETS, presetLayout, RING_COMFORT_LIMIT, RING_SOFT_LIMIT, RING_HARD_LIMIT, canUndo, canRedo,
} from './state.js';
import { defaultBend } from './render.js';
import { pickColor, editEdgeLabel, editTitle, finishEdit } from './interact.js';
import { addImageBlob } from './images.js';

// ---------- small form helpers ----------

/** Live slider: mutates during drag, one undo step per gesture. */
function slider(label, { min, max, step = 1, get, set, fmt = (v) => v }) {
  const val = h('span', { class: 'val' }, fmt(get()));
  const input = h('input', { type: 'range', min, max, step, value: get() });
  input.addEventListener('input', () => {
    begin();
    set(Number(input.value));
    layoutRing(store.doc);
    val.textContent = fmt(Number(input.value));
    emit();
  });
  input.addEventListener('change', commit);
  return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label, val), input);
}

function segmented(label, options, current, onPick) {
  return h('div', { class: 'field' },
    label && h('span', { class: 'lbl' }, label),
    h('div', { class: 'seg', role: 'group' },
      options.map(([v, text, title]) =>
        h('button', { type: 'button', class: v === current ? 'on' : '', title: title || text, onclick: () => onPick(v) }, text))));
}

function check(label, get, set) {
  const input = h('input', { type: 'checkbox', checked: get() });
  input.addEventListener('change', () => change(() => set(input.checked)));
  return h('label', { class: 'check' }, input, label);
}

function textField(label, { get, set, multiline, placeholder }) {
  const input = h(multiline ? 'textarea' : 'input', { value: get() || '', placeholder: placeholder || '', rows: multiline ? 2 : undefined });
  input.value = get() || '';
  input.addEventListener('input', () => {
    begin();
    set(input.value);
    emit();
  });
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => e.stopPropagation());
  return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input);
}

function pickFile(accept, multiple, cb) {
  const inp = h('input', { type: 'file', accept, multiple });
  inp.onchange = () => cb([...inp.files]);
  inp.click();
}

// ---------- capacity ----------

/** How large one avatar ends up when the image is viewed full-width on a phone (~390 CSS px). */
export function capacityInfo(doc) {
  const n = doc.nodes.length;
  const g = ringGeometry(doc, Math.max(doc.nodes.filter((x) => !x.pinned).length, 1));
  const phone = Math.round((g.d / doc.canvas.w) * 390);
  const level = n > RING_SOFT_LIMIT ? 'bad' : n > RING_COMFORT_LIMIT ? 'warn' : 'ok';
  return { n, d: Math.round(g.d), phone, level };
}

// ---------- left: characters ----------

export function renderSidebar(root, { onAddFiles, onBangumi }) {
  const doc = store.doc;
  const cap = capacityInfo(doc);
  root.replaceChildren(...[
    h('div', { class: 'panel-head' },
      h('h2', {}, '角色 ', h('span', { class: 'muted' }, `${doc.nodes.length}`)),
      h('span', { class: `cap ${cap.level}`, title: '手机上全屏查看时一个头像的直径' }, doc.nodes.length ? `手机上约 ${cap.phone}px` : '')),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => pickFile('image/*', true, onAddFiles) }, '＋ 添加图片'),
      h('button', { type: 'button', class: 'btn', onclick: onBangumi }, 'Bangumi 导入')),
    cap.level === 'warn' ? h('p', { class: 'hint warn' }, `超过 ${RING_COMFORT_LIMIT} 个角色：发到社交平台后，手机上要放大才看得清头像。`) : null,
    cap.level === 'bad' ? h('p', { class: 'hint bad' }, `超过 ${RING_SOFT_LIMIT} 个角色：图片被平台压缩后头像会糊，建议精简或拆成两张。`) : null,
    h('ol', { class: 'char-list' }, doc.nodes.map((n, i) => charRow(n, i))),
    !doc.nodes.length ? h('p', { class: 'hint' }, '也可以把图片直接拖到画布上，或者复制图片后按 Ctrl/⌘+V 粘贴。') : null,
    doc.nodes.length ? h('p', { class: 'hint' }, `拖动列表可以调整在圆上的顺序。最多 ${RING_HARD_LIMIT} 个。`) : null,
  ].filter(Boolean));
}

let dragFrom = null;
function charRow(n, i) {
  const meta = n.img && store.images.get(n.img);
  const sel = store.sel?.kind === 'node' && store.sel.id === n.id;
  const name = h('input', { class: 'nm', value: n.name, placeholder: '未命名', 'aria-label': '角色名' });
  name.value = n.name;
  name.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') name.blur();
  });
  name.addEventListener('change', () => change(() => (n.name = name.value.trim())));
  name.addEventListener('focus', () => select({ kind: 'node', id: n.id }));
  const li = h('li', { class: 'char' + (sel ? ' on' : '') + (n.pinned ? ' pinned' : ''), draggable: true, 'data-i': i },
    h('span', { class: 'grip', 'aria-hidden': true }, '⋮⋮'),
    meta ? h('img', { src: meta.src, alt: '' }) : h('span', { class: 'noimg' }),
    name,
    n.pinned ? h('span', { class: 'tag', title: '已从圆环上移开' }, '自由') : null,
    h('button', { type: 'button', class: 'icon-btn small', 'aria-label': '删除', onclick: (e) => {
      e.stopPropagation();
      select({ kind: 'node', id: n.id });
      document.dispatchEvent(new CustomEvent('delete-selection'));
    } }, '✕'));
  li.addEventListener('click', (e) => e.target !== name && select({ kind: 'node', id: n.id }));
  li.addEventListener('dragstart', (e) => {
    dragFrom = i;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-char', String(i));
  });
  li.addEventListener('dragover', (e) => {
    if (dragFrom == null) return;
    e.preventDefault();
    li.classList.add('drop');
  });
  li.addEventListener('dragleave', () => li.classList.remove('drop'));
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    li.classList.remove('drop');
    const from = dragFrom;
    dragFrom = null;
    if (from == null || from === i) return;
    change((d) => {
      const [m] = d.nodes.splice(from, 1);
      d.nodes.splice(i, 0, m);
    });
  });
  li.addEventListener('dragend', () => (dragFrom = null));
  return li;
}

// ---------- right: inspector ----------

export function renderInspector(root) {
  const s = store.sel, obj = findSel(s);
  let body;
  if (!obj) body = docPanel();
  else if (s.kind === 'node') body = nodePanel(obj);
  else if (s.kind === 'edge') body = edgePanel(obj);
  else if (s.kind === 'text') body = textPanel(obj);
  else if (s.kind === 'title') body = titlePanel(obj);
  else if (s.kind === 'legend') body = legendPanel(obj);
  root.replaceChildren(...[].concat(body).filter(Boolean));
}

function head(title, back = true) {
  return h('div', { class: 'panel-head' },
    h('h2', {}, title),
    back ? h('button', { type: 'button', class: 'link', onclick: () => select(null) }, '完成') : null);
}

function docPanel() {
  const d = store.doc, st = d.style;
  const cap = capacityInfo(d);
  return [
    head('画布', false),
    segmented('线条风格', [['brush', '笔刷'], ['sketch', '铅笔'], ['clean', '干净']], st.stroke, (v) => change(() => (st.stroke = v))),
    slider('线条粗细', { min: 2, max: 16, get: () => st.lineWidth, set: (v) => (st.lineWidth = v) }),
    segmented('线上文字', [['hand', '手写体'], ['sans', '黑体']], st.labelFont, (v) => change(() => (st.labelFont = v))),
    segmented('标题和图例', [['sans', '黑体'], ['hand', '手写体']], st.titleFont, (v) => change(() => (st.titleFont = v))),
    h('div', { class: 'field' },
      h('span', { class: 'lbl' }, '头像大小', h('span', { class: 'val' }, d.ring.size ? '' : `自动 · ${cap.d}px`)),
      h('div', { class: 'inline' },
        check('自动', () => !d.ring.size, (v) => (d.ring.size = v ? 0 : cap.d)),
        d.ring.size
          ? (() => {
              const inp = h('input', { type: 'range', min: 40, max: 260, value: d.ring.size });
              inp.addEventListener('input', () => {
                begin();
                d.ring.size = Number(inp.value);
                layoutRing(d);
                emit();
              });
              inp.addEventListener('change', commit);
              return inp;
            })()
          : null)),
    check('显示角色名', () => st.showNames, (v) => (st.showNames = v)),
    check('头像描边', () => st.border, (v) => (st.border = v)),
    h('div', { class: 'field' },
      h('span', { class: 'lbl' }, '画布尺寸'),
      h('div', { class: 'inline' },
        (() => {
          const sel = h('select', {}, Object.entries(CANVAS_PRESETS).map(([k, p]) => h('option', { value: k }, `${p.label}`)));
          sel.value = d.canvas.preset;
          sel.onchange = () => change((doc) => {
            const p = CANVAS_PRESETS[sel.value], L = presetLayout(sel.value);
            const kx = p.w / doc.canvas.w, ky = p.h / doc.canvas.h;
            Object.assign(doc.canvas, { preset: sel.value, w: p.w, h: p.h });
            Object.assign(doc.title, L.title);
            Object.assign(doc.legend, L.legend);
            for (const o of [...doc.texts, ...doc.nodes.filter((n) => n.pinned)]) {
              o.x *= kx;
              o.y *= ky;
            }
          });
          return sel;
        })(),
        colorSwatch(d.canvas.bg, (c) => change(() => (d.canvas.bg = c)), '背景色'))),
    h('button', { type: 'button', class: 'btn block', disabled: !d.nodes.some((n) => n.pinned), onclick: () => change((doc) => doc.nodes.forEach((n) => (n.pinned = false))) }, '把所有角色放回圆环'),
    h('div', { class: 'tips' },
      h('h3', {}, '怎么用'),
      h('ul', {},
        h('li', {}, '点图例里的文字就能改，点色块换颜色。'),
        h('li', {}, '选「连线」或按 L，从一个头像拖到另一个头像。'),
        h('li', {}, '点中一条线后，拖中间的圆点调弧度，双击写字。'),
        h('li', {}, '把头像拖离圆环就能自由摆放。'))),
  ];
}

function colorSwatch(value, onPick, title) {
  return h('button', { type: 'button', class: 'swatch', title, style: { background: value }, onclick: () => pickColor(value, onPick) });
}

function nodePanel(n) {
  return [
    head('角色'),
    cropper(n),
    textField('名字', { get: () => n.name, set: (v) => (n.name = v), placeholder: '可选；勾选「显示角色名」才会出现在图上' }),
    slider('头像缩放', { min: 1, max: 4, step: 0.05, get: () => n.zoom || 1, set: (v) => (n.zoom = v), fmt: (v) => v.toFixed(2) + '×' }),
    slider('大小', { min: 0.5, max: 2.2, step: 0.05, get: () => n.scale || 1, set: (v) => (n.scale = v), fmt: (v) => Math.round(v * 100) + '%' }),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => pickFile('image/*', false, async ([f]) => {
        if (!f) return;
        const id = await addImageBlob(f);
        change(() => Object.assign(n, { img: id, fx: 0.5, fy: 0.5, zoom: 1 }));
      }) }, '更换图片'),
      n.pinned ? h('button', { type: 'button', class: 'btn', onclick: () => change(() => (n.pinned = false)) }, '放回圆环') : null),
    h('button', { type: 'button', class: 'btn danger block', onclick: () => document.dispatchEvent(new CustomEvent('delete-selection')) }, '删除角色'),
    h('p', { class: 'hint' }, '连线：按 L 切到连线工具，从这个头像拖到另一个头像。'),
  ];
}

/** Circle preview you drag to reframe the picture. */
function cropper(n) {
  const meta = n.img && store.images.get(n.img);
  if (!meta) return h('div', { class: 'cropper empty' }, '没有图片');
  const size = 168;
  const img = h('img', { src: meta.src, alt: '', draggable: false });
  const box = h('div', { class: 'cropper', title: '拖动调整构图，滚轮缩放' }, img);
  const place = () => {
    const s = (size * (n.zoom || 1)) / Math.min(meta.w, meta.h);
    const W = meta.w * s, H = meta.h * s, r = size / 2;
    const fx = clamp(n.fx, r / W, 1 - r / W), fy = clamp(n.fy, r / H, 1 - r / H);
    Object.assign(img.style, { width: W + 'px', height: H + 'px', left: r - fx * W + 'px', top: r - fy * H + 'px' });
    return { W, H, r };
  };
  place();
  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    box.setPointerCapture(e.pointerId);
    const { W, H, r } = place();
    drag = { x: e.clientX, y: e.clientY, fx: clamp(n.fx, r / W, 1 - r / W), fy: clamp(n.fy, r / H, 1 - r / H), W, H };
    begin();
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    n.fx = drag.fx - (e.clientX - drag.x) / drag.W;
    n.fy = drag.fy - (e.clientY - drag.y) / drag.H;
    const { W, H, r } = place();
    n.fx = clamp(n.fx, r / W, 1 - r / W);
    n.fy = clamp(n.fy, r / H, 1 - r / H);
    emit();
  });
  const up = () => {
    if (drag) commit();
    drag = null;
  };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
  box.addEventListener('wheel', (e) => {
    e.preventDefault();
    begin();
    n.zoom = clamp((n.zoom || 1) * (e.deltaY < 0 ? 1.08 : 1 / 1.08), 1, 4);
    place();
    emit();
    clearTimeout(box._t);
    box._t = setTimeout(commit, 300);
  }, { passive: false });
  return box;
}

function legendChips(selected, onPick, { multi } = {}) {
  return h('div', { class: 'chips' },
    store.doc.legend.items.map((c) => {
      const idx = selected.indexOf(c.id);
      return h('button', { type: 'button', class: 'chip' + (idx >= 0 ? ' on' : ''), onclick: (e) => onPick(c.id, e) },
        h('i', { style: { background: c.color } }),
        c.label || '（未命名）',
        multi && idx >= 0 && selected.length > 1 ? h('sup', {}, idx + 1) : null);
    }));
}

function edgePanel(e) {
  const d = store.doc;
  const A = d.nodes.find((n) => n.id === e.a), B = d.nodes.find((n) => n.id === e.b);
  const nm = (n) => n?.name || '这个角色';
  return [
    head('连线'),
    h('p', { class: 'muted small' }, `${nm(A)} — ${nm(B)}`),
    h('div', { class: 'field' },
      h('span', { class: 'lbl' }, '颜色', h('span', { class: 'val' }, store.multiColor ? '依次点选，组成分段线' : '')),
      legendChips(e.colors, (id) => change(() => {
        if (!store.multiColor) e.colors = [id];
        else if (e.colors.includes(id)) e.colors = e.colors.length > 1 ? e.colors.filter((c) => c !== id) : e.colors;
        else e.colors = [...e.colors, id];
      }), { multi: store.multiColor }),
      (() => {
        const input = h('input', { type: 'checkbox', checked: store.multiColor });
        input.onchange = () => {
          store.multiColor = input.checked;
          emit();
        };
        return h('label', { class: 'check' }, input, '一条线用多种颜色（分段）');
      })()),
    textField('线上的字', { get: () => e.label, set: (v) => (e.label = v), placeholder: '比如：one sided、前任' }),
    e.label ? slider('字号', { min: 0.5, max: 2.5, step: 0.05, get: () => e.labelSize || 1, set: (v) => (e.labelSize = v), fmt: (v) => Math.round(v * 100) + '%' }) : null,
    segmented('箭头', [['none', '无'], ['end', `→`, `指向 ${nm(B)}`], ['start', '←', `指向 ${nm(A)}`], ['both', '↔', '双向']], e.arrow, (v) => change(() => (e.arrow = v))),
    slider('粗细', { min: 0.4, max: 3, step: 0.05, get: () => e.width || 1, set: (v) => (e.width = v), fmt: (v) => Math.round(v * 100) + '%' }),
    h('div', { class: 'field' },
      h('span', { class: 'lbl' }, '弧度', h('span', { class: 'val' }, '也可以直接拖线中间的圆点')),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => change(() => (e.bend = { u: 0.5, v: 0 })) }, '拉直'),
        h('button', { type: 'button', class: 'btn', onclick: () => change(() => (e.bend = { ...e.bend, v: -e.bend.v })) }, '反向弯'),
        h('button', { type: 'button', class: 'btn', onclick: () => change(() => {
          e.bend = defaultBend(d, A, B);
          e.seed = (Math.random() * 1e9) | 0;
        }) }, '重画'))),
    h('button', { type: 'button', class: 'btn danger block', onclick: () => document.dispatchEvent(new CustomEvent('delete-selection')) }, '删除连线'),
  ];
}

function textPanel(t) {
  return [
    head('文字'),
    textField('内容', { get: () => t.text, set: (v) => (t.text = v), multiline: true }),
    slider('字号', { min: 16, max: 160, get: () => t.size, set: (v) => (t.size = v) }),
    slider('旋转', { min: -90, max: 90, get: () => t.rot || 0, set: (v) => (t.rot = v), fmt: (v) => v + '°' }),
    h('div', { class: 'field' },
      h('span', { class: 'lbl' }, '颜色'),
      legendChips([t.color], (id) => change(() => (t.color = id))),
      h('div', { class: 'inline' }, h('span', { class: 'muted small' }, '其他颜色'), colorSwatch(t.color?.startsWith('#') ? t.color : legendColor(t.color), (c) => change(() => (t.color = c))))),
    h('button', { type: 'button', class: 'btn danger block', onclick: () => document.dispatchEvent(new CustomEvent('delete-selection')) }, '删除文字'),
  ];
}

function titlePanel(t) {
  return [
    head('标题'),
    textField('标题', { get: () => t.text, set: (v) => (t.text = v), multiline: true, placeholder: '作品名…' }),
    textField('副标题', { get: () => t.sub, set: (v) => (t.sub = v), multiline: true, placeholder: '比如：制表：xxx\n填表：' }),
    slider('字号', { min: 32, max: 200, get: () => t.size, set: (v) => (t.size = v) }),
    h('div', { class: 'field' },
      h('span', { class: 'lbl' }, '标题图片（作品 logo）'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => pickFile('image/*', false, async ([f]) => {
          if (!f) return;
          const id = await addImageBlob(f);
          change(() => (t.img = id));
        }) }, t.img ? '更换图片' : '上传图片'),
        t.img ? h('button', { type: 'button', class: 'btn', onclick: () => change(() => (t.img = null)) }, '移除') : null)),
    t.img ? slider('图片宽度', { min: 120, max: 1400, get: () => t.imgW, set: (v) => (t.imgW = v) }) : null,
  ];
}

function legendPanel(L) {
  return [
    head('图例'),
    h('p', { class: 'muted small' }, '画布上点文字可以直接改，点色块换颜色。'),
    h('ol', { class: 'legend-list' },
      L.items.map((c) => {
        const input = h('input', { value: c.label, placeholder: '含义' });
        input.value = c.label;
        input.addEventListener('keydown', (e) => e.stopPropagation());
        input.addEventListener('input', () => {
          begin();
          c.label = input.value;
          emit();
        });
        input.addEventListener('change', commit);
        return h('li', {},
          colorSwatch(c.color, (col) => change(() => (c.color = col)), '换颜色'),
          input,
          h('button', { type: 'button', class: 'icon-btn small', 'aria-label': '删除这一项', disabled: L.items.length <= 1, onclick: () => removeLegendItem(c.id) }, '✕'));
      })),
    h('button', { type: 'button', class: 'btn block', onclick: () => document.dispatchEvent(new CustomEvent('legend-add')) }, '＋ 添加一项'),
    slider('字号', { min: 24, max: 90, get: () => L.size, set: (v) => (L.size = v) }),
    h('button', { type: 'button', class: 'btn block', onclick: () => {
      change(() => (L.show = false));
      select(null);
      toast('图例已隐藏，可在「⋯」菜单里重新显示');
    } }, '隐藏图例'),
  ];
}

// ---------- toolbar ----------

export function renderToolbar() {
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === store.tool);
  const pens = $('#pens');
  pens.replaceChildren(
    ...store.doc.legend.items.map((c) =>
      h('button', {
        type: 'button',
        class: 'pen' + (store.pen === c.id ? ' on' : ''),
        title: `用「${c.label || '未命名'}」连线`,
        style: { '--c': c.color },
        onclick: () => {
          store.pen = c.id;
          store.tool = 'connect';
          document.dispatchEvent(new CustomEvent('toolchange'));
          emit();
        },
      }))
  );
  $('#undo').disabled = !canUndo();
  $('#redo').disabled = !canRedo();
  $('#menu-legend').hidden = store.doc.legend.show;
}

export { editEdgeLabel, editTitle, finishEdit, addLegendItem };
