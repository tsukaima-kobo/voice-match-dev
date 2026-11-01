// 声のかたち: 測った数字から描く、その声だけの図（Canvas 2D）。乱数なし: 同じ数字なら、いつも同じかたち。
// 5 つの層が、項目のまとまりに対応する（どの部分が何を表すかは SHAPE_LAYERS。図の読み方として画面にも出す）。
//   形      … 高さ: 色と縦の伸び／抑揚: ふちのうねり／高さの偏り: 上下のふくらみ／高さの動きの速さ: うねりの速さ
//   芯と模様 … 響き: F1 で芯の上下・F2 で芯の左右（母音の図と同じ向き）／響きの間隔: 内側の輪の間隔／明るさ: 波の細かさと光／音色: 波の形
//   霞と線  … 声の質: 澄み（息）でまわりの霞／柔らかさで線のぼけ／高さのゆらぎで線の切れ目／大きさのゆらぎでふちの粒
//   外の輪  … 速さと間: 速さで粒の数と回る速さ／間の多さで輪のすき間／リズムのムラで粒の大きさのムラ
//   大きさ  … 強さ: 声の力で形の大きさと線の太さ／強弱の幅で脈の大きさ
// 測っていない項目（一言だけの時の、速さと間など）の層は、点線で薄く描く（話すほど、かたちがそろう）。
import { displayValue, FEATURE_BY_KEY, formatFeature, type FeatureKey, type Features } from '../voice/features.ts';

export type ShapeLayer = 'shape' | 'core' | 'mist' | 'orbit' | 'size';
export interface ShapeItem {
  key: FeatureKey;
  /** 図の読み方の名前（無ければ項目の名前） */
  name?: string;
  fig: string;
}
export const SHAPE_LAYERS: readonly { key: ShapeLayer; name: string; items: readonly ShapeItem[] }[] = [
  {
    key: 'shape',
    name: '形',
    items: [
      { key: 'pitch', fig: '全体の色と縦の伸び。高い声ほど縦に伸びて桃色に、低い声ほど横に広がって水色になります。' },
      { key: 'pitchRange', fig: 'ふちと線のうねりの大きさ。抑揚が大きいほど、大きくうねります。' },
      { key: 'pitchSkew', fig: '上下のふくらみ。上に広い声ほど上が、下に広い声ほど下がふくらみます。' },
      { key: 'pitchMotion', fig: '線が芯から外へ流れる速さ。高さがよく動く声ほど、速く流れます。' },
    ],
  },
  {
    key: 'core',
    name: '芯と模様',
    items: [
      { key: 'f1', fig: '光る芯の上下。口を大きく開ける響きほど、芯が下にきます（点線の上下）。' },
      { key: 'f2', fig: '光る芯の左右。舌が前に出る響きほど、芯が右にきます（点線の左右）。' },
      { key: 'formantSpacing', fig: '線の間隔。響きの間隔が広いほど、線が少なく、間が広くなります。' },
      { key: 'centroid', fig: 'ふちのうねりの細かさと、光る星。明るい声ほど、うねりが細かく、星が多く強くなります。' },
      { key: 'mfcc2', name: '音色', fig: '指紋の模様そのものと、まわりを包む光のリボン。リボンは音色（MFCC 1〜13）から計算した響きの山と谷で、上が低い音、下が高い音です。外へふくらむ所ほど、その高さの音が強く響いています。' },
    ],
  },
  {
    key: 'mist',
    name: '霞と線',
    items: [
      { key: 'hnr', fig: 'まわりの霞と、ふわっと出ては消える霞の粒。息が多い声ほど霞と粒が広がり、線が淡くなります。' },
      { key: 'h1h2', fig: '線のぼけ。柔らかい声ほど、線がぼけて光がにじみます。' },
      { key: 'jitter', fig: '線の切れ目と、星の粒のまたたき。高さがゆらぐ声ほど、線があちこちで切れ、まわりの星の粒が速くまたたきます。' },
      { key: 'shimmer', fig: 'ふちのまわりに散る、星のような小さな粒と、線のまだら。大きさがゆらぐ（かすれた）声ほど、粒が増えて広く散ります。' },
    ],
  },
  {
    key: 'orbit',
    name: '外の輪',
    items: [
      { key: 'rate', fig: '外の輪の粒の数と、回る速さ。速く話すほど、粒が多く速く回ります。' },
      { key: 'pauseShare', fig: '外の輪の 3 つのすき間。間が多いほど、すき間が広がります。' },
      { key: 'rhythm', fig: '粒の大きさと並びのムラ。リズムにムラがあるほど、粒がそろいません。' },
    ],
  },
  {
    key: 'size',
    name: '大きさ',
    items: [
      { key: 'tilt', fig: '全体の大きさと線の太さ。力強い声ほど、大きく太くなります（点線の円）。' },
      { key: 'levelRange', fig: 'ゆっくり脈打つ幅。強弱が大きいほど、大きく脈打ちます（2 つの点線の円の間）。' },
    ],
  },
];

