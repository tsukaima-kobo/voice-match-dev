// 一言から測る・話すほど絞り込む（features.ts の needOf・takes.ts）と、セリフ真似（measure.ts の Contour・mimic/line.ts）の試験。
// 音は合成音（録音なし）。
import { describe, expect, it } from 'vitest';
import { CONTOUR_STEP, measureVoice } from '../src/voice/measure.ts';
import { FEATURE_KEYS, forLength, LONG_SECONDS, needOf, ONE_LINE_SECONDS, type Features } from '../src/voice/features.ts';
import { certaintyOf, combineTakes } from '../src/voice/takes.ts';
import { compareLines, lineScore } from '../src/mimic/line.ts';
import { mimicScore } from '../src/mimic/mimic.ts';
import { concat, silence, vowel } from './voice-synth.ts';

const R = 16000;
/** 一言: 声 `seconds` 秒（前後に静かな所）。高さは f0(t) */
const line = (seconds: number, f0: number | ((t: number) => number), seed = 1) =>
  concat(silence(R, 0.4), vowel({ rate: R, seconds, f0, jitter: 0.006, shimmer: 0.03, breath: 0.02, seed, envelope: (t) => Math.min(1, t / 0.05, (seconds - t) / 0.05) }), silence(R, 0.4));
const ok = (x: Float32Array, contour = false) => {
  const m = measureVoice(x, R, { minVoicedSeconds: ONE_LINE_SECONDS, contour });
  if (!m.ok) throw new Error(m.reason);
  return m;
};

describe('一言から測る', () => {
  it('measures a word of about a second: the pitch, the formants and the voice quality', () => {
    const m = ok(line(1, 180));
    expect(m.features.pitch).toBeGreaterThan(175);
    expect(m.features.pitch).toBeLessThan(185);
    for (const k of ['f1', 'f2', 'f3', 'hnr', 'cpp', 'h1h2', 'tilt'] as const) expect(m.features[k], k).not.toBeNull();
  });
  it('turns away less than the least', () => {
    const m = measureVoice(line(0.25, 180), R, { minVoicedSeconds: ONE_LINE_SECONDS });
    expect(m.ok).toBe(false);
  });
  it('leaves out, for a short take, the items that need a longer one', () => {
    const f = forLength(ok(line(1, 180)).features, 1);
    expect(f.pitch).not.toBeNull();
    expect(f.pitchRange).toBeNull();
    expect(f.rate).toBeNull();
    expect(needOf('pitch')).toBe(ONE_LINE_SECONDS);
    expect(needOf('pauseShare')).toBe(LONG_SECONDS);
  });
});

describe('話すほど絞り込む', () => {
  const base = Object.fromEntries(FEATURE_KEYS.map((k) => [k, null])) as Features;
  it('puts takes together by their length, the Hz ones as a geometric mean, each item only from takes long enough for it', () => {
    const a = { ...base, pitch: 100, hnr: 10, rate: 5 };
    const b = { ...base, pitch: 400, hnr: 20, rate: 3 };
    const c = combineTakes([
      { features: a, voicedSeconds: 1 },
      { features: b, voicedSeconds: 1 },
    ]);
    expect(c.features.pitch).toBe(200);
    expect(c.features.hnr).toBe(15);
    expect(c.features.rate).toBeNull();
    const d = combineTakes([
      { features: a, voicedSeconds: 1 },
      { features: b, voicedSeconds: 9 },
    ]);
    expect(d.features.rate).toBe(3);
    expect(d.features.hnr).toBe(19);
    expect(d.voicedSeconds).toBe(10);
    expect(d.takes).toBe(2);
  });
  it('tells how sure: a word, a few seconds, one long take', () => {
    expect(certaintyOf({ voicedSeconds: 1, longest: 1 })).toBe(1);
    expect(certaintyOf({ voicedSeconds: 4, longest: 1 })).toBe(2);
    expect(certaintyOf({ voicedSeconds: 12, longest: 3 })).toBe(2);
    expect(certaintyOf({ voicedSeconds: 9, longest: 8.5 })).toBe(3);
  });
  it('does not give a short take a higher voice score for leaving items out', () => {
    const t = ok(line(1, 180)).features;
    const off = { ...t, pitch: t.pitch! * 2 ** (3 / 12) };
    const full = mimicScore(t, off)!;
    const fewer = mimicScore({ ...t, f2: null, centroid: null }, { ...off, f2: null, centroid: null })!;
    expect(fewer.score).toBeLessThanOrEqual(full.score);
  });
});

describe('セリフ真似', () => {
  // (a line that goes up, then falls at the end)
  const rise = (t: number) => 160 * 2 ** ((4 * Math.sin(Math.PI * Math.min(1, t / 1.2))) / 12);
  const fall = (t: number) => 160 * 2 ** ((-4 * Math.sin(Math.PI * Math.min(1, t / 1.2))) / 12);
  it('gives the pitch and the loudness over time, step by step', () => {
    const m = ok(line(1.2, rise), true);
    const c = m.info.contour!;
    expect(c.step).toBe(CONTOUR_STEP);
    expect(c.pitch.length).toBeGreaterThan(50);
    const voiced = Array.from(c.pitch).filter(Number.isFinite);
    expect(Math.max(...voiced) - Math.min(...voiced)).toBeGreaterThan(3);
    expect(Math.max(...Array.from(c.level))).toBe(0);
  });
  it('scores the same line the same as full marks', () => {
    const c = ok(line(1.2, rise), true).info.contour!;
    const r = compareLines(c, c)!;
    expect(r.intonation).toBe(100);
    expect(r.timing).toBe(100);
    expect(r.tips).toEqual([]);
    expect(lineScore(r, 100)).toBe(100);
  });
  it('keeps the shape apart from the height: the same tune higher still has the intonation', () => {
    const a = ok(line(1.2, rise, 1), true).info.contour!;
    const b = ok(line(1.2, (t) => rise(t) * 2 ** (5 / 12), 2), true).info.contour!;
    expect(compareLines(a, b)!.intonation).toBeGreaterThanOrEqual(85);
  });
  it('sees a tune that goes the other way, and tells where', () => {
    const a = ok(line(1.2, rise, 1), true).info.contour!;
    const b = ok(line(1.2, fall, 2), true).info.contour!;
    const r = compareLines(a, b)!;
    expect(r.intonation).toBeLessThan(30);
    expect(r.tips.map((t) => t.text).join('')).toContain('上げる');
  });
  it('sees a slower line in the timing, not in the intonation', () => {
    const a = ok(line(1.2, rise, 1), true).info.contour!;
    const b = ok(line(1.9, (t) => rise((t * 1.2) / 1.9), 2), true).info.contour!;
    const r = compareLines(a, b)!;
    expect(r.intonation).toBeGreaterThanOrEqual(80);
    expect(r.timing).toBeLessThan(85);
    expect(r.tips.map((t) => t.text).join('')).toContain('速く');
  });
  it('weighs the parts 4 : 2.5 : 3.5, and goes on without the voice part', () => {
    expect(lineScore({ intonation: 100, timing: 0 }, 0)).toBe(40);
    expect(lineScore({ intonation: 100, timing: 0 }, null)).toBe(62);
  });
});
