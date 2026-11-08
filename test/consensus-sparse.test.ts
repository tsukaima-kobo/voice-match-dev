// 壁 ③（src/submit/consensus.ts）を、項目の少ない数字で試す。白色化のモデルでも、無い項目を中心とみなさず、
// 両方にある項目だけで比べるので、項目が少ないほど通りやすくはならない。
import { describe, expect, it } from 'vitest';
import { FEATURE_BY_KEY, FEATURE_KEYS, type Features } from '../src/voice/features.ts';
import { defaultModel, type MatchModel } from '../src/match/match.ts';
import { REQUIRED } from '../src/submit/code.ts';
import { consensus } from '../src/submit/consensus.ts';

const base = defaultModel('test');
/** 項目どうしの重なりの無い白色化（単位行列） */
const model: MatchModel = { ...base, whiten: base.keys.map((_, i) => base.keys.map((_, j) => (i === j ? 1 : 0))) };
/** 全部の項目を、中心から散らばりの z 倍ずらした声 */
const voiceAt = (z: number): Features =>
  Object.fromEntries(
    model.keys.map((k, i) => {
      const x = model.center[i]! + z * model.spread[i]!;
      return [k, FEATURE_BY_KEY[k].log ? Math.exp(x) : x];
    }),
  ) as Features;
const only = (f: Features, keys: readonly string[]) => Object.fromEntries(FEATURE_KEYS.map((k) => [k, keys.includes(k) ? f[k] : null])) as Features;

describe('壁 ③ と、項目の少ない数字', () => {
  it('近い 3 つは、全部の項目でも、要る項目だけでも通る', () => {
    const near = [-0.4, 0, 0.4].map(voiceAt);
    expect(consensus(model, near.map((features) => ({ features })))?.used).toBe(3);
    expect(consensus(model, near.map((f) => ({ features: only(f, REQUIRED) })))?.used).toBe(3);
  });
  it('離れた 3 つは、要る項目だけにしても通らない（無い項目を中心とみなすと通ってしまう）', () => {
    const far = [-1.5, 0, 1.5].map(voiceAt);
    expect(consensus(model, far.map((features) => ({ features })))).toBeNull();
    expect(consensus(model, far.map((f) => ({ features: only(f, REQUIRED) })))).toBeNull();
  });
});
