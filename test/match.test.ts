// 照合（src/match/match.ts）と tools/lib.ts の試験。数字は種つきの乱数で作る（声の合成はしない）。
import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS, FEATURE_BY_KEY, forLength, ONE_LINE_SECONDS, type Features } from '../src/voice/features.ts';
import { defaultModel, rank, closeness, closenessWord, distances, farScale, type MatchModel } from '../src/match/match.ts';
import { evaluate, fitModel, itemStats, LIKENESS_SHARE, likenessScale, medianFeatures, selectWindows, type Speaker } from '../tools/lib.ts';
import type { VoiceWindow } from '../src/data/types.ts';
import { gauss, rng } from './voice-synth.ts';

const V = 'test';
/** 画面の目盛りの中のどこか（0〜1）を、その項目の数字に */
const at = (k: (typeof FEATURE_KEYS)[number], t: number) => {
  const d = FEATURE_BY_KEY[k];
  return d.log ? d.lo * (d.hi / d.lo) ** t : d.lo + (d.hi - d.lo) * t;
};
function voiceAt(pos: Record<string, number>): Features {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, at(k, pos[k] ?? 0.5)])) as Features;
}
/** n 人、1 人 2 本の動画で 8 窓ずつ。人ごとの位置はばらばら、窓ごとの揺れは `noise`（目盛りの割合）。項目の半分は人による差が無い */
function crowd(n: number, noise: number, seed = 1): { id: string; windows: VoiceWindow[] }[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const pos = Object.fromEntries(FEATURE_KEYS.map((k, j) => [k, j % 2 === 0 ? 0.2 + 0.6 * r() : 0.5]));
    const windows: VoiceWindow[] = [];
    for (const video of ['a', 'b'])
      for (let w = 0; w < 8; w++) {
        const p = Object.fromEntries(FEATURE_KEYS.map((k) => [k, pos[k]! + noise * gauss(r)]));
        windows.push({ video, t0: w * 30, t1: w * 30 + 30, measuredAt: '2026-10-31', version: V, features: voiceAt(p), voicedSeconds: 12, gapTonal: 0, snrDb: 30 });
      }
    return { id: `vt-${String(i + 1).padStart(4, '0')}`, windows };
  });
}

describe('照合', () => {
  const model = defaultModel(V);
  const people = [
    { id: 'vt-0002', features: voiceAt({ pitch: 0.8 }) },
    { id: 'vt-0001', features: voiceAt({ pitch: 0.2 }) },
    { id: 'vt-0003', features: voiceAt({ pitch: 0.5 }) },
  ];
  it('一番近い声が先。同じ声は距離 0', () => {
    const r = rank(model, voiceAt({ pitch: 0.75 }), people);
    expect(r.map((x) => x.id)).toEqual(['vt-0002', 'vt-0003', 'vt-0001']);
    expect(rank(model, people[2]!.features, people)[0]).toMatchObject({ id: 'vt-0003', distance: 0 });
  });
  it('距離が同じなら ID の小さい方が先（一覧の順に関わらず）', () => {
    const twins = [
      { id: 'vt-0009', features: voiceAt({}) },
      { id: 'vt-0004', features: voiceAt({}) },
    ];
    expect(rank(model, voiceAt({}), twins)[0]!.id).toBe('vt-0004');
    expect(rank(model, voiceAt({}), [...twins].reverse())[0]!.id).toBe('vt-0004');
  });
  it('声に無い項目は除いて、それでも並べる', () => {
    const u = { ...voiceAt({ pitch: 0.2 }), pauseLen: null };
    const r = rank(model, u, people);
    expect(r[0]!.id).toBe('vt-0001');
    expect(r[0]!.used).toBe(FEATURE_KEYS.length - 1);
  });
  it('どの項目が近いかを出す', () => {
    const c = closeness(model, voiceAt({ pitch: 0.2, rate: 0.9 }), voiceAt({ pitch: 0.2, rate: 0.1 }));
    expect(c[c.length - 1]![0]).toBe('rate');
    expect(c[0]![1]).toBe(0);
  });
});

/** 逆行列（掃き出し。試験の答え合わせ用） */
function inverse(a: number[][]): number[][] {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    const d = m[c]![c]!;
    for (let j = 0; j < 2 * n; j++) m[c]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]!;
      for (let j = 0; j < 2 * n; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  return m.map((row) => row.slice(n));
}
/** 答え合わせ: 両方にある項目だけの、マハラノビス距離を 1 項目あたりに（Σ = (WᵀW)⁻¹ の、その項目の所の逆で） */
function mahalanobis(model: MatchModel, a: Features, b: Features): number {
  const z = (f: Features) => model.keys.map((k, i) => (f[k] === null ? null : ((FEATURE_BY_KEY[k].log ? Math.log(f[k]!) : f[k]!) - model.center[i]!) / model.spread[i]!));
  const u = z(a),
    v = z(b);
  const o = model.keys.flatMap((_, i) => (u[i] !== null && v[i] !== null ? [i] : []));
  const W = model.whiten!;
  const cov = inverse(W[0]!.map((_, i) => W[0]!.map((_, j) => W.reduce((s, row) => s + row[i]! * row[j]!, 0))));
  const p = inverse(o.map((i) => o.map((j) => cov[i]![j]!)));
  const d = o.map((i) => u[i]! - v[i]!);
  return Math.sqrt(d.reduce((s, x, r) => s + x * d.reduce((t, y, c) => t + p[r]![c]! * y, 0), 0) / o.length);
}