/** 図に使う値（0〜1。測っていない項目は null） */
export type ShapeParams = Record<string, number | null>;

const KEYS: readonly FeatureKey[] = ['pitch', 'pitchRange', 'pitchSkew', 'pitchMotion', 'f1', 'f2', 'formantSpacing', 'centroid', 'mfcc1', 'mfcc2', 'mfcc3', 'mfcc4', 'mfcc5', 'mfcc6', 'mfcc7', 'mfcc8', 'mfcc9', 'mfcc10', 'mfcc11', 'mfcc12', 'mfcc13', 'hnr', 'h1h2', 'jitter', 'shimmer', 'rate', 'pauseShare', 'rhythm', 'tilt', 'levelRange'];
/** 数字を、図に使う 0〜1 に（画面の目盛りと同じ位置） */
export function shapeParams(f: Features): ShapeParams {
  const out: ShapeParams = {};
  for (const k of KEYS) {
    const v = f[k];
    out[k] = v === null || !Number.isFinite(v) ? null : displayValue(k, v);
  }
  return out;
}

/** 目盛りの位置から、5 段の言葉（例: やや高い） */
export function levelWord(key: FeatureKey, v: number | null): string {
  if (v === null) return 'まだ測っていません';
  const d = FEATURE_BY_KEY[key];
  const x = displayValue(key, v);
  if (d.low === '−' || d.high === '+') return '';
  if (x < 0.2) return `かなり${d.low}`;
  if (x < 0.4) return `やや${d.low}`;
  if (x <= 0.6) return 'ふつう';
  if (x <= 0.8) return `やや${d.high}`;
  return `かなり${d.high}`;
}

/* ---- 描く ---- */
type RGB = [number, number, number];
export interface ShapePalette {
  low: RGB;
  mid: RGB;
  high: RGB;
  ink: RGB;
  glint: RGB;
  light: boolean;
}
const TAU = Math.PI * 2;
const h1 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const or = (v: number | null | undefined, d = 0.5) => (v === null || v === undefined ? d : v);
const WAVES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export interface DrawOptions {
  /** 時間（秒）。動きを減らす時は 0 のまま */
  t: number;
  /** 光らせる層（ほかは薄く） */
  focus: ShapeLayer | null;
}

