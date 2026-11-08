// src/voice/measure.ts の高い声（500〜1100 Hz）の試験。合成音だけを使う（録音なし。乱数は種つき）。
// 1. 高い声を正しいオクターブで測る。2. 1100 Hz より高い音は、半分の高さにせず捨てる。
// 3. 500 Hz より低い声は、版 3.1.0 と全く同じ数字（3.1.0 で測った声と比べられるように）。息の多い声も（3.2.0 は、2 倍音・3 倍音を
//    本当の高さと取り違えて 1 オクターブ高く測ったり、上限より高い答えで 3.1.0 の答えを捨てたりしていた）。
import { describe, expect, it } from 'vitest';
import { MEASURE_COMPATIBLE, MEASURE_VERSION, measureVoice, type Measured } from '../src/voice/measure.ts';
import { bursts, concat, silence, tone, vowel } from './voice-synth.ts';

const R = 16000;
const ONE = { minVoicedSeconds: 0.4 };
const inRoom = (x: Float32Array) => concat(silence(R, 0.6), x, silence(R, 0.6, 0.0003, 9));
const talk = bursts(5, { share: 0.8, floor: 0.3, group: 7, pause: 0.4 });
/** 高い声: F1 を声の高さより上に置く（歌う声のように） */
const high = (f0: number) => inRoom(vowel({ rate: R, seconds: 3, f0, jitter: 0.01, shimmer: 0.04, formants: [[Math.max(800, f0 * 1.1), 120], [1600, 150], [2900, 200]], envelope: talk }));
const ok = (m: Measured) => {
  if (!m.ok) throw new Error(`not measured: ${m.reason} ${JSON.stringify(m.info)}`);
  return m;
};

describe('高い声', () => {
  it('500〜1050 Hz の音と母音を、正しいオクターブで測る（前は 535 Hz より上を半分の高さにしていた）', () => {
    for (const f0 of [520, 620, 800, 1000, 1047]) {
      for (const x of [inRoom(tone({ rate: R, seconds: 3, f0 })), high(f0)]) {
        const m = ok(measureVoice(x, R, ONE));
        expect(Math.abs(m.features.pitch! / f0 - 1), `${f0} Hz`).toBeLessThan(0.01);
      }
    }
  });
  it('2 倍音が F1 に重なる高い声でも、1 オクターブ高く・低く測らない', () => {
    for (const f0 of [550, 650, 750]) {
      const m = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 3, f0, jitter: 0.01, shimmer: 0.04, envelope: talk })), R, ONE));
      expect(Math.abs(m.features.pitch! / f0 - 1), `${f0} Hz`).toBeLessThan(0.01);
    }
  });
  it('高さの移り: 350→650 Hz は真ん中が 477 Hz ほど、500→1050 Hz は 725 Hz ほど', () => {
    const up = (a: number, b: number) => (t: number) => a * (b / a) ** (t / 6);
    const m1 = ok(measureVoice(inRoom(tone({ rate: R, seconds: 6, f0: up(350, 650) })), R));
    expect(m1.features.pitch).toBeCloseTo(477, -1);
    const m2 = ok(measureVoice(inRoom(tone({ rate: R, seconds: 6, f0: up(500, 1050) })), R));
    expect(Math.abs(m2.features.pitch! / 725 - 1)).toBeLessThan(0.01);
    // 1 オクターブ強を 6 秒で上がる: 10〜90 % の幅は 12.8 半音の 8 割ほど
    expect(m2.features.pitchRange).toBeGreaterThan(9);
    expect(m2.features.pitchRange).toBeLessThan(11);
  });
  it('1100 Hz より高い音は、半分の高さにせず捨てる', () => {
    for (const f0 of [1200, 1500, 2000, 3000]) expect(measureVoice(inRoom(tone({ rate: R, seconds: 3, f0 })), R, ONE), `${f0} Hz`).toMatchObject({ ok: false, reason: 'short' });
    // 800→1600 Hz: 1100 Hz までの所だけを測る
    const m = ok(measureVoice(inRoom(tone({ rate: R, seconds: 6, f0: (t) => 800 * 2 ** (t / 6) })), R, ONE));
    expect(m.features.pitch).toBeGreaterThan(800);
    expect(m.features.pitch).toBeLessThan(1100);
    expect(m.info.voicedSeconds).toBeLessThan(3);
  });
  it('息だけの音（声の響きで色の付いた息）を、高い声と取り違えない', () => {
    const x = high(620);
    const breathy = inRoom(vowel({ rate: R, seconds: 3, f0: 620, breath: 0.6, formants: [[800, 120], [1600, 150], [2900, 200]], envelope: talk }));
    expect(ok(measureVoice(x, R, ONE)).features.pitch).toBeCloseTo(620, -1);
    expect(measureVoice(breathy, R, ONE).ok).toBe(false);
  });
});

