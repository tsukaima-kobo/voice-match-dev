// 声真似の練習の計算（src/mimic/mimic.ts）と、長い音の測り方（src/voice/combine.ts）の試験。合成音だけ（録音なし）。
import { describe, expect, it } from 'vitest';
import { measureVoice, type Measured } from '../src/voice/measure.ts';
import { measureLong, medianFeatures } from '../src/voice/combine.ts';
import { ADVICE, adviceFor, differences, mimicScore, scoreWord } from '../src/mimic/mimic.ts';
import { FEATURE_KEYS, type Features } from '../src/voice/features.ts';
import { bursts, concat, silence, vowel } from './voice-synth.ts';

const R = 16000;
const talk = bursts(5, { share: 0.8, floor: 0.3, group: 7, pause: 0.4 });
/** `f0` Hz あたりで話す（±2 半音、ゆっくり） */
const speech = (seconds: number, f0: number, seed = 1) =>
  concat(
    silence(R, 0.5),
    vowel({ rate: R, seconds, f0: (t) => f0 * 2 ** ((2 * Math.sin(t * 1.3)) / 12), jitter: 0.008, shimmer: 0.03, breath: 0.02, envelope: talk, seed }),
    silence(R, 0.5, 0.0003, 9),
  );
const ok = (m: Measured) => {
  if (!m.ok) throw new Error(`not measured: ${m.reason}`);
  return m.features;
};
const noPause = async () => {};

describe('点数', () => {
  const a = ok(measureVoice(speech(12, 180), R));
  const b = ok(measureVoice(speech(12, 200, 2), R));
  const c = ok(measureVoice(speech(12, 260, 3), R));
  it('同じ数字なら 100、遠いほど低く、何度でも同じ', () => {
    expect(mimicScore(a, a)!.score).toBe(100);
    const sb = mimicScore(a, b)!.score;
    const sc = mimicScore(a, c)!.score;
    expect(sb).toBeLessThan(100);
    expect(sc).toBeLessThan(sb);
    expect(mimicScore(a, b)).toEqual(mimicScore(a, b));
  });
  it('比べられる項目が無ければ null', () => {
    const none = Object.fromEntries(FEATURE_KEYS.map((k) => [k, null])) as Features;
    expect(mimicScore(a, none)).toBeNull();
    expect(mimicScore(a, { ...none, pitch: 200, rate: 5 })).toBeNull();
  });
  it('どの点数にも言葉がある', () => {
    expect([100, 90, 89, 75, 74, 55, 54, 35, 34, 0].map(scoreWord)).toEqual(['そっくり', 'そっくり', 'かなり近い', 'かなり近い', '近い', '近い', '少し近い', '少し近い', 'まだ遠い', 'まだ遠い']);
  });
});

describe('直し方', () => {
  const base = ok(measureVoice(speech(12, 180), R));
  it('自分の数字がお手本より低ければ上げるように、高ければ下げるように言う', () => {
    const up = adviceFor(differences({ ...base, pitch: 260 }, base));
    expect(up[0]).toMatchObject({ key: 'pitch', text: ADVICE.pitch!.up });
    const down = adviceFor(differences({ ...base, pitch: 120 }, base));
    expect(down[0]).toMatchObject({ key: 'pitch', text: ADVICE.pitch!.down });
  });
  it('小さな違いと、わざと変えられない項目は除く', () => {
    const d = differences({ ...base, mfcc1: (base.mfcc1 ?? 0) + 20, jitter: 0.05 }, base);
    expect(d.map((x) => x.key)).not.toContain('mfcc1');
    expect(d.map((x) => x.key)).not.toContain('jitter');
    expect(adviceFor(d)).toEqual([]);
    expect(adviceFor(differences({ ...base, pitch: base.pitch! * 2 ** (1 / 12) }, base))).toEqual([]);
  });
  it('大きな違いは 1 つでも効く: 1 オクターブずれると点数が半分を切る', () => {
    expect(mimicScore({ ...base, pitch: base.pitch! * 2 }, base)!.score).toBeLessThan(50);
    expect(mimicScore({ ...base, pitch: base.pitch! * 2 ** (1 / 12) }, base)!.score).toBeGreaterThan(95);
  });
  it('こつは多くて n 個、違いの大きい物から', () => {
    const target = { ...base, pitch: 300, rate: (base.rate ?? 5) + 3, pitchRange: (base.pitchRange ?? 4) + 2, levelRange: (base.levelRange ?? 15) + 9 };
    const tips = adviceFor(differences(target, base), 2);
    expect(tips).toHaveLength(2);
    expect(Math.abs(tips[0]!.z)).toBeGreaterThanOrEqual(Math.abs(tips[1]!.z));
  });
});

describe('長い音', () => {
  it('40 s 以下の音は、measureVoice と同じく一度に測る', async () => {
    const x = speech(12, 180);
    const m = await measureLong(x, R, { minVoicedSeconds: 8, pause: noPause });
    expect(m.ok).toBe(true);
    expect(m.ok && m.features).toEqual(ok(measureVoice(x, R, { minVoicedSeconds: 8 })));
  });
  it('それより長い音は 30 s の窓に分けて中央値を取る。何度でも同じ', async () => {
    const x = speech(75, 180);
    const progress: string[] = [];
    const m = await measureLong(x, R, { minVoicedSeconds: 8, pause: noPause, onProgress: (d, t) => progress.push(`${d}/${t}`) });
    if (!m.ok) throw new Error(m.reason);
    expect(m.windows).toBe(3);
    expect(progress.at(-1)).toBe('3/3');
    expect(Math.abs(m.features.pitch! / 180 - 1)).toBeLessThan(0.03);
    expect(await measureLong(x, R, { minVoicedSeconds: 8, pause: noPause })).toEqual(m);
  });
  it('声のある窓が無い時は、わけを言う', async () => {
    const m = await measureLong(silence(R, 70), R, { minVoicedSeconds: 8, pause: noPause });
    expect(m).toMatchObject({ ok: false, reason: 'silent' });
  });
  it('項目ごとに中央値を取る。無い物は除く', () => {
    const f = (pitch: number | null) => ({ features: { ...Object.fromEntries(FEATURE_KEYS.map((k) => [k, null])), pitch } as Features });
    expect(medianFeatures([f(100), f(300), f(200), f(null)]).pitch).toBe(200);
    expect(medianFeatures([f(null)]).pitch).toBeNull();
  });
});
