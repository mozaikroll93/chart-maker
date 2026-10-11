export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9);

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, pv] of Object.entries(v)) el.style.setProperty(p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), pv);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return el;
}

// Inside a claude.ai Artifact a page cannot start downloads itself; the
// viewer's `downloads` capability asks the viewer to save the file instead.
let downloadsCap;
const artifactDownloads = () => (downloadsCap ??= window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null));
artifactDownloads();

export async function download(blob, filename) {
  const cap = await artifactDownloads();
  if (cap) {
    try {
      await cap.save({ filename, data: blob });
    } catch (e) {
      if (e?.code !== 'declined') toast('没能保存文件：' + (e?.message || e?.code || '未知错误'));
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** In-page confirmation (native confirm() is unavailable in some embeds). */
export function confirmDialog(message, okLabel = '确定') {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'confirm-dialog' },
      h('p', {}, message),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => dlg.close('cancel') }, '取消'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => dlg.close('ok') }, okLabel)));
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

let toastTimer;
export function toast(msg, ms = 2600) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
