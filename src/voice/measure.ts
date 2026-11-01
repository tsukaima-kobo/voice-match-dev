// 声を測る: 録った声（PCM）から、features.ts の 45 項目の数字を出す。DOM を使わず、乱数も時刻も使わない:
// 同じ音なら、いつも同じ数字（数字は features.ts の `digits` に丸める）。声から性別や年齢は判断しない（測るのは
// 声の音の性質だけ）。音はここで数字にするだけで、どこにも送らず、残さない。
// サイトのマイク（src/voice/listen.ts）と、お手本の声を事前に測る拡張機能（collector/）の両方が、この同じコードを使う
// （物差しをそろえるため）。
//
// 流れ:
// 16 kHz へ直す（窓つき sinc）→ 60 Hz より下を切る → 10 ms ごとの枠（32 ms の窓）の大きさと周波数の分布 →
// その録音の静かな所（雑音の床）から決めた線より大きい枠が「話している所」→ YIN で声の高さ（60〜500 Hz）と有声か →
// 1 周期ずつたどって（相互相関）周期・大きさ・となりの周期との似かた。
// 2026-10-31 に足した物: フォルマント（LPC の根）、MFCC、CPP（ケプストラム）、H1−H2、長い時間の平均スペクトル
// （Hammarberg・傾き）、高さの動きの速さ、間の長さ、ひと続きの長さ、リズム（nPVI）、声の続き方。
// 2026-11-01 に足した物（数万の声を細かく見分けるため。版 3）: 高さの偏り、F4、フォルマントの幅（B1・B2）、
// F1・F2 の動く幅、MFCC 5〜13、音色の動き（となりの枠との MFCC の差）、速さのムラ（ひと続きごとの速さの散らばり）。
// 目盛り（features.ts の lo・hi）は暫定。人の声・配信の音で確かめて見直す。
import { FEATURE_KEYS, roundFeature, type Features } from './features.ts';

/** 測り方の版（数字の意味が変わったら上げる。事前に測ったお手本の数字と利用者の数字は、同じ版どうしで比べる） */
export const MEASURE_VERSION = '3.0.0';

/** the rate the analysis runs at (every clip is brought to it first) */
export const RATE = 16000;
/** frames every 10 ms, each a window of 32 ms (512 samples) */
export const HOP = 160;
export const WIN = 512;
/** the pitch searched (Hz) */
export const F0_MIN = 60;
export const F0_MAX = 500;
const YIN_W = 480;
const YIN_FIRST = 0.15;
const VOICED_MAX = 0.35;
/** the least voiced speech measured by default (seconds); the page and the collector ask for more */
export const MIN_VOICED_SECONDS = 3;
/** the most analysed (seconds) */
export const MAX_SECONDS = 40;
/** a gap in the speech of at least this long (seconds) is a pause (間) */
export const PAUSE_MIN_SECONDS = 0.25;
export const QUIET_DB = -55;
export const MIN_SNR_DB = 15;
export const MAX_CLIPPED = 0.003;
/** LPC: the order at 16 kHz and the window (25 ms) */
const LPC_ORDER = 18;
const LPC_WIN = 400;
/** CPP and H1−H2: a longer window (64 ms) */
const CEP_N = 1024;
/** MFCC: mel filters between these (Hz; the resampler cuts at 7.2 kHz) */
const MEL_FILTERS = 26;
const MEL_LO = 60;
const MEL_HI = 7000;

export type MeasureFail = 'invalid' | 'silent' | 'quiet' | 'noisy' | 'clipped' | 'short';

export interface MeasureInfo {
  /** the clip's length (seconds, at most MAX_SECONDS) */
  seconds: number;
  /** from the first sound of speech to the last (seconds) */
  speechSeconds: number;
  /** the voiced frames (seconds) */
  voicedSeconds: number;
  /** the loud frames (95th percentile) and the quiet floor (5th), dBFS */
  loudDb: number;
  floorDb: number;
  /** the share of the speech's samples at full scale */
  clipped: number;
  /** cycles traced (breath and roughness come from them) and frames with all three formants */
  cycles: number;
  formantFrames: number;
  /** of the frames well under the voice inside the speech, the share that still has a pitch (music under the talk raises it) */
  gapTonal: number;
}

export interface MeasureOptions {
  /** the least voiced speech (seconds, default MIN_VOICED_SECONDS) */
  minVoicedSeconds?: number;
}

export type Measured = { ok: true; features: Features; info: MeasureInfo } | { ok: false; reason: MeasureFail; info: Partial<MeasureInfo> };

/* ---- 小さな道具 ---- */
const dB = (power: number) => 10 * Math.log10(power + 1e-20);
const semitones = (hz: number) => 12 * Math.log2(hz / 100);

/** a quantile (linear between the two nearest ranks) */
export function quantileOf(values: ArrayLike<number>, q: number): number {
  const n = values.length;
  if (!n) return NaN;
  const s = Float64Array.from(values).sort();
  const at = (n - 1) * q;
  const lo = Math.floor(at),
    hi = Math.ceil(at);
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}
const median = (v: ArrayLike<number>) => quantileOf(v, 0.5);
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/* ---- 16 kHz へ（窓つき sinc） ---- */
/** Brought to `to` Hz by a Blackman-windowed sinc low-pass (cut at 0.45 of the lower rate, 8 zero crossings a side). */
export function resample(x: Float64Array, from: number, to: number): Float64Array {
  if (from === to) return x.slice();
  const ratio = from / to;
  const nOut = Math.max(0, Math.floor((x.length - 1) / ratio) + 1);
  const out = new Float64Array(nOut);
  const fc = 0.45 * Math.min(1, 1 / ratio);
  const half = Math.ceil(4 / fc);
  const tap = (u: number) => {
    const v = u / half;
    if (v <= -1 || v >= 1) return 0;
    const w = 0.42 + 0.5 * Math.cos(Math.PI * v) + 0.08 * Math.cos(2 * Math.PI * v);
    const a = 2 * fc * u;
    return (a === 0 ? 1 : Math.sin(Math.PI * a) / (Math.PI * a)) * w;
  };
  const intRates = Number.isInteger(from) && Number.isInteger(to);
  const g = intRates ? gcd(from, to) : 1;
  const p = from / g,
    q = to / g;
  const width = 2 * half + 1;
  let table: Float64Array | null = null;
  if (intRates && q <= 4096) {
    table = new Float64Array(q * width);
    for (let ph = 0; ph < q; ph++) {
      const frac = ph / q;
      let sum = 0;
      for (let j = 0; j < width; j++) {
        const h = tap(j - half - frac);
        table[ph * width + j] = h;
        sum += h;
      }
      for (let j = 0; j < width; j++) table[ph * width + j] = table[ph * width + j]! / sum;
    }
  }
  const len = x.length;
  for (let n = 0; n < nOut; n++) {
    let base: number,
      frac: number,
      ph = 0;
    if (table) {
      const num = n * p;
      base = Math.floor(num / q);
      ph = num - base * q;
      frac = ph / q;
    } else {
      const t = n * ratio;
      base = Math.floor(t);
      frac = t - base;
    }
    let acc = 0,
      wsum = 0;
    for (let j = 0; j < width; j++) {
      const i = base - half + j;
      const h = table ? table[ph * width + j]! : tap(j - half - frac);
      wsum += h;
      if (i >= 0 && i < len) acc += x[i]! * h;
    }
    out[n] = table ? acc : acc / wsum;
  }
  return out;
}