describe('白色化のモデルで、無い項目のある声を比べる', () => {
  const speakers = crowd(30, 0.05, 4);
  // 項目どうしに重なりのあるモデル（ずらした項目を足して、白色化に意味を持たせる）
  const linked = speakers.map((s) => ({
    ...s,
    windows: s.windows.map((w) => ({ ...w, features: { ...w.features, f2: w.features.f1! * 1.6, mfcc2: w.features.mfcc1! / 40 } })),
  }));
  const model = fitModel(linked, V, { whiten: true });
  const profiles = linked.map((s) => ({ id: s.id, features: medianFeatures(s.windows) }));
  const query = linked[7]!.windows[3]!.features;
  it('全部の項目がある時も、一部が無い時も、両方にある項目だけのマハラノビス距離（1 項目あたり）になる', () => {
    expect(model.whiten).toBeDefined();
    for (const q of [query, forLength(query, ONE_LINE_SECONDS), { ...query, pitch: null, f1: null, mfcc5: null }]) {
      for (const r of rank(model, q, profiles, 30)) expect(r.distance, r.id).toBeCloseTo(mahalanobis(model, q, profiles.find((p) => p.id === r.id)!.features), 3);
    }
  });
  it('数は、両方にあって比べた項目の数', () => {
    const short = forLength(query, ONE_LINE_SECONDS);
    const n = FEATURE_KEYS.filter((k) => short[k] !== null).length;
    expect(n).toBeLessThan(FEATURE_KEYS.length);
    expect(rank(model, short, profiles, 1)[0]!.used).toBe(n);
    expect(rank(model, query, profiles, 1)[0]!.used).toBe(FEATURE_KEYS.length);
  });
  it('来た人に無い項目は、相手の値に関わらない（中心の値の人が近くならない）', () => {
    const short = forLength(query, ONE_LINE_SECONDS);
    const real = profiles[7]!.features;
    const centred = { ...real };
    model.keys.forEach((k, i) => {
      if (short[k] === null) centred[k] = FEATURE_BY_KEY[k].log ? Math.exp(model.center[i]!) : model.center[i]!;
    });
    const r = rank(model, short, [
      { id: 'b-centre', features: centred },
      { id: 'a-real', features: real },
    ]);
    expect(r[0]!.distance).toBe(r[1]!.distance);
    expect(r[0]!.id).toBe('a-real');
  });
  it('近さは丸めない（言葉は丸める前の値で選ぶ）。並べない近さも同じ値', () => {
    const d = rank(model, query, profiles, 30).map((x) => x.distance);
    expect(d.some((x) => Math.round(x * 100) / 100 !== x)).toBe(true);
    const all = new Map(distances(model, query, profiles).map((x) => [x.id, x.distance]));
    for (const r of rank(model, query, profiles, 30)) expect(all.get(r.id)).toBe(r.distance);
    const m = { ...model, likeness: { typical: 9, cuts: [1.0195, 1.1898, 1.3879] as [number, number, number] } };
    expect(closenessWord(m, 1.0195)).toBe('とても似ている');
    expect(closenessWord(m, 1.0197)).toBe('よく似ている');
  });
  it('一言でも、ほとんどの場合その人を当てる', () => {
    const r = evaluate(linked, model);
    expect(r.oneLine.top1).toBeGreaterThan(0.8);
    expect(r.oneLine.top5).toBeGreaterThanOrEqual(r.oneLine.top1);
  });
});

describe('窓の選別と代表値', () => {
  const base = crowd(1, 0.02)[0]!.windows;
  it('別の版・音楽・短い窓・高さが大きく外れた窓を除く', () => {
    const odd = [
      { ...base[0]!, version: 'old' },
      { ...base[1]!, gapTonal: 0.6 },
      { ...base[2]!, voicedSeconds: 3 },
      { ...base[3]!, features: { ...base[3]!.features, pitch: base[3]!.features.pitch! * 2 } },
    ];
    const { kept, dropped } = selectWindows([...odd, ...base.slice(4)], V);
    expect(dropped).toEqual({ version: 1, music: 1, short: 1, pitch: 1 });
    expect(kept.length).toBe(base.length - 4);
  });
  it('項目ごとに中央値を取る', () => {
    const m = medianFeatures(base);
    const pitches = base.map((w) => w.features.pitch!).sort((a, b) => a - b);
    expect(Math.abs(m.pitch! - (pitches[7]! + pitches[8]!) / 2)).toBeLessThan(0.1);
  });
});

