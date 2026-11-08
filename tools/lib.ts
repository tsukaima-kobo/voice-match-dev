// tools/ の共通の計算（DOM なし・ファイルの読み書きなし。test/match.test.ts・test/match-missing.test.ts で試す）。
// 窓の選別 → 声ごとの代表値 → 照合のモデル（中心・散らばり・白色化・人ごとの代表値の散らばり）→ 見分ける力の評価 → 近さの言葉の目安。
import { FEATURE_BY_KEY, FEATURE_KEYS, FEW_SECONDS, forLength, ONE_LINE_SECONDS, type FeatureKey, type Features } from '../src/voice/features.ts';
import { quantileOf, readableVersion } from '../src/voice/measure.ts';
import { medianFeatures } from '../src/voice/combine.ts';

/** 項目ごとの中央値（サイトの音声ファイルのお手本と同じ計算。src/voice/combine.ts） */
export { medianFeatures };
import { cholesky, distances, invertLower, MANY_WINDOWS, rank, type LikenessScale, type MatchModel, type Profile, type QueryKind } from '../src/match/match.ts';
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
    if (!readableVersion(w.version, version)) dropped.version++;
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

/**
 * 人ごとの代表値の、平均と共分散（目盛りをそろえた後。照合の people）。項目の組ごとに、両方ある人だけで数える。
 * 照合は、相手に無い項目の分として、来た声を別の人と比べた時の見込みをこれから出して足す（src/match/match.ts）
 */
export function peopleOf(profiles: readonly Features[], keys: readonly FeatureKey[], center: readonly number[], spread: readonly number[]): { mean: number[]; cov: number[][] } {
  const z = profiles.map((f) =>
    keys.map((k, i) => {
      const v = f[k];
      return v === null || v === undefined || !Number.isFinite(v) ? null : (transform(k, v) - center[i]!) / spread[i]!;
    }),
  );
  const r = (x: number) => Math.round(x * 10000) / 10000;
  const n = keys.length;
  const mean = keys.map((_, i) => {
    const v = z.map((p) => p[i]).filter((x): x is number => x !== null && x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  });
  const cov = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = 0,
        c = 0;
      for (const p of z) {
        const x = p[i],
          y = p[j];
        if (x === null || x === undefined || y === null || y === undefined) continue;
        s += (x - mean[i]!) * (y - mean[j]!);
        c++;
      }
      cov[i]![j] = cov[j]![i] = c > 1 ? r(s / (c - 1)) : i === j ? 1 : 0;
    }
  return { mean: mean.map(r), cov };
}

/** 照合のモデルを作る: 中心は人ごとの中央値の中央値、散らばりは同じ人の中の揺れ（＋経路の差）。人ごとの代表値の散らばり（people）も */
export function fitModel(speakers: readonly Speaker[], measureVersion: string, opts: FitOptions): MatchModel {
  const keys = FEATURE_KEYS.filter((k) => !opts.drop?.includes(k));
  const profiles = speakers.map((s) => medianFeatures(s.windows));
  const center = keys.map((k) => {
    const v = profiles.map((p) => p[k]).filter((x): x is number => x !== null).map((x) => transform(k, x));
    return v.length ? quantileOf(v, 0.5) : 0;
  });
  // 窓ごとに、その人の平均（ある値だけの）を引く。全員分をまとめて、同じ人の中の共分散にする。
  // 項目の組ごとに、両方ある窓だけを数える。自由度は、その窓の数から、その組がある人の数を引いた物
  const n = keys.length;
  const sum = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const dof = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const s of speakers) {
    const resid = keys.map((k) => {
      const c = s.windows.map((w) => w.features[k]).map((x) => (x === null || !Number.isFinite(x) ? null : transform(k, x)));
      const v = c.filter((x): x is number => x !== null);
      const m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
      return c.map((x) => (x === null ? null : x - m));
    });
    for (let i = 0; i < n; i++)
      for (let j = 0; j <= i; j++) {
        const ri = resid[i]!,
          rj = resid[j]!;
        let acc = 0,
          seen = 0;
        for (let w = 0; w < ri.length; w++) {
          const x = ri[w],
            y = rj[w];
          if (x === null || x === undefined || y === null || y === undefined) continue;
          acc += x * y;
          seen++;
        }
        if (!seen) continue;
        sum[i]![j] = sum[i]![j]! + acc;
        dof[i]![j] = dof[i]![j]! + seen - 1;
      }
  }
  const cov = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      cov[i]![j] = sum[i]![j]! / Math.max(1, dof[i]![j]!);
      cov[j]![i] = cov[i]![j]!;
    }
  keys.forEach((k, i) => {
    cov[i]![i] = cov[i]![i]! + (opts.channel?.[k] ?? 0) ** 2;
  });
  const spread = keys.map((_, i) => Math.sqrt(Math.max(cov[i]![i]!, 1e-12)));
  const people = peopleOf(profiles, keys, center, spread);
  const base: MatchModel = { version: opts.whiten ? 'whiten' : 'diagonal', measureVersion, speakers: speakers.length, keys: [...keys], center, spread, weight: keys.map(() => 1), people };
  if (!opts.whiten) return base;
  // 目盛りをそろえた項目の相関を、単位行列の方へ寄せ、コレスキー分解でその逆平方根を作る
  const shrink = opts.shrink ?? 0.2;
  const corr = cov.map((row, i) => row.map((v, j) => (i === j ? 1 : (1 - shrink) * (v / (spread[i]! * spread[j]!)))));
  const l = cholesky(corr);
  if (!l) return base;
  return { ...base, whiten: invertLower(l) };
}