/* ---- 2次のフィルター（Butterworth、RBJ の式） ---- */
function biquad(x: Float64Array, kind: 'low' | 'high', hz: number, rate: number): Float64Array {
  const w0 = (2 * Math.PI * hz) / rate;
  const cs = Math.cos(w0),
    alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = (kind === 'low' ? (1 - cs) / 2 : (1 + cs) / 2) / a0;
  const b1 = (kind === 'low' ? 1 - cs : -(1 + cs)) / a0;
  const b2 = b0;
  const a1 = (-2 * cs) / a0,
    a2 = (1 - alpha) / a0;
  const y = new Float64Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

/* ---- FFT（基数 2、大きさごとに表を持つ） ---- */
interface FftTab {
  cos: Float64Array;
  sin: Float64Array;
  rev: Uint32Array;
}
const fftTabs = new Map<number, FftTab>();
function fftTab(n: number): FftTab {
  let t = fftTabs.get(n);
  if (t) return t;
  const cos = new Float64Array(n / 2),
    sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev };
  fftTabs.set(n, t);
  return t;
}
/** the complex FFT of (re, im) in place (length a power of 2) */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { cos, sin, rev } = fftTab(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) {
      const tr = re[i]!,
        ti = im[i]!;
      re[i] = re[j]!;
      im[i] = im[j]!;
      re[j] = tr;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1,
      stepT = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const k = j * stepT;
        const wr = cos[k]!,
          wi = -sin[k]!;
        const a = i + j,
          b = a + halfSize;
        const tr = re[b]! * wr - im[b]! * wi;
        const ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}
const windows = new Map<string, Float64Array>();
function windowOf(kind: 'hann' | 'hamming', n: number): Float64Array {
  const key = `${kind}${n}`;
  let w = windows.get(key);
  if (w) return w;
  w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = kind === 'hann' ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n) : 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
  windows.set(key, w);
  return w;
}
/** the power spectrum (bins 0..n/2) of x[start .. start+n), windowed (outside the signal: 0) */
function powerSpectrum(x: Float64Array, start: number, w: Float64Array, re: Float64Array, im: Float64Array, power: Float64Array): void {
  const n = w.length;
  for (let i = 0; i < n; i++) {
    const j = start + i;
    re[i] = j >= 0 && j < x.length ? x[j]! * w[i]! : 0;
    im[i] = 0;
  }
  fft(re, im);
  for (let k = 0; k <= n / 2; k++) power[k] = re[k]! * re[k]! + im[k]! * im[k]!;
}
const BIN_HZ = RATE / WIN;
const bin = (hz: number) => Math.round(hz / BIN_HZ);
/** the pre-emphasis (1 − 0.97 z⁻¹) on the power of each bin (響き) */
const LIFT = Float64Array.from({ length: WIN / 2 + 1 }, (_, k) => 1 + 0.97 * 0.97 - 2 * 0.97 * Math.cos((2 * Math.PI * k) / WIN));

/* ---- メルの帯（MFCC） ---- */
const melOf = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const hzOfMel = (m: number) => 700 * (10 ** (m / 2595) - 1);
/** triangular filters on the bins of a WIN-point spectrum: [first bin, weights] for each */
const MEL_BANK: [number, Float64Array][] = (() => {
  const lo = melOf(MEL_LO),
    hi = melOf(MEL_HI);
  const edges = Array.from({ length: MEL_FILTERS + 2 }, (_, i) => hzOfMel(lo + ((hi - lo) * i) / (MEL_FILTERS + 1)));
  const bank: [number, Float64Array][] = [];
  for (let m = 1; m <= MEL_FILTERS; m++) {
    const a = edges[m - 1]!,
      c = edges[m]!,
      b = edges[m + 1]!;
    const k0 = Math.ceil(a / BIN_HZ),
      k1 = Math.floor(b / BIN_HZ);
    const w = new Float64Array(Math.max(0, k1 - k0 + 1));
    for (let k = k0; k <= k1; k++) {
      const f = k * BIN_HZ;
      w[k - k0] = f <= c ? (f - a) / (c - a) : (b - f) / (b - c);
    }
    bank.push([k0, w]);
  }
  return bank;
})();
/** MFCC 1..13 */
const MFCC_N = 13;
/** the orthonormal DCT-II rows 1..13 (c0, the loudness, is left out: it moves with the gain) */
const DCT_ROWS = Array.from({ length: MFCC_N }, (_, i) => i + 1).map((q) => Float64Array.from({ length: MEL_FILTERS }, (_, m) => Math.sqrt(2 / MEL_FILTERS) * Math.cos((Math.PI * q * (m + 0.5)) / MEL_FILTERS)));

