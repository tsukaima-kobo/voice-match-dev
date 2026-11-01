// src/voice/measure.ts の試験。数字から作った合成音だけを使う（録音なし。乱数は種つき）。
// 1. 同じ音なら同じ数字。2. 各項目が言葉どおりに動く。3. 測れない時は理由を言う。
// 人の声での確かめ（Praat との比較・配信の音との差）は、ここではなく tools/channel.ts と本物の声で行う。
import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS, FEATURE_BY_KEY } from '../src/voice/features.ts';
import { measureVoice, MIN_VOICED_SECONDS, quantileOf, resample, type Measured } from '../src/voice/measure.ts';
import { bursts, concat, gauss, mixIn, rng, silence, tone, vowel } from './voice-synth.ts';

const R = 16000;
const inRoom = (x: Float32Array, rate = R) => concat(silence(rate, 0.6), x, silence(rate, 0.6, 0.0003, 9));
const ok = (m: Measured) => {
  if (!m.ok) throw new Error(`not measured: ${m.reason} ${JSON.stringify(m.info)}`);
  return m;
};
const num = (v: number | null): number => {
  if (v === null) throw new Error('missing');
  return v;
};
/** a speech-like F0: a triangle round `mid` Hz, `span` semitones from top to bottom, once every two seconds */
const glide = (span: number, mid = 150) => (t: number) => mid * 2 ** ((span * 2 * (Math.abs(((t * 0.5) % 1) - 0.5) - 0.25)) / 12);
const syllables = bursts(5, { share: 0.8, floor: 0.4 });
const talk = bursts(5, { share: 0.8, floor: 0.3, group: 7, pause: 0.4 });
const increasing = (v: number[]) => v.every((x, i) => i === 0 || x > v[i - 1]!);

describe('同じ音なら同じ数字', () => {
  const clip = inRoom(vowel({ rate: 48000, seconds: 6, f0: glide(8), jitter: 0.01, shimmer: 0.04, breath: 0.02, envelope: talk }), 48000);
  it('gives identical results for the same samples, however they are held', () => {
    const a = measureVoice(clip, 48000);
    expect(a.ok).toBe(true);
    for (const b of [measureVoice(clip, 48000), measureVoice(Array.from(clip), 48000), measureVoice(Float32Array.from(clip), 48000)]) expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
  it('gives every item, rounded to its digits, and does not touch the samples', () => {
    const before = Float32Array.from(clip);
    const m = ok(measureVoice(clip, 48000));
    expect(Object.keys(m.features)).toEqual([...FEATURE_KEYS]);
    for (const k of FEATURE_KEYS) {
      const v = m.features[k];
      if (v === null) continue;
      const p = 10 ** FEATURE_BY_KEY[k].digits;
      expect(Math.round(v * p) / p, k).toBe(v);
    }
    // (a talk with pauses and syllables: nothing is missing but F4 (the synthetic vowel has three resonances) and
    // 速さのムラ (6 s hold fewer than 4 stretches of 1 s))
    expect(FEATURE_KEYS.filter((k) => m.features[k] === null)).toEqual(['f4', 'rateVar']);
    expect(clip).toEqual(before);
  });
  it('measures the same sound alike at 16, 22.05, 44.1 and 48 kHz', () => {
    const at = (rate: number) => ok(measureVoice(inRoom(vowel({ rate, seconds: 5, f0: glide(4, 211), envelope: syllables }), rate), rate));
    const all = [16000, 22050, 44100, 48000].map(at);
    for (const m of all) expect(Math.abs(num(m.features.pitch) / 211 - 1)).toBeLessThan(0.02);
    for (const m of all) expect(Math.abs(num(m.features.f2) / num(all[0]!.features.f2) - 1)).toBeLessThan(0.03);
  });
  it('does not change with the gain (the timbre and the strength are the same 12 dB quieter)', () => {
    const loud = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 5, f0: glide(4), envelope: syllables, rms: 0.2 })), R));
    const quiet = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 5, f0: glide(4), envelope: syllables, rms: 0.05 })), R));
    for (const k of ['pitch', 'f1', 'f2', 'f3', 'mfcc1', 'mfcc2', 'mfcc3', 'mfcc4', 'tilt', 'levelRange', 'centroid', 'hammarberg'] as const) {
      expect(Math.abs(num(quiet.features[k]) - num(loud.features[k])), k).toBeLessThanOrEqual(Math.abs(num(loud.features[k])) * 0.01 + 0.05);
    }
  });
});

