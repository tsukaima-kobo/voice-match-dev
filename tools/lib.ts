// tools/ の共通の計算（DOM なし・ファイルの読み書きなし。test/tools.test.ts で試す）。
// 窓の選別 → 声ごとの代表値 → 照合のモデル（中心・散らばり・白色化）→ 見分ける力の評価。
import { FEATURE_BY_KEY, FEATURE_KEYS, type FeatureKey, type Features } from '../src/voice/features.ts';
import { quantileOf } from '../src/voice/measure.ts';
import { medianFeatures } from '../src/voice/combine.ts';

/** 項目ごとの中央値（サイトのお手本と同じ計算。src/voice/combine.ts） */
/** 項目ごとの中央値（サイトの音声ファイルのお手本と同じ計算。src/voice/combine.ts） */
export { medianFeatures };
import { rank, type MatchModel, type Profile } from '../src/match/match.ts';
import type { VoiceWindow } from '../src/data/types.ts';

/** 窓を使う条件 */
export const SELECT = {
  /** 間に音楽が続く窓は除く */
  maxGapTonal: 0.3,
  /** 声が少ない窓は除く（秒） */
  minVoicedSeconds: 8,
  /** その人の高さの中央値から、これより離れた窓は別の人・読み上げとして除く（半音） */
  maxPitchOffSt: 3,
  /** 高さで除くのは、窓がこれ以上ある時だけ */
  pitchCheckFrom: 5,
  /** 代表値を作る最少の窓 */
  minWindows: 10,
} as const;

export type DropReason = 'version' | 'music' | 'short' | 'pitch';

/** 窓を選ぶ: 使う窓と、除いた理由ごとの数 */
export function selectWindows(windows: readonly VoiceWindow[], version: string): { kept: VoiceWindow[]; dropped: Record<DropReason, number> } {
  const dropped: Record<DropReason, number> = { version: 0, music: 0, short: 0, pitch: 0 };
  const first: VoiceWindow[] = [];
  for (const w of windows) {
    if (w.version !== version) dropped.version++;
    else if (w.gapTonal > SELECT.maxGapTonal) dropped.music++;
    else if (w.voicedSeconds < SELECT.minVoicedSeconds || w.features.pitch === null) dropped.short++;
    else first.push(w);
  }
  if (first.length < SELECT.pitchCheckFrom) return { kept: first, dropped };
  const st = first.map((w) => 12 * Math.log2(w.features.pitch! / 100));
  const mid = quantileOf(st, 0.5);
  const kept = first.filter((_, i) => Math.abs(st[i]! - mid) <= SELECT.maxPitchOffSt);
  dropped.pitch = first.length - kept.length;
  return { kept, dropped };
}

/** 照合と同じ変換（log の物は自然対数） */
export const transform = (k: FeatureKey, v: number): number => (FEATURE_BY_KEY[k].log ? Math.log(Math.max(v, 1e-9)) : v);

export interface Speaker {
  id: string;
  /** 使う窓（照合のモデルと評価が見るのは、動画と数字だけ） */
  windows: readonly Pick<VoiceWindow, 'video' | 'features'>[];
}

/** 項目ごとの、人の間の散らばりと、同じ人の中の散らばり（変換後）。ICC = 人の間 / (人の間 + 人の中) */
export function itemStats(speakers: readonly Speaker[]): { key: FeatureKey; between: number; within: number; icc: number; n: number }[] {
  return FEATURE_KEYS.map((k) => {
    const means: number[] = [];
    let ss = 0,
      dof = 0,
      n = 0;
    for (const s of speakers) {
      const v = s.windows.map((w) => w.features[k]).filter((x): x is number => x !== null).map((x) => transform(k, x));
      if (v.length < 2) continue;
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      means.push(m);
      for (const x of v) ss += (x - m) ** 2;
      dof += v.length - 1;
      n += v.length;
    }
    const within = dof > 0 ? ss / dof : NaN;
    let between = NaN;
    if (means.length >= 2) {
      const mm = means.reduce((a, b) => a + b, 0) / means.length;
      between = Math.max(0, means.reduce((a, b) => a + (b - mm) ** 2, 0) / (means.length - 1) - within / (n / means.length));
    }
    return { key: k, between, within, icc: between / (between + within), n };
  });
}

/** 対称な行列のコレスキー分解（下三角）。失敗したら null */
function cholesky(a: number[][]): number[][] | null {
  const n = a.length;
  const l = a.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i]![j]!;
      for (let k = 0; k < j; k++) s -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        if (!(s > 0)) return null;
        l[i]![i] = Math.sqrt(s);
      } else l[i]![j] = s / l[j]![j]!;
    }
  }
  return l;
}
/** 下三角行列の逆行列 */
function invertLower(l: number[][]): number[][] {
  const n = l.length;
  const inv = l.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    inv[i]![i] = 1 / l[i]![i]!;
    for (let j = 0; j < i; j++) {
      let s = 0;
      for (let k = j; k < i; k++) s -= l[i]![k]! * inv[k]![j]!;
      inv[i]![j] = s / l[i]![i]!;
    }
  }
  return inv;
}