/* ---- YIN（1 枠の声の高さ） ---- */
function yin(x: Float64Array, sq: Float64Array, b: number, tauMin: number, tauMax: number, d: Float64Array): { tau: number; dip: number } {
  const e0 = sq[b + YIN_W]! - sq[b]!;
  let run = 0;
  d[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    let cross = 0;
    for (let j = 0; j < YIN_W; j++) cross += x[b + j]! * x[b + j + tau]!;
    const et = sq[b + tau + YIN_W]! - sq[b + tau]!;
    const diff = Math.max(0, e0 + et - 2 * cross);
    run += diff;
    d[tau] = run > 0 ? (diff * tau) / run : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t]! < YIN_FIRST) {
      while (t + 1 <= tauMax && d[t + 1]! < d[t]!) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    tau = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (d[t]! < d[tau]!) tau = t;
  }
  const dip = d[tau]!;
  if (tau <= tauMin || tau >= tauMax) return { tau: 0, dip: 1 };
  const a = d[tau - 1]!,
    c = d[tau + 1]!;
  const den = a - 2 * dip + c;
  let delta = den > 0 ? (a - c) / (2 * den) : 0;
  if (delta > 1) delta = 1;
  else if (delta < -1) delta = -1;
  return { tau: tau + delta, dip };
}

/* ---- 周期を1つずつたどる（相互相関） ---- */
function ncc(x: Float64Array, sq: Float64Array, m: number, tau: number, n: number): number {
  let c = 0;
  for (let j = 0; j < n; j++) c += x[m + j]! * x[m + tau + j]!;
  const ea = sq[m + n]! - sq[m]!,
    eb = sq[m + tau + n]! - sq[m + tau]!;
  const den = Math.sqrt(ea * eb);
  return den > 0 ? c / den : 0;
}
function peakOf(a: number, b: number, c: number): [number, number] {
  const den = a - 2 * b + c;
  if (den >= 0) return [0, b];
  let off = (a - c) / (2 * den);
  if (off > 0.5) off = 0.5;
  else if (off < -0.5) off = -0.5;
  return [off, b - ((a - c) * off) / 4];
}
function peakBetween(v: Float64Array, k: number, centre: number): number {
  let top = -Infinity;
  for (let s = -24; s <= 24; s++) {
    const u = centre + s / 16;
    let y = 0;
    for (let j = -k; j <= k; j++) {
      const x = u - j;
      if (Math.abs(x) >= k + 1) continue;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (k + 1));
      y += v[j + k]! * (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w;
    }
    if (y > top) top = y;
  }
  return top;
}

/* ---- LPC とフォルマント ---- */
/** LPC coefficients a[0..p] (a[0] = 1) of a windowed frame by Levinson–Durbin; false when it cannot be found */
function lpcOf(frame: Float64Array, p: number, r: Float64Array, a: Float64Array, tmp: Float64Array): boolean {
  const n = frame.length;
  for (let k = 0; k <= p; k++) {
    let s = 0;
    for (let i = 0; i + k < n; i++) s += frame[i]! * frame[i + k]!;
    r[k] = s;
  }
  if (!(r[0]! > 0)) return false;
  // (a slight lag window: the autocorrelation times a Gaussian, so that a single harmonic is not taken for a formant)
  for (let k = 1; k <= p; k++) r[k] = r[k]! * Math.exp(-0.5 * ((2 * Math.PI * 40 * k) / RATE) ** 2);
  r[0] = r[0]! * (1 + 1e-9);
  a.fill(0);
  a[0] = 1;
  let err = r[0]!;
  for (let i = 1; i <= p; i++) {
    let acc = r[i]!;
    for (let j = 1; j < i; j++) acc += a[j]! * r[i - j]!;
    const k = -acc / err;
    for (let j = 0; j <= i; j++) tmp[j] = a[j]!;
    for (let j = 1; j < i; j++) a[j] = tmp[j]! + k * tmp[i - j]!;
    a[i] = k;
    err *= 1 - k * k;
    if (!(err > 0)) return false;
  }
  return true;
}
/** the roots of z^p + a1 z^(p−1) + … + ap (Durand–Kerner, fixed start: the same input gives the same roots) */
function rootsOf(a: Float64Array, p: number, zr: Float64Array, zi: Float64Array): boolean {
  let br = 1,
    bi = 0;
  for (let k = 0; k < p; k++) {
    const nr = br * 0.4 - bi * 0.9,
      ni = br * 0.9 + bi * 0.4;
    br = nr;
    bi = ni;
    zr[k] = br;
    zi[k] = bi;
  }
  for (let iter = 0; iter < 500; iter++) {
    let moved = 0;
    for (let k = 0; k < p; k++) {
      const xr = zr[k]!,
        xi = zi[k]!;
      let pr = 1,
        pi = 0;
      for (let j = 1; j <= p; j++) {
        const nr = pr * xr - pi * xi + a[j]!;
        pi = pr * xi + pi * xr;
        pr = nr;
      }
      let dr = 1,
        di = 0;
      for (let j = 0; j < p; j++) {
        if (j === k) continue;
        const ur = xr - zr[j]!,
          ui = xi - zi[j]!;
        const nr = dr * ur - di * ui;
        di = dr * ui + di * ur;
        dr = nr;
      }
      const den = dr * dr + di * di;
      if (!(den > 0)) return false;
      const qr = (pr * dr + pi * di) / den,
        qi = (pi * dr - pr * di) / den;
      zr[k] = xr - qr;
      zi[k] = xi - qi;
      const m = Math.abs(qr) + Math.abs(qi);
      if (m > moved) moved = m;
    }
    if (moved < 1e-11) return true;
  }
  return false;
}
interface FrameFormants {
  /** F1..F3 (Hz) */
  f: [number, number, number];
  /** F4 (Hz), or NaN when the frame has none */
  f4: number;
  /** the bandwidths of F1 and F2 (Hz) */
  b: [number, number];
}
/** F1..F4 and the bandwidths of F1 and F2 of a frame from the LPC's roots, or null (F1..F3 are needed) */
function formantsOf(zr: Float64Array, zi: Float64Array, p: number): FrameFormants | null {
  const cand: [number, number][] = [];
  for (let k = 0; k < p; k++) {
    if (!(zi[k]! > 0)) continue;
    const f = (Math.atan2(zi[k]!, zr[k]!) * RATE) / (2 * Math.PI);
    const bw = (-RATE / Math.PI) * Math.log(Math.hypot(zr[k]!, zi[k]!));
    if (f > 90 && f < RATE / 2 - 90 && bw > 0 && bw < 500) cand.push([f, bw]);
  }
  cand.sort((x, y) => x[0] - y[0]);
  const c1 = cand.find(([f]) => f >= 200 && f <= 1200);
  if (c1 === undefined) return null;
  const c2 = cand.find(([f]) => f >= Math.max(600, c1[0] + 150) && f <= 3200);
  if (c2 === undefined) return null;
  const c3 = cand.find(([f]) => f >= Math.max(1500, c2[0] + 150) && f <= 4500);
  if (c3 === undefined) return null;
  const c4 = cand.find(([f]) => f >= Math.max(2500, c3[0] + 300) && f <= 5500);
  return { f: [c1[0], c2[0], c3[0]], f4: c4 ? c4[0] : NaN, b: [c1[1], c2[1]] };
}

