// Hand-drawn stroke geometry.
// A line is a quadratic Bézier; instead of stroking it with a constant width we
// build a filled outline whose width tapers at both ends, breathes a little along
// the way, and whose centreline wobbles at low frequency — the things that make a
// pen line look drawn rather than plotted.

const TAU = Math.PI * 2;

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const quad = (p0, c, p1, t) => {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
};

export const quadTangent = (p0, c, p1, t) => {
  const x = 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x);
  const y = 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y);
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const STYLES = {
  // wobble: centreline drift as a fraction of length (capped in px)
  brush: { wobble: 0.006, wobbleMax: 5, taperIn: 0.07, taperOut: 0.14, minW: 0.28, breathe: 0.12, passes: 1, widthMul: 1 },
  sketch: { wobble: 0.008, wobbleMax: 6, taperIn: 0.04, taperOut: 0.06, minW: 0.45, breathe: 0.18, passes: 3, widthMul: 0.42 },
  clean: { wobble: 0, wobbleMax: 0, taperIn: 0, taperOut: 0, minW: 1, breathe: 0, passes: 1, widthMul: 1 },
};

function centreline(p0, c, p1, seed, st) {
  const len = Math.hypot(c.x - p0.x, c.y - p0.y) + Math.hypot(p1.x - c.x, p1.y - c.y);
  const n = Math.max(12, Math.min(220, Math.round(len / 5)));
  const r = rng(seed);
  const f1 = 0.6 + r() * 1.2, f2 = 2 + r() * 2.5, ph1 = r() * TAU, ph2 = r() * TAU;
  const amp = Math.min(st.wobbleMax, len * st.wobble);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = quad(p0, c, p1, t);
    const tg = quadTangent(p0, c, p1, t);
    // anchor the very ends so the line still lands where it was aimed
    const off = amp * (0.65 * Math.sin(TAU * f1 * t + ph1) + 0.35 * Math.sin(TAU * f2 * t + ph2)) * Math.sin(Math.PI * t) ** 0.4;
    pts.push({ x: p.x - tg.y * off, y: p.y + tg.x * off, t });
  }
  // tangents from the wobbled polyline
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    pts[i].tx = (b.x - a.x) / l;
    pts[i].ty = (b.y - a.y) / l;
  }
  return pts;
}

function widthFn(w, seed, st) {
  const r = rng(seed ^ 0x9e3779b9);
  const f = 1 + r() * 2, ph = r() * TAU;
  return (t) => {
    const taper = st.taperIn || st.taperOut ? Math.min(smooth(0, st.taperIn || 1e-6, t), 1 - smooth(1 - (st.taperOut || 1e-6), 1, t)) : 1;
    return w * (st.minW + (1 - st.minW) * taper) * (1 + st.breathe * Math.sin(TAU * f * t + ph));
  };
}

const fmt = (v) => Math.round(v * 10) / 10;

// Closed outline of pts[i0..i1] with round caps where requested.
function outline(pts, i0, i1, wf, capStart, capEnd) {
  const L = [], R = [];
  for (let i = i0; i <= i1; i++) {
    const p = pts[i], hw = wf(p.t) / 2;
    L.push([p.x - p.ty * hw, p.y + p.tx * hw]);
    R.push([p.x + p.ty * hw, p.y - p.tx * hw]);
  }
  const out = [...L];
  const cap = (p, sign) => {
    const hw = wf(p.t) / 2, res = [];
    for (let k = 1; k < 8; k++) {
      const a = (k / 8) * Math.PI;
      // from left normal, around the tip (sign=+1 forward / -1 backward), to right normal
      const nx = -p.ty, ny = p.tx;
      res.push([p.x + hw * (nx * Math.cos(a) * sign + p.tx * Math.sin(a) * sign), p.y + hw * (ny * Math.cos(a) * sign + p.ty * Math.sin(a) * sign)]);
    }
    return res;
  };
  if (capEnd) out.push(...cap(pts[i1], 1));
  out.push(...R.reverse());
  if (capStart) out.push(...cap(pts[i0], -1));
  return 'M' + out.map(([x, y]) => fmt(x) + ' ' + fmt(y)).join('L') + 'Z';
}

/**
 * Paths for one stroke.
 * @returns {{d:string,color:string,opacity:number}[]}
 */
export function strokePaths(p0, c, p1, { width, colors, seed, style = 'brush' }) {
  const st = STYLES[style] || STYLES.brush;
  const res = [];
  for (let pass = 0; pass < st.passes; pass++) {
    let a = p0, b = p1, cc = c;
    const s = seed + pass * 7919;
    if (pass > 0) {
      // re-traced passes start and stop a little off, like a pencil going over a line again
      const r = rng(s);
      const tg0 = quadTangent(p0, c, p1, 0), tg1 = quadTangent(p0, c, p1, 1);
      const o0 = (r() - 0.6) * 10, o1 = (r() - 0.4) * 12, j = (r() - 0.5) * width * 1.4;
      a = { x: p0.x - tg0.x * o0 - tg0.y * j, y: p0.y - tg0.y * o0 + tg0.x * j };
      b = { x: p1.x + tg1.x * o1 - tg1.y * j, y: p1.y + tg1.y * o1 + tg1.x * j };
      cc = { x: c.x + (r() - 0.5) * width * 3, y: c.y + (r() - 0.5) * width * 3 };
    }
    const pts = centreline(a, cc, b, s, st);
    const wf = widthFn(width * st.widthMul, s, st);
    const n = pts.length - 1, k = colors.length;
    for (let i = 0; i < k; i++) {
      const i0 = Math.round((i / k) * n), i1 = Math.round(((i + 1) / k) * n);
      res.push({
        d: outline(pts, i0, Math.min(n, i1 + (i < k - 1 ? 1 : 0)), wf, i === 0, i === k - 1),
        color: colors[i],
        opacity: st.passes > 1 ? 0.88 : 1,
      });
    }
  }
  return res;
}

/** Two short strokes forming an open arrowhead at `tip`, pointing along `dir`. */
export function arrowPaths(tip, dir, { width, color, seed, style }) {
  const len = 14 + width * 3.2;
  const res = [];
  [-1, 1].forEach((side, i) => {
    const ang = side * 0.47;
    const bx = -dir.x * Math.cos(ang) + dir.y * Math.sin(ang);
    const by = -dir.y * Math.cos(ang) - dir.x * Math.sin(ang);
    const end = { x: tip.x + bx * len, y: tip.y + by * len };
    const mid = { x: (tip.x + end.x) / 2 + side * dir.x * 1.5, y: (tip.y + end.y) / 2 + side * dir.y * 1.5 };
    res.push(...strokePaths(tip, mid, end, { width: width * 0.95, colors: [color], seed: seed + 31 * (i + 1), style }));
  });
  return res;
}