export function drawShape(ctx: CanvasRenderingContext2D, S: number, p: ShapeParams, P: ShapePalette, o: DrawOptions): void {
  const u = S / 360;
  const cx = S / 2,
    cy = S / 2;
  const la = (l: ShapeLayer) => (!o.focus || o.focus === l ? 1 : 0.13);
  const pitch = or(p.pitch);
  const col = pitch < 0.5 ? mix(P.low, P.mid, pitch * 2) : mix(P.mid, P.high, (pitch - 0.5) * 2);
  const blend: GlobalCompositeOperation = P.light ? 'source-over' : 'lighter';

  // (大きさ: 声の力で大きさ、強弱の幅で脈)
  const strength = or(p.tilt);
  const pulse = 1 + (0.008 + 0.03 * or(p.levelRange)) * Math.sin(o.t * 1.4);
  const R = S * (0.2 + 0.07 * strength) * pulse;
  const sx = 1.1 - 0.2 * pitch,
    sy = 0.9 + 0.2 * pitch;
  const skew = 0.16 * (or(p.pitchSkew) - 0.5);
  // (ふちの波: 明るさで細かさ、抑揚で大きさ、音色で形、高さの動きで速さ)
  const centre = 2.2 + 7.5 * or(p.centroid);
  const A = 0.025 + 0.16 * or(p.pitchRange);
  const speed = 0.15 + 0.9 * or(p.pitchMotion);
  const timbre = ['mfcc1', 'mfcc2', 'mfcc3', 'mfcc4', 'mfcc5', 'mfcc6'].map((k) => or(p[k]));
  const ws = WAVES.map((n) => Math.exp(-((n - centre) ** 2) / 3));
  const wsum = ws.reduce((a, b) => a + b, 0);
  const ph = WAVES.map((n, i) => TAU * (h1(i * 7.7 + 1.3) + 0.6 * timbre[i % timbre.length]! + 0.25 * timbre[(i + 2) % timbre.length]!) + o.t * speed * (i % 2 ? 1 : -1) * (0.3 + h1(i * 3.3) * 0.5));
  const rad = (th: number, ring: number) => {
    let s = 0;
    for (let i = 0; i < WAVES.length; i++) s += (ws[i]! / wsum) * Math.cos(WAVES[i]! * th + ph[i]! + ring * 0.35);
    return 1 + A * (1 - ring * 0.08) * s + skew * -Math.sin(th);
  };
  const N = Math.max(180, Math.min(360, Math.round(S * 0.6)));
  const point = (th: number, r: number): [number, number] => [cx + r * Math.cos(th) * sx, cy + r * Math.sin(th) * sy];

  ctx.save();
  ctx.clearRect(0, 0, S, S);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 霞（息が多いほど広く濃く）
  const breath = 1 - or(p.hnr);
  {
    const hr = R * (1.35 + 0.7 * breath);
    const g = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, hr);
    g.addColorStop(0, rgba(col, (0.06 + 0.3 * breath) * la('mist')));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, hr, 0, TAU);
    ctx.fill();
    // (霞の粒: 決まった場所に、息の量だけ)
    const n = Math.round(breath * 160);
    ctx.globalCompositeOperation = blend;
    for (let i = 0; i < n; i++) {
      const a = h1(i * 3.17 + 0.11) * TAU;
      const life = (h1(i * 5.71 + 0.37) + o.t * 0.04 * (0.5 + h1(i * 1.9))) % 1;
      const [x, y] = point(a, R * rad(a, 0) * (1.05 + life * (0.3 + 0.5 * breath)));
      const al = Math.sin(Math.PI * life) * (0.15 + 0.4 * breath) * la('mist');
      ctx.fillStyle = rgba(col, al);
      ctx.beginPath();
      ctx.arc(x, y, u * (0.8 + 2.4 * h1(i * 9.13) ** 2), 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // 形の塗り
  ctx.beginPath();
  for (let j = 0; j <= N; j++) {
    const th = (j / N) * TAU;
    const [x, y] = point(th, R * rad(th, 0));
    if (j) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  {
    const g = ctx.createRadialGradient(cx - R * 0.2 * sx, cy - R * 0.25 * sy, 0, cx, cy, R * 1.25);
    g.addColorStop(0, rgba(mix(col, P.glint, 0.45), (P.light ? 0.35 : 0.42) * la('shape')));
    g.addColorStop(0.6, rgba(col, 0.16 * la('shape')));
    g.addColorStop(1, rgba(col, 0.04 * la('shape')));
    ctx.fillStyle = g;
    ctx.fill();
  }

  // 内側の輪（響きの間隔で間をあける）。線は、柔らかさでぼけ、ゆらぎで切れる
  const gap = 0.07 + 0.08 * or(p.formantSpacing);
  const rings = Math.max(3, Math.min(9, Math.floor(0.82 / gap)));
  const soft = or(p.h1h2);
  const cut = 0.45 * or(p.jitter, 0);
  ctx.globalCompositeOperation = blend;
  for (let k = rings - 1; k >= 0; k--) {
    const scale = 1 - k * gap;
    const ringLayer: ShapeLayer = k === 0 ? 'shape' : 'core';
    const a = (k === 0 ? 0.95 : 0.55 - k * 0.04) * (1 - 0.4 * soft);
    ctx.strokeStyle = rgba(k === 0 ? mix(col, P.ink, P.light ? 0.25 : 0.2) : col, a * Math.max(la(ringLayer), k === 0 ? la('mist') : 0));
    ctx.lineWidth = u * (k === 0 ? 1.1 + 2.2 * strength : 0.5 + 0.8 * strength) * (1 + 1.4 * soft);
    ctx.shadowColor = rgba(col, 0.6 * soft * la('mist'));
    ctx.shadowBlur = u * 10 * soft;
    ctx.beginPath();
    let pen = false;
    for (let j = 0; j <= N; j++) {
      if (cut > 0.002 && h1(Math.floor(j / 5) * 7.31 + k * 31.7) < cut) {
        pen = false;
        continue;
      }
      const th = (j / N) * TAU;
      const [x, y] = point(th, R * scale * rad(th, k));
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // ふちの粒（大きさのゆらぎ）
  const grains = Math.round(or(p.shimmer, 0) * 140);
  for (let i = 0; i < grains; i++) {
    const th = h1(i * 2.71 + 5.3) * TAU;
    const [x, y] = point(th, R * rad(th, 0) * (0.96 + 0.1 * h1(i * 4.4)));
    ctx.fillStyle = rgba(mix(col, P.ink, 0.4), (0.35 + 0.4 * h1(i * 8.8)) * la('mist'));
    ctx.fillRect(x, y, u * 1.4, u * 1.4);
  }

  // 光る芯（F2 で左右、F1 で上下。母音の図の向き）
  {
    const f1 = p.f1 ?? null,
      f2 = p.f2 ?? null;
    const kx = (or(f2) - 0.5) * 1.1,
      ky = (or(f1) - 0.5) * 1.1;
    const x = cx + R * 0.55 * kx * sx,
      y = cy + R * 0.55 * ky * sy;
    const cr = R * 0.32;
    const g = ctx.createRadialGradient(x, y, 0, x, y, cr);
    const have = f1 !== null && f2 !== null;
    g.addColorStop(0, rgba(P.glint, (have ? 0.9 : 0.3) * la('core')));
    g.addColorStop(0.35, rgba(mix(col, P.glint, 0.5), (have ? 0.45 : 0.15) * la('core')));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, cr, 0, TAU);
    ctx.fill();
  }

  // 左上の光（明るさ）
  {
    const bright = or(p.centroid);
    const gx = cx - R * 0.45 * sx,
      gy = cy - R * 0.5 * sy;
    const s = u * (3 + 12 * bright) * (1 + 0.1 * Math.sin(o.t * 2.1));
    ctx.fillStyle = rgba(P.glint, (0.15 + 0.75 * bright) * la('core'));
    ctx.beginPath();
    ctx.moveTo(gx, gy - s);
    ctx.quadraticCurveTo(gx, gy, gx + s, gy);
    ctx.quadraticCurveTo(gx, gy, gx, gy + s);
    ctx.quadraticCurveTo(gx, gy, gx - s, gy);
    ctx.quadraticCurveTo(gx, gy, gx, gy - s);
    ctx.fill();
  }

  // 外の輪（速さと間）。測っていなければ点線だけ
  {
    const OR = Math.min(S * 0.47, R * 1.62);
    const rate = p.rate ?? null,
      pause = p.pauseShare ?? null,
      rhythm = p.rhythm ?? null;
    ctx.globalCompositeOperation = 'source-over';
    if (rate === null || pause === null) {
      ctx.setLineDash([u * 2, u * 6]);
      ctx.strokeStyle = rgba(P.ink, 0.22 * la('orbit'));
      ctx.lineWidth = u * 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, OR * sx, OR * sy, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const beads = Math.round(10 + 46 * rate);
      const rot = o.t * (0.05 + 0.3 * rate);
      const gapShare = 0.05 + 0.55 * pause;
      // (the gaps: three of them, so the ring reads as phrases and pauses)
      const inGap = (a: number) => {
        const f = (((a / TAU) % (1 / 3)) + 1 / 3) % (1 / 3);
        return f > (1 / 3) * (1 - gapShare);
      };
      ctx.strokeStyle = rgba(col, 0.28 * la('orbit'));
      ctx.lineWidth = u * 0.8;
      ctx.beginPath();
      ctx.ellipse(cx, cy, OR * sx, OR * sy, 0, 0, TAU);
      ctx.stroke();
      for (let i = 0; i < beads; i++) {
        const a = (i / beads) * TAU + rot;
        if (inGap(a - rot)) continue;
        const uneven = or(rhythm) * (h1(i * 6.1 + 2.2) - 0.5) * 2;
        const r = u * (2.2 + 1.2 * strength) * (1 + 0.75 * uneven);
        const [x, y] = point(a, OR);
        ctx.fillStyle = rgba(mix(col, P.glint, 0.3), 0.85 * la('orbit'));
        ctx.beginPath();
        ctx.arc(x, y, Math.max(u * 0.8, r), 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/* ---- 画面に置く ---- */
function cssColor(probe: CanvasRenderingContext2D, value: string, fallback: RGB): RGB {
  try {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000';
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!];
  } catch {
    return fallback;
  }
}
function readPalette(el: Element): ShapePalette {
  const cs = getComputedStyle(el);
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const c = (n: string, fb: RGB) => cssColor(probe, cs.getPropertyValue(n).trim(), fb);
  const light = !matchMedia('(prefers-color-scheme: dark)').matches;
  return { low: c('--a3', [98, 216, 236]), mid: c('--a2', [122, 77, 255]), high: c('--a1', [240, 71, 143]), ink: c('--ink', [240, 240, 250]), glint: light ? [255, 255, 255] : [255, 246, 252], light };
}

export interface ShapeView {
  set(f: Features): void;
  focus(l: ShapeLayer | null, item?: FeatureKey | null): void;
}

/** canvas に声のかたちを描き続ける（画面に見えない時・ページが隠れた時は止める。動きを減らす設定では止まった絵） */
export function createShapeView(canvas: HTMLCanvasElement): ShapeView {
  const ctx = canvas.getContext('2d')!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let params: ShapeParams | null = null,
    focus: ShapeLayer | null = null,
    // (read at the first drawing: the canvas must be in the page for its colours)
    pal: ShapePalette | null = null,
    visible = true,
    raf = 0,
    t0 = 0;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    pal = null;
    wake();
  });
  function draw(now: number) {
    raf = 0;
    if (!params || !canvas.isConnected) return;
    pal ??= readPalette(canvas);
    const d = Math.min(2, window.devicePixelRatio || 1);
    const S = Math.max(1, Math.round((canvas.clientWidth || 300) * d));
    if (canvas.width !== S || canvas.height !== S) canvas.width = canvas.height = S;
    if (!t0) t0 = now;
    drawShape(ctx, S, params, pal, { t: reduce.matches ? 0 : (now - t0) / 1000, focus });
    if (!reduce.matches && visible && !document.hidden) raf = requestAnimationFrame(draw);
  }
  const wake = () => {
    if (!raf && params) raf = requestAnimationFrame(draw);
  };
  new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting);
    wake();
  }).observe(canvas);
  document.addEventListener('visibilitychange', wake);
  new ResizeObserver(wake).observe(canvas);
  return {
    set(f) {
      params = shapeParams(f);
      canvas.setAttribute('aria-label', `声のかたちの図。${SHAPE_LAYERS.flatMap((l) => l.items.filter((i) => !i.key.startsWith('mfcc')).map((i) => `${FEATURE_BY_KEY[i.key].name} ${formatFeature(i.key, f[i.key])}`)).join('、')}`);
      wake();
    },
    focus(l) {
      focus = l;
      wake();
    },
  };
}

/**
 * 図の読み方: 層ごとに項目の名前を並べ、押すと（マウスなら重ねると）その層だけを光らせて、
 * 数字と、図のどこに出ているかを出す。`values` に、名前ごとの数字を出す声（あなた・お手本など）を渡す。
 */
export function renderGuide(box: HTMLElement, views: readonly ShapeView[], values: readonly { who: string; f: Features }[]): void {
  box.replaceChildren();
  const note = document.createElement('p');
  note.className = 'shape-note';
  note.setAttribute('aria-live', 'polite');
  const REST = '名前を押すと、図のその部分が光ります。';
  note.textContent = REST;
  let current: string | null = null;
  const buttons: HTMLButtonElement[] = [];
  const pick = (item: ShapeItem | null, layer: ShapeLayer | null, sticky: boolean) => {
    for (const v of views) v.focus(layer, item?.key ?? null);
    if (!item) {
      note.textContent = REST;
      return;
    }
    const name = item.name ?? FEATURE_BY_KEY[item.key].name;
    const b = document.createElement('b');
    const parts = values.map(({ who, f }) => {
      const w = item.key.startsWith('mfcc') ? '' : levelWord(item.key, f[item.key]);
      const num = item.key.startsWith('mfcc') ? '' : formatFeature(item.key, f[item.key]);
      return `${values.length > 1 ? `${who} ` : ''}${num}${w ? `（${w}）` : ''}`.trim();
    });
    b.textContent = `${name}${parts.some(Boolean) ? ` ${parts.filter(Boolean).join('・')}` : ''}`;
    note.replaceChildren(b, ' ', item.fig);
    if (sticky) current = item.key;
  };
  for (const layer of SHAPE_LAYERS) {
    const g = document.createElement('div');
    g.className = 'shape-group';
    const h = document.createElement('span');
    h.className = 'shape-layer';
    h.textContent = layer.name;
    g.append(h);
    for (const item of layer.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'shape-chip';
      b.textContent = item.name ?? FEATURE_BY_KEY[item.key].name;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        const on = current !== item.key;
        current = on ? item.key : null;
        for (const x of buttons) x.setAttribute('aria-pressed', String(x === b && on));
        pick(on ? item : null, on ? layer.key : null, on);
      });
      b.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse' && !current) pick(item, layer.key, false);
      });
      b.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse' && !current) pick(null, null, false);
      });
      buttons.push(b);
      g.append(b);
    }
    box.append(g);
  }
  box.append(note);

  // (案内: 見えている間、項目を順に 1 回だけ光らせる。押す・重ねると止まる。動きを減らす設定ではしない)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const all = SHAPE_LAYERS.flatMap((l) => l.items.map((item) => ({ item, layer: l.key })));
  let step = -1,
    timer = 0,
    seen = false;
  const stop = () => {
    clearInterval(timer);
    timer = 0;
  };
  const tour = () => {
    if (current || !box.isConnected) return stop();
    step++;
    if (step >= all.length) {
      stop();
      pick(null, null, false);
      return;
    }
    pick(all[step]!.item, all[step]!.layer, false);
  };
  box.addEventListener('pointerdown', stop, { once: true });
  box.addEventListener('pointerenter', stop, { once: true });
  box.addEventListener('focusin', stop, { once: true });
  new IntersectionObserver((es, obs) => {
    if (seen || !es.some((e) => e.isIntersecting)) return;
    seen = true;
    obs.disconnect();
    // (after the drawing-out of the figure)
    setTimeout(() => {
      if (!current) timer = window.setInterval(tour, 2600);
    }, 2600);
  }).observe(box);
}
