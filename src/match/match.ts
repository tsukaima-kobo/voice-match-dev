// 照合: 利用者の声の数字（features.ts）と、VTuber の声の代表値を比べて、近い順に並べる。DOM なし・乱数なし。
// 1. 項目ごとに、log の物は対数にしてから、モデル（model.json）の中心と散らばりで目盛りをそろえる。
// 2. モデルが白色化の行列を持つ時は、それを掛ける（同じ人の中の揺れと、項目どうしの重なりを除くため。tools/eval.ts が作る）。
// 3. 重みつきの二乗距離。数字は 1/10000 の整数に丸めてから計算し、比べるのは BigInt で割り算なし。同点は ID の小さい方。
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
   * 来た人の声だけにかかる、決まった向きのずれ（変換後、keys の順）。照合の前に来た人の数字から引く。
   * ほかのタブの音（BGM 入り）を聞かせた時のモデルが持つ（声を抜き出した音との差の平均、tools/bgm-shift.ts）。
   */
  queryShift?: number[];
}

export interface Profile {
  id: string;
  features: Features;
}

export interface Ranked {
  id: string;
  /** 近さ（0 が同じ。目安: 1 項目あたりの平均のずれを、散らばりの何倍かで） */
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

/** 1 つの声を、モデルの目盛りの整数の並びに（無い項目は null）。query は来た人の声（queryShift を引く） */
export function standardize(model: MatchModel, f: Features, query = false): (number | null)[] {
  const z = model.keys.map((k, i) => {
    const v = f[k];
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    const x = (FEATURE_BY_KEY[k].log ? Math.log(Math.max(v, 1e-9)) : v) - (query ? (model.queryShift?.[i] ?? 0) : 0);
    const s = model.spread[i]!;
    return s > 0 ? (x - model.center[i]!) / s : null;
  });
  // (whitening mixes the items, so it needs all of them: one missing is taken at the centre, 0. The weights then go
  // with the whitened rows, and tools/eval.ts sets them to 1)
  const out: (number | null)[] = model.whiten ? model.whiten.map((row) => row.reduce<number>((acc, w, j) => acc + w * (z[j] ?? 0), 0)) : z;
  return out.map((v) => (v === null ? null : Math.round(v * SCALE)));
}

/** 近い順（同点は ID の小さい順）。`n` 人まで */
export function rank(model: MatchModel, user: Features, profiles: readonly Profile[], n = 5): Ranked[] {
  const u = standardize(model, user, true);
  const w = model.weight.map((x) => BigInt(Math.round(Math.max(0, x) * 1000)));
  const scored = profiles.map((p) => {
    const v = standardize(model, p.features);
    let d2 = 0n,
      wsum = 0n,
      used = 0;
    for (let i = 0; i < u.length; i++) {
      const a = u[i],
        b = v[i];
      if (a === null || a === undefined || b === null || b === undefined || w[i] === 0n) continue;
      const diff = BigInt(a - b);
      d2 += w[i]! * diff * diff;
      wsum += w[i]!;
      used++;
    }
    return { id: p.id, d2, wsum, used };
  });
  const usable = scored.filter((s) => s.wsum > 0n);
  // (compare d2/wsum without dividing: a.d2 · b.wsum vs b.d2 · a.wsum)
  usable.sort((a, b) => {
    const l = a.d2 * b.wsum,
      r = b.d2 * a.wsum;
    if (l < r) return -1;
    if (l > r) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return usable.slice(0, n).map((s) => ({
    id: s.id,
    distance: Math.round(Math.sqrt(Number(s.d2) / Number(s.wsum)) / SCALE * 100) / 100,
    used: s.used,
  }));
}

/** 近い項目・違う項目（白色化の前の目盛りで、重みのある項目だけ）。a は来た人の声。小さい順に並べた [key, ずれ] */
export function closeness(model: MatchModel, a: Features, b: Features): [FeatureKey, number][] {
  const out: [FeatureKey, number][] = [];
  model.keys.forEach((k, i) => {
    const x = a[k],
      y = b[k];
    if (x === null || y === null || !(model.weight[i]! > 0) || !(model.spread[i]! > 0)) return;
    const t = (v: number) => (FEATURE_BY_KEY[k].log ? Math.log(Math.max(v, 1e-9)) : v);
    out.push([k, Math.abs(t(x) - (model.queryShift?.[i] ?? 0) - t(y)) / model.spread[i]!]);
  });
  return out.sort((p, q) => p[1] - q[1] || (p[0] < q[0] ? -1 : 1));
}

/** 近さの言葉（distance の目安。データがそろったら tools/eval.ts の結果で見直す） */
export function closenessWord(distance: number): string {
  if (distance <= 0.5) return t('とても近い', 'Very close');
  if (distance <= 0.9) return t('近い', 'Close');
  if (distance <= 1.4) return t('やや近い', 'Fairly close');
  return t('似ている所がある', 'Some likeness');
}
