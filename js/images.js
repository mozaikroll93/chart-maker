import { uid } from './util.js';
import { store } from './state.js';

const MAX_SIDE = 640;

function loadImg(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('图片加载失败'));
    im.src = src;
  });
}

/** Downscale to MAX_SIDE and re-encode so projects stay small and exports never taint the canvas. */
async function normalize(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const im = await loadImg(url);
    const s = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
    const w = Math.max(1, Math.round(im.naturalWidth * s)), h = Math.max(1, Math.round(im.naturalHeight * s));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    const keepAlpha = /png|gif|webp|svg/.test(blob.type);
    if (!keepAlpha) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(im, 0, 0, w, h);
    const src = cv.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.9);
    return { src, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function addImageBlob(blob) {
  const meta = await normalize(blob);
  const id = uid('im');
  store.images.set(id, meta);
  return id;
}

// Bangumi's image host may not send CORS headers; if a direct fetch is refused
// fall back to the public wsrv.nl image proxy, which does.
export async function addImageUrl(url) {
  const tries = [url, `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${MAX_SIDE}&output=jpg`];
  let lastErr;
  for (const u of tries) {
    try {
      const r = await fetch(u, { mode: 'cors' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await addImageBlob(await r.blob());
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export const fileBaseName = (name) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