/**
 * 今のモデル（data/model.json）を置き換えない理由。置き換えてよければ null。--sheet を付け忘れた npm run eval などで、
 * 運営のシートから作ったモデルを、ずっと少ない人（半分未満）から作った物にしないため。reportSpeakers は eval-report.json の人数（前の形のモデル用）
 */
export function replaceProblem(now: Partial<MatchModel> | null, reportSpeakers: number | undefined, next: { speakers: number; source: NonNullable<MatchModel['source']> }): string | null {
  if (!now || !now.version || now.version === 'none' || now.version === 'default') return null;
  const had = now.speakers ?? reportSpeakers ?? 0;
  if (now.source === 'sheet' && next.source !== 'sheet') return `今の data/model.json は運営のシートから作った物です（${had} 人）`;
  if (next.speakers * 2 < had) return `今の data/model.json は ${had} 人から作った物で、今回は ${next.speakers} 人だけです`;
  return null;
}

export interface EvalResult {
  /** 問いの数（窓の数） */
  queries: number;
  top1: number;
  top5: number;
  /**
   * 同じ窓を一言（声 3 秒・8 秒が要る項目を無くした物。features.ts の needOf）にした時。
   * 残りの項目も 30 秒の窓から測った値なので、本当の一言（声 1 秒ほど）より当たりやすい（甘めの数字）
   */
  oneLine: { top1: number; top5: number };
}

/**
 * 見分ける力: 動画が 2 本以上ある人ごとに、1 本の動画を外して残りで代表値を作り、外した動画の窓（30 秒ずつ）1 つずつで、
 * 全員の中で本人が 1 位・5 位以内に入る割合。来た人の声 1 回分を、窓 1 つとみなす。比べ方はサイトと同じ（src/match/match.ts の rank）。
 * 一言の割合は、同じ窓から、1 回に声 3 秒・8 秒が要る項目を除いて比べた物。残りの項目は 30 秒から測った値のままなので、
 * 本当の一言（声 1 秒ほどから測った値。揺れがずっと大きい）より甘い。
 * `model` に関数を渡すと、外した動画ごとに、その動画を除いた窓でモデルを作り直す（モデルが答えを見ないように）。
 */
export function evaluate(speakers: readonly Speaker[], model: MatchModel | ((train: readonly Speaker[]) => MatchModel)): EvalResult {
  const full: Profile[] = speakers.map((s) => ({ id: s.id, features: medianFeatures(s.windows) }));
  let queries = 0,
    top1 = 0,
    top5 = 0,
    short1 = 0,
    short5 = 0;
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
        const o = rank(m, forLength(q.features, ONE_LINE_SECONDS), profiles, 5);
        if (o[0]?.id === s.id) short1++;
        if (o.some((x) => x.id === s.id)) short5++;
      }
    }
  }
  const share = (x: number) => (queries ? x / queries : NaN);
  return { queries, top1: share(top1), top5: share(top5), oneLine: { top1: share(short1), top5: share(short5) } };
}

