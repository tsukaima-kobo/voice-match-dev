// 照合: 利用者の声の数字（features.ts）と、VTuber の声の代表値を比べて、近い順に並べる。DOM なし・乱数なし。
// 1. 項目ごとに、log の物は対数にしてから、モデル（model.json）の中心と散らばりで目盛りをそろえ、1/10000 の整数に丸める。
// 2. 比べるのは、両方にあって重みのある項目だけ。無い項目を中心とみなすと、一言の声が真ん中あたりの人ばかりに近くなる。
// 3. モデルが白色化の行列を持つ時（tools/eval.ts が作る）は、同じ人の中の揺れと、項目どうしの重なりを除く。
//    行列から揺れの共分散を戻し、比べる項目の所だけを切り出して白色化し直す（その項目でのマハラノビス距離）。
//    全部の項目がある時は、モデルの行列のまま。項目の組ごとに作った行列は覚えておく。
// 4. 重みつきの二乗距離（重みは白色化した行ごと。tools/eval.ts は 1）を、重みの和で割る（1 項目あたり）。
//    白色化したずれも整数に丸めてから足し、比べるのは整数（BigInt）で割り算なし。同点は ID の小さい方。
//    だから、同じ数字なら、どの端末でも同じ順位になる。
// 声から性別や年齢は判断しない。絞り込み（グループなど）は利用者が選ぶ。
import { FEATURE_BY_KEY, FEATURE_KEYS, type FeatureKey, type Features } from '../voice/features.ts';
import { t } from '../i18n.ts';

/** 照合のモデル（data/model.json）。center・spread は変換後（log の物は自然対数）の値 */
export interface MatchModel {
  version: string;
  /** どの測り方の版のデータから作ったか */
  measureVersion: string;
  keys: FeatureKey[];
  center: number[];
  spread: number[];
  /** 0 以上。0 の項目は使わない */
  weight: number[];
  /** 白色化の行列（keys.length × keys.length、行ごと）。無ければ単位行列 */
  whiten?: number[][];
  /**
   * 近さの言葉の目安（tools/eval.ts が、データに居ない人の 1 位の近さの分布から作る）。
   * typical: 来た人の声 1 回分から全員への近さの中央値の、ふつうの値。cuts: 「とても似ている」「よく似ている」「似ている」の上限（直した近さで）
   */
  likeness?: { typical: number; cuts: [number, number, number] };
}

export interface Profile {
  id: string;
  features: Features;
}

export interface Ranked {
  id: string;
  /** 近さ（0 が同じ。目安: 1 項目あたりの平均のずれを、散らばりの何倍かで）。丸めない（言葉はこの値で選ぶ。数字を出す時だけ丸める） */
  distance: number;
  /** 比べた項目の数 */
  used: number;
}

const SCALE = 10000;

/** モデルが無い時の物（features.ts の画面の目盛りの真ん中と、幅の 1/4 を散らばりとする。重みは features.ts の prior、既定 1） */
export function defaultModel(measureVersion: string): MatchModel {
  const keys = [...FEATURE_KEYS];
  const t = (k: FeatureKey, v: number) => (FEATURE_BY_KEY[k].log ? Math.log(v) : v);
  return {
    version: 'default',
    measureVersion,
    keys,
    center: keys.map((k) => (t(k, FEATURE_BY_KEY[k].lo) + t(k, FEATURE_BY_KEY[k].hi)) / 2),
    spread: keys.map((k) => Math.abs(t(k, FEATURE_BY_KEY[k].hi) - t(k, FEATURE_BY_KEY[k].lo)) / 4),
    weight: keys.map((k) => FEATURE_BY_KEY[k].prior ?? 1),
  };
}

/** 1 つの声を、モデルの目盛り（中心 0・散らばり 1）の 1/SCALE の整数の並びに（白色化の前。無い項目は null） */
export function standardize(model: MatchModel, f: Features): (number | null)[] {
  return model.keys.map((k, i) => {
    const v = f[k];
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    const x = FEATURE_BY_KEY[k].log ? Math.log(Math.max(v, 1e-9)) : v;
    const s = model.spread[i]!;
    return s > 0 ? Math.round(((x - model.center[i]!) / s) * SCALE) : null;
  });
}

