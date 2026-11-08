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

// 2026-11-01 版 3.1: 小さな BGM・雑音に強くした。話していない枠の平均スペクトル（背景）を、話している所のスペクトルから引いて
// 音色（MFCC）・明るさ・強さの傾き・長い時間の平均スペクトルを出す。声の質（澄み・ゆらぎ・はっきりさ・柔らかさ）は、
// 声が背景より CLEAR_DB 大きい枠だけで測る（足りなければ全部の枠）。話していない所が無い・無音だけの時は、前と同じ。
// 音色は、その枠の一番強い帯から MFCC_RANGE_DB（50 dB）より弱い帯を、その下の端にそろえる（前は 80 dB。弱い雑音で動かないように）。
// 背景を引くのは、声と背景の差が 40 dB より小さい時だけ（静かな部屋では引かない）。
/** 測り方の版（数字の意味が変わったら上げる。事前に測ったお手本の数字と利用者の数字は、同じ版どうしで比べる） */
export const MEASURE_VERSION = '3.1.0';

/** 測る時のサンプリング周波数（どの音も、まずこれに直す） */
export const RATE = 16000;
/** 枠は 10 ms ごと。1 つの枠は 32 ms の窓（512 サンプル） */
export const HOP = 160;
export const WIN = 512;
/** 探す声の高さの範囲（Hz） */
export const F0_MIN = 60;
export const F0_MAX = 500;
const YIN_W = 480;
const YIN_FIRST = 0.15;
const VOICED_MAX = 0.35;
/** 測るのに要る、声のある所の長さの既定の下限（秒）。ページと拡張機能は、もっと長く求める */
export const MIN_VOICED_SECONDS = 3;
/** 測る長さの上限（秒） */
export const MAX_SECONDS = 40;
/** 話の中のすき間で、これ以上長い物（秒）を間とする */
export const PAUSE_MIN_SECONDS = 0.25;
export const QUIET_DB = -55;
export const MIN_SNR_DB = 15;
export const MAX_CLIPPED = 0.003;
/** 背景の音（BGM・雑音）を引くのは、声と背景の差（loud − 背景、dB）がこれより小さい時。BG_FULL_SNR 以下で全部引き、
 * BG_NONE_SNR 以上では引かない（静かな部屋の小さな雑音で数字を動かさないため。間はなめらかに） */
const BG_FULL_SNR = 30;
const BG_NONE_SNR = 40;
/** 音色（MFCC）: 帯ごとに背景を引き、背景のこの割合より下げない（小さすぎる値の log で揺れないように） */
const BG_MEL_FLOOR = 0.3;
/** 長い時間の平均スペクトル・帯の強さ: 引いた後に残す下限（元の割合） */
const BG_FLOOR = 0.05;
/** 背景の音を覚えるのに要る、話していない枠の数（0.2 秒） */
const BG_MIN_FRAMES = 20;
/** 背景の音は、話している所からこれだけ離れた枠で覚える（話しはじめ・終わりの声のすそを混ぜないため。0.1 秒） */
const BG_MARGIN = 10;
/** 背景の音は、その場所の前後 BG_RADIUS 枠（1.5 秒）の、話していない枠から覚える（BGM の和音が変わっても追えるように）。
 * BG_BLOCK 枠（0.5 秒）ごとに 1 つ。近くに話していない枠が BG_LOCAL_MIN より少なければ、全体の平均 */
const BG_RADIUS = 150;
const BG_BLOCK = 50;
const BG_LOCAL_MIN = 10;
/** 声の質（澄み・ゆらぎ・はっきりさ・柔らかさ）は、背景の音よりこれだけ大きい枠だけで測る（dB） */
const CLEAR_DB = 12;
/** 音色（MFCC）で見る強さの幅（その枠の一番強い帯から下へ、dB）。これより弱い帯は、この幅の下の端にそろえる */
const MFCC_RANGE_DB = 50;
/** LPC: 16 kHz での次数と、窓（25 ms） */
const LPC_ORDER = 18;
const LPC_WIN = 400;
/** CPP と H1−H2: 長めの窓（64 ms） */
const CEP_N = 1024;
/** MFCC: メルの帯をこの間に並べる（Hz。16 kHz へ直す所で 7.2 kHz より上は切れる） */
const MEL_FILTERS = 26;
const MEL_LO = 60;
const MEL_HI = 7000;

