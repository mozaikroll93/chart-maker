import { $, debounce, download, toast } from './util.js';
import {
  store, subscribe, emit, change, undo, redo, select, layoutRing, replaceDoc, newDoc, onDocChange,
  addNodes, deleteSelection, addLegendItem, RING_HARD_LIMIT,
} from './state.js';
import { mountStage, render, ui } from './render.js';
import { setupInteraction, isEditing, finishEdit, editTitle, editLegendLabel } from './interact.js';
import { renderSidebar, renderInspector, renderToolbar } from './panels.js';
import { addImageBlob, fileBaseName } from './images.js';
import { openBangumi } from './bangumi.js';
import { renderPNG, projectJSON, parseProject } from './exporter.js';
import { dbGet, dbSet } from './db.js';

const stage = $('#stage'), wrap = $('#stage-wrap');
mountStage(stage);
setupInteraction(stage, wrap);

// ---------- view zoom ----------

function applyZoom() {
  const { w, h } = store.doc.canvas;
  const fit = Math.min((wrap.clientWidth - 40) / w, (wrap.clientHeight - 40) / h);
  const z = store.zoom || fit;
  stage.style.width = Math.round(w * z) + 'px';
  stage.style.height = Math.round(h * z) + 'px';
  $('#zoom-val').textContent = store.zoom ? Math.round(store.zoom * 100) + '%' : '适应';
}
const setZoom = (z) => {
  store.zoom = z;
  applyZoom();
};
const currentZoom = () => stage.clientWidth / store.doc.canvas.w;
$('#zoom-in').onclick = () => setZoom(Math.min(2, currentZoom() * 1.25));
$('#zoom-out').onclick = () => setZoom(Math.max(0.1, currentZoom() / 1.25));
$('#zoom-val').onclick = () => setZoom(0);
new ResizeObserver(applyZoom).observe(wrap);

// ---------- rendering ----------

const sidebar = $('#sidebar'), inspector = $('#inspector');
let pointerHeld = false;
window.addEventListener('pointerdown', () => (pointerHeld = true), true);
window.addEventListener('pointerup', () => (pointerHeld = false), true);
function busy(panel) {
  const ae = document.activeElement;
  if (!ae || !panel.contains(ae)) return false;
  return ae.matches('textarea, select, input:not([type]), input[type=text], input[type=search]') || (ae.type === 'range' && pointerHeld);
}
let lastSelKey = '';
subscribe(() => {
  render();
  renderToolbar();
  applyZoom();
  // don't rebuild a panel while someone is typing or dragging a slider in it
  const selKey = JSON.stringify(store.sel);
  if (!busy(sidebar) || selKey !== lastSelKey) renderSidebar(sidebar, { onAddFiles: addFiles, onBangumi: openBangumi });
  if (!busy(inspector) || selKey !== lastSelKey) renderInspector(inspector);
  lastSelKey = selKey;
  wrap.dataset.tool = store.tool;
});

// ---------- autosave ----------

const save = debounce(() => {
  const p = projectJSON();
  dbSet('current', { doc: p.doc, images: p.images });
}, 600);
onDocChange(save);

// ---------- adding characters ----------

async function addFiles(files) {
  const imgs = files.filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) return;
  const room = RING_HARD_LIMIT - store.doc.nodes.length;
  if (room <= 0) return toast(`最多 ${RING_HARD_LIMIT} 个角色`);
  const items = [];
  for (const f of imgs.slice(0, room)) {
    try {
      items.push({ name: fileBaseName(f.name || ''), img: await addImageBlob(f) });
    } catch {
      /* unreadable file */
    }
  }
  const n = addNodes(items);
  if (imgs.length > room) toast(`最多 ${RING_HARD_LIMIT} 个角色，只加入了前 ${n} 张`);
}

// drop files anywhere on the page
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('dropping');
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('dropping');
  }
});
window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dropping');
  addFiles([...e.dataTransfer.files]);
});
window.addEventListener('paste', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  }
});

// ---------- toolbar ----------

const setTool = (t) => {
  store.tool = t;
  finishEdit(true);
  document.dispatchEvent(new CustomEvent('toolchange'));
  emit();
};
document.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
document.addEventListener('toolchange', () => {
  if (store.tool !== 'connect') ui.pendingFrom = ui.rubber = ui.hoverNode = null;
  emit();
});
document.addEventListener('delete-selection', deleteSelection);
document.addEventListener('legend-add', () => {
  const item = addLegendItem();
  select({ kind: 'legend' });
  requestAnimationFrame(() => editLegendLabel(item));
});
$('#undo').onclick = undo;
$('#redo').onclick = redo;

$('#export').onclick = async () => {
  const btn = $('#export');
  finishEdit(true);
  select(null);
  btn.disabled = true;
  btn.textContent = '导出中…';
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const blob = await renderPNG(1);
    const name = (store.doc.title.text.split('\n')[0] || 'shipping-chart').replace(/[\\/:*?"<>|]/g, '').trim();
    download(blob, `${name || 'shipping-chart'}.png`);
  } catch (e) {
    console.error(e);
    toast('导出失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '导出图片';
  }
};

const menu = $('#menu');
$('#menu-btn').onclick = (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
};
document.addEventListener('click', (e) => !menu.contains(e.target) && (menu.hidden = true));
$('#menu-new').onclick = () => {
  if (store.doc.nodes.length && !confirm('清空当前画布，开始一张新图？（建议先保存工程文件）')) return;
  replaceDoc(newDoc(store.doc.canvas.preset), new Map());
  menu.hidden = true;
};
$('#menu-save').onclick = () => {
  const name = (store.doc.title.text.split('\n')[0] || 'shipping-chart').replace(/[\\/:*?"<>|]/g, '').trim() || 'shipping-chart';
  download(new Blob([JSON.stringify(projectJSON())], { type: 'application/json' }), `${name}.shipchart.json`);
  menu.hidden = true;
};
$('#menu-open').onclick = () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = async () => {
    try {
      const { doc, images } = parseProject(JSON.parse(await inp.files[0].text()));
      replaceDoc(doc, images);
    } catch (e) {
      toast('打不开这个文件：' + e.message);
    }
  };
  inp.click();
  menu.hidden = true;
};
$('#menu-legend').onclick = () => {
  change((d) => (d.legend.show = true));
  menu.hidden = true;
};

// ---------- keyboard ----------

window.addEventListener('keydown', (e) => {
  if (isEditing() || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (store.sel) {
      e.preventDefault();
      deleteSelection();
    }
  } else if (e.key === 'Escape') {
    setTool('select');
    select(null);
  } else if (!mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'v') setTool('select');
    else if (k === 'l') setTool('connect');
    else if (k === 't') setTool('text');
    else if (k === 'enter' && store.sel?.kind === 'title') editTitle();
  }
});

// ---------- boot ----------

(async () => {
  const saved = await dbGet('current');
  if (saved?.doc) replaceDoc(saved.doc, new Map(Object.entries(saved.images || {})));
  else {
    layoutRing(store.doc);
    emit();
  }
})();
