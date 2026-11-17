/**
 * 手绘标记画笔：熟练度底色（宽扫）与笔记下划线（窄带）。
 *
 * 两条通道都画在正文之上的一层 SVG 里，用 multiply 叠色：
 *  - 熟练度 1–4 级：三层叠扫的马克笔宽底色，5 级不出笔；
 *  - 笔记：字脚下 7px 的手绘窄带，斜口收笔、下缘湿边。
 *
 * 这里只做「给定矩形 → 路径」，坐标换算和可见区域裁剪交给调用方：
 * EPUB 在 iframe 内以 body 为原点，TXT 在滚动容器内以容器为原点。
 */

export type NoteInkKey = 'blue' | 'green' | 'pink';

interface InkColor {
  line: string;
  deep: string;
}

const LEVEL_INK: Record<number, InkColor & { alpha: number }> = {
  1: { line: '#EF4444', deep: '#D42B2B', alpha: 0.32 },
  2: { line: '#F97316', deep: '#DA5A0C', alpha: 0.29 },
  3: { line: '#F5C518', deep: '#D1A200', alpha: 0.32 },
  4: { line: '#34D399', deep: '#16A578', alpha: 0.23 },
};

const NOTE_INK: Record<NoteInkKey, InkColor> = {
  blue: { line: '#2C5D96', deep: '#234C7B' },
  green: { line: '#2F7355', deep: '#245C44' },
  pink: { line: '#AE4157', deep: '#93374A' },
};

export interface InkRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InkRun {
  kind: 'vocab' | 'note';
  rects: InkRect[];
  fontSize: number;
  fontFamily: string;
  level?: number;
  note?: NoteInkKey;
  seed: string;
}

/** 笔记色值（旧的三色或新的墨色）统一映射到画笔。 */
export function noteKeyFromColor(color: string): NoteInkKey {
  const value = (color || '').toLowerCase();
  if (value === '#10b981' || value === '#4f8468') return 'green';
  if (value === '#ec4899' || value === '#a8636f') return 'pink';
  return 'blue';
}

/** Range 的逐行矩形，转换到图层坐标。 */
export function rectsOfRange(range: Range, originLeft: number, originTop: number): InkRect[] {
  const out: InkRect[] = [];
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const rc = rects[i];
    if (rc.width < 2) continue;
    out.push({
      x: rc.left - originLeft,
      y: rc.top - originTop,
      w: rc.width,
      h: rc.height,
    });
  }
  return out;
}