describe('500 Hz より低い声は、版 3.1.0 と同じ', () => {
  const glide = (span: number, mid: number) => (t: number) => mid * 2 ** ((span * 2 * (Math.abs(((t * 0.5) % 1) - 0.5) - 0.25)) / 12);
  const voice = (mid: number) => inRoom(vowel({ rate: R, seconds: 5, f0: glide(4, mid), jitter: 0.01, shimmer: 0.04, breath: 0.02, envelope: talk }));
  it('版の名前: 3.3.0。3.1.0 と 3.2.0 の数字と比べてよい', () => {
    expect(MEASURE_VERSION).toBe('3.3.0');
    expect(MEASURE_COMPATIBLE).toEqual(['3.1.0', '3.2.0']);
  });
  // 版 3.1.0 で測った数字（そのまま写した物）
  const v310: Record<number, Record<string, number | null>> = {
    100: { pitch: 99.8, pitchRange: 3.32, pitchSkew: 0.09, pitchMotion: 3.8, f1: 681, f2: 1216, f3: 2598, f4: null, formantSpacing: 989, f1Range: 0.53, f2Range: 0.58, b1: 101, b2: 161, centroid: 866, hammarberg: 36.79, slopeLow: 30, slopeMid: -20.23, mfcc1: 20.1, mfcc2: -2.406, mfcc3: -5.7, mfcc4: -2.01, mfcc5: -0.235, mfcc6: 1.687, mfcc7: 0.306, mfcc8: -1.057, mfcc9: 1.353, mfcc10: 1.182, mfcc11: -1.184, mfcc12: -0.81, mfcc13: -0.414, mfccDelta: 0.653, hnr: 19.92, cpp: 22.83, h1h2: -1.11, jitter: 0.00322, shimmer: 0.0209, rate: 4.93, rateVar: null, pauseShare: 0.151, pauseLen: 0.38, runLen: 1.42, rhythm: 4.7, voicedShare: 0.986, levelRange: 10.84, tilt: -8.11 },
    // 2 倍音が F1 に重なる声（H1−H2 が大きく負）: 高い声の探し方で 1 オクターブ高く測りやすい
    330: { pitch: 330.5, pitchRange: 3.32, pitchSkew: -0.02, pitchMotion: 4, f1: 653, f2: 1120, f3: 2582, f4: null, formantSpacing: 970, f1Range: 2.63, f2Range: 4.04, b1: 48, b2: 208, centroid: 804, hammarberg: 39.35, slopeLow: 60.06, slopeMid: -10.24, mfcc1: 14.364, mfcc2: -5.115, mfcc3: -7.912, mfcc4: -4.203, mfcc5: -2.121, mfcc6: -0.223, mfcc7: -1.301, mfcc8: -2.625, mfcc9: -0.856, mfcc10: -1.114, mfcc11: -3.098, mfcc12: -2.434, mfcc13: -1.444, mfccDelta: 1.035, hnr: 20.13, cpp: 15.3, h1h2: -11.17, jitter: 0.003, shimmer: 0.0155, rate: 4.93, rateVar: null, pauseShare: 0.151, pauseLen: 0.38, runLen: 1.42, rhythm: 2.7, voicedShare: 1, levelRange: 14.94, tilt: -10.25 },
  };
  for (const mid of [100, 330]) {
    it(`${mid} Hz ほどの話し声: 45 項目が全く同じ`, () => {
      expect(ok(measureVoice(voice(mid), R)).features).toEqual(v310[mid]);
    });
  }
});