export type MeasureFail = 'invalid' | 'silent' | 'quiet' | 'noisy' | 'clipped' | 'short';

export interface MeasureInfo {
  /** 録音の長さ（秒。MAX_SECONDS まで） */
  seconds: number;
  /** 話しはじめの音から、話し終わりの音まで（秒） */
  speechSeconds: number;
  /** 声のある枠（秒） */
  voicedSeconds: number;
  /** 大きい枠（95 パーセンタイル）と、静かな床（5 パーセンタイル）。dBFS */
  loudDb: number;
  floorDb: number;
  /** 話している所のサンプルのうち、振り切れた（フルスケールの）物の割合 */
  clipped: number;
  /** たどった周期の数（息とかすれは、これから出す）と、フォルマントが 3 つとも取れた枠の数 */
  cycles: number;
  formantFrames: number;
  /** 話している所の中で声よりずっと小さい枠のうち、それでも高さがある物の割合（話の下に音楽があると上がる） */
  gapTonal: number;
  /** 高さと大きさの動き（`contour: true` の時だけ。セリフ真似で使う） */
  contour?: Contour;
}

/** bgm の時、いちばん多い高さからこれより離れた枠は、ほかの音とみなす（半音。1 オクターブ） */
export const BGM_BAND_ST = 12;

/**
 * 1 つのセリフの、高さと大きさの動き（話しはじめから話し終わりまで、CONTOUR_STEP 秒ごと）。
 * 高さは 100 Hz を 0 とした半音（声の無い所は NaN）、大きさはその音の大きい所（95%）を 0 とした dB（-40 まで）。
 */
export interface Contour {
  step: number;
  pitch: Float32Array;
  level: Float32Array;
}
/** 動きの 1 こま（秒） */
export const CONTOUR_STEP = 0.02;

export interface MeasureOptions {
  /** 要る、声のある所の長さの下限（秒。既定は MIN_VOICED_SECONDS） */
  minVoicedSeconds?: number;
  /** 高さと大きさの動き（Contour）も返す */
  contour?: boolean;
  /**
   * ほかのタブの音など、BGM やほかの人の声が混ざる音: その人のいちばん多い高さから BGM_BAND_ST 半音より離れた枠を、
   * 声の高さ（と、それを使う項目）に使わない。マイクの声と、運営が測った声（声を抜き出した音）には使わない（数字が変わるため）
   */
  bgm?: boolean;
}

export type Measured = { ok: true; features: Features; info: MeasureInfo } | { ok: false; reason: MeasureFail; info: Partial<MeasureInfo> };

/* ---- 小さな道具 ---- */
const dB = (power: number) => 10 * Math.log10(power + 1e-20);
const semitones = (hz: number) => 12 * Math.log2(hz / 100);

/** 分位数（いちばん近い 2 つの順位の間は、直線でつなぐ） */
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
/** Blackman 窓つきの sinc の低域通過で `to` Hz に直す（低いほうのサンプリング周波数の 0.45 で切る。片側にゼロ交差 8 つ）。 */
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
/** (re, im) の複素 FFT。結果は同じ配列に書く（長さは 2 のべき乗） */
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
/** x[start .. start+n) に窓をかけたパワースペクトル（ビン 0..n/2。信号の外は 0） */
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
/** ビンごとのパワーにかける高域強調（1 − 0.97 z⁻¹）（響き） */
const LIFT = Float64Array.from({ length: WIN / 2 + 1 }, (_, k) => 1 + 0.97 * 0.97 - 2 * 0.97 * Math.cos((2 * Math.PI * k) / WIN));

/* ---- メルの帯（MFCC） ---- */
const melOf = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const hzOfMel = (m: number) => 700 * (10 ** (m / 2595) - 1);
/** WIN 点のスペクトルのビンにかける三角のフィルター: それぞれ [最初のビン, 重み] */
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
/** 正規直交の DCT-II の 1..13 行目（c0 は大きさなので除く: 音量（ゲイン）で動くため） */
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
/** 窓をかけた枠の LPC 係数 a[0..p]（a[0] = 1）を Levinson–Durbin で出す。出せない時は false */
function lpcOf(frame: Float64Array, p: number, r: Float64Array, a: Float64Array, tmp: Float64Array): boolean {
  const n = frame.length;
  for (let k = 0; k <= p; k++) {
    let s = 0;
    for (let i = 0; i + k < n; i++) s += frame[i]! * frame[i + k]!;
    r[k] = s;
  }
  if (!(r[0]! > 0)) return false;
  // 軽いラグ窓: 自己相関にガウスをかける（倍音 1 本をフォルマントと取り違えないように）
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
/** z^p + a1 z^(p−1) + … + ap の根（Durand–Kerner。始めの値は固定: 同じ入力なら同じ根） */
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
  /** F4（Hz）。その枠に無ければ NaN */
  f4: number;
  /** F1 と F2 の幅（Hz） */
  b: [number, number];
}
/** LPC の根から出す、その枠の F1..F4 と、F1・F2 の幅。出せなければ null（F1..F3 は要る） */
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