export interface FitOptions {
  /** 白色化するか（false なら項目ごとの散らばりだけ） */
  whiten: boolean;
  /** 白色化の時、共分散を対角へ寄せる割合（0〜1） */
  shrink?: number;
  /** 経路（マイクと配信の音）の差の散らばり（変換後、項目ごと）。同じ人の中の揺れに足す */
  channel?: Partial<Record<FeatureKey, number>>;
  /** 使わない項目 */
  drop?: FeatureKey[];
}

/** 照合のモデルを作る: 中心は人ごとの中央値の中央値、散らばりは同じ人の中の揺れ（＋経路の差） */
export function fitModel(speakers: readonly Speaker[], measureVersion: string, opts: FitOptions): MatchModel {
  const keys = FEATURE_KEYS.filter((k) => !opts.drop?.includes(k));
  const profiles = speakers.map((s) => medianFeatures(s.windows));
  const center = keys.map((k) => {
    const v = profiles.map((p) => p[k]).filter((x): x is number => x !== null).map((x) => transform(k, x));
    return v.length ? quantileOf(v, 0.5) : 0;
  });
  // (each window minus its speaker's mean, items missing taken at the speaker's mean: the pooled within-speaker covariance)
  const resid: number[][] = [];
  for (const s of speakers) {
    const cols = keys.map((k) => s.windows.map((w) => w.features[k]).map((x) => (x === null ? null : transform(k, x))));
    const means = cols.map((c) => {
      const v = c.filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    });
    if (s.windows.length < 2) continue;
    s.windows.forEach((_, wi) => resid.push(cols.map((c, j) => (c[wi] === null ? 0 : c[wi]! - means[j]!))));
  }
  const n = keys.length;
  const cov = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const r of resid) for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) cov[i]![j] = cov[i]![j]! + r[i]! * r[j]!;
  const dof = Math.max(1, resid.length - speakers.length);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      cov[i]![j] = cov[i]![j]! / dof;
      cov[j]![i] = cov[i]![j]!;
    }
  keys.forEach((k, i) => {
    cov[i]![i] = cov[i]![i]! + (opts.channel?.[k] ?? 0) ** 2;
  });
  const spread = keys.map((_, i) => Math.sqrt(Math.max(cov[i]![i]!, 1e-12)));
  const base: MatchModel = { version: opts.whiten ? 'whiten' : 'diagonal', measureVersion, keys: [...keys], center, spread, weight: keys.map(() => 1) };
  if (!opts.whiten) return base;
  // (the correlation of the standardized items, pulled toward the identity, then its inverse square root by Cholesky)
  const shrink = opts.shrink ?? 0.2;
  const corr = cov.map((row, i) => row.map((v, j) => (i === j ? 1 : (1 - shrink) * (v / (spread[i]! * spread[j]!)))));
  const l = cholesky(corr);
  if (!l) return base;
  return { ...base, whiten: invertLower(l) };
}

export interface EvalResult {
  /** 問いの数（窓の数） */
  queries: number;
  top1: number;
  top5: number;
}

/**
 * 見分ける力: 動画が 2 本以上ある人ごとに、1 本の動画を外して残りで代表値を作り、外した動画の窓 1 つずつを問いにして、
 * 全員の中で本人が 1 位・5 位以内に入る割合（利用者の 30 秒の声 1 つと同じ条件）
 */
/**
 * 1 本の動画を外して、その動画の窓（30 秒ずつ）で本人が 1 位・5 位以内に入る割合。来た人の声 1 回分を、窓 1 つとみなす。
 * `model` に関数を渡すと、外した動画ごとに、その動画を除いた窓でモデルを作り直す（モデルが答えを見ないように）。
 */
export function evaluate(speakers: readonly Speaker[], model: MatchModel | ((train: readonly Speaker[]) => MatchModel)): EvalResult {
  const full: Profile[] = speakers.map((s) => ({ id: s.id, features: medianFeatures(s.windows) }));
  let queries = 0,
    top1 = 0,
    top5 = 0;
  for (const s of speakers) {
    const videos = [...new Set(s.windows.map((w) => w.video))].sort();
    if (videos.length < 2) continue;
    for (const v of videos) {
      const rest = s.windows.filter((w) => w.video !== v);
      const held = s.windows.filter((w) => w.video === v);
      const profiles = full.map((p) => (p.id === s.id ? { id: s.id, features: medianFeatures(rest) } : p));
      const m = typeof model === 'function' ? model(speakers.map((x) => (x.id === s.id ? { id: x.id, windows: rest } : x))) : model;
      for (const q of held) {
        const r = rank(m, q.features, profiles, 5);
        queries++;
        if (r[0]?.id === s.id) top1++;
        if (r.some((x) => x.id === s.id)) top5++;
      }
    }
  }
  return { queries, top1: queries ? top1 / queries : NaN, top5: queries ? top5 / queries : NaN };
}