/** 対称な行列のコレスキー分解（下三角）。失敗したら null */
export function cholesky(a: readonly (readonly number[])[]): number[][] | null {
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
export function invertLower(l: readonly (readonly number[])[]): number[][] {
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

/** 比べる項目の組（モデルの項目の番号）と、その白色化の行列（白色化しないモデルでは null）と、行ごとの重み */
interface Block {
  idx: number[];
  rows: number[][] | null;
  /** rows が下三角か（掛け算を半分にする） */
  lower: boolean;
  wt: number[];
}
/** モデルごとに: 白色化の行列から戻した共分散 Σ = (WᵀW)⁻¹ と、項目の組ごとの Block */
const CACHE = new WeakMap<MatchModel, { cov: number[][] | null; blocks: Map<string, Block> }>();
/** 覚えておく項目の組の数の上限（超えたら忘れる） */
const MAX_BLOCKS = 256;

function covOf(w: readonly (readonly number[])[]): number[][] | null {
  const n = w.length;
  const a = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let s = 0;
      for (let k = 0; k < n; k++) s += w[k]![i]! * w[k]![j]!;
      return s;
    }),
  );
  const l = cholesky(a);
  if (!l) return null;
  const li = invertLower(l);
  // a⁻¹ = liᵀ · li
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let s = 0;
      for (let k = Math.max(i, j); k < n; k++) s += li[k]![i]! * li[k]![j]!;
      return s;
    }),
  );
}

function blockOf(model: MatchModel, idx: number[], w: readonly number[]): Block {
  const wt = idx.map((i) => w[i]!);
  if (!model.whiten) return { idx, rows: null, lower: true, wt };
  let c = CACHE.get(model);
  if (!c) {
    c = { cov: null, blocks: new Map() };
    CACHE.set(model, c);
  }
  const key = idx.join(',');
  const hit = c.blocks.get(key);
  if (hit) return hit;
  let b: Block;
  if (idx.length === model.keys.length) {
    // 全部の項目: モデルの行列のまま
    const W = model.whiten;
    b = { idx, rows: W, lower: W.every((row, r) => row.every((x, k) => k <= r || x === 0)), wt };
  } else {
    // 比べる項目だけの共分散の、コレスキー分解の逆（下三角）。分解できなければ、項目ごとの散らばりだけ
    c.cov ??= covOf(model.whiten);
    const cov = c.cov;
    const sub = idx.map((i) => idx.map((j) => (cov ? cov[i]![j]! : i === j ? 1 : 0)));
    const l = cholesky(sub);
    const rows = l ? invertLower(l) : sub.map((row, r) => row.map((x, k) => (r === k ? 1 / Math.sqrt(x) : 0)));
    b = { idx, rows, lower: true, wt };
  }
  if (c.blocks.size >= MAX_BLOCKS) c.blocks.clear();
  c.blocks.set(key, b);
  return b;
}

/** 二乗距離（整数）: Σ 重み × (白色化したずれを整数に丸めた物)² */
function d2Of(b: Block, u: readonly (number | null)[], v: readonly (number | null)[]): bigint {
  const m = b.idx.length;
  const diff = b.idx.map((i) => u[i]! - v[i]!);
  const y = new Array<number>(m);
  let s = 0;
  for (let r = 0; r < m; r++) {
    let x = diff[r]!;
    if (b.rows) {
      const row = b.rows[r]!;
      x = 0;
      for (let k = 0, e = b.lower ? r : m - 1; k <= e; k++) x += row[k]! * diff[k]!;
    }
    y[r] = Math.round(x);
    s += b.wt[r]! * y[r]! * y[r]!;
  }
  // どれも 0 以上の整数なので、和が 2^53 未満なら途中も正確。超えたら BigInt で足し直す
  if (s <= Number.MAX_SAFE_INTEGER) return BigInt(s);
  let big = 0n;
  for (let r = 0; r < m; r++) big += BigInt(b.wt[r]!) * BigInt(y[r]!) ** 2n;
  return big;
}

