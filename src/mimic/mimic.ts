// 声真似の練習の計算: お手本と利用者の声の数字を比べて、近さの点数と、近づけるための直し方を出す。DOM なし・乱数なし。
// 点数に使うのは、自分で変えやすい 12 項目だけ（音色 MFCC やゆらぎのように、意識して変えにくい項目は表には出すが、点数と直し方には使わない）。
// 項目ごとに「ここまでのずれなら近い」幅（TOLERANCE、暫定）を決め、ずれをその何倍かにして（5 倍で止める）、
// 二乗の合計 S から 100·exp(−S/30) を点数にする。項目どうしで平均しないので、1 つの大きなずれ（例: 高さが 1 オクターブ違う）も点に効く。
// 幅と 30 は、本物の声で「同じ人が 2 回話した時」のずれが分かったら見直す（2026-11-01、目安は同じ人で 80 点台）。
// 同じ数字なら、どの端末でも同じ点数。
import { FEATURE_BY_KEY, type FeatureKey, type Features } from '../voice/features.ts';
import { lang, t } from '../i18n.ts';

/** 点数と直し方に使う項目 */
export const SCORED_KEYS = ['pitch', 'pitchRange', 'f1', 'f2', 'formantSpacing', 'centroid', 'hnr', 'h1h2', 'tilt', 'rate', 'pauseShare', 'levelRange'] as const satisfies readonly FeatureKey[];
export type ScoredKey = (typeof SCORED_KEYS)[number];

/** 近いと見るずれの幅。log の項目（Hz）は比で（例: 1.5 半音 = 2^(1.5/12)） */
export const TOLERANCE: Record<ScoredKey, number> = {
  pitch: 2 ** (1.5 / 12),
  pitchRange: 1.5,
  f1: 1.08,
  f2: 1.06,
  formantSpacing: 1.04,
  centroid: 1.08,
  hnr: 3,
  h1h2: 3,
  tilt: 3,
  rate: 0.6,
  pauseShare: 0.06,
  levelRange: 3,
};
/** ずれは幅の 5 倍で止める（1 項目だけで点が 0 にならないように） */
export const CLIP = 5;
/** 点数の目盛り: 100·exp(−S / SCORE_SCALE) */
export const SCORE_SCALE = 30;
/** 比べられる項目がこれより少なければ点数を出さない */
export const MIN_ITEMS = 6;

/** 項目を上げる時・下げる時の言葉（数字が大きくなる向きが up） */
const ADVICE_JA: Record<ScoredKey, { up: string; down: string }> = {
  pitch: { up: '声をもう少し高く', down: '声をもう少し低く' },
  pitchRange: { up: '抑揚をもっと大きく', down: '抑揚を控えめに、平らに' },
  f1: { up: '口をもう少し大きく開ける', down: '口の開きを小さめに' },
  f2: { up: '舌を前に出す感じで、明るい響きに', down: '唇を少し丸めて、こもった響きに' },
  formantSpacing: { up: '口角を上げ、喉を少し上げる感じで', down: '唇を少しすぼめ、喉を少し下げる感じで' },
  centroid: { up: '響きをもっと明るく', down: '響きを暗く、落ち着いた感じに' },
  hnr: { up: '息を減らして、澄んだ声に', down: '息を混ぜて、ささやき気味に' },
  h1h2: { up: '力を抜いて、ふわっと柔らかく', down: '芯のある、張った声に' },
  tilt: { up: '声に力をこめる', down: '声の力を抜く' },
  rate: { up: 'もっと速く話す', down: 'もっとゆっくり話す' },
  pauseShare: { up: '間をもっと取る', down: '間を詰めて話す' },
  levelRange: { up: '強弱をもっとつける', down: '大きさを一定に' },
};
const ADVICE_EN: Record<ScoredKey, { up: string; down: string }> = {
  pitch: { up: 'Raise your pitch a little', down: 'Lower your pitch a little' },
  pitchRange: { up: 'Use more intonation', down: 'Flatten your intonation' },
  f1: { up: 'Open your mouth a little wider', down: 'Open your mouth a little less' },
  f2: { up: 'Bring your tongue forward for a brighter resonance', down: 'Round your lips a little for a darker resonance' },
  formantSpacing: { up: 'Lift the corners of your mouth and raise your throat a little', down: 'Purse your lips and lower your throat a little' },
  centroid: { up: 'Make the resonance brighter', down: 'Make the resonance darker and calmer' },
  hnr: { up: 'Use less breath for a clearer voice', down: 'Add some breath, close to a whisper' },
  h1h2: { up: 'Relax for a softer, airier voice', down: 'Firm up for a pressed, focused voice' },
  tilt: { up: 'Put more power into your voice', down: 'Take some power out of your voice' },
  rate: { up: 'Speak faster', down: 'Speak more slowly' },
  pauseShare: { up: 'Take more pauses', down: 'Close up the pauses' },
  levelRange: { up: 'Vary your loudness more', down: 'Keep your loudness steady' },
};
/** 項目を上げる時・下げる時の言葉（数字が大きくなる向きが up。今の言葉で） */
export const ADVICE = new Proxy(ADVICE_JA, { get: (o, k) => (lang === 'en' ? ADVICE_EN : o)[k as ScoredKey] }) as Record<ScoredKey, { up: string; down: string }>;