describe('高さ', () => {
  it('finds the F0 of harmonic tones from 80 to 400 Hz within 0.5 %', () => {
    for (const f of [80, 95, 123.4, 160, 211, 250, 300, 400]) {
      const m = ok(measureVoice(inRoom(tone({ rate: R, seconds: 4, f0: f })), R));
      expect(Math.abs(num(m.features.pitch) / f - 1), `${f} Hz`).toBeLessThan(0.005);
    }
  });
  it('抑揚 follows the spread of a speech-like glide; 高さの動き follows its speed', () => {
    const spans = [2, 5, 10];
    const got = spans.map((s) => ok(measureVoice(inRoom(vowel({ rate: R, seconds: 6, f0: glide(s), envelope: syllables })), R)));
    got.forEach((m, i) => expect(Math.abs(num(m.features.pitchRange) - 0.8 * spans[i]!)).toBeLessThan(0.6));
    // (the glide goes `span` semitones a second)
    got.forEach((m, i) => expect(Math.abs(num(m.features.pitchMotion) - spans[i]!)).toBeLessThan(0.25 * spans[i]! + 0.3));
    expect(increasing(got.map((m) => num(m.features.pitchMotion)))).toBe(true);
  });
  it('高さの偏り: a voice that jumps up now and then leans up; a symmetric glide is near 0', () => {
    const sym = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 6, f0: glide(6), envelope: syllables })), R));
    // (mostly at 150 Hz, up to 8 semitones higher for 0.3 s of every 1.5 s)
    const up = (t: number) => 150 * 2 ** ((t % 1.5 < 0.3 ? 8 * Math.sin((Math.PI * (t % 1.5)) / 0.3) : 0) / 12);
    const lean = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 6, f0: up, envelope: syllables })), R));
    expect(Math.abs(num(sym.features.pitchSkew))).toBeLessThan(1);
    expect(num(lean.features.pitchSkew)).toBeGreaterThan(2);
  });
});

describe('響き（フォルマント）', () => {
  const at = (formants: [number, number][], f0 = 120) => ok(measureVoice(inRoom(vowel({ rate: R, seconds: 4, f0, formants })), R));
  it('finds F1 within 10 %, F2 and F3 within 8 %, of synthetic vowels (a low voice)', () => {
    const vowels: [number, number, number][] = [
      [300, 2300, 3000],
      [750, 1200, 2600],
      [500, 1500, 2500],
      [400, 900, 2400],
    ];
    for (const [a, b, c] of vowels) {
      const m = at([
        [a, 70],
        [b, 100],
        [c, 150],
      ]);
      // (F1 near the low harmonics is pulled a little toward them: 10 %)
      expect(Math.abs(num(m.features.f1) / a - 1), `F1 of ${a}`).toBeLessThan(0.1);
      expect(Math.abs(num(m.features.f2) / b - 1), `F2 of ${b}`).toBeLessThan(0.08);
      expect(Math.abs(num(m.features.f3) / c - 1), `F3 of ${c}`).toBeLessThan(0.08);
    }
  });
  it('響きの間隔: a shorter tract (all formants up by 20 %) measures wider', () => {
    const long = at([
      [500, 80],
      [1500, 100],
      [2500, 150],
    ]);
    const short = at([
      [600, 80],
      [1800, 100],
      [3000, 150],
    ]);
    expect(Math.abs(num(long.features.formantSpacing) - 1000)).toBeLessThan(60);
    expect(num(short.features.formantSpacing) / num(long.features.formantSpacing)).toBeGreaterThan(1.12);
  });
  it('F4 follows a fourth resonance', () => {
    for (const f4 of [3400, 4200]) {
      const m = at([
        [500, 80],
        [1500, 100],
        [2500, 150],
        [f4, 200],
      ]);
      expect(Math.abs(num(m.features.f4) / f4 - 1), `F4 of ${f4}`).toBeLessThan(0.08);
    }
  });
  it('F1 の幅: a wider first resonance measures wider', () => {
    const narrow = at([
      [600, 60],
      [1500, 100],
      [2500, 150],
    ]);
    const wide = at([
      [600, 220],
      [1500, 100],
      [2500, 150],
    ]);
    expect(num(wide.features.b1)).toBeGreaterThan(1.5 * num(narrow.features.b1));
  });
  it('口の開きの幅・舌の動きの幅・音色の動き: changing vowels measure wider and livelier than one held vowel', () => {
    const vs: [number, number][][] = [
      [
        [700, 90],
        [1200, 110],
        [2600, 160],
      ],
      [
        [300, 70],
        [2300, 100],
        [3000, 150],
      ],
      [
        [500, 80],
        [1500, 100],
        [2500, 150],
      ],
    ];
    const held = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 6, f0: 120, formants: vs[0], envelope: syllables })), R));
    const changing = ok(measureVoice(inRoom(concat(...Array.from({ length: 40 }, (_, i) => vowel({ rate: R, seconds: 0.15, f0: 120, formants: vs[i % 3], seed: i + 1 })))), R));
    expect(num(changing.features.f1Range)).toBeGreaterThan(num(held.features.f1Range) + 5);
    expect(num(changing.features.f2Range)).toBeGreaterThan(num(held.features.f2Range) + 5);
    expect(num(changing.features.mfccDelta)).toBeGreaterThan(2 * num(held.features.mfccDelta));
  });
  it('明るさ: higher resonances measure brighter', () => {
    const dark = at([
      [450, 80],
      [800, 90],
      [2400, 150],
    ]);
    const bright = at([
      [700, 110],
      [2000, 130],
      [3000, 170],
    ]);
    expect(num(dark.features.centroid)).toBeLessThan(num(bright.features.centroid));
  });
});