describe('息の多い声（3.2.0 で 1 オクターブ高く測った物）', () => {
  const glide = (span: number, mid: number) => (t: number) => mid * 2 ** ((span * 2 * (Math.abs(((t * 0.5) % 1) - 0.5) - 0.25)) / 12);
  /** 息の多い声: F1 を 2 倍音・3 倍音の近くに置く（3.2.0 は、その倍音を本当の高さと取り違えた） */
  const breathy = (f0: number, F1: number, breath: number) =>
    inRoom(vowel({ rate: R, seconds: 3, f0: glide(4, f0), jitter: 0.01, shimmer: 0.04, breath, formants: [[F1, 80], [Math.max(F1 + 500, 1700), 120], [2800, 180]], envelope: talk, seed: f0 + breath * 1000 + 80 }));
  // 版 3.1.0 で測った数字（そのまま写した物）
  const v310: Record<string, Record<string, number | null>> = {
    '380/760/0.2': { pitch: 384.4, pitchRange: 2.43, pitchSkew: -0.27, pitchMotion: 3.7, f1: 763, f2: 1693, f3: 2767, f4: null, formantSpacing: 1125, f1Range: 1.83, f2Range: 1.68, b1: 46, b2: 179, centroid: 1599, hammarberg: 17.51, slopeLow: 81.7, slopeMid: -3.88, mfcc1: 9.855, mfcc2: -14.156, mfcc3: -1.377, mfcc4: -3.148, mfcc5: -4.572, mfcc6: -0.522, mfcc7: -1.344, mfcc8: 0.64, mfcc9: -0.054, mfcc10: -3.3, mfcc11: -1.85, mfcc12: 0.763, mfcc13: 0.423, mfccDelta: 2.132, hnr: 0.42, cpp: 10.66, h1h2: -12.44, jitter: 0.01522, shimmer: 0.0772, rate: 3.79, rateVar: null, pauseShare: 0.126, pauseLen: 0.38, runLen: 1.32, rhythm: null, voicedShare: 0.606, levelRange: 12.34, tilt: -2.9 },
    '420/840/0.3': { pitch: 421.9, pitchRange: 0.86, pitchSkew: 0.08, pitchMotion: 3.5, f1: 844, f2: 1671, f3: 2740, f4: null, formantSpacing: 1122, f1Range: null, f2Range: null, b1: 43, b2: 165, centroid: 1676, hammarberg: 15.95, slopeLow: 75.85, slopeMid: 3.94, mfcc1: 8.397, mfcc2: -15.898, mfcc3: -1.717, mfcc4: -2.583, mfcc5: -3.294, mfcc6: 0.532, mfcc7: -0.86, mfcc8: 0.554, mfcc9: -0.389, mfcc10: -3.087, mfcc11: -0.716, mfcc12: 2.381, mfcc13: 1.415, mfccDelta: 2.192, hnr: 1.93, cpp: 9.89, h1h2: -16.23, jitter: 0.01471, shimmer: 0.0929, rate: 2.27, rateVar: null, pauseShare: 0.126, pauseLen: 0.38, runLen: 1.32, rhythm: null, voicedShare: 0.367, levelRange: 12.15, tilt: -0.08 },
  };
  it('F1 が 2 倍音に重なる息の多い声: 45 項目が 3.1.0 と全く同じ（1 オクターブ高く測らない）', () => {
    expect(ok(measureVoice(breathy(380, 760, 0.2), R, ONE)).features).toEqual(v310['380/760/0.2']);
    expect(ok(measureVoice(breathy(420, 840, 0.3), R, ONE)).features).toEqual(v310['420/840/0.3']);
  });
  it('ほかの息の多い声も、3.1.0 と同じ高さ', () => {
    for (const [f0, F1, br, want] of [[420, 756, 0.2, 394.7], [340, 748, 0.3, 363.4], [420, 840, 0.2, 421.2], [380, 836, 0.2, 414.6]] as const)
      expect(ok(measureVoice(breathy(f0, F1, br), R, ONE)).features.pitch, `${f0} Hz F1 ${F1} 息 ${br}`).toBe(want);
  });
  it('3.1.0 で測れなかった息の多い声は、響きの高さで測れたことにしない', () => {
    for (const [f0, F1, br] of [[420, 924, 0.3], [300, 900, 0.2], [260, 780, 0.3]] as const) expect(measureVoice(breathy(f0, F1, br), R, ONE).ok, `${f0} Hz F1 ${F1} 息 ${br}`).toBe(false);
    // 息だけに近い声（F1 が 600〜1000 Hz）
    for (const [f0, F1] of [[150, 600], [150, 1000], [220, 1000], [300, 1000]] as const) {
      const x = inRoom(vowel({ rate: R, seconds: 3, f0, breath: 0.6, formants: [[F1, 60], [F1 + 700, 120], [2800, 180]], envelope: talk, seed: f0 + F1 }));
      expect(measureVoice(x, R, ONE).ok, `${f0} Hz F1 ${F1}`).toBe(false);
    }
  });
  it('強い倍音が上限（1100 Hz）より高くても、3.1.0 の答えを捨てない（220 Hz・F1 1100 Hz）', () => {
    const x = inRoom(vowel({ rate: R, seconds: 3, f0: glide(4, 220), jitter: 0.01, shimmer: 0.04, breath: 0.1, formants: [[1100, 80], [1600, 120], [2700, 180]], envelope: talk, seed: 225 }));
    expect(ok(measureVoice(x, R, ONE)).features).toEqual({ pitch: 219.7, pitchRange: 12.84, pitchSkew: -11.39, pitchMotion: null, f1: 1085, f2: 1599, f3: 2680, f4: null, formantSpacing: 1103, f1Range: null, f2Range: null, b1: 91, b2: 173, centroid: 1403, hammarberg: 21.09, slopeLow: 71.86, slopeMid: 23.05, mfcc1: 12.046, mfcc2: -13.083, mfcc3: -1.753, mfcc4: 2.264, mfcc5: 0.302, mfcc6: 1.895, mfcc7: -2.028, mfcc8: -1.925, mfcc9: 0.58, mfcc10: -1.288, mfcc11: -0.793, mfcc12: 0.739, mfcc13: -0.872, mfccDelta: null, hnr: 3.93, cpp: 12.81, h1h2: 1.62, jitter: 0.01847, shimmer: 0.089, rate: 1.89, rateVar: null, pauseShare: 0.126, pauseLen: 0.38, runLen: 1.32, rhythm: null, voicedShare: 0.25, levelRange: 12.3, tilt: 12.31 });
  });
});

