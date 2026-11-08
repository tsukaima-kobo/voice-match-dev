// 壁 ③（src/submit/consensus.ts）の、写し（同じ音の数字を少し変えた物）と、近さの上限の試験。
// 距離の目盛りが分かるように、項目どうしの重なりの無いモデル（単位行列）で、全部の項目を同じだけずらした声を使う（近さ = ずらした幅）。
import { describe, expect, it } from 'vitest';
import { FEATURE_BY_KEY, roundFeature, type Features } from '../src/voice/features.ts';
import { defaultModel, type MatchModel } from '../src/match/match.ts';
import { consensus, consensusMembers, CONSENSUS } from '../src/submit/consensus.ts';

const base = defaultModel('test');
/** データから作ったモデルの代わり（likeness がある時だけ、写しをまとめる） */
const model: MatchModel = { ...base, whiten: base.keys.map((_, i) => base.keys.map((_, j) => (i === j ? 1 : 0))), likeness: { typical: 1.8, cuts: [1, 1.2, 1.4] } };
const voiceAt = (z: number): Features =>
  Object.fromEntries(
    model.keys.map((k, i) => {
      const x = model.center[i]! + z * model.spread[i]!;
      return [k, FEATURE_BY_KEY[k].log ? Math.exp(x) : x];
    }),
  ) as Features;
/** 最後の桁を 1 つ変えた写し */
const nudge = (f: Features, n: number): Features => ({ ...f, pitch: roundFeature('pitch', f.pitch! + n * 0.1) });
const items = (fs: Features[]) => fs.map((features) => ({ features }));

describe('壁 ③ の写し', () => {
  it('1 つの音の数字を少しずつ変えた 3 件は、1 件と数えて通らない', () => {
    const a = voiceAt(0.2);
    expect(consensus(model, items([a, nudge(a, 1), nudge(a, 2)]))).toBeNull();
    // 仮のモデル（画面の目盛り）では、まったく同じ数字だけをまとめる（前と同じ）
    expect(consensus({ ...model, likeness: undefined }, items([a, nudge(a, 1), nudge(a, 2)]))?.used).toBe(3);
  });
  it('写しの近さ（0.3）より離れた 3 件は通る。写しが混ざっても、出す数字は写しを 1 件とした中央値', () => {
    const three = [voiceAt(-0.4), voiceAt(0), voiceAt(0.4)];
    expect(consensus(model, items(three))?.used).toBe(3);
    const c = consensus(model, items([...three, nudge(three[2]!, 1), nudge(three[2]!, 2)]))!;
    // 使った件数は写しも数える（取り込みが名前などを決める登録と同じ数）
    expect(c.used).toBe(5);
    expect(consensusMembers(model, items([...three, nudge(three[2]!, 1), nudge(three[2]!, 2)]))).toHaveLength(5);
    expect(c.features.f1).toBeCloseTo(three[1]!.f1!, 0);
    // 0.3 より近い 2 件は 1 件
    expect(consensus(model, items([voiceAt(0), voiceAt(0.25), voiceAt(0.6)]))).toBeNull();
  });
  it(`中央値から ${CONSENSUS.maxDistance} までの物を使う`, () => {
    expect(consensus(model, items([voiceAt(-1.1), voiceAt(0), voiceAt(1.1)]))?.used).toBe(3);
    expect(consensus(model, items([voiceAt(-1.3), voiceAt(0), voiceAt(1.3)]))).toBeNull();
  });
});