/** 近さの言葉の目安で、データに居ない人の 1 位が入る割合（「とても似ている」まで・「よく似ている」まで・「似ている」まで） */
export const LIKENESS_SHARE = [0.4, 0.8, 0.99] as const;

/** 目安を作る問いの種類（src/match/match.ts の queryKind と同じ分け方） */
export const LIKENESS_KINDS: readonly QueryKind[] = ['line', 'few', 'full', 'many'];

/**
 * 「何回分もの中央値」の目安を作る窓の数。じっくり測るページは MANY_WINDOWS（10）〜40 個の窓（20 分）なので、その真ん中。
 * 窓が多いほど 1 位が近くなる（シートの 348 人で、20 個で作ると「とても似ている」は 10 個で 32%・20 個で 40%・全部で 49%）
 */
export const LIKENESS_MANY_WINDOWS = 20;

/** 問いの種類ごとの、来た人の声（窓 1 つ、または続けて LIKENESS_MANY_WINDOWS 個の窓の中央値） */
export function likenessQueries(windows: readonly Pick<VoiceWindow, 'features'>[], kind: QueryKind): Features[] {
  if (kind === 'line') return windows.map((w) => forLength(w.features, ONE_LINE_SECONDS));
  if (kind === 'few') return windows.map((w) => forLength(w.features, FEW_SECONDS));
  if (kind === 'full') return windows.map((w) => w.features);
  const n = Math.max(MANY_WINDOWS, LIKENESS_MANY_WINDOWS);
  const out: Features[] = [];
  for (let at = 0; at + n <= windows.length; at += n) out.push(medianFeatures(windows.slice(at, at + n)));
  return out;
}

/**
 * 近さの言葉の目安（model.likeness）: 来た人の声を、本人を除いた全員と比べ、全員への近さの中央値のふつう（typical）と、
 * 1 位の直した近さ（src/match/match.ts の farScale と同じ縮め方）の分布から決める。データに居ない人の 1 位が、
 * LIKENESS_SHARE の割合で各言葉に入るようにする。問いの種類（一言・数秒・30 秒 1 回・何回分もの中央値）ごとに作る
 * （項目の数と揺れの大きさで、近さの分布が違うため）。typical・cuts は 30 秒 1 回分（前からの形）
 */
export function likenessScale(speakers: readonly Speaker[], model: MatchModel): NonNullable<MatchModel['likeness']> {
  const profiles: Profile[] = speakers.map((s) => ({ id: s.id, features: medianFeatures(s.windows) }));
  const r = (x: number) => Math.round(x * 10000) / 10000;
  const one = (kind: QueryKind): LikenessScale | null => {
    const mids: number[] = [],
      ones: number[] = [];
    speakers.forEach((s, si) => {
      const others = profiles.filter((_, i) => i !== si);
      for (const q of likenessQueries(s.windows, kind)) {
        // サイトと同じ比べ方（src/match/match.ts の distances）
        const d = Float64Array.from(distances(model, q, others), (x) => x.distance).sort();
        if (!d.length) continue;
        mids.push(d.length % 2 ? d[d.length >> 1]! : (d[d.length / 2 - 1]! + d[d.length / 2]!) / 2);
        ones.push(d[0]!);
      }
    });
    if (!mids.length) return null;
    const typical = quantileOf(mids, 0.5);
    const near = ones.map((d, i) => (mids[i]! > typical ? (d * typical) / mids[i]! : d));
    return { typical: r(typical), cuts: [r(quantileOf(near, LIKENESS_SHARE[0])), r(quantileOf(near, LIKENESS_SHARE[1])), r(quantileOf(near, LIKENESS_SHARE[2]))] };
  };
  // 問いが作れなかった種類（窓の少ない人ばかりの時の「何回分もの中央値」など）は入れない（30 秒 1 回分の目安を使う）
  const kinds: Partial<Record<QueryKind, LikenessScale>> = {};
  for (const k of LIKENESS_KINDS) {
    const l = one(k);
    if (l) kinds[k] = l;
  }
  const full = kinds.full ?? { typical: 0, cuts: [0.5, 0.9, 1.4] };
  return { typical: full.typical, cuts: full.cuts, kinds };
}