describe('声の質', () => {
  const voice = (o: { breath?: number; jitter?: number; shimmer?: number; glottis?: number }) => ok(measureVoice(inRoom(vowel({ rate: R, seconds: 5, f0: glide(6), envelope: syllables, seed: 5, ...o })), R));
  it('more breath: 澄み (HNR) and はっきりさ (CPP) fall', () => {
    const got = [0, 0.03, 0.06, 0.1].map((b) => voice({ breath: b }));
    expect(increasing(got.map((m) => -num(m.features.hnr)))).toBe(true);
    expect(increasing(got.map((m) => -num(m.features.cpp)))).toBe(true);
  });
  it('more jitter and shimmer: ゆらぎ grow', () => {
    const got = [0, 0.01, 0.02, 0.04].map((j) => voice({ jitter: j, shimmer: 4 * j }));
    expect(increasing(got.map((m) => num(m.features.jitter)))).toBe(true);
    expect(increasing(got.map((m) => num(m.features.shimmer)))).toBe(true);
  });
  it('柔らかさ (H1−H2): a softer source (its highs falling sooner) measures higher', () => {
    const got = [600, 250, 120, 70].map((g) => voice({ glottis: g }));
    expect(increasing(got.map((m) => num(m.features.h1h2)))).toBe(true);
    // (and the strength the other way)
    expect(increasing(got.map((m) => -num(m.features.tilt)))).toBe(true);
  });
});

describe('話す速さと間', () => {
  it('counts syllable-like bursts a second', () => {
    const per = [3, 4, 5, 6, 7];
    const got = per.map((n) => ok(measureVoice(inRoom(vowel({ rate: R, seconds: 6, f0: glide(4, 180), envelope: bursts(n, { share: 0.75 }) })), R)));
    got.forEach((m, i) => expect(Math.abs(num(m.features.rate) - per[i]!)).toBeLessThan(0.25));
  });
  it('measures the pauses: their share, their length, and the stretches between them', () => {
    const pauses = [0.3, 0.6, 1.0];
    const got = pauses.map((p) => ok(measureVoice(inRoom(vowel({ rate: R, seconds: 10, f0: glide(4, 180), envelope: bursts(5, { share: 0.75, group: 6, pause: p }) })), R)));
    expect(increasing(got.map((m) => num(m.features.pauseShare)))).toBe(true);
    got.forEach((m, i) => expect(Math.abs(num(m.features.pauseLen) - pauses[i]!), `pause ${pauses[i]}`).toBeLessThan(0.12));
    // (a group of 6 at 5 a second: 1.2 s, a little less for the last burst's tail)
    for (const m of got) expect(Math.abs(num(m.features.runLen) - 1.15)).toBeLessThan(0.15);
  });
  it('no pause at all: 間の長さ is missing, not made up', () => {
    const m = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 6, f0: glide(4), envelope: bursts(5, { share: 0.75 }) })), R));
    expect(m.features.pauseShare).toBe(0);
    expect(m.features.pauseLen).toBe(null);
  });
  it('速さのムラ: stretches at one speed are low; fast and slow stretches by turns are higher', () => {
    // (stretches of 1.6 s, pauses of 0.5 s; the syllables come `per(i)` a second in the i-th stretch)
    const env = (per: (i: number) => number) => (t: number) => {
      const i = Math.floor(t / 2.1),
        u = t - i * 2.1;
      if (u >= 1.6) return 0;
      const ph = (u * per(i)) % 1;
      return ph < 0.75 ? 0.4 + 0.6 * (0.5 - 0.5 * Math.cos((2 * Math.PI * ph) / 0.75)) : 0.4;
    };
    const even = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 12.6, f0: glide(4, 180), envelope: env(() => 5) })), R));
    const uneven = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 12.6, f0: glide(4, 180), envelope: env((i) => (i % 2 ? 7 : 3)) })), R));
    expect(num(even.features.rateVar)).toBeLessThan(0.1);
    expect(num(uneven.features.rateVar)).toBeGreaterThan(0.25);
  });
  it('リズムのムラ: even syllables are low, uneven ones higher', () => {
    const even = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 8, f0: glide(4), envelope: bursts(5, { share: 0.75 }) })), R));
    // (bursts of 0.12 s, the gaps between their peaks long then short: 0.35 s, 0.15 s, …)
    const lilt = (t: number) => {
      const ph = t % 0.5;
      const u = ph < 0.35 ? ph / 0.12 : (ph - 0.35) / 0.12;
      return u < 1 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * u) : 0;
    };
    const uneven = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 8, f0: glide(4), envelope: lilt })), R));
    expect(num(even.features.rhythm)).toBeLessThan(15);
    expect(num(uneven.features.rhythm)).toBeGreaterThan(num(even.features.rhythm) + 30);
  });
});

