// 照合（src/match/match.ts）と tools/lib.ts の試験。数字は種つきの乱数で作る（声の合成はしない）。
import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS, FEATURE_BY_KEY, type Features } from '../src/voice/features.ts';
import { defaultModel, rank, closeness } from '../src/match/match.ts';
import { evaluate, fitModel, itemStats, medianFeatures, selectWindows, type Speaker } from '../tools/lib.ts';
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
  it('puts the nearest first, and the same voice at distance 0', () => {
    const r = rank(model, voiceAt({ pitch: 0.75 }), people);
    expect(r.map((x) => x.id)).toEqual(['vt-0002', 'vt-0003', 'vt-0001']);
    expect(rank(model, people[2]!.features, people)[0]).toMatchObject({ id: 'vt-0003', distance: 0 });
  });
  it('breaks a tie by the smaller id, whatever the order of the list', () => {
    const twins = [
      { id: 'vt-0009', features: voiceAt({}) },
      { id: 'vt-0004', features: voiceAt({}) },
    ];
    expect(rank(model, voiceAt({}), twins)[0]!.id).toBe('vt-0004');
    expect(rank(model, voiceAt({}), [...twins].reverse())[0]!.id).toBe('vt-0004');
  });
  it('leaves out an item a voice does not have, and still ranks', () => {
    const u = { ...voiceAt({ pitch: 0.2 }), pauseLen: null };
    const r = rank(model, u, people);
    expect(r[0]!.id).toBe('vt-0001');
    expect(r[0]!.used).toBe(FEATURE_KEYS.length - 1);
  });
  it('says which items are close', () => {
    const c = closeness(model, voiceAt({ pitch: 0.2, rate: 0.9 }), voiceAt({ pitch: 0.2, rate: 0.1 }));
    expect(c[c.length - 1]![0]).toBe('rate');
    expect(c[0]![1]).toBe(0);
  });
  it('takes a fixed shift off the visitor only (a BGM model), so a shifted copy of a voice comes back to it', () => {
    const i = model.keys.indexOf('pitch');
    // (pitch is on a log scale: a shift of log 1.5 raises it by half)
    const shifted = { ...people[1]!.features, pitch: people[1]!.features.pitch! * 1.5 };
    expect(rank(model, shifted, people)[0]!.id).not.toBe('vt-0001');
    const bgm = { ...model, queryShift: model.keys.map((_, j) => (j === i ? Math.log(1.5) : 0)) };
    expect(rank(bgm, shifted, people)[0]).toMatchObject({ id: 'vt-0001', distance: 0 });
    expect(closeness(bgm, shifted, people[1]!.features).find(([k]) => k === 'pitch')![1]).toBeCloseTo(0, 6);
  });
});

describe('窓の選別と代表値', () => {
  const base = crowd(1, 0.02)[0]!.windows;
  it('drops other versions, music, short windows, and windows far off the pitch', () => {
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
  it('takes the median of each item', () => {
    const m = medianFeatures(base);
    const pitches = base.map((w) => w.features.pitch!).sort((a, b) => a - b);
    expect(Math.abs(m.pitch! - (pitches[7]! + pitches[8]!) / 2)).toBeLessThan(0.1);
  });
});

describe('モデルと評価', () => {
  const speakers = crowd(30, 0.03);
  it('finds the items that tell people apart (ICC high where people differ, near 0 where they do not)', () => {
    const items = itemStats(speakers);
    FEATURE_KEYS.forEach((k, j) => {
      const icc = items.find((i) => i.key === k)!.icc;
      if (j % 2 === 0) expect(icc, k).toBeGreaterThan(0.8);
      else expect(icc, k).toBeLessThan(0.3);
    });
  });
  it('identifies the speaker from another video most of the time', () => {
    for (const whiten of [false, true]) {
      const model = fitModel(speakers, V, { whiten });
      const r = evaluate(speakers, model);
      expect(r.queries).toBe(30 * 16);
      expect(r.top1, `whiten ${whiten}`).toBeGreaterThan(0.9);
      expect(r.top5).toBeGreaterThanOrEqual(r.top1);
    }
  });
  it('a noisier crowd is told apart less well', () => {
    const noisy = crowd(30, 0.2, 2);
    const a = evaluate(speakers, fitModel(speakers, V, { whiten: false }));
    const b = evaluate(noisy, fitModel(noisy, V, { whiten: false }));
    expect(b.top1).toBeLessThan(a.top1);
  });
});
