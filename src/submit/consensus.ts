// 壁 ③: 同じ声に別々の 3 件以上の数字が届き、互いに近い時だけ、その声を出す。出す数字はその中央値。DOM なし・乱数なし。
// 1 件だけのでたらめな数字では出せない。近さは照合と同じ距離（src/match/match.ts の rank）。
import { FEATURE_KEYS, type Features } from '../voice/features.ts';
import { medianFeatures } from '../voice/combine.ts';
import { rank, type MatchModel } from '../match/match.ts';

export const CONSENSUS = {
  /** 出すのに要る件数 */
  min: 3,
  /** 中央値からこれより遠い数字は外す（照合の距離。暫定） */
  maxDistance: 1.0,
} as const;

/** そろった数字の中央値と、使った件数。そろわなければ null */
export function consensus(model: MatchModel, items: readonly { features: Features }[]): { features: Features; used: number } | null {
  // まったく同じ数字が 2 回届いたら、2 件ではなく 1 件と数える
  const seen = new Set<string>();
  const uniq = items.filter((x) => {
    const k = JSON.stringify(FEATURE_KEYS.map((key) => x.features[key]));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (uniq.length < CONSENSUS.min) return null;
  const mid = medianFeatures(uniq);
  const kept = uniq.filter((x) => {
    const r = rank(model, x.features, [{ id: 'mid', features: mid }], 1)[0];
    return r !== undefined && r.distance <= CONSENSUS.maxDistance;
  });
  if (kept.length < CONSENSUS.min) return null;
  return { features: medianFeatures(kept), used: kept.length };
}
