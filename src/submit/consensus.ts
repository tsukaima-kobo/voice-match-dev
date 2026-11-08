// 壁 ③: 同じ声に別々の 3 件以上の数字が届き、互いに近い時だけ、その声を出す。出す数字はその中央値。DOM なし・乱数なし。
// 1 件だけのでたらめな数字では出せない。近さは照合と同じ距離（src/match/match.ts の rank）。来た数字にあって中央値に無い項目は
// 見込みを足すので、項目の少ない数字（無い項目を null にした物）でも通りやすくはならない。
// 同じ音を測った写し（数字を少し変えた物も）は、何件届いても 1 件と数える（1 人が 1 つの音から 3 件作っても通らない）。
import { FEATURE_KEYS, type Features } from '../voice/features.ts';
import { medianFeatures } from '../voice/combine.ts';
import { rank, type MatchModel } from '../match/match.ts';

export const CONSENSUS = {
  /** 出すのに要る件数（写しを 1 件と数えて） */
  min: 3,
  /**
   * 中央値からこれより遠い数字は外す（照合の距離）。シートの 348 人（30 秒の窓）で、同じ人の 3 件が通るのは
   * 2 本の動画から 70%・90 秒ずつなら 84%、別の 3 人が通るのは 5%（窓）〜11%（90 秒）。1.0 では同じ人が 42〜61% しか通らない。
   * 1.2 より広げると、同じ人が増える分と同じほど、別の人どうしも通るようになる
   */
  maxDistance: 1.2,
  /**
   * これより近い 2 件は、同じ音を測った写しとみなして 1 件と数える（照合の距離の、両向きの遠い方）。
   * 同じ人の別々の 30 秒は、6 万組で一番近くても 0.35（0.1% が 0.52 より近い）。45 個の数字を全部、最後の桁で 10 ずつ変えても 0.3 まで。
   * 距離の目盛りがデータから作ったモデル（同じ人の中の揺れが 1。likeness がある）の時だけ使う
   */
  sameDistance: 0.3,
} as const;

/** 2 件の近さ（照合の距離の、両向きの遠い方。比べる項目が無ければ Infinity） */
function apart(model: MatchModel, a: Features, b: Features): number {
  const x = rank(model, a, [{ id: 'b', features: b }], 1)[0]?.distance ?? Infinity;
  const y = rank(model, b, [{ id: 'a', features: a }], 1)[0]?.distance ?? Infinity;
  return Math.max(x, y);
}

/**
 * 壁 ③ で使われる登録: まったく同じ数字は 1 件に数え、全部の中央値から照合の距離で CONSENSUS.maxDistance より遠い物を除く。
 * consensus が通した時の used と同じ数になる（tools/intake-lib.ts は、名前の書き方などをこの登録だけで決める）
 */
export function consensusMembers<T extends { features: Features }>(model: MatchModel, items: readonly T[]): T[] {
  // まったく同じ数字が 2 回届いたら、2 件ではなく 1 件と数える
  const seen = new Set<string>();
  const uniq = items.filter((x) => {
    const k = JSON.stringify(FEATURE_KEYS.map((key) => x.features[key]));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!uniq.length) return [];
  const mid = medianFeatures(uniq);
  return uniq.filter((x) => {
    const r = rank(model, x.features, [{ id: 'mid', features: mid }], 1)[0];
    return r !== undefined && r.distance <= CONSENSUS.maxDistance;
  });
}

/** 写しを 1 件にまとめた物（届いた順に、前の物のどれかと CONSENSUS.sameDistance 以内なら、その写し） */
export function withoutCopies<T extends { features: Features }>(model: MatchModel, items: readonly T[]): T[] {
  const out: T[] = [];
  for (const x of items) if (!out.some((y) => apart(model, x.features, y.features) <= CONSENSUS.sameDistance)) out.push(x);
  return out;
}

/** そろった数字の中央値と、使った件数（写しも数える。consensusMembers の数）。そろわなければ null */
export function consensus(model: MatchModel, items: readonly { features: Features }[]): { features: Features; used: number } | null {
  if (items.length < CONSENSUS.min) return null;
  const kept = consensusMembers(model, items);
  if (kept.length < CONSENSUS.min) return null;
  // 写しを 1 件と数えて、まだ足りるか。出す数字も、写しを 1 件として中央値に。
  // 仮のモデル（画面の目盛りから作った物）は距離の目盛りが違うので、まったく同じ数字だけを 1 件にする
  const distinct = model.likeness ? withoutCopies(model, kept) : kept;
  if (distinct.length < CONSENSUS.min) return null;
  return { features: medianFeatures(distinct), used: kept.length };
}
