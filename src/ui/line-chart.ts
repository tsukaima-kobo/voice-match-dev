// セリフ真似の図: お手本の高さの動きと、お手本の時間に合わせたあなたの高さの動きを、1 つの図に重ねる（SVG）。
// 下には、お手本の大きさの動き（音の山）を薄く描く。数字の並びだけを使い、音は使わない。
import type { Contour } from '../voice/measure.ts';

const NS = 'http://www.w3.org/2000/svg';
const W = 1000,
  H = 300;
let uid = 0;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** 値の並びを、声の無い所で切れる線の d に */
function pathOf(v: ArrayLike<number>, x: (i: number) => number, y: (p: number) => number): string {
  let d = '',
    open = false;
  for (let i = 0; i < v.length; i++) {
    const p = v[i]!;
    if (!Number.isFinite(p)) {
      open = false;
      continue;
    }
    d += `${open ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`;
    open = true;
  }
  return d;
}

export function drawLineChart(box: HTMLElement, ref: Contour, mine: Float32Array): void {
  const id = `lc${++uid}`;
  const n = ref.pitch.length;
  const all = [...Array.from(ref.pitch), ...Array.from(mine)].filter(Number.isFinite);
  let lo = Math.min(...all) - 1.5,
    hi = Math.max(...all) + 1.5;
  if (hi - lo < 8) {
    const mid = (hi + lo) / 2;
    lo = mid - 4;
    hi = mid + 4;
  }
  const top = 18,
    bottom = H - 70;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const y = (p: number) => bottom - ((p - lo) / (hi - lo)) * (bottom - top);

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'お手本とあなたの、声の高さの動きを重ねた図' });
  const defs = svg('defs', {});
  const g = svg('linearGradient', { id: `${id}g`, x1: 0, x2: 1, y1: 0, y2: 0 });
  g.append(svg('stop', { offset: 0, class: 'stop-a' }), svg('stop', { offset: 0.5, class: 'stop-b' }), svg('stop', { offset: 1, class: 'stop-c' }));
  defs.append(g);
  root.append(defs);

  // (the grid: a line every 2 semitones, faint)
  for (let s = Math.ceil(lo / 2) * 2; s <= hi; s += 2) root.append(svg('line', { x1: 0, x2: W, y1: y(s), y2: y(s), class: 'grid' }));

  // (the model's loudness, at the foot)
  let area = `M0 ${H}`;
  for (let i = 0; i < n; i++) area += `L${x(i).toFixed(1)} ${(H - ((ref.level[i]! + 40) / 40) * 56).toFixed(1)}`;
  area += `L${W} ${H}Z`;
  root.append(svg('path', { d: area, class: 'level' }));

  root.append(svg('path', { d: pathOf(ref.pitch, x, y), class: 'ref', stroke: `url(#${id}g)` }));
  root.append(svg('path', { d: pathOf(mine, x, y), class: 'mine' }));
  box.replaceChildren(root);
}