describe('測れない時は、その理由', () => {
  it('no sound, or the room alone: silent', () => {
    expect(measureVoice(silence(R, 5, 0), R)).toMatchObject({ ok: false, reason: 'silent' });
    expect(measureVoice(silence(R, 5), R)).toMatchObject({ ok: false, reason: 'silent' });
  });
  it('a voice far too quiet: quiet', () => {
    const m = measureVoice(concat(silence(R, 0.6, 0.00001), tone({ rate: R, seconds: 4, f0: 150, rms: 0.0007 }), silence(R, 0.6, 0.00001)), R);
    expect(m).toMatchObject({ ok: false, reason: 'quiet' });
  });
  it('a voice under a steady noise: noisy', () => {
    const x = inRoom(tone({ rate: R, seconds: 4, f0: 150 }));
    const r = rng(3);
    expect(measureVoice(mixIn(x, Float32Array.from({ length: x.length }, () => gauss(r) * 0.04)), R)).toMatchObject({ ok: false, reason: 'noisy' });
  });
  it('a voice cut off at full scale: clipped', () => {
    const x = inRoom(tone({ rate: R, seconds: 4, f0: 150, rms: 0.9 }));
    for (let i = 0; i < x.length; i++) x[i] = Math.max(-1, Math.min(1, x[i]!));
    expect(measureVoice(x, R)).toMatchObject({ ok: false, reason: 'clipped' });
  });
  it(`less voice than asked: short (default ${MIN_VOICED_SECONDS} s; the page asks for more)`, () => {
    expect(measureVoice(inRoom(tone({ rate: R, seconds: 2, f0: 150 })), R)).toMatchObject({ ok: false, reason: 'short' });
    const five = inRoom(vowel({ rate: R, seconds: 5, f0: 150 }));
    expect(measureVoice(five, R).ok).toBe(true);
    expect(measureVoice(five, R, { minVoicedSeconds: 8 })).toMatchObject({ ok: false, reason: 'short' });
  });
  it('not a recording: invalid', () => {
    expect(measureVoice(new Float32Array(0), R)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(measureVoice(tone({ rate: R, seconds: 4, f0: 150 }), 4000)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('音楽が混ざった時の目印', () => {
  it('a tone kept going in the pauses raises gapTonal', () => {
    const talkOnly = inRoom(vowel({ rate: R, seconds: 8, f0: glide(4), envelope: talk }));
    const clean = ok(measureVoice(talkOnly, R));
    expect(clean.info.gapTonal).toBeLessThan(0.05);
    const music = tone({ rate: R, seconds: 8 + 1.2, f0: 440, rms: 0.006 });
    const withMusic = ok(measureVoice(mixIn(Float32Array.from(talkOnly), music), R));
    expect(withMusic.info.gapTonal).toBeGreaterThan(0.5);
  });
});

describe('小さな道具', () => {
  it('quantileOf (linear between ranks)', () => {
    expect(quantileOf([3, 1, 2, 4], 0.5)).toBe(2.5);
    expect(Number.isNaN(quantileOf([], 0.5))).toBe(true);
  });
  it('resample keeps a tone’s level and frequency', () => {
    const x = Float64Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5);
    const y = resample(x, 48000, 16000);
    expect(y.length).toBe(16000);
    const mid = y.subarray(1000, 15000);
    expect(Math.sqrt(mid.reduce((a, v) => a + v * v, 0) / mid.length)).toBeCloseTo(0.5 / Math.SQRT2, 3);
  });
});
