// src/voice/measure.ts の試験（test/voice-measure.test.ts）に使う音。ここで数字だけから作る（録音は
// 使わない）。雑音と jitter は種つきの乱数（mulberry32）で作るので、何度動かしても同じサンプルになる。
// tone(): F0 の分かっている倍音の和（高さの正確さを見る）。vowel(): jitter と shimmer のあるパルス列を
// 3 つのフォルマントの響きに通した物に、音源に混ぜた息の雑音（breath）と、包絡で作る音節のかたまりと間
// （速さ・間を見る）。silence(): 静かな部屋を、少しの雑音として。

/** [0, 1) の数を出す、種つきの乱数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 乱数から作る正規分布の数（Box–Muller） */
export const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());

/** サンプルの RMS */
export const rmsOf = (x: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, x.length));
};
/** RMS に合わせて大きさを変えたサンプル */
export function toRms(x: Float32Array, rms: number): Float32Array {
  const k = rms / Math.max(1e-12, rmsOf(x));
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * k;
  return x;
}
/** 音を順につなぐ */
export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
/** 静かな部屋: `rms` の白色雑音（0 ならデジタルの無音） */
export function silence(rate: number, seconds: number, rms = 0.0003, seed = 7): Float32Array {
  const r = rng(seed);
  const x = new Float32Array(Math.round(rate * seconds));
  if (rms > 0) for (let i = 0; i < x.length; i++) x[i] = gauss(r) * rms;
  return x;
}
/** 別の音を足す（どちらも元の大きさのまま） */
export function mixIn(x: Float32Array, y: ArrayLike<number>): Float32Array {
  for (let i = 0; i < x.length && i < y.length; i++) x[i] = x[i]! + y[i]!;
  return x;
}

export interface ToneOptions {
  rate: number;
  seconds: number;
  /** F0（Hz）。数か、時刻（秒）の関数で */
  f0: number | ((t: number) => number);
  /** RMS（決まりは 0.1、約 -20 dBFS） */
  rms?: number;
  /** 倍音の下がり方: 振幅 1/k^tilt（決まりは 1） */
  tilt?: number;
  /** この周波数までの倍音（決まりは 5 kHz） */
  maxHz?: number;
}
/** F0 の分かっている倍音の和（位相を足していくので、F0 が変わると滑らかに移る） */
export function tone(o: ToneOptions): Float32Array {
  const n = Math.round(o.rate * o.seconds);
  const x = new Float32Array(n);
  const f0At = typeof o.f0 === 'number' ? () => o.f0 as number : o.f0;
  const maxHz = o.maxHz ?? 5000;
  const tilt = o.tilt ?? 1;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = f0At(i / o.rate);
    phase += (2 * Math.PI * f) / o.rate;
    let v = 0;
    for (let k = 1; k * f < maxHz && k * f < o.rate / 2; k++) v += Math.sin(k * phase) / k ** tilt;
    x[i] = v;
  }
  return toRms(x, o.rms ?? 0.1);
}

export interface VowelOptions {
  rate: number;
  seconds: number;
  f0: number | ((t: number) => number);
  /** 周期を、1 つずつ最大 ± この割合で変える（一様） */
  jitter?: number;
  /** パルスの振幅を、1 つずつ最大 ± この割合で変える（一様） */
  shimmer?: number;
  /** 音源の中の息の雑音。パルスの RMS に対する、その RMS の比 */
  breath?: number;
  /** フォルマント（Hz）と、その帯域幅（Hz） */
  formants?: readonly (readonly [number, number])[];
  /** 時間ごとの大きさ（0..1）。音節や間など */
  envelope?: (t: number) => number;
  /** 声門で高い音が下がり始める所（Hz。決まりは 150 で柔らかい声。高いほど張った明るい声） */
  glottis?: number;
  rms?: number;
  seed?: number;
}
/** 声のある音: 帯域を限ったパルス列をフォルマントの響きに通し、唇で高い音を上げる（差分） */
export function vowel(o: VowelOptions): Float32Array {
  const n = Math.round(o.rate * o.seconds);
  const r = rng(o.seed ?? 1);
  const f0At = typeof o.f0 === 'number' ? () => o.f0 as number : o.f0;
  const src = new Float64Array(n);
  // どのパルスも、ちょうどの時刻に置いた短い窓付きの sinc。時刻はサンプルに丸めない
  const HALF = 6;
  let t = 0.004 * o.rate;
  while (t < n - HALF) {
    const amp = 1 + (o.shimmer ?? 0) * (2 * r() - 1);
    const i0 = Math.floor(t);
    for (let j = -HALF; j <= HALF; j++) {
      const u = i0 + j - t;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * u) / (HALF + 1));
      const s = u === 0 ? 1 : Math.sin(Math.PI * 0.9 * u) / (Math.PI * 0.9 * u);
      const i = i0 + j;
      if (i >= 0 && i < n) src[i] = src[i]! + amp * 0.9 * s * w;
    }
    const T = o.rate / f0At(t / o.rate);
    t += T * (1 + (o.jitter ?? 0) * (2 * r() - 1));
  }
  // 声門で高い音が下がる: 150 Hz の 1 次のローパスを 2 回。1 オクターブ上で -12 dB。唇で +6 戻す
  for (let pass = 0; pass < 2; pass++) {
    const k = Math.exp((-2 * Math.PI * (o.glottis ?? 150)) / o.rate);
    let prev = 0;
    for (let i = 0; i < n; i++) src[i] = prev = (1 - k) * src[i]! + k * prev;
  }
  // 息の音: 声門での白色雑音。声門の形は付けないので、高い所では倍音より上に出る
  if (o.breath) {
    const pulseRms = Math.sqrt(src.reduce((a, v) => a + v * v, 0) / n);
    for (let i = 0; i < n; i++) src[i] = src[i]! + gauss(r) * pulseRms * o.breath;
  }
  let y = src;
  for (const [F, B] of o.formants ?? [
    [700, 90],
    [1200, 110],
    [2600, 160],
  ]) {
    const rr = Math.exp((-Math.PI * B) / o.rate);
    const c1 = 2 * rr * Math.cos((2 * Math.PI * F) / o.rate),
      c2 = -rr * rr;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = y[i]! + c1 * (i > 0 ? out[i - 1]! : 0) + c2 * (i > 1 ? out[i - 2]! : 0);
    y = out;
  }
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = y[i]! - (i ? y[i - 1]! : 0);
  if (o.envelope) for (let i = 0; i < n; i++) x[i] = x[i]! * o.envelope(i / o.rate);
  return toRms(x, o.rms ?? 0.1);
}

/**
 * 音節のかたまり: 1 秒に `perSecond` 個（1 つずつ、その `share` の部分に raised cosine）。`group` 個ごとに
 * `pause` 秒の間。`[0, seconds)` の外は 0
 */
export function bursts(perSecond: number, opts: { share?: number; group?: number; pause?: number; floor?: number } = {}): (t: number) => number {
  const share = opts.share ?? 0.7;
  const group = opts.group ?? Infinity;
  const pause = opts.pause ?? 0;
  const period = 1 / perSecond;
  const groupLen = group * period + pause;
  const floor = opts.floor ?? 0;
  return (t: number) => {
    const inGroup = Number.isFinite(groupLen) ? t % groupLen : t;
    if (inGroup >= group * period) return 0;
    const ph = (inGroup % period) / period;
    if (ph >= share) return floor;
    return floor + (1 - floor) * (0.5 - 0.5 * Math.cos((2 * Math.PI * ph) / share));
  };
}