describe('モデルと評価', () => {
  const speakers = crowd(30, 0.03);
  it('人を見分ける項目を見つける（人で違う項目は ICC が高く、違わない項目は 0 に近い）', () => {
    const items = itemStats(speakers);
    FEATURE_KEYS.forEach((k, j) => {
      const icc = items.find((i) => i.key === k)!.icc;
      if (j % 2 === 0) expect(icc, k).toBeGreaterThan(0.8);
      else expect(icc, k).toBeLessThan(0.3);
    });
  });
  it('窓に無い項目は、0 のずれとして数えない（散らばりが小さくならない）', () => {
    const base = fitModel(speakers, V, { whiten: false });
    // 半分の窓から pitch を抜く
    const holes = speakers.map((s) => ({ ...s, windows: s.windows.map((w, i) => (i % 2 ? { ...w, features: { ...w.features, pitch: null } } : w)) }));
    const m = fitModel(holes, V, { whiten: false });
    const at = base.keys.indexOf('pitch');
    expect(m.spread[at]! / base.spread[at]!).toBeGreaterThan(0.8);
    expect(m.spread[at]! / base.spread[at]!).toBeLessThan(1.25);
  });
  it('別の動画からでも、ほとんどの場合その人を当てる', () => {
    for (const whiten of [false, true]) {
      const model = fitModel(speakers, V, { whiten });
      const r = evaluate(speakers, model);
      expect(r.queries).toBe(30 * 16);
      expect(r.top1, `whiten ${whiten}`).toBeGreaterThan(0.9);
      expect(r.top5).toBeGreaterThanOrEqual(r.top1);
    }
  });
  it('揺れの大きい集まりほど見分けにくい', () => {
    const noisy = crowd(30, 0.2, 2);
    const a = evaluate(speakers, fitModel(speakers, V, { whiten: false }));
    const b = evaluate(noisy, fitModel(noisy, V, { whiten: false }));
    expect(b.top1).toBeLessThan(a.top1);
  });
});

describe('近さの言葉', () => {
  const speakers = crowd(40, 0.12, 3);
  const fitted = fitModel(speakers, V, { whiten: true });
  const model = { ...fitted, likeness: likenessScale(speakers, fitted) };
  const WORDS = ['とても似ている', 'よく似ている', '似ている', '似ている所がある'];
  /** 窓 1 つずつを、本人を除いた全員と比べた時の、1 位の言葉の割合。shift は来た人の全項目に足すずれ（目盛りの割合） */
  function shares(shift: number, useScale: boolean): number[] {
    const n = [0, 0, 0, 0];
    speakers.forEach((s, si) => {
      const others = speakers.flatMap((o, oi) => (oi === si ? [] : [{ id: o.id, features: medianFeatures(o.windows) }]));
      for (const w of s.windows) {
        const f = Object.fromEntries(FEATURE_KEYS.map((k) => [k, FEATURE_BY_KEY[k].log ? w.features[k]! * Math.exp(shift) : w.features[k]! + shift * (FEATURE_BY_KEY[k].hi - FEATURE_BY_KEY[k].lo)])) as Features;
        const top = rank(model, f, others, 1)[0]!;
        const at = WORDS.indexOf(closenessWord(model, top.distance, useScale ? farScale(model, f, others) : 1));
        n[at] = n[at]! + 1;
      }
    });
    const all = n.reduce((a, b) => a + b, 0);
    return n.map((x) => x / all);
  }
  it('データから目盛りを作る: 区切りは順に大きく、全員とのふつうの距離は区切りより遠い', () => {
    const { typical, cuts } = model.likeness!;
    expect(cuts[0]).toBeLessThan(cuts[1]);
    expect(cuts[1]).toBeLessThan(cuts[2]);
    expect(typical).toBeGreaterThan(cuts[2]);
  });
  it('データに居ない人の 1 位の声に、決めた割合どおりに言葉が付く', () => {
    const s = shares(0, true);
    expect(s[0]).toBeCloseTo(LIKENESS_SHARE[0], 1);
    expect(s[0]! + s[1]!).toBeCloseTo(LIKENESS_SHARE[1], 1);
    expect(s[3]).toBeLessThan(0.05);
  });
  it('マイクで声が全員から一度に遠くなっても言葉を保つ（目盛りが無いと保てない）', () => {
    const plain = shares(0.05, false);
    const kept = shares(0.05, true);
    expect(plain[3]).toBeGreaterThan(0.3);
    expect(kept[3]).toBeLessThan(0.1);
    expect(kept[0]! + kept[1]!).toBeGreaterThan(0.6);
  });
  it('モデルに目盛りが無い時は、決まった目盛りを使う', () => {
    const m = defaultModel(V);
    expect(farScale(m, voiceAt({}), [{ id: 'a', features: voiceAt({ pitch: 0.9 }) }])).toBe(1);
    expect(closenessWord(m, 0.4)).toBe('とても似ている');
    expect(closenessWord(m, 1.0)).toBe('似ている');
    expect(closenessWord(m, 2)).toBe('似ている所がある');
  });
});