/** `centre` を中心にした n サンプルの Hann 窓での、x の `hz` の振幅（DFT のビン 1 つだけ。ビンとビンの間でもよい） */
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

/** (x, y) に最小二乗で引いた直線の傾き */
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
 * 録音から声の数字を出す: モノラルの PCM（-1..1）、`sampleRate` Hz（8–192 kHz）。同じサンプルなら同じ結果。
 * 測れない物は失敗（ok: false）にする。
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
    let a = 0;
    for (let k = kSyl0; k < kSyl1; k++) a += pw[k]!;
    syl[f] = dB(a);
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
  if (opts.bgm) {
    // いちばん多い高さ: 声のある枠をいちばん多く含む 6 半音の幅の、真ん中（幅の真ん中に近い枠ほど重く数える）。
    // そこから遠い枠は、音楽かほかの人
    const vals: number[] = [];
    for (let f = 0; f < nF; f++) if (f0[f]! > 0) vals.push(st[f]!);
    if (vals.length >= 50) {
      let lo = Infinity,
        hi = -Infinity;
      for (const v of vals) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      let mode = 0,
        best = -1;
      for (let c = Math.floor(lo); c <= Math.ceil(hi); c += 0.5) {
        let score = 0;
        for (const v of vals) {
          const dd = Math.abs(v - c);
          if (dd < 3) score += 3 - dd;
        }
        if (score > best) {
          best = score;
          mode = c;
        }
      }
      for (let f = 0; f < nF; f++) if (f0[f]! > 0 && Math.abs(st[f]! - mode) > BGM_BAND_ST) f0[f] = 0;
    }
    for (const [a, b] of runsOf((f) => f0[f]! > 0)) if (b - a + 1 < 3) for (let f = a; f <= b; f++) f0[f] = 0;
  }
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

  /* 背景の音（BGM・換気扇など）: 話していない枠の平均スペクトルと大きさ。話している所のスペクトルから引き、
     声の質は、声が背景よりはっきり大きい枠だけで測る。話していない所が少ない（または無音だけの）時は何もしない */
  const NB = WIN / 2 + 1;
  const bgFrames: number[] = [];
  const bgLevels: number[] = [];
  const nearSpeech = new Uint8Array(nF);
  for (const [a, b] of speech) for (let f = Math.max(0, a - BG_MARGIN); f <= Math.min(nF - 1, b + BG_MARGIN); f++) nearSpeech[f] = 1;
  for (let f = 0; f < nF; f++) {
    if (nearSpeech[f] || level[f]! < -90 || level[f]! >= gate) continue;
    bgFrames.push(f);
    bgLevels.push(level[f]!);
  }
  const hasBg = bgFrames.length >= BG_MIN_FRAMES;
  const bgDb = hasBg ? median(bgLevels) : -Infinity;
  // 背景をどれだけ引くか: 声に近い大きさなら全部、声よりずっと小さければ引かない
  const bgW = hasBg ? Math.min(1, Math.max(0, (BG_NONE_SNR - (loudDb - bgDb)) / (BG_NONE_SNR - BG_FULL_SNR))) : 0;
  // 枠のまとまりごとの、その近くの背景のスペクトルと、その MFCC の帯
  const nBlocks = Math.ceil(nF / BG_BLOCK);
  const blockSpec = new Float64Array(bgW > 0 ? nBlocks * NB : 0);
  const blockMel = new Float64Array(bgW > 0 ? nBlocks * MEL_FILTERS : 0);
  if (bgW > 0) {
    const spec = new Float64Array(bgFrames.length * NB);
    const all = new Float64Array(NB);
    bgFrames.forEach((f, i) => {
      powerSpectrum(s, f * HOP, hann, re, im, pw);
      for (let k = 0; k < NB; k++) {
        spec[i * NB + k] = pw[k]!;
        all[k] = all[k]! + pw[k]! / bgFrames.length;
      }
    });
    for (let b = 0; b < nBlocks; b++) {
      const c = b * BG_BLOCK + BG_BLOCK / 2;
      let n = 0;
      const out = blockSpec.subarray(b * NB, (b + 1) * NB);
      bgFrames.forEach((f, i) => {
        if (Math.abs(f - c) > BG_RADIUS) return;
        n++;
        for (let k = 0; k < NB; k++) out[k] = out[k]! + spec[i * NB + k]!;
      });
      if (n >= BG_LOCAL_MIN) for (let k = 0; k < NB; k++) out[k] = out[k]! / n;
      else out.set(all);
      for (let m = 0; m < MEL_FILTERS; m++) {
        const [k0, w] = MEL_BANK[m]!;
        let e = 0;
        for (let j = 0; j < w.length; j++) e += w[j]! * out[k0 + j]!;
        blockMel[b * MEL_FILTERS + m] = e;
      }
    }
  }
  /** 声のある枠の背景を足した物（声のある枠のループの後で、長い時間の和から引く） */
  const bgSum = new Float64Array(NB);
  const clearLine = hasBg ? bgDb + CLEAR_DB : -Infinity;
  const isClear = (f: number) => level[f]! >= clearLine;

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
  // 正なら、声が真ん中から下へより、上へ遠くまで届く
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
  // 速さのムラ: 1 秒以上のひと続きごとの、音節の速さ。その散らばりを平均で割る（ひと続きが 4 つ以上の時）
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
  // 同じひと続きの中の、音節の山と山の間隔の nPVI
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
    // 0.5 秒より長い間隔は、ためらいでリズムではない
    if (d1 > 50 || d2 > 50) continue;
    pvi.push(Math.abs(d1 - d2) / ((d1 + d2) / 2));
  }
  const rhythm = pvi.length >= 8 ? (100 * pvi.reduce((x, y) => x + y, 0)) / pvi.length : NaN;
  let voicedInSpeech = 0;
  for (let f = 0; f < nF; f++) if (isVs(f)) voicedInSpeech++;
  const voicedShare = speakFrames ? voicedInSpeech / speakFrames : NaN;
  /* 強さ・響き（枠の分布から） */
  const vl: number[] = [];
  for (let f = 0; f < nF; f++) if (isVs(f)) vl.push(level[f]!);
  const levelRangeDb = quantileOf(vl, 0.95) - quantileOf(vl, 0.05);
  // 高い帯・低い帯と重心: 下の声のある枠のループで足し、背景はループの後で和から引く
  let lowSum = 0,
    highSum = 0,
    cn = 0,
    cd = 0;
  // 話の下の音楽: 話しはじめの音から話し終わりの音までで、声よりずっと小さい枠（声の中央値より 15 dB 下）のうち、
  // それでも高さがある物の割合。話だけなら、そこは間・閉鎖・無声の音。話の下に曲があると、そこにも高さが残る
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
  // 音色の動き: 声のある枠の MFCC と、そのすぐ前の枠の MFCC との距離
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
    h12: number[] = [],
    cppsClear: number[] = [],
    h12Clear: number[] = [];
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
    // 長い時間の平均・MFCC・帯・重心のため、もう一度スペクトルを出す。背景は、長い時間の和からはループの後で、
    // MFCC の帯からはここで 1 つずつ引く
    powerSpectrum(s, f * HOP, hann, re, im, pw);
    for (let k = 0; k <= WIN / 2; k++) ltas[k] = ltas[k]! + pw[k]!;
    const blk = Math.floor(f / BG_BLOCK);
    if (bgW > 0) for (let k = 0; k < NB; k++) bgSum[k] = bgSum[k]! + blockSpec[blk * NB + k]!;
    for (let k = kLow0; k < kLow1; k++) lowSum += pw[k]!;
    for (let k = kLow1; k < kHigh1; k++) highSum += pw[k]!;
    for (let k = kCen0; k < kHigh1; k++) {
      const w = pw[k]! * LIFT[k]!;
      cn += k * BIN_HZ * w;
      cd += w;
    }
    let melFloor = 0;
    for (let m = 0; m < MEL_FILTERS; m++) {
      const [k0, w] = MEL_BANK[m]!;
      let e = 0;
      for (let j = 0; j < w.length; j++) e += w[j]! * pw[k0 + j]!;
      if (bgW > 0) {
        const bm = blockMel[blk * MEL_FILTERS + m]!;
        e = Math.max(e - bgW * bm, bgW * BG_MEL_FLOOR * bm + (1 - bgW) * e);
      }
      melE[m] = e;
      if (e > melFloor) melFloor = e;
    }
    // その枠のいちばん強い帯から MFCC_RANGE_DB 下に床を置く: 空の帯や、サーという雑音・BGM より弱い帯で形が揺れないように。
    // 50 dB なら声を見分ける物はほとんど残り、小さなサーという雑音で音色が動く量は 80 dB の時の 3 分の 1
    melFloor *= 10 ** (-MFCC_RANGE_DB / 10);
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
    // フォルマント: 高域強調した信号の LPC（25 ms の Hamming 窓）
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
    // CPP: 64 ms の dB スペクトルのケプストラム。声の高さがありうる所の山が、1 ms から 30 ms に合わせた直線より
    // どれだけ上か。ケフレンシーのビン 3 つでならす
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
      const cppV = sm3(best) - (icpt + slope * best);
      cpps.push(cppV);
      if (isClear(f)) cppsClear.push(cppV);
    }
    // H1−H2: 4 周期分で見る、最初の 2 本の倍音。それぞれ ±3 % の中で 5 回試して、いちばん大きい物
    const fz = f0[f]!;
    const nWin = Math.min(CEP_N, Math.max(128, Math.round((4 * RATE) / fz)));
    if (centre - (nWin >> 1) >= 0 && centre + (nWin >> 1) < len) {
      let h1 = 0,
        h2 = 0;
      for (const k of [-0.03, -0.015, 0, 0.015, 0.03]) {
        h1 = Math.max(h1, amplitudeAt(x16, centre, nWin, fz * (1 + k)));
        h2 = Math.max(h2, amplitudeAt(x16, centre, nWin, 2 * fz * (1 + k)));
      }
      if (h1 > 0 && h2 > 0) {
        const hv = 20 * Math.log10(h1 / h2);
        h12.push(hv);
        if (isClear(f)) h12Clear.push(hv);
      }
    }
  }
  // 長い時間の和から背景を引く: 声のある枠それぞれの背景を足した物を
  if (bgW > 0) {
    let bl = 0,
      bh = 0,
      bn = 0,
      bd = 0;
    for (let k = kLow0; k < kLow1; k++) bl += bgSum[k]!;
    for (let k = kLow1; k < kHigh1; k++) bh += bgSum[k]!;
    for (let k = kCen0; k < kHigh1; k++) {
      const w = bgSum[k]! * LIFT[k]!;
      bn += k * BIN_HZ * w;
      bd += w;
    }
    lowSum = Math.max(lowSum - bgW * bl, lowSum * BG_FLOOR);
    highSum = Math.max(highSum - bgW * bh, highSum * BG_FLOOR);
    if (cd - bgW * bd > cd * BG_FLOOR) {
      cn -= bgW * bn;
      cd -= bgW * bd;
    }
    for (let k = 0; k < NB; k++) ltas[k] = Math.max(ltas[k]! - bgW * bgSum[k]!, ltas[k]! * BG_FLOOR);
  }
  const tiltDb = dB(highSum) - dB(lowSum);
  const centroidHz = cd > 0 ? cn / cd : NaN;
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
  // 同じ物を、声が背景よりはっきり大きい周期だけから
  const dTC: number[] = [],
    dAC: number[] = [],
    matchesC: number[] = [];
  let sumTC = 0,
    sumAC = 0;
  const cleanAt = (p: number) => isClear(Math.max(0, Math.min(nF - 1, frameAt(p))));
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
      J: boolean[] = [],
      C: boolean[] = [];
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
        C.push(false);
        continue;
      }
      const [off, rv] = peakOf(ncc(lp, sqLp, m, best - 1, n), bestR, ncc(lp, sqLp, m, best + 1, n));
      const period = best + off;
      const nc = Math.round(period);
      P.push(period);
      A.push(Math.sqrt((sqLp[m + nc]! - sqLp[m]!) / nc));
      J.push(clear && rv >= 0.7);
      C.push(cleanAt(m));
      clear = rv >= 0.7;
      nCycles++;
      const t0 = Math.round(period),
        c0 = m - (n >> 1);
      if (c0 >= 0 && c0 + t0 + K + n + 1 <= len) {
        for (let k = -K; k <= K; k++) v[k + K] = ncc(pe, sqPe, c0, t0 + k, n);
        const mv = Math.min(0.99999, peakBetween(v, K, period - t0));
        matches.push(mv);
        if (cleanAt(m)) matchesC.push(mv);
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
      if (C[i - 1] && C[i] && C[i + 1]) {
        dTC.push(Math.abs(p1 - t3));
        dAC.push(Math.abs(A[i]! - a3));
        sumTC += t3;
        sumAC += a3;
      }
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
  // 背景がある時は、背景よりはっきり大きい周期から（数が足りる時）
  const useClear = hasBg && dTC.length >= 40 && matchesC.length >= 40;
  const jitter = useClear ? trimmedMean(dTC) / (sumTC / dTC.length) : trimmedMean(dT) / (sumT / dT.length);
  const shimmer = useClear ? trimmedMean(dAC) / (sumAC / dAC.length) : trimmedMean(dA) / (sumA / dA.length);
  const rMid = Math.max(1e-6, median(useClear ? matchesC : matches));
  const cppList = hasBg && cppsClear.length >= 30 ? cppsClear : cpps;
  const h12List = hasBg && h12Clear.length >= 30 ? h12Clear : h12;
  const hnrDb = 10 * Math.log10(rMid / (1 - rMid));

  // 枠が 0.3 秒分より少ないフォルマントは使わない（少なすぎて当てにならない）。動く幅には 1 秒分要る
  const enoughF = F1.length >= 30;
  const enoughSpread = F1.length >= 100;
  const spreadSt = (v: number[]) => 12 * Math.log2(quantileOf(v, 0.9) / quantileOf(v, 0.1));
  const raw2: Record<string, number> = {
    pitch: f0Hz,
    pitchRange: f0RangeSt,
    pitchSkew,
    pitchMotion,
    f1: enoughF ? median(F1) : NaN,
    f2: enoughF ? median(F2) : NaN,
    f3: enoughF ? median(F3) : NaN,
    f4: F4.length >= 50 ? median(F4) : NaN,
    formantSpacing: enoughF ? median(dF) : NaN,
    f1Range: enoughSpread ? spreadSt(F1) : NaN,
    f2Range: enoughSpread ? spreadSt(F2) : NaN,
    b1: enoughF ? median(B1) : NaN,
    b2: enoughF ? median(B2) : NaN,
    centroid: centroidHz,
    hammarberg,
    slopeLow,
    slopeMid,
    ...Object.fromEntries(Array.from(mfcc, (v, q) => [`mfcc${q + 1}`, mfccN ? v / mfccN : NaN])),
    // 中央値でなく平均: 見たいのは音と音の間の動きで、それは枠のごく一部だから
    mfccDelta: mfccSteps.length >= 50 ? mfccSteps.reduce((x, y) => x + y, 0) / mfccSteps.length : NaN,
    hnr: hnrDb,
    cpp: cppList.length >= 30 ? median(cppList) : NaN,
    h1h2: h12List.length >= 30 ? median(h12List) : NaN,
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
  if (!opts.contour) return { ok: true, features, info: info1 };

  /* セリフの高さと大きさの動き（話しはじめから話し終わりまで、2 枠ずつ） */
  const k = Math.round((CONTOUR_STEP * RATE) / HOP);
  const first = speech[0]![0],
    last = speech[speech.length - 1]![1];
  const nC = Math.max(1, Math.ceil((last - first + 1) / k));
  const pitch = new Float32Array(nC),
    lv = new Float32Array(nC);
  for (let c = 0; c < nC; c++) {
    let sum = 0,
      cnt = 0,
      top = -Infinity;
    for (let f = first + c * k; f < Math.min(last + 1, first + (c + 1) * k); f++) {
      if (isVs(f)) {
        sum += st[f]!;
        cnt++;
      }
      top = Math.max(top, level[f]!);
    }
    pitch[c] = cnt ? Math.round((sum / cnt) * 100) / 100 : NaN;
    lv[c] = Math.round(Math.max(-40, Math.min(0, top - loudDb)) * 10) / 10;
  }
  return { ok: true, features, info: { ...info1, contour: { step: CONTOUR_STEP, pitch, level: lv } } };
}
