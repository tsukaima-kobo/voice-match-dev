// 照合: 利用者の声の数字（features.ts）と、声の代表値を比べて、近い順に並べる。DOM なし・乱数なし。
// 1. 項目ごとに、log の物は対数にしてから、モデル（model.json）の中心と散らばりで目盛りをそろえ、1/10000 の整数に丸める。
// 2. 比べるのは、両方にあって重みのある項目だけ。無い項目を中心とみなすと、一言の声が真ん中あたりの人ばかりに近くなる。
// 3. モデルが白色化の行列を持つ時（tools/eval.ts が作る）は、同じ人の中の揺れと、項目どうしの重なりを除く。
//    行列から揺れの共分散を戻し、比べる項目の所だけを切り出して白色化し直す（その項目でのマハラノビス距離）。
//    全部の項目がある時は、モデルの行列のまま。項目の組ごとに作った行列は覚えておく。
// 4. 来た人にあって相手に無い項目は、この声を、別の人（モデルの people の、人ごとの代表値の散らばり）と比べた時に、
//    その項目で増える分の見込み（期待値）を足す。項目の少ない声が、項目が少ないだけで 1 位にならないように。
//    見込みは来た声の数字から出すので、マイクのずれで全員から遠い声でも、足す分も同じだけ大きくなる。
//    来た人に無い項目は数えない（一言の声は、全部の項目がある人と、一言の項目だけで比べる）。全部の項目がある相手には、何も足さない。
// 5. 重みつきの二乗距離（重みは白色化した行ごと。tools/eval.ts は 1）を、来た人の項目の重みの和で割る（1 項目あたり）。
//    白色化したずれも整数に丸めてから足し、比べるのは整数で割り算なし。同点は ID の小さい方。
//    だから、同じ数字なら、どの端末でも同じ順位になる。
// 速さのため: 相手の目盛りをそろえた数字と、最後に来た声での近さは覚えておく（声の数字の入れ物は、渡した後に書き換えない）。
// 声から性別や年齢は判断しない。絞り込み（グループなど）は利用者が選ぶ。
import { FEATURE_BY_KEY, FEATURE_KEYS, FEW_SECONDS, LONG_SECONDS, needOf, type FeatureKey, type Features } from '../voice/features.ts';
import { t } from '../i18n.ts';

/** 近さの言葉の目安（問いの種類 1 つ分） */
export interface LikenessScale {
  /** 来た人の声から全員への近さの中央値の、ふつうの値 */
  typical: number;
  /** 「とても似ている」「よく似ている」「似ている」の上限（直した近さで） */
  cuts: [number, number, number];
}

/** 問いの種類: 一言・1 回で声数秒・1 回で声 8 秒から（30 秒 1 回分）・何回分もの中央値（じっくり測る） */
export type QueryKind = 'line' | 'few' | 'full' | 'many';
/** これだけの回（30 秒の窓）の中央値なら「何回分もの中央値」 */
export const MANY_WINDOWS = 10;

/** 照合のモデル（data/model.json）。center・spread は変換後（log の物は自然対数）の値 */
export interface MatchModel {
  version: string;
  /** どの測り方の版のデータから作ったか（いくつかの版が混ざる時は、いちばん古い版） */
  measureVersion: string;
  /** 作るのに使ったデータの測り方の版（全部） */
  dataVersions?: string[];
  /** 作るのに使った人の数 */
  speakers?: number;
  /** どの声から作ったか（sheet: 運営が測った声のシート・voices: 拡張機能で測った声。tools/eval.ts） */
  source?: 'sheet' | 'voices';
  keys: FeatureKey[];
  center: number[];
  spread: number[];
  /** 0 以上。0 の項目は使わない */
  weight: number[];
  /** 白色化の行列（keys.length × keys.length、行ごと）。無ければ単位行列 */
  whiten?: number[][];
  /**
   * 人ごとの代表値の、平均と共分散（目盛りをそろえた後。tools/eval.ts が作る）。相手に無い項目の見込みに使う。
   * 無ければ、無い項目ごとに likeness.typical の 2 乗
   */
  people?: { mean: number[]; cov: number[][] };
  /**
   * 近さの言葉の目安（tools/eval.ts が、データに居ない人の 1 位の近さの分布から作る）。
   * typical・cuts は 30 秒 1 回分の声（前からの形）。kinds は問いの種類ごと（queryKind。無い種類は typical・cuts）
   */
  likeness?: LikenessScale & { kinds?: Partial<Record<QueryKind, LikenessScale>> };
}

