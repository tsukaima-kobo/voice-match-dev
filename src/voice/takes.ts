// 何回かに分けて話した声を、数字だけで 1 つにまとめる（音は残さない。1 回ごとに数字にしたら捨てる）。
// 項目ごとに、その項目に足りる長さの回（features.ts の needOf）だけを使い、声の長さで重みを付けた平均にする
// （Hz など log の項目は、log の平均 = 相乗平均）。乱数なし・同じ回の並びなら同じ結果。
import { FEATURE_BY_KEY, FEATURE_KEYS, FEW_SECONDS, LONG_SECONDS, needOf, roundFeature, type Features } from './features.ts';
import { lang } from '../i18n.ts';

export interface Take {
  features: Features;
  voicedSeconds: number;
}
export interface Combined {
  features: Features;
  /** 全部の回の声（秒） */
  voicedSeconds: number;
  takes: number;
  /** 1 回で一番長かった声（秒）。抑揚や速さが出るかはこれで決まる */
  longest: number;
}

export function combineTakes(takes: readonly Take[]): Combined {
  const features = {} as Features;
  for (const k of FEATURE_KEYS) {
    const log = FEATURE_BY_KEY[k].log;
    let sum = 0,
      w = 0;
    for (const t of takes) {
      const v = t.features[k];
      if (v === null || !Number.isFinite(v) || t.voicedSeconds < needOf(k) || (log && v <= 0)) continue;
      sum += t.voicedSeconds * (log ? Math.log(v) : v);
      w += t.voicedSeconds;
    }
    features[k] = w > 0 ? roundFeature(k, log ? Math.exp(sum / w) : sum / w) : null;
  }
  const voicedSeconds = Math.round(takes.reduce((a, t) => a + t.voicedSeconds, 0) * 10) / 10;
  const longest = takes.reduce((a, t) => Math.max(a, t.voicedSeconds), 0);
  return { features, voicedSeconds, takes: takes.length, longest };
}

/**
 * 結果の確かさ: 1 ざっくり（一言）・2 だいたい（1 回で声 3 秒から、抑揚なども出る）・3 しっかり（1 回で声 8 秒から、速さと間も出る）。
 * 項目は、その長さの回からしか作らない（needOf）ので、短い回を何回足しても上がらない。
 * 近さの言葉の目安も、この 3 つに分けて作る（まとめた数字にある項目から決める。src/match/match.ts の queryKind）
 */
export type Certainty = 1 | 2 | 3;
export function certaintyOf(c: Pick<Combined, 'voicedSeconds' | 'longest'>): Certainty {
  if (c.voicedSeconds >= LONG_SECONDS && c.longest >= LONG_SECONDS) return 3;
  if (c.voicedSeconds >= FEW_SECONDS && c.longest >= FEW_SECONDS) return 2;
  return 1;
}
const CERT_JA: Record<Certainty, string> = { 1: 'ざっくり', 2: 'だいたい', 3: 'しっかり' };
const CERT_EN: Record<Certainty, string> = { 1: 'Rough', 2: 'Fair', 3: 'Solid' };
export const CERTAINTY_WORDS = new Proxy(CERT_JA, { get: (o, k) => (lang === 'en' ? CERT_EN : o)[k as unknown as Certainty] }) as Record<Certainty, string>;