export function runInBox(run: InkRun, box: { left: number; top: number; right: number; bottom: number }) {
  for (const r of run.rects) {
    if (r.x + r.w < box.left || r.x > box.right) continue;
    if (r.y + r.h < box.top || r.y > box.bottom) continue;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* path helpers                                                        */
/* ------------------------------------------------------------------ */

function hash(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number) {
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 平滑的一维噪声，返回 [-1, 1]，同时驱动位置和压力。 */
function edgeNoise(rand: () => number, ctrl: number) {
  const v: number[] = [];
  for (let i = 0; i < ctrl; i++) v.push(rand() * 2 - 1);
  v.push(v[ctrl - 1]);
  v.push(v[ctrl - 1]);
  return (t: number) => {
    const s = t * (ctrl - 1);
    const k = Math.min(ctrl - 1, Math.floor(s));
    const fr = s - k;
    const u = fr * fr * (3 - 2 * fr);
    return v[k] * (1 - u) + v[k + 1] * u;
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

interface RibbonOpt {
  thick: number;
  press: number;
  taper: number;
  amp: number;
  tilt: number;
  bow: number;
  flick?: number;
  rough?: number;
}

/** 一笔：游走的中线 + 压力包络，收成实心多边形。 */
function ribbon(
  x0: number,
  x1: number,
  y: number,
  rand: () => number,
  o: RibbonOpt
) {
  const W = Math.max(3, x1 - x0);
  const steps = Math.max(9, Math.min(78, Math.round(W / 2.6)));
  const n = edgeNoise(rand, 7);
  const m = edgeNoise(rand, 19);
  const eT = o.rough ? edgeNoise(rand, 34) : null;
  const eB = o.rough ? edgeNoise(rand, 34) : null;
  const top: [number, number][] = [];
  const bot: [number, number][] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + W * t;
    const e = Math.min(t, 1 - t);
    const taper = Math.min(1, e / Math.max(0.001, o.taper));
    let th = o.thick * (1 + o.press * (n(t) * 0.62 + m(t) * 0.38));
    th *= 0.12 + 0.88 * Math.pow(taper, 0.5);
    const yy = y + o.tilt * (t - 0.5) + o.bow * Math.sin(Math.PI * t) + n(t) * o.amp + m(t) * o.amp * 0.24;
    top.push([x, yy - th / 2 + (o.rough && eT ? eT(t) * th * o.rough : 0)]);
    bot.push([x, yy + th / 2 + (o.rough && eB ? eB(t) * th * o.rough : 0)]);
  }

  if (o.flick) {
    const L = top.length - 1;
    top[L][0] += o.flick;
    bot[L][0] += o.flick;
    top[L][1] -= o.flick * 0.32;
    bot[L][1] -= o.flick * 0.32;
  }

  const pts = top.concat(bot.reverse());
  let d = `M${round2(pts[0][0])},${round2(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${round2(pts[i][0])},${round2(pts[i][1])}`;
  return d + 'Z';
}

function addPath(target: SVGElement, d: string, fill: string, alpha: number) {
  const doc = target.ownerDocument || document;
  const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', fill);
  p.setAttribute('opacity', String(alpha));
  target.appendChild(p);
}

/** 马克笔带状笔触：斜口、上下缘毛边。 */
function band(
  target: SVGElement,
  x0: number,
  x1: number,
  y: number,
  H: number,
  rand: () => number,
  color: InkColor,
  alpha: number
) {
  const W = Math.max(4, x1 - x0);
  const steps = Math.max(8, Math.min(64, Math.round(W / 4)));
  const nT = edgeNoise(rand, 8);
  const nB = edgeNoise(rand, 8);
  const tilt = (rand() - 0.5) * H * 0.16;
  const bow = (rand() - 0.5) * H * 0.1;
  const top: [number, number][] = [];
  const bot: [number, number][] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + W * t;
    const yy = y + tilt * (t - 0.5) + bow * Math.sin(Math.PI * t);
    top.push([x, yy + nT(t) * H * 0.13]);
    bot.push([x, yy + H + nB(t) * H * 0.13]);
  }

  const lL = H * (0.1 + rand() * 0.14);
  const lR = H * (0.08 + rand() * 0.12);
  top[0][0] += lL;
  bot[0][0] -= lL * 0.6;
  top[steps][0] -= lR;
  bot[steps][0] += lR * 0.6;

  const pts = top.concat(bot.reverse());
  let d = `M${round2(pts[0][0])},${round2(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${round2(pts[i][0])},${round2(pts[i][1])}`;
  addPath(target, d + 'Z', color.line, alpha);
}

/* ------------------------------------------------------------------ */
/* baseline                                                            */
/* ------------------------------------------------------------------ */

const metricCache = new WeakMap<Document, { ctx: CanvasRenderingContext2D; byKey: Map<string, { asc: number; desc: number }> }>();

function metrics(doc: Document, F: number, family: string) {
  let entry = metricCache.get(doc);
  if (!entry) {
    const canvas = doc.createElement('canvas');
    entry = { ctx: canvas.getContext('2d') as CanvasRenderingContext2D, byKey: new Map() };
    metricCache.set(doc, entry);
  }
  const key = `${family}|${F.toFixed(1)}`;
  const cached = entry.byKey.get(key);
  if (cached) return cached;
  const ctx = entry.ctx;
  ctx.font = `400 ${F}px ${family}`;
  const m = ctx.measureText('Hxpgy');
  const value = {
    asc: m.fontBoundingBoxAscent || F * 0.9,
    desc: m.fontBoundingBoxDescent || F * 0.22,
  };
  entry.byKey.set(key, value);
  return value;
}

function baselineOf(rect: InkRect, F: number, family: string, doc: Document) {
  const met = metrics(doc, F, family);
  const contentH = met.asc + met.desc;
  return Math.abs(rect.h - contentH) < 2.4
    ? rect.y + met.asc
    : rect.y + (rect.h - contentH) / 2 + met.asc;
}

/* ------------------------------------------------------------------ */
/* render                                                              */
/* ------------------------------------------------------------------ */

function wash(
  target: SVGElement,
  x0: number,
  x1: number,
  baseline: number,
  F: number,
  rand: () => number,
  color: InkColor & { alpha: number }
) {
  const W = x1 - x0;
  const a = color.alpha;
  band(target, x0, x1, baseline - F * 0.82, F * 1.12, rand, color, a * 0.52);
  band(target, x0 + W * 0.03, x1 - W * 0.01, baseline - F * 0.74, F * 1.02, rand, color, a * 0.28);
  band(target, x0 + W * 0.15, x1 - W * 0.09, baseline - F * 0.86, F * 1.16, rand, color, a * 0.18);
}

function dot(target: SVGElement, x: number, y: number, r: number, fill: string, alpha: number) {
  const doc = target.ownerDocument || document;
  const c = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('cx', String(round2(x)));
  c.setAttribute('cy', String(round2(y)));
  c.setAttribute('r', String(round2(r)));
  c.setAttribute('fill', fill);
  c.setAttribute('opacity', String(alpha));
  target.appendChild(c);
}

/** 笔记：钢笔线。等宽偏细、轻微提按，收笔自然提离纸面。 */
function penLine(target: SVGElement, x0: number, x1: number, y: number, rand: () => number, color: InkColor, s: number) {
  const d = ribbon(x0, x1, y, rand, {
    thick: 1.42 * s,
    press: 0.34,
    taper: 0.022,
    amp: 0.13 * s,
    tilt: (rand() - 0.5) * 0.5 * s,
    bow: 0.16 * s,
    flick: 1.3 * s,
  });
  addPath(target, d, color.deep, 0.9);
  dot(target, x0 + 0.9 * s, y, 0.55 * s, color.deep, 0.85);
}

/**
 * 清空并重画整个图层。调用方负责先按可见区域裁剪 runs。
 */
export function renderInk(svg: SVGSVGElement, runs: InkRun[], doc: Document) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!runs.length) return;

  const washLayer = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
  const noteLayer = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(washLayer);
  svg.appendChild(noteLayer);

  for (const run of runs) {
    const rand = mulberry32(hash(run.seed));
    const s = run.fontSize / 25;
    for (const rc of run.rects) {
      const baseline = baselineOf(rc, run.fontSize, run.fontFamily, doc);
      if (run.kind === 'vocab') {
        const color = run.level ? LEVEL_INK[run.level] : undefined;
        if (!color) continue;
        wash(washLayer, rc.x - 1.2, rc.x + rc.w + 1.2, baseline, run.fontSize, rand, color);
      } else {
        const color = NOTE_INK[run.note || 'blue'];
        penLine(noteLayer, rc.x - 1.2 * s, rc.x + rc.w + 1.2 * s, baseline + run.fontSize * 0.195, rand, color, s);
      }
    }
  }

  if (!washLayer.childNodes.length) svg.removeChild(washLayer);
  if (!noteLayer.childNodes.length) svg.removeChild(noteLayer);
}

/** 图层容器：EPUB 的 iframe 与 TXT 的滚动容器共用同一套定位样式。 */
export function styleInkLayer(
  svg: SVGSVGElement,
  width: number,
  height: number,
  blend: 'multiply' | 'screen' = 'multiply'
) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('aria-hidden', 'true');
  // EPUB 自带 `svg { max-width: 408px !important }` 这类按页宽写死的规则，
  // 会把整层压成一栏宽；只有内联 !important 能盖住它。
  svg.style.cssText =
    `position:absolute;left:0;top:0;pointer-events:none;overflow:visible;z-index:4;mix-blend-mode:${blend};` +
    `width:${w}px !important;height:${h}px !important;max-width:none !important;max-height:none !important;`;
}