describe('2 倍音がとても強い高い声（F1 が 2F0）', () => {
  const strongH2 = (f0: number, breath = 0) => inRoom(vowel({ rate: R, seconds: 3, f0, jitter: 0.01, shimmer: 0.04, breath, formants: [[f0 * 2, 120], [f0 * 2 + 600, 150], [2900, 200]], envelope: talk, seed: f0 }));
  it('650・800・1050 Hz を正しいオクターブで測る（3.2.0 は 434・400・420 Hz）', () => {
    for (const f0 of [650, 800, 1050]) expect(Math.abs(ok(measureVoice(strongH2(f0), R, ONE)).features.pitch! / f0 - 1), `${f0} Hz`).toBeLessThan(0.01);
  });
  it('少し息のある高い声も（620・800 Hz、息 0.02）', () => {
    for (const f0 of [620, 800]) {
      const x = inRoom(vowel({ rate: R, seconds: 3, f0, jitter: 0.01, shimmer: 0.04, breath: 0.02, formants: [[Math.max(800, f0 * 1.1), 120], [1600, 150], [2900, 200]], envelope: talk }));
      expect(Math.abs(ok(measureVoice(x, R, ONE)).features.pitch! / f0 - 1), `${f0} Hz`).toBeLessThan(0.01);
    }
  });
});