export interface Difference {
  key: ScoredKey;
  /** (あなた − お手本) ÷ 幅。負ならあなたの方が低い。1 を超えたら「ずれている」 */
  z: number;
}

/** 点数に使う項目ごとのずれ。ずれの大きい順、同じなら項目の名前順 */
export function differences(target: Features, mine: Features): Difference[] {
  const out: Difference[] = [];
  for (const k of SCORED_KEYS) {
    const tol = TOLERANCE[k];
    const a = mine[k],
      b = target[k];
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    const z = FEATURE_BY_KEY[k].log ? Math.log(Math.max(a, 1e-9) / Math.max(b, 1e-9)) / Math.log(tol) : (a - b) / tol;
    out.push({ key: k, z: Math.round(z * 100) / 100 });
  }
  return out.sort((p, q) => Math.abs(q.z) - Math.abs(p.z) || (p.key < q.key ? -1 : 1));
}

export interface MimicScore {
  /** 0〜100 */
  score: number;
  /** 比べた項目の数 */
  used: number;
}

/** 近さの点数。比べられる項目が MIN_ITEMS より少なければ null */
export function mimicScore(target: Features, mine: Features): MimicScore | null {
  const d = differences(target, mine);
  if (d.length < MIN_ITEMS) return null;
  // 項目が少ない時は、無い項目も同じだけずれていたとみなす（短い回が、項目が抜けたせいで高い点にならないように）
  const s = (d.reduce((acc, x) => acc + Math.min(Math.abs(x.z), CLIP) ** 2, 0) * SCORED_KEYS.length) / d.length;
  return { score: Math.round(100 * Math.exp(-s / SCORE_SCALE)), used: d.length };
}

/** 近づけるための直し方（幅より大きくずれた項目を、ずれの大きい順に `n` 個まで） */
export function adviceFor(diffs: readonly Difference[], n = 3): { key: ScoredKey; text: string; z: number }[] {
  const out: { key: ScoredKey; text: string; z: number }[] = [];
  for (const d of diffs) {
    const a = ADVICE[d.key];
    if (Math.abs(d.z) <= 1) continue;
    // 負ならあなたの方がお手本より低いので、上げる
    out.push({ key: d.key, text: d.z < 0 ? a.up : a.down, z: d.z });
    if (out.length >= n) break;
  }
  return out;
}

/** 点数の言葉（暫定） */
export function scoreWord(score: number): string {
  if (score >= 90) return t('そっくり', 'Spot on');
  if (score >= 75) return t('かなり近い', 'Very close');
  if (score >= 55) return t('近い', 'Close');
  if (score >= 35) return t('少し近い', 'Getting there');
  return t('まだ遠い', 'Still far');
}
