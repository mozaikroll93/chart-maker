import { h, esc, toast } from './util.js';
import { store, addNodes, RING_HARD_LIMIT } from './state.js';
import { addImageUrl } from './images.js';

// Bangumi's API allows any origin (CORS *), so the browser talks to it directly.
const API = 'https://api.bgm.tv';

const TYPES = [
  { v: '', label: '全部' },
  { v: 2, label: '动画' },
  { v: 1, label: '书籍' },
  { v: 4, label: '游戏' },
  { v: 6, label: '三次元' },
];

async function searchSubjects(keyword, type) {
  const body = { keyword, sort: 'match' };
  if (type) body.filter = { type: [Number(type)] };
  const r = await fetch(`${API}/v0/search/subjects?limit=20`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('搜索失败 HTTP ' + r.status);
  return (await r.json()).data || [];
}

async function subjectCharacters(id) {
  const r = await fetch(`${API}/v0/subjects/${id}/characters`);
  if (!r.ok) throw new Error('获取角色失败 HTTP ' + r.status);
  return r.json();
}

// The subject→characters list only carries the original name; the Chinese name
// sits in each character's infobox.
async function chineseName(id) {
  try {
    const r = await fetch(`${API}/v0/characters/${id}`);
    if (!r.ok) return '';
    const c = await r.json();
    const row = (c.infobox || []).find((x) => x.key === '简体中文名');
    return typeof row?.value === 'string' ? row.value : '';
  } catch {
    return '';
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    })
  );
  return out;
}

const RELATION_ORDER = { 主角: 0, 配角: 1, 客串: 2 };

let dlg;

export function openBangumi() {
  if (!dlg) dlg = build();
  dlg.showModal();
  dlg.querySelector('input[type=search]').focus();
}

function build() {
  const results = h('div', { class: 'bgm-results' });
  const chars = h('div', { class: 'bgm-chars', hidden: true });
  const status = h('div', { class: 'bgm-status' });
  const input = h('input', { type: 'search', placeholder: '搜索作品名，例如：葬送的芙莉莲', enterkeyhint: 'search' });
  const typeSel = h('select', {}, TYPES.map((t) => h('option', { value: t.v }, t.label)));
  typeSel.value = '2';
  const footer = h('div', { class: 'bgm-footer', hidden: true });

  const doSearch = async () => {
    const q = input.value.trim();
    if (!q) return;
    chars.hidden = true;
    footer.hidden = true;
    results.hidden = false;
    status.textContent = '搜索中…';
    results.innerHTML = '';
    try {
      const list = await searchSubjects(q, typeSel.value);
      status.textContent = list.length ? '选择一部作品：' : '没有找到，换个关键词试试';
      for (const s of list) {
        results.append(
          h('button', { class: 'bgm-subject', type: 'button', onclick: () => showChars(s) },
            s.images?.grid ? h('img', { src: s.images.grid, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'noimg' }),
            h('span', { class: 'meta' },
              h('b', {}, s.name_cn || s.name),
              h('small', {}, [s.name_cn ? s.name : '', s.date ? s.date.slice(0, 4) : ''].filter(Boolean).join(' · ')))
          )
        );
      }
    } catch (e) {
      status.textContent = '连不上 Bangumi：' + e.message + '。可以先手动上传图片。';
    }
  };

  const picked = new Set();
  let current = [];

  const updateFooter = () => {
    const room = RING_HARD_LIMIT - store.doc.nodes.length;
    footer.querySelector('.count').textContent = `已选 ${picked.size} 个` + (picked.size > room ? `（最多还能加 ${room} 个）` : '');
    footer.querySelector('.add').disabled = !picked.size || room <= 0;
  };

  const showChars = async (s) => {
    results.hidden = true;
    chars.hidden = false;
    chars.innerHTML = '';
    status.innerHTML = `<button type="button" class="link back">← 返回结果</button> ${esc(s.name_cn || s.name)} 的角色：加载中…`;
    status.querySelector('.back').onclick = () => {
      chars.hidden = true;
      footer.hidden = true;
      results.hidden = false;
      status.textContent = '选择一部作品：';
    };
    try {
      current = (await subjectCharacters(s.id)).filter((c) => c.type === 1 || c.type == null);
      current.sort((a, b) => (RELATION_ORDER[a.relation] ?? 3) - (RELATION_ORDER[b.relation] ?? 3));
      picked.clear();
      current.forEach((c) => (c.relation === '主角' || c.relation === '配角') && picked.add(c.id));
      status.lastChild.textContent = ` ${s.name_cn || s.name} 的角色（${current.length}）：点选要加入的角色`;
      for (const c of current) {
        const tile = h('button', { type: 'button', class: 'bgm-char' + (picked.has(c.id) ? ' on' : ''), title: c.name },
          c.images?.grid ? h('img', { src: c.images.grid, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'noimg' }),
          h('span', { class: 'nm' }, c.name),
          h('small', {}, c.relation || ''));
        tile.onclick = () => {
          picked.has(c.id) ? picked.delete(c.id) : picked.add(c.id);
          tile.classList.toggle('on', picked.has(c.id));
          updateFooter();
        };
        chars.append(tile);
      }
      footer.hidden = false;
      updateFooter();
    } catch (e) {
      status.lastChild.textContent = ' 加载失败：' + e.message;
    }
  };

  const selectAll = (on) => {
    current.forEach((c) => (on ? picked.add(c.id) : picked.delete(c.id)));
    chars.querySelectorAll('.bgm-char').forEach((t) => t.classList.toggle('on', on));
    updateFooter();
  };

  const doAdd = async () => {
    const room = RING_HARD_LIMIT - store.doc.nodes.length;
    const list = current.filter((c) => picked.has(c.id)).slice(0, room);
    const btn = footer.querySelector('.add');
    btn.disabled = true;
    let done = 0, failed = 0;
    const items = await pool(list, 4, async (c) => {
      const [img, cn] = await Promise.all([
        c.images?.large ? addImageUrl(c.images.large).catch(() => (failed++, null)) : null,
        chineseName(c.id),
      ]);
      btn.textContent = `下载中 ${++done}/${list.length}`;
      return { name: cn || c.name, img };
    });
    addNodes(items);
    btn.textContent = '加入画布';
    dlg.close();
    toast(`已加入 ${items.length} 个角色` + (failed ? `，其中 ${failed} 张图片下载失败，可在右侧更换` : ''));
  };

  footer.append(
    h('span', { class: 'count' }),
    h('button', { type: 'button', class: 'btn ghost', onclick: () => selectAll(true) }, '全选'),
    h('button', { type: 'button', class: 'btn ghost', onclick: () => selectAll(false) }, '全不选'),
    h('button', { type: 'button', class: 'btn primary add', onclick: doAdd }, '加入画布')
  );

  input.addEventListener('keydown', (e) => e.key === 'Enter' && doSearch());

  const d = h('dialog', { class: 'bgm-dialog' },
    h('div', { class: 'dlg-head' },
      h('h2', {}, '从 Bangumi 导入角色'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '关闭', onclick: () => d.close() }, '✕')),
    h('div', { class: 'bgm-search' }, typeSel, input, h('button', { type: 'button', class: 'btn primary', onclick: doSearch }, '搜索')),
    status,
    results,
    chars,
    footer,
    h('p', { class: 'fine' }, '数据来自 ', h('a', { href: 'https://bgm.tv', target: '_blank', rel: 'noopener' }, 'Bangumi 番组计划'), '。图片会下载到本地浏览器里，不会上传到任何服务器。')
  );
  d.addEventListener('click', (e) => e.target === d && d.close());
  document.body.append(d);
  return d;
}