/** the amplitude of x at `hz` over a Hann window of n samples centred on `centre` (a single DFT bin, between bins) */
function amplitudeAt(x: Float64Array, centre: number, n: number, hz: number): number {
  const start = centre - (n >> 1);
  let re = 0,
    im = 0;
  const w = (2 * Math.PI * hz) / RATE;
  for (let i = 0; i < n; i++) {
    const j = start + i;
    if (j < 0 || j >= x.length) continue;
    const v = x[j]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    re += v * Math.cos(w * i);
    im -= v * Math.sin(w * i);
  }
  return Math.hypot(re, im);
}

/** a straight line through (x, y) by least squares: the slope */
function slopeOf(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  let sx = 0,
    sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n,
    my = sy / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den > 0 ? num / den : NaN;
}

/* ---- 測る ---- */
const fail = (reason: MeasureFail, info: Partial<MeasureInfo>): Measured => ({ ok: false, reason, info });

/**
 * The numbers of a voice from its recording: mono PCM (-1..1) at `sampleRate` Hz (8–192 kHz). The same samples give
 * the same result. Fails (ok: false) on what cannot be measured.
 */
export function measureVoice(pcm: ArrayLike<number>, sampleRate: number, opts: MeasureOptions = {}): Measured {
  const minVoiced = opts.minVoicedSeconds ?? MIN_VOICED_SECONDS;
  if (!pcm || !(sampleRate >= 8000 && sampleRate <= 192000) || pcm.length < sampleRate * 0.1) return fail('invalid', {});
  const n0 = Math.min(pcm.length, Math.floor(MAX_SECONDS * sampleRate));
  const seconds = n0 / sampleRate;
  const raw = new Float64Array(n0);
  let peak = 0,
    bad = 0;
  const clipAt = new Uint32Array(Math.ceil((n0 * RATE) / sampleRate / HOP) + 2);
  for (let i = 0; i < n0; i++) {
    let v = Number(pcm[i]);
    if (!Number.isFinite(v)) {
      bad++;
      v = 0;
    }
    raw[i] = v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    if (a >= 0.99) clipAt[Math.max(0, Math.round(((i * RATE) / sampleRate - WIN / 2) / HOP))]!++;
  }
  if (bad > n0 * 0.01) return fail('invalid', { seconds });
  if (peak < 1e-4) return fail('silent', { seconds });

  const x16 = resample(raw, sampleRate, RATE);
  const s = biquad(x16, 'high', 60, RATE);
  const len = s.length;
  if (len < WIN + YIN_W) return fail('short', { seconds, voicedSeconds: 0 });
  const lp = biquad(biquad(s, 'low', 1500, RATE), 'low', 1500, RATE);
  const lift = new Float64Array(len);
  for (let i = 0; i < len; i++) lift[i] = s[i]! - 0.97 * (i ? s[i - 1]! : 0);
  const pe = biquad(biquad(lift, 'low', 5000, RATE), 'low', 5000, RATE);
  const prefix = (v: Float64Array) => {
    const q = new Float64Array(v.length + 1);
    for (let i = 0; i < v.length; i++) q[i + 1] = q[i]! + v[i]! * v[i]!;
    return q;
  };
  const sqLp = prefix(lp),
    sqPe = prefix(pe);

  /* 枠ごとの大きさと周波数の分布 */
  const nF = Math.floor((len - WIN) / HOP) + 1;
  const hann = windowOf('hann', WIN);
  let hannSum2 = 0;
  for (let i = 0; i < WIN; i++) hannSum2 += hann[i]! * hann[i]!;
  const level = new Float64Array(nF);
  const syl = new Float64Array(nF);
  const lowBand = new Float64Array(nF),
    highBand = new Float64Array(nF),
    cenNum = new Float64Array(nF),
    cenDen = new Float64Array(nF);
  const re = new Float64Array(WIN),
    im = new Float64Array(WIN),
    pw = new Float64Array(WIN / 2 + 1);
  const kSyl0 = bin(300),
    kSyl1 = bin(3000),
    kLow0 = bin(80),
    kLow1 = bin(1000),
    kHigh1 = bin(4000),
    kCen0 = bin(300);
  for (let f = 0; f < nF; f++) {
    powerSpectrum(s, f * HOP, hann, re, im, pw);
    let total = 0;
    for (let k = 0; k <= WIN / 2; k++) total += (k === 0 || k === WIN / 2 ? 1 : 2) * pw[k]!;
    level[f] = dB(total / WIN / hannSum2);
    let a = 0,
      lo = 0,
      hi = 0,
      cn = 0,
      cd = 0;
    for (let k = kSyl0; k < kSyl1; k++) a += pw[k]!;
    for (let k = kLow0; k < kLow1; k++) lo += pw[k]!;
    for (let k = kLow1; k < kHigh1; k++) hi += pw[k]!;
    for (let k = kCen0; k < kHigh1; k++) {
      const w = pw[k]! * LIFT[k]!;
      cn += k * BIN_HZ * w;
      cd += w;
    }
    syl[f] = dB(a);
    lowBand[f] = lo;
    highBand[f] = hi;
    cenNum[f] = cn;
    cenDen[f] = cd;
  }

  /* 雑音の床と、話している所の線 */
  const floorDb = quantileOf(
    level.map((v) => Math.max(v, -100)),
    0.05,
  );
  const loudDb = quantileOf(level, 0.95);
  const base = { seconds, loudDb, floorDb };
  const snr = loudDb - floorDb;
  if (loudDb < -75 || (snr < 6 && loudDb < -45)) return fail('silent', base);
  if (loudDb < QUIET_DB) return fail('quiet', base);
  if (snr < MIN_SNR_DB) return fail('noisy', base);
  const gate = Math.max(floorDb + Math.max(6, 0.3 * snr), loudDb - 30);

  /* 声の高さ（YIN）と有声かどうか */
  const tauMin = Math.floor(RATE / F0_MAX),
    tauMax = Math.ceil(RATE / F0_MIN);
  const d = new Float64Array(tauMax + 2);
  const f0 = new Float64Array(nF);
  for (let f = 0; f < nF; f++) {
    if (level[f]! < gate) continue;
    const b = f * HOP + WIN / 2 - YIN_W / 2;
    if (b < 0 || b + YIN_W + tauMax + 1 >= len) continue;
    const r = yin(lp, sqLp, b, tauMin, tauMax, d);
    if (r.tau > 0 && r.dip <= VOICED_MAX) {
      const hz = RATE / r.tau;
      if (hz >= F0_MIN && hz <= F0_MAX) f0[f] = hz;
    }
  }
  const runsOf = (on: (f: number) => boolean): [number, number][] => {
    const out: [number, number][] = [];
    let a = -1;
    for (let f = 0; f <= nF; f++) {
      const v = f < nF && on(f);
      if (v && a < 0) a = f;
      else if (!v && a >= 0) {
        out.push([a, f - 1]);
        a = -1;
      }
    }
    return out;
  };
  for (const [a, b] of runsOf((f) => f0[f]! > 0)) if (b - a + 1 < 3) for (let f = a; f <= b; f++) f0[f] = 0;
  const st = new Float64Array(nF);
  for (let f = 0; f < nF; f++) st[f] = f0[f]! > 0 ? semitones(f0[f]!) : 0;
  const slips: number[] = [];
  for (const [a, b] of runsOf((f) => f0[f]! > 0)) {
    for (let f = a; f <= b; f++) {
      const near: number[] = [];
      for (let g = Math.max(a, f - 4); g <= Math.min(b, f + 4); g++) near.push(st[g]!);
      if (Math.abs(st[f]! - median(near)) > 5) slips.push(f);
    }
  }
  for (const f of slips) f0[f] = 0;
  const voiced = (f: number) => f0[f]! > 0;
  let nVoiced = 0;
  for (let f = 0; f < nF; f++) if (voiced(f)) nVoiced++;
  const voicedSeconds = (nVoiced * HOP) / RATE;

  /* 話している所（短いすき間はつなぎ、声の無い所だけの物は除く） */
  const pauseFrames = Math.round((PAUSE_MIN_SECONDS * RATE) / HOP);
  const segs: [number, number][] = [];
  for (const [a, b] of runsOf((f) => level[f]! >= gate)) {
    const last = segs[segs.length - 1];
    if (last && a - last[1] - 1 < pauseFrames) last[1] = b;
    else segs.push([a, b]);
  }
  const speech = segs.filter(([a, b]) => {
    let v = 0;
    for (let f = a; f <= b; f++) if (voiced(f)) v++;
    return b - a + 1 >= 6 && v >= 5;
  });
  const frameS = HOP / RATE;
  const speechSeconds = speech.length ? (speech[speech.length - 1]![1] - speech[0]![0] + 1) * frameS : 0;
  let speakFrames = 0,
    clipped = 0;
  for (const [a, b] of speech) {
    speakFrames += b - a + 1;
    for (let f = a; f <= b; f++) clipped += clipAt[f] ?? 0;
  }
  const clippedShare = speakFrames ? clipped / ((speakFrames * HOP * sampleRate) / RATE) : 0;
  const info0 = { ...base, voicedSeconds, speechSeconds, clipped: clippedShare };
  if (clippedShare > MAX_CLIPPED) return fail('clipped', info0);
  if (voicedSeconds < minVoiced || !speech.length) return fail('short', info0);
  const inSpeech = new Uint8Array(nF);
  for (const [a, b] of speech) for (let f = a; f <= b; f++) inSpeech[f] = 1;
  const isVs = (f: number) => voiced(f) && inSpeech[f] === 1;

  /* 高さ・抑揚・高さの動きの速さ */
  const vf: number[] = [];
  const vst: number[] = [];
  for (let f = 0; f < nF; f++)
    if (isVs(f)) {
      vf.push(f0[f]!);
      vst.push(st[f]!);
    }
  const f0Hz = median(vf);
  const st10 = quantileOf(vst, 0.1),
    st50 = quantileOf(vst, 0.5),
    st90 = quantileOf(vst, 0.9);
  const f0RangeSt = st90 - st10;
  // (positive: the voice reaches further up from its middle than down)
  const pitchSkew = st90 - st50 - (st50 - st10);
  const motions: number[] = [];
  for (let f = 2; f < nF - 2; f++) {
    let all = true;
    for (let g = f - 2; g <= f + 2; g++) if (!isVs(g)) all = false;
    if (all) motions.push(Math.abs(st[f + 2]! - st[f - 2]!) / (4 * frameS));
  }
  const pitchMotion = motions.length >= 50 ? median(motions) : NaN;

  /* 速さ（音の山の数）・間・ひと続き・リズム・声の続き方 */
  const sm = new Float64Array(nF);
  for (let f = 0; f < nF; f++) sm[f] = (syl[Math.max(0, f - 1)]! + syl[f]! + syl[Math.min(nF - 1, f + 1)]!) / 3;
  const nearVoiced = (f: number) => {
    for (let g = Math.max(0, f - 2); g <= Math.min(nF - 1, f + 2); g++) if (voiced(g)) return true;
    return false;
  };
  const peaks: number[] = [];
  for (let f = 1; f < nF - 1; f++) {
    if (!inSpeech[f] || level[f]! < gate || !nearVoiced(f) || !(sm[f]! >= sm[f - 1]! && sm[f]! > sm[f + 1]!)) continue;
    const last = peaks[peaks.length - 1];
    if (last === undefined) {
      peaks.push(f);
      continue;
    }
    let dip = Infinity;
    for (let g = last; g <= f; g++) if (sm[g]! < dip) dip = sm[g]!;
    const apart = f - last >= 6 && sm[last]! - dip >= 3 && sm[f]! - dip >= 3;
    if (apart) peaks.push(f);
    else if (sm[f]! > sm[last]!) peaks[peaks.length - 1] = f;
  }
  const rate = peaks.length / (speakFrames * frameS);
  // (速さのムラ: the syllable rate of each stretch of speech of 1 s or more; their spread over their mean, from 4 stretches)
  const runRates: number[] = [];
  {
    let pi = 0;
    for (const [ra, rb] of speech) {
      let n = 0;
      while (pi < peaks.length && peaks[pi]! < ra) pi++;
      while (pi < peaks.length && peaks[pi]! <= rb) {
        n++;
        pi++;
      }
      const sec = (rb - ra + 1) * frameS;
      if (sec >= 1) runRates.push(n / sec);
    }
  }
  let rateVar = NaN;
  if (runRates.length >= 4) {
    const mean = runRates.reduce((x, y) => x + y, 0) / runRates.length;
    const sd = Math.sqrt(runRates.reduce((x, y) => x + (y - mean) ** 2, 0) / runRates.length);
    rateVar = mean > 0 ? sd / mean : NaN;
  }
  const gapsLen: number[] = [];
  let gaps = 0;
  for (let i = 1; i < speech.length; i++) {
    const g = speech[i]![0] - speech[i - 1]![1] - 1;
    gaps += g;
    gapsLen.push(g * frameS);
  }
  const pauseShare = speechSeconds > 0 ? (gaps * frameS) / speechSeconds : 0;
  const pauseLen = gapsLen.length ? median(gapsLen) : NaN;
  const runLen = median(speech.map(([a, b]) => (b - a + 1) * frameS));
  // (nPVI of the intervals between syllable peaks inside the same stretch of speech)
  const segOf = new Int32Array(nF).fill(-1);
  speech.forEach(([a, b], i) => {
    for (let f = a; f <= b; f++) segOf[f] = i;
  });
  const pvi: number[] = [];
  for (let i = 2; i < peaks.length; i++) {
    const p0 = peaks[i - 2]!,
      p1 = peaks[i - 1]!,
      p2 = peaks[i]!;
    if (segOf[p0] !== segOf[p2] || segOf[p0]! < 0) continue;
    const d1 = p1 - p0,
      d2 = p2 - p1;
    // (an interval over 0.5 s is a hesitation, not the rhythm)
    if (d1 > 50 || d2 > 50) continue;
    pvi.push(Math.abs(d1 - d2) / ((d1 + d2) / 2));
  }
  const rhythm = pvi.length >= 8 ? (100 * pvi.reduce((x, y) => x + y, 0)) / pvi.length : NaN;
  let voicedInSpeech = 0;
  for (let f = 0; f < nF; f++) if (isVs(f)) voicedInSpeech++;
  const voicedShare = speakFrames ? voicedInSpeech / speakFrames : NaN;
  /* 強さ・響き（枠の分布から） */
  const vl: number[] = [];
  let lowSum = 0,
    highSum = 0,
    cn = 0,
    cd = 0;
  for (let f = 0; f < nF; f++) {
    if (!isVs(f)) continue;
    vl.push(level[f]!);
    lowSum += lowBand[f]!;
    highSum += highBand[f]!;
    cn += cenNum[f]!;
    cd += cenDen[f]!;
  }
  const levelRangeDb = quantileOf(vl, 0.95) - quantileOf(vl, 0.05);
  const tiltDb = dB(highSum) - dB(lowSum);
  const centroidHz = cd > 0 ? cn / cd : NaN;
  // (music under the talk: of the frames well under the voice (15 dB below its median) between the first sound of speech
  // and the last, the share that still has a pitch. In speech those are pauses, closures and voiceless sounds; a tune
  // under the talk keeps them tonal)
  const lowLine = median(vl) - 15;
  let lowFrames = 0,
    lowTonal = 0;
  for (let f = speech[0]![0]; f <= speech[speech.length - 1]![1]; f++) {
    if (level[f]! >= lowLine || level[f]! < -70) continue;
    const b = f * HOP + WIN / 2 - YIN_W / 2;
    if (b < 0 || b + YIN_W + tauMax + 1 >= len) continue;
    lowFrames++;
    const yr = yin(lp, sqLp, b, tauMin, tauMax, d);
    if (yr.tau > 0 && yr.dip <= VOICED_MAX) lowTonal++;
  }
  const gapTonal = lowFrames >= 20 ? lowTonal / lowFrames : 0;

  /* 有声の枠ごと: 長い時間の平均スペクトル・MFCC・フォルマント・CPP・H1−H2 */
  const ltas = new Float64Array(WIN / 2 + 1);
  const mfcc = new Float64Array(MFCC_N);
  let mfccN = 0;
  // (音色の動き: the distance between the MFCC of a voiced frame and the one just before it)
  const cNow = new Float64Array(MFCC_N),
    cPrev = new Float64Array(MFCC_N);
  let prevF = -2;
  const mfccSteps: number[] = [];
  const F1: number[] = [],
    F2: number[] = [],
    F3: number[] = [],
    F4: number[] = [],
    B1: number[] = [],
    B2: number[] = [],
    dF: number[] = [];
  const cpps: number[] = [],
    h12: number[] = [];
  const melE = new Float64Array(MEL_FILTERS);
  const lpcFrame = new Float64Array(LPC_WIN);
  const hamming = windowOf('hamming', LPC_WIN);
  const r = new Float64Array(LPC_ORDER + 1),
    a = new Float64Array(LPC_ORDER + 1),
    tmp = new Float64Array(LPC_ORDER + 1),
    zr = new Float64Array(LPC_ORDER),
    zi = new Float64Array(LPC_ORDER);
  const hannC = windowOf('hann', CEP_N);
  const reC = new Float64Array(CEP_N),
    imC = new Float64Array(CEP_N),
    pwC = new Float64Array(CEP_N / 2 + 1);
  const qLo = Math.floor(RATE / F0_MAX),
    qHi = Math.ceil(RATE / F0_MIN);
  const qFit0 = Math.round(0.001 * RATE),
    qFit1 = Math.round(0.03 * RATE);
  const cep = new Float64Array(CEP_N / 2 + 1);
  for (let f = 0; f < nF; f++) {
    if (!isVs(f)) continue;
    const centre = f * HOP + WIN / 2;
    // (the spectrum once more, for the long-term average and the MFCC)
    powerSpectrum(s, f * HOP, hann, re, im, pw);
    for (let k = 0; k <= WIN / 2; k++) ltas[k] = ltas[k]! + pw[k]!;
    let melFloor = 0;
    for (let m = 0; m < MEL_FILTERS; m++) {
      const [k0, w] = MEL_BANK[m]!;
      let e = 0;
      for (let j = 0; j < w.length; j++) e += w[j]! * pw[k0 + j]!;
      melE[m] = e;
      if (e > melFloor) melFloor = e;
    }
    // (a floor 80 dB under the frame's strongest band: empty bands do not swing the shape)
    melFloor *= 1e-8;
    for (let m = 0; m < MEL_FILTERS; m++) melE[m] = Math.log(Math.max(melE[m]!, melFloor) + 1e-30);
    for (let q = 0; q < MFCC_N; q++) {
      const row = DCT_ROWS[q]!;
      let c = 0;
      for (let m = 0; m < MEL_FILTERS; m++) c += row[m]! * melE[m]!;
      mfcc[q] = mfcc[q]! + c;
      cNow[q] = c;
    }
    mfccN++;
    if (prevF === f - 1) {
      let d2 = 0;
      for (let q = 0; q < MFCC_N; q++) d2 += (cNow[q]! - cPrev[q]!) ** 2;
      mfccSteps.push(Math.sqrt(d2));
    }
    cPrev.set(cNow);
    prevF = f;
    // (formants: LPC of the lifted signal, 25 ms Hamming)
    const l0 = centre - (LPC_WIN >> 1);
    if (l0 >= 0 && l0 + LPC_WIN <= len) {
      for (let i = 0; i < LPC_WIN; i++) lpcFrame[i] = lift[l0 + i]! * hamming[i]!;
      if (lpcOf(lpcFrame, LPC_ORDER, r, a, tmp) && rootsOf(a, LPC_ORDER, zr, zi)) {
        const fm = formantsOf(zr, zi, LPC_ORDER);
        if (fm) {
          const [g1, g2, g3] = fm.f;
          F1.push(g1);
          F2.push(g2);
          F3.push(g3);
          if (Number.isFinite(fm.f4)) F4.push(fm.f4);
          B1.push(fm.b[0]);
          B2.push(fm.b[1]);
          dF.push((0.5 * g1 + 1.5 * g2 + 2.5 * g3) / 8.75);
        }
      }
    }
    // (CPP: the cepstrum of the dB spectrum over 64 ms; its peak where the pitch can be, over a straight line fitted
    // from 1 ms to 30 ms; smoothed over 3 quefrency bins)
    const c0 = centre - CEP_N / 2;
    if (c0 >= 0 && c0 + CEP_N <= len) {
      powerSpectrum(s, c0, hannC, reC, imC, pwC);
      for (let k = 0; k < CEP_N; k++) {
        const kk = k <= CEP_N / 2 ? k : CEP_N - k;
        reC[k] = dB(pwC[kk]!);
        imC[k] = 0;
      }
      fft(reC, imC);
      for (let q = 0; q <= CEP_N / 2; q++) cep[q] = dB((reC[q]! * reC[q]! + imC[q]! * imC[q]!) / (CEP_N * CEP_N));
      const sm3 = (q: number) => (cep[Math.max(0, q - 1)]! + cep[q]! + cep[Math.min(CEP_N / 2, q + 1)]!) / 3;
      let best = qLo;
      for (let q = qLo; q <= Math.min(qHi, CEP_N / 2 - 1); q++) if (sm3(q) > sm3(best)) best = q;
      let sx = 0,
        sy = 0,
        sxx = 0,
        sxy = 0,
        n = 0;
      for (let q = qFit0; q <= Math.min(qFit1, CEP_N / 2); q++) {
        const y = sm3(q);
        sx += q;
        sy += y;
        sxx += q * q;
        sxy += q * y;
        n++;
      }
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      const icpt = (sy - slope * sx) / n;
      cpps.push(sm3(best) - (icpt + slope * best));
    }
    // (H1−H2: the first two harmonics over four periods, each the highest of five tries within ±3 %)
    const fz = f0[f]!;
    const nWin = Math.min(CEP_N, Math.max(128, Math.round((4 * RATE) / fz)));
    if (centre - (nWin >> 1) >= 0 && centre + (nWin >> 1) < len) {
      let h1 = 0,
        h2 = 0;
      for (const k of [-0.03, -0.015, 0, 0.015, 0.03]) {
        h1 = Math.max(h1, amplitudeAt(x16, centre, nWin, fz * (1 + k)));
        h2 = Math.max(h2, amplitudeAt(x16, centre, nWin, 2 * fz * (1 + k)));
      }
      if (h1 > 0 && h2 > 0) h12.push(20 * Math.log10(h1 / h2));
    }
  }
  const ltasDb = Array.from(ltas, (v) => dB(v / Math.max(1, mfccN)));
  const maxIn = (lo: number, hi: number) => {
    let m = -Infinity;
    for (let k = bin(lo); k <= Math.min(WIN / 2, bin(hi)); k++) m = Math.max(m, ltasDb[k]!);
    return m;
  };
  const hammarberg = maxIn(0, 2000) - maxIn(2000, 5000);
  const slopeBand = (lo: number, hi: number) => {
    const xs: number[] = [],
      ys: number[] = [];
    for (let k = Math.max(1, bin(lo)); k <= bin(hi); k++) {
      xs.push((k * BIN_HZ) / 1000);
      ys.push(ltasDb[k]!);
    }
    return slopeOf(xs, ys);
  };
  const slopeLow = slopeBand(0, 500);
  const slopeMid = slopeBand(500, 1500);

  /* 息とかすれ（1 周期ずつ） */
  const frameAt = (p: number) => Math.round((p - WIN / 2) / HOP);
  const K = 4;
  const v = new Float64Array(2 * K + 1);
  const dT: number[] = [],
    dA: number[] = [],
    matches: number[] = [];
  let sumT = 0,
    sumA = 0,
    nCycles = 0;
  for (const [ra, rb] of runsOf(isVs)) {
    if (rb - ra + 1 < 5) continue;
    const start = Math.max(0, ra * HOP + WIN / 2 - HOP / 2);
    const end = Math.min(len, rb * HOP + WIN / 2 + HOP / 2);
    const periodAt = (p: number) => RATE / f0[Math.min(rb, Math.max(ra, frameAt(p)))]!;
    let m = start;
    const T0 = periodAt(start);
    for (let p = start; p < Math.min(end, start + Math.ceil(T0)); p++) if (lp[p]! > lp[m]!) m = p;
    let mf = m;
    let clear = false;
    const P: number[] = [],
      A: number[] = [],
      J: boolean[] = [];
    for (;;) {
      const T = periodAt(m);
      const n = Math.round(T);
      const lo = Math.max(2, Math.floor(0.8 * T)),
        hi = Math.ceil(1.25 * T);
      if (m + hi + 1 + n > end) break;
      let best = lo,
        bestR = -Infinity;
      for (let tau = lo; tau <= hi; tau++) {
        const rr = ncc(lp, sqLp, m, tau, n);
        if (rr > bestR) {
          bestR = rr;
          best = tau;
        }
      }
      if (best <= lo || best >= hi || bestR < 0.5) {
        clear = false;
        mf += T;
        m = Math.round(mf);
        P.push(NaN);
        A.push(NaN);
        J.push(false);
        continue;
      }
      const [off, rv] = peakOf(ncc(lp, sqLp, m, best - 1, n), bestR, ncc(lp, sqLp, m, best + 1, n));
      const period = best + off;
      const nc = Math.round(period);
      P.push(period);
      A.push(Math.sqrt((sqLp[m + nc]! - sqLp[m]!) / nc));
      J.push(clear && rv >= 0.7);
      clear = rv >= 0.7;
      nCycles++;
      const t0 = Math.round(period),
        c0 = m - (n >> 1);
      if (c0 >= 0 && c0 + t0 + K + n + 1 <= len) {
        for (let k = -K; k <= K; k++) v[k + K] = ncc(pe, sqPe, c0, t0 + k, n);
        matches.push(Math.min(0.99999, peakBetween(v, K, period - t0)));
      }
      mf += period;
      m = Math.round(mf);
    }
    for (let i = 1; i + 1 < P.length; i++) {
      if (!J[i] || !J[i + 1]) continue;
      const p0 = P[i - 1]!,
        p1 = P[i]!,
        p2 = P[i + 1]!;
      if (Math.max(p0, p1, p2) / Math.min(p0, p1, p2) > 1.3) continue;
      const t3 = (p0 + p1 + p2) / 3,
        a3 = (A[i - 1]! + A[i]! + A[i + 1]!) / 3;
      dT.push(Math.abs(p1 - t3));
      dA.push(Math.abs(A[i]! - a3));
      sumT += t3;
      sumA += a3;
    }
  }
  const info1 = { ...info0, cycles: nCycles, formantFrames: F1.length, gapTonal };
  if (nCycles < 60 || dT.length < 40 || matches.length < 40) return fail('noisy', info1);
  const trimmedMean = (x: number[]) => {
    const s2 = Float64Array.from(x).sort();
    const k = Math.max(1, Math.floor(s2.length * 0.95));
    let sum = 0;
    for (let i = 0; i < k; i++) sum += s2[i]!;
    return sum / k;
  };
  const jitter = trimmedMean(dT) / (sumT / dT.length);
  const shimmer = trimmedMean(dA) / (sumA / dA.length);
  const rMid = Math.max(1e-6, median(matches));
  const hnrDb = 10 * Math.log10(rMid / (1 - rMid));

  // (formants from fewer than 1 s of frames are left out: too few to trust)
  const enoughF = F1.length >= 100;
  const spreadSt = (v: number[]) => 12 * Math.log2(quantileOf(v, 0.9) / quantileOf(v, 0.1));
  const raw2: Record<string, number> = {
    pitch: f0Hz,
    pitchRange: f0RangeSt,
    pitchSkew,
    pitchMotion,
    f1: enoughF ? median(F1) : NaN,
    f2: enoughF ? median(F2) : NaN,
    f3: enoughF ? median(F3) : NaN,
    f4: F4.length >= 100 ? median(F4) : NaN,
    formantSpacing: enoughF ? median(dF) : NaN,
    f1Range: enoughF ? spreadSt(F1) : NaN,
    f2Range: enoughF ? spreadSt(F2) : NaN,
    b1: enoughF ? median(B1) : NaN,
    b2: enoughF ? median(B2) : NaN,
    centroid: centroidHz,
    hammarberg,
    slopeLow,
    slopeMid,
    ...Object.fromEntries(Array.from(mfcc, (v, q) => [`mfcc${q + 1}`, mfccN ? v / mfccN : NaN])),
    // (the mean, not the median: the moves between sounds are what it is about, and they are a small part of the frames)
    mfccDelta: mfccSteps.length >= 50 ? mfccSteps.reduce((x, y) => x + y, 0) / mfccSteps.length : NaN,
    hnr: hnrDb,
    cpp: cpps.length >= 50 ? median(cpps) : NaN,
    h1h2: h12.length >= 50 ? median(h12) : NaN,
    jitter,
    shimmer,
    rate,
    rateVar,
    pauseShare,
    pauseLen,
    runLen,
    rhythm,
    voicedShare,
    levelRange: levelRangeDb,
    tilt: tiltDb,
  };
  const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, roundFeature(k, raw2[k])])) as Features;
  return { ok: true, features, info: info1 };
}