export interface Profile {
  id: string;
  features: Features;
}

export interface Ranked {
  id: string;
  /** 近さ（0 が同じ。目安: 1 項目あたりの平均のずれを、散らばりの何倍かで）。丸めない（言葉はこの値で選ぶ。数字を出す時だけ丸める） */
  distance: number;
  /** 比べた項目の数（両方にある項目） */
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

/** 比べる項目の組（モデルの項目の番号）と、その白色化の行列と、行ごとの重み */
interface Block {
  idx: number[];
  /** 白色化の行列を行ごとに詰めた物（lower なら行 r は r+1 個、でなければ idx.length 個）。白色化しないモデルでは null */
  rows: Float64Array | null;
  /** rows が下三角か（掛け算を半分にする） */
  lower: boolean;
  wt: number[];
  /** 重みの和 */
  wsum: number;
  /** 別の人との重みつき二乗距離の見込みのうち、来た声によらない所（SCALE² の目盛り）: Σ 重み × (R P Rᵀ) の対角 */
  spreadPart: number;
}
/** モデルごとに: 白色化の行列から戻した共分散 Σ = (WᵀW)⁻¹、項目の組ごとの Block（新しく使った順）、目盛りをそろえた相手の数字 */
interface ModelCache {
  w: number[];
  cov: number[][] | null;
  blocks: Map<string, Block>;
  std: WeakMap<Features, Float64Array>;
  last: Query | null;
}
const CACHE = new WeakMap<MatchModel, ModelCache>();
/** 覚えておく項目の組の数の上限（超えたら、いちばん前に使った物から忘れる。1 回の照合の中では、同じ組は 1 回だけ作る） */
const MAX_BLOCKS = 512;

function cacheOf(model: MatchModel): ModelCache {
  let c = CACHE.get(model);
  if (!c) {
    c = { w: model.weight.map((x) => Math.round(Math.max(0, x) * 1000)), cov: null, blocks: new Map(), std: new WeakMap(), last: null };
    CACHE.set(model, c);
  }
  return c;
}

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

/** 行列を、行ごとに詰める（lower なら下三角の所だけ） */
function pack(m: readonly (readonly number[])[], lower: boolean): Float64Array {
  const n = m.length;
  const out = new Float64Array(lower ? (n * (n + 1)) / 2 : n * n);
  let at = 0;
  for (let r = 0; r < n; r++) for (let k = 0, e = lower ? r : n - 1; k <= e; k++) out[at++] = m[r]![k]!;
  return out;
}
const rowAt = (b: Pick<Block, 'lower' | 'idx'>, r: number) => (b.lower ? (r * (r + 1)) / 2 : r * b.idx.length);

/** 見込みの、来た声によらない所: Σ 重み × (R P Rᵀ) の対角（P は people.cov の、比べる項目の所）。people が無ければ、項目ごとに typical² */
function spreadOf(model: MatchModel, b: Omit<Block, 'spreadPart'>): number {
  const m = b.idx.length;
  const P = model.people?.cov;
  let s = 0;
  if (!P) {
    const c0 = (model.likeness?.typical ?? 1) ** 2;
    for (let r = 0; r < m; r++) s += b.wt[r]! * c0;
    return s * SCALE * SCALE;
  }
  const pi = b.idx.map((i) => P[i]!);
  for (let r = 0; r < m; r++) {
    let v: number;
    if (!b.rows) v = pi[r]![b.idx[r]!]!;
    else {
      // 行 R_r について Σ_a Σ_k R_ra P_ak R_rk
      const at = rowAt(b, r);
      const e = b.lower ? r : m - 1;
      v = 0;
      for (let a = 0; a <= e; a++) {
        const ra = b.rows[at + a]!;
        if (ra === 0) continue;
        const row = pi[a]!;
        let x = 0;
        for (let k = 0; k <= e; k++) x += row[b.idx[k]!]! * b.rows[at + k]!;
        v += ra * x;
      }
    }
    s += b.wt[r]! * Math.max(0, v);
  }
  return s * SCALE * SCALE;
}

/**
 * 来た声を、別の人と比べた時の、重みつき二乗距離の見込み（SCALE² の目盛りの整数）:
 * 人ごとの代表値の平均からのずれ（白色化した物）の二乗 ＋ spreadPart。people が無ければ spreadPart だけ
 */
function costOf(model: MatchModel, b: Block, u: Float64Array): number {
  const mean = model.people?.mean;
  let s = b.spreadPart;
  if (mean) {
    const m = b.idx.length;
    const d = b.idx.map((i) => u[i]! - mean[i]! * SCALE);
    for (let r = 0; r < m; r++) {
      let x = d[r]!;
      if (b.rows) {
        const at = rowAt(b, r);
        x = 0;
        for (let k = 0, e = b.lower ? r : m - 1; k <= e; k++) x += b.rows[at + k]! * d[k]!;
      }
      s += b.wt[r]! * x * x;
    }
  }
  return Math.round(s);
}

function blockOf(model: MatchModel, c: ModelCache, idx: number[]): Block {
  const key = idx.join(',');
  const hit = c.blocks.get(key);
  if (hit) {
    // 新しく使った物として、後ろへ
    c.blocks.delete(key);
    c.blocks.set(key, hit);
    return hit;
  }
  const wt = idx.map((i) => c.w[i]!);
  const wsum = wt.reduce((a, x) => a + x, 0);
  let base: Omit<Block, 'spreadPart'>;
  if (!model.whiten) base = { idx, rows: null, lower: true, wt, wsum };
  else if (idx.length === model.keys.length) {
    // 全部の項目: モデルの行列のまま
    const W = model.whiten;
    const lower = W.every((row, r) => row.every((x, k) => k <= r || x === 0));
    base = { idx, rows: pack(W, lower), lower, wt, wsum };
  } else {
    // 比べる項目だけの共分散の、コレスキー分解の逆（下三角）。分解できなければ、項目ごとの散らばりだけ
    c.cov ??= covOf(model.whiten);
    const cov = c.cov;
    const sub = idx.map((i) => idx.map((j) => (cov ? cov[i]![j]! : i === j ? 1 : 0)));
    const l = cholesky(sub);
    const rows = l ? invertLower(l) : sub.map((row, r) => row.map((x, k) => (r === k ? 1 / Math.sqrt(x) : 0)));
    base = { idx, rows: pack(rows, true), lower: true, wt, wsum };
  }
  const b: Block = { ...base, spreadPart: spreadOf(model, base) };
  if (c.blocks.size >= MAX_BLOCKS) c.blocks.delete(c.blocks.keys().next().value!);
  c.blocks.set(key, b);
  return b;
}

/** 目盛りをそろえた数字（standardize と同じ値。無い項目は NaN）。相手の物は覚えておく */
function stdOf(model: MatchModel, f: Features): Float64Array {
  return Float64Array.from(standardize(model, f), (x) => (x === null ? NaN : x));
}
function stdCached(model: MatchModel, c: ModelCache, f: Features): Float64Array {
  let v = c.std.get(f);
  if (!v) {
    v = stdOf(model, f);
    c.std.set(f, v);
  }
  return v;
}

/** 1 人分の近さ（整数のまま。d2/wsum が 1 項目あたりの二乗のずれ × SCALE²。2^53 を超える時だけ BigInt） */
interface Score {
  d2: number | bigint;
  used: number;
}
/** 来た声 1 つ分の計算（目盛りをそろえた数字・比べる項目・相手ごとの近さ） */
interface Query {
  u: Float64Array;
  all: Block;
  /** 別の人との見込み（全部の項目で） */
  cost: number;
  scores: WeakMap<Features, Score | null>;
  /** この声で使った、項目の組と見込み（相手に無い項目の番号で）。覚えておく上限を超えても、1 回の照合の中では作り直さない */
  blocks: Map<string, { b: Block; cost: number }>;
  /** 計算の途中に使う場所 */
  diff: Float64Array;
  y: Float64Array;
}

function queryOf(model: MatchModel, user: Features): Query {
  const c = cacheOf(model);
  const u = stdOf(model, user);
  // 最後に来た声と同じ数字なら、覚えた近さを使う（1 回の結果で、並べる・言葉を選ぶの何回分も）
  const last = c.last;
  if (last && last.u.length === u.length && last.u.every((x, i) => Object.is(x, u[i]))) return last;
  const mine = Array.from(u.keys()).filter((i) => !Number.isNaN(u[i]!) && c.w[i]! > 0);
  const all = blockOf(model, c, mine);
  const q: Query = { u, all, cost: costOf(model, all, u), scores: new WeakMap(), blocks: new Map(), diff: new Float64Array(mine.length), y: new Float64Array(mine.length) };
  c.last = q;
  return q;
}

/** 二乗距離（整数）: Σ 重み × (白色化したずれを整数に丸めた物)² */
function d2Of(b: Block, q: Query, v: Float64Array): number | bigint {
  const m = b.idx.length;
  const { u, diff, y } = q;
  for (let r = 0; r < m; r++) diff[r] = u[b.idx[r]!]! - v[b.idx[r]!]!;
  const rows = b.rows;
  let s = 0;
  for (let r = 0; r < m; r++) {
    let x = diff[r]!;
    if (rows) {
      const at = rowAt(b, r);
      x = 0;
      for (let k = 0, e = b.lower ? r : m - 1; k <= e; k++) x += rows[at + k]! * diff[k]!;
    }
    y[r] = Math.round(x);
    s += b.wt[r]! * y[r]! * y[r]!;
  }
  // どれも 0 以上の整数なので、和が 2^53 未満なら途中も正確。超えたら BigInt で足し直す
  if (s <= Number.MAX_SAFE_INTEGER) return s;
  let big = 0n;
  for (let r = 0; r < m; r++) big += BigInt(b.wt[r]!) * BigInt(y[r]!) ** 2n;
  return big;
}

/** 1 人分の近さ。比べる項目が無い人は null */
function scoreOf(model: MatchModel, q: Query, f: Features): Score | null {
  const hit = q.scores.get(f);
  if (hit !== undefined) return hit;
  const c = cacheOf(model);
  const v = stdCached(model, c, f);
  const all = q.all;
  let b = all;
  // 相手に無い項目の分: 別の人との見込みの、全部の項目と比べた項目との差（全部ある相手は 0）
  let add = 0;
  for (const i of all.idx)
    if (Number.isNaN(v[i]!)) {
      const key = all.idx.filter((j) => Number.isNaN(v[j]!)).join(',');
      let hit = q.blocks.get(key);
      if (!hit) {
        const sub = blockOf(model, c, all.idx.filter((j) => !Number.isNaN(v[j]!)));
        hit = { b: sub, cost: costOf(model, sub, q.u) };
        q.blocks.set(key, hit);
      }
      b = hit.b;
      add = Math.max(0, q.cost - hit.cost);
      break;
    }
  let s: Score | null = null;
  if (b.idx.length) {
    const d2 = d2Of(b, q, v);
    const sum = typeof d2 === 'number' && d2 + add <= Number.MAX_SAFE_INTEGER ? d2 + add : BigInt(d2) + BigInt(add);
    s = { d2: sum, used: b.idx.length };
  }
  q.scores.set(f, s);
  return s;
}

const distanceOf = (d2: number | bigint, wsum: number) => Math.sqrt(Number(d2) / wsum) / SCALE;
/** 並べる順（近い方が先。同点は ID の小さい方）。割る数は同じなので、d2 だけを比べる */
const order = (a: { d2: number | bigint; id: string }, b: { d2: number | bigint; id: string }) => (a.d2 < b.d2 ? -1 : a.d2 > b.d2 ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 近い順（同点は ID の小さい順）。`n` 人まで */
export function rank(model: MatchModel, user: Features, profiles: readonly Profile[], n = 5): Ranked[] {
  const q = queryOf(model, user);
  const top: { id: string; d2: number | bigint; used: number }[] = [];
  if (n <= 0) return [];
  // 多く要る時は全部並べる。少ない時は、上位 n 人だけを入れ替えながら持つ
  const all = n * 8 >= profiles.length;
  for (const p of profiles) {
    const s = scoreOf(model, q, p.features);
    if (!s) continue;
    const x = { id: p.id, d2: s.d2, used: s.used };
    if (all) {
      top.push(x);
      continue;
    }
    if (top.length >= n && order(x, top[top.length - 1]!) >= 0) continue;
    let at = top.length;
    while (at > 0 && order(x, top[at - 1]!) < 0) at--;
    top.splice(at, 0, x);
    if (top.length > n) top.pop();
  }
  if (all) top.sort(order);
  return top.slice(0, n).map((s) => ({ id: s.id, distance: distanceOf(s.d2, q.all.wsum), used: s.used }));
}

/** 全員との近さ（並べない。比べる項目が無い人は除く）。farScale と tools/lib.ts の目安づくりで使う */
export function distances(model: MatchModel, user: Features, profiles: readonly Profile[]): Ranked[] {
  const q = queryOf(model, user);
  const out: Ranked[] = [];
  for (const p of profiles) {
    const s = scoreOf(model, q, p.features);
    if (s) out.push({ id: p.id, distance: distanceOf(s.d2, q.all.wsum), used: s.used });
  }
  return out;
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
 * 問いの種類。ある項目の中でいちばん長い声が要る物で決める（features.ts の needOf。一言・数秒・8 秒から）。
 * windows は、何回分（30 秒の窓）の中央値か（じっくり測るページ）。MANY_WINDOWS 回からは「何回分もの中央値」
 */
export function queryKind(f: Features, windows = 1): QueryKind {
  let need = 0;
  for (const k of FEATURE_KEYS) {
    const v = f[k];
    if (v !== null && v !== undefined && Number.isFinite(v)) need = Math.max(need, needOf(k));
  }
  if (need >= LONG_SECONDS) return windows >= MANY_WINDOWS ? 'many' : 'full';
  return need >= FEW_SECONDS ? 'few' : 'line';
}

/** その種類の問いの目安（モデルに無い種類は、30 秒 1 回分の物） */
export function likenessOf(model: MatchModel, kind: QueryKind): LikenessScale | undefined {
  const l = model.likeness;
  return l ? (l.kinds?.[kind] ?? { typical: l.typical, cuts: l.cuts }) : undefined;
}

/** 近さの言葉の物差し（farScale が作り、closenessWord に渡す）。scale は近さを縮める割合、kind は問いの種類 */
export interface WordScale {
  scale: number;
  kind: QueryKind;
}

/**
 * 近さの言葉を選ぶ時の物差し。マイクや部屋の響きのずれは、来た人の声を全員からまとめて遠ざけるので、
 * 全員への近さの中央値が、その種類の問いのふつう（likeness の typical）より遠い時は、その割合で近さを縮める（近い時は 1 のまま）。
 * profiles はサイトの全員（絞り込む前）を渡す。windows は、何回分の中央値か（じっくり測るページ。queryKind）。目安が無いモデルでは 1
 */
export function farScale(model: MatchModel, user: Features, profiles: readonly Profile[], windows = 1): WordScale {
  const kind = queryKind(user, windows);
  const typical = likenessOf(model, kind)?.typical;
  if (!typical) return { scale: 1, kind };
  const d = Float64Array.from(distances(model, user, profiles), (s) => s.distance).sort();
  if (!d.length) return { scale: 1, kind };
  const mid = d.length % 2 ? d[d.length >> 1]! : (d[d.length / 2 - 1]! + d[d.length / 2]!) / 2;
  return { scale: mid > typical ? typical / mid : 1, kind };
}

/**
 * 近さの言葉。目安はモデルが持つ（データに居ない人の 1 位が、40%「とても似ている」・40%「よく似ている」・19%「似ている」・
 * 1%「似ている所がある」になる所。問いの種類ごと。tools/lib.ts の LIKENESS_SHARE）。distance は rank の丸めない値を渡す。
 * scale は farScale の値（数だけの時は、30 秒 1 回分の目安で）。目安が無いモデルでは、前からの決まった目安
 */
export function closenessWord(model: MatchModel, distance: number, scale: number | WordScale = 1): string {
  const s = typeof scale === 'number' ? { scale, kind: 'full' as const } : scale;
  const [a, b, c] = likenessOf(model, s.kind)?.cuts ?? [0.5, 0.9, 1.4];
  const d = distance * s.scale;
  if (d <= a) return t('とても似ている', 'Very similar');
  if (d <= b) return t('よく似ている', 'Quite similar');
  if (d <= c) return t('似ている', 'Similar');
  return t('似ている所がある', 'Some likeness');
}
