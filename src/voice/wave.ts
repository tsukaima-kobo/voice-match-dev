// 録っている声に合わせて動く波: 40 ms ごとの大きさを 1 本の棒にし、右に足して左へ流す（上下に対の、中心から伸びる棒）。
// 残すのは棒の高さ（0〜1 の数）だけで、音そのものは持たない。色は canvas の CSS 変数 --wave から。
// 動きを減らす設定では、流さずに今の大きさの横棒だけ。
const BAR_SECONDS = 0.04;
const MAX_BARS = 256;
const BAR_W = 3;
const STEP = 6;

export interface Wave {
  push(x: Float32Array, rate: number): void;
  draw(live: boolean): void;
  clear(): void;
}

/** 2 乗の平均から棒の高さ: -56 dBFS 以下は 0、-10 dBFS でいっぱい */
const heightOf = (ms: number) => {
  const db = 10 * Math.log10(ms + 1e-12);
  return Math.min(1, Math.max(0, (db + 56) / 46)) ** 1.3;
};

export function createWave(canvas: HTMLCanvasElement): Wave {
  const ctx = canvas.getContext('2d')!;
  const bars = new Float32Array(MAX_BARS);
  let count = 0,
    acc = 0,
    accN = 0,
    level = 0;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  function fit() {
    const d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round((canvas.clientWidth || 320) * d),
      h = Math.round((canvas.clientHeight || 120) * d);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return d;
  }
  return {
    push(x, rate) {
      const per = Math.max(1, Math.round(rate * BAR_SECONDS));
      for (let i = 0; i < x.length; i++) {
        acc += x[i]! * x[i]!;
        if (++accN >= per) {
          const v = heightOf(acc / accN);
          bars[count % MAX_BARS] = v;
          count++;
          level = v;
          acc = 0;
          accN = 0;
        }
      }
    },
    draw(live) {
      const d = fit();
      const w = canvas.width,
        h = canvas.height,
        mid = h / 2;
      const color = getComputedStyle(canvas).getPropertyValue('--wave').trim() || '#d6336c';
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, mid - d / 2, w, d);
      if (!live) return;
      if (reduce.matches) {
        ctx.globalAlpha = 0.9;
        const bw = Math.max(d * 4, w * level);
        ctx.fillRect((w - bw) / 2, mid - 3 * d, bw, 6 * d);
        return;
      }
      const n = Math.min(count, MAX_BARS, Math.floor(w / (STEP * d)));
      for (let i = 0; i < n; i++) {
        const v = bars[(count - 1 - i) % MAX_BARS]!;
        const x = w - (i + 1) * STEP * d;
        const bh = Math.max(d, v * (h * 0.46));
        ctx.globalAlpha = 0.25 + 0.75 * (1 - i / n);
        ctx.fillRect(x, mid - bh, BAR_W * d, bh * 2);
      }
      ctx.globalAlpha = 1;
    },
    clear() {
      count = 0;
      acc = 0;
      accN = 0;
      level = 0;
      bars.fill(0);
    },
  };
}