/** 全員との二乗距離（整数のまま。d2/wsum が 1 項目あたりの二乗のずれ × SCALE²）。比べる項目が無い人は wsum が 0 */
function scoreAll(model: MatchModel, user: Features, profiles: readonly Profile[]) {
  const w = model.weight.map((x) => Math.round(Math.max(0, x) * 1000));
  const u = standardize(model, user);
  const mine = u.flatMap((x, i) => (x !== null && w[i]! > 0 ? [i] : []));
  const all = blockOf(model, mine, w);
  return profiles.map((p) => {
    const v = standardize(model, p.features);
    const b = mine.every((i) => v[i] !== null) ? all : blockOf(model, mine.filter((i) => v[i] !== null), w);
    if (!b.idx.length) return { id: p.id, d2: 0n, wsum: 0n, used: 0 };
    return { id: p.id, d2: d2Of(b, u, v), wsum: BigInt(b.wt.reduce((a, x) => a + x, 0)), used: b.idx.length };
  });
}

const distanceOf = (s: { d2: bigint; wsum: bigint }) => Math.sqrt(Number(s.d2) / Number(s.wsum)) / SCALE;

/** 近い順（同点は ID の小さい順）。`n` 人まで */
export function rank(model: MatchModel, user: Features, profiles: readonly Profile[], n = 5): Ranked[] {
  const usable = scoreAll(model, user, profiles).filter((s) => s.wsum > 0n);
  // d2/wsum を割らずに比べる: a.d2 · b.wsum と b.d2 · a.wsum
  usable.sort((a, b) => {
    const l = a.d2 * b.wsum,
      r = b.d2 * a.wsum;
    if (l < r) return -1;
    if (l > r) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return usable.slice(0, n).map((s) => ({ id: s.id, distance: distanceOf(s), used: s.used }));
}

/** 全員との近さ（並べない。比べる項目が無い人は除く）。farScale と tools/lib.ts の目安づくりで使う */
export function distances(model: MatchModel, user: Features, profiles: readonly Profile[]): Ranked[] {
  return scoreAll(model, user, profiles)
    .filter((s) => s.wsum > 0n)
    .map((s) => ({ id: s.id, distance: distanceOf(s), used: s.used }));
}

/** 近い項目・違う項目（白色化の前の目盛りで、重みのある項目だけ）。a は来た人の声。小さい順に並べた [key, ずれ] */
export function closeness(model: MatchModel, a: Features, b: Features): [FeatureKey, number][] {
  const out: [FeatureKey, number][] = [];
  model.keys.forEach((k, i) => {
    const x = a[k],
      y = b[k];
    if (x === null || y === null || !(model.weight[i]! > 0) || !(model.spread[i]! > 0)) return;
    const t = (v: number) => (FEATURE_BY_KEY[k].log ? Math.log(Math.max(v, 1e-9)) : v);
    out.push([k, Math.abs(t(x) - t(y)) / model.spread[i]!]);
  });
  return out.sort((p, q) => p[1] - q[1] || (p[0] < q[0] ? -1 : 1));
}

/**
 * 近さの言葉を選ぶ時の縮め方（0〜1）。マイクや部屋の響きのずれは、来た人の声を全員からまとめて遠ざけるので、
 * 全員への近さの中央値が、ふつう（model.likeness.typical）より遠い時は、その割合で近さを縮める（近い時は 1 のまま）。
 * profiles はサイトの全員（絞り込む前）を渡す。目安が無いモデルでは 1
 */
export function farScale(model: MatchModel, user: Features, profiles: readonly Profile[]): number {
  const typical = model.likeness?.typical;
  if (!typical) return 1;
  const d = distances(model, user, profiles)
    .map((s) => s.distance)
    .sort((a, b) => a - b);
  if (!d.length) return 1;
  const mid = d.length % 2 ? d[d.length >> 1]! : (d[d.length / 2 - 1]! + d[d.length / 2]!) / 2;
  return mid > typical ? typical / mid : 1;
}

/**
 * 近さの言葉。目安はモデルが持つ（データに居ない人の 1 位が、40%「とても似ている」・40%「よく似ている」・19%「似ている」・
 * 1%「似ている所がある」になる所。tools/lib.ts の LIKENESS_SHARE）。distance は rank の丸めない値を渡す。
 * scale は farScale の値。目安が無いモデルでは、前からの決まった目安
 */
export function closenessWord(model: MatchModel, distance: number, scale = 1): string {
  const [a, b, c] = model.likeness?.cuts ?? [0.5, 0.9, 1.4];
  const d = distance * scale;
  if (d <= a) return t('とても似ている', 'Very similar');
  if (d <= b) return t('よく似ている', 'Quite similar');
  if (d <= c) return t('似ている', 'Similar');
  return t('似ている所がある', 'Some likeness');
}
