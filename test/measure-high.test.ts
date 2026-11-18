// src/voice/measure.ts の高い声（500〜1100 Hz）の試験。合成音だけを使う（録音なし。乱数は種つき）。
// 1. 高い声を正しいオクターブで測る。2. 1100 Hz より高い音は、半分の高さにせず捨てる。
// 3. 500 Hz より低い声は、版 3.1.0 と全く同じ数字（3.1.0 で測った声と比べられるように）。息の多い声も（3.2.0 は、2 倍音・3 倍音を
//    本当の高さと取り違えて 1 オクターブ高く測ったり、上限より高い答えで 3.1.0 の答えを捨てたりしていた）。
// 4. 息の混じった 500 Hz より高い声を、1/2・1/3 の高さに測らない（3.3.0 まで）。響きの細い低い声は、それで変わらない（3.4.0）。
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
  it('版の名前: 3.4.0。3.1.0・3.2.0・3.3.0 の数字と比べてよい', () => {
    expect(MEASURE_VERSION).toBe('3.4.0');
    expect(MEASURE_COMPATIBLE).toEqual(['3.1.0', '3.2.0', '3.3.0']);
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

describe('息の混じった高い声（3.3.0 は 1/2・1/3 の高さに測った）', () => {
  const notes = bursts(1.5, { share: 0.85, floor: 0.0 });
  const glide = (span: number, mid: number) => (t: number) => mid * 2 ** ((span * 2 * (Math.abs(((t * 0.5) % 1) - 0.5) - 0.25)) / 12);
  /** 歌（ビブラート）か話し声（ゆっくり上下）。F1 は声の高さより上 */
  const voice = (st: number, style: 'sing' | 'talk', vib: number, F1: number, breath: number) => {
    const f0 = 500 * 2 ** (st / 12);
    const F = Math.max(F1, f0 * 1.05);
    const fn = style === 'sing' ? (t: number) => f0 * 2 ** ((vib * Math.sin(2 * Math.PI * 5.8 * t)) / 12) : glide(4 * vib, f0);
    const sing = style === 'sing';
    return { f0, x: inRoom(vowel({ rate: R, seconds: 4, f0: fn, jitter: sing ? 0.004 : 0.01, shimmer: sing ? 0.016 : 0.04, breath, formants: [[F, 100], [Math.max(F + 600, 1500), 130], [2800, 180]], envelope: sing ? notes : talk, seed: st + 1 })) };
  };
  it('630 Hz の歌（息 0.02）・944 Hz の歌（息 0.05）・794 Hz の話し声（息 0.1）を、正しいオクターブで測る（3.3.0 は 1/2 か 1/3）', () => {
    for (const [st, style, vib, F1, breath] of [[4, 'sing', 1, 900, 0.02], [11, 'sing', 0.5, 700, 0.05], [8, 'talk', 0.5, 700, 0.1]] as const) {
      const { f0, x } = voice(st, style, vib, F1, breath);
      expect(Math.abs(Math.log2(ok(measureVoice(x, R, ONE)).features.pitch! / f0)), `${f0.toFixed(0)} Hz ${style} 息 ${breath}`).toBeLessThan(0.05);
    }
  });
  it('高い声を 1 オクターブ高くは測らない', () => {
    for (const breath of [0.02, 0.05, 0.1])
      for (const st of [0, 6, 12]) {
        const { f0, x } = voice(st, 'sing', 1, 900, breath);
        const m = measureVoice(x, R, ONE);
        if (m.ok) expect(m.features.pitch!, `${f0.toFixed(0)} Hz 息 ${breath}`).toBeLessThan(f0 * 1.2);
      }
  });

  // 響き（F1）の幅がとても細い低い声: F1 の高さで鳴った枠を、高い声と取り違えて戻さない（3.3.0 と同じ数字）
  const narrow = (f0: number, F1: number, fry: number, breath: number, envelope: (t: number) => number, F2: number, F3: number, span: number, rate: number) => {
    const fn = (t: number) => {
      const u = t % 1.5;
      const base = f0 * 2 ** ((span * Math.sin(2 * Math.PI * rate * t)) / 12);
      return fry && u > 1.15 ? base * (fry / base) ** Math.min(1, (u - 1.15) / 0.1) : base;
    };
    return inRoom(vowel({ rate: R, seconds: 6, f0: fn, jitter: 0.01 + (fry ? 0.02 : 0), shimmer: 0.05, breath, formants: [[F1, 40], [F2, F2 === F1 + 700 ? 90 : 100], [F3, 150]], envelope, seed: f0 + F1 + 40 }));
  };
  it('160 Hz の男性の声（F1 1100 Hz・幅 40 Hz・息 0.1）: 45 項目が 3.3.0 と全く同じ', () => {
    const x = narrow(160, 1100, 0, 0.1, bursts(4, { share: 0.8, floor: 0.2, group: 6, pause: 0.5 }), 1800, 2600, 1.5, 0.3);
    expect(ok(measureVoice(x, R, ONE)).features).toEqual({ pitch: 160.3, pitchRange: 26.06, pitchSkew: 2.33, pitchMotion: null, f1: 1083, f2: 1806, f3: 2595, f4: null, formantSpacing: 1114, f1Range: null, f2Range: null, b1: 59, b2: 109, centroid: 1572, hammarberg: 18.47, slopeLow: 54.15, slopeMid: 13.64, mfcc1: 11.83, mfcc2: -13.181, mfcc3: -0.01, mfcc4: 3.497, mfcc5: -0.579, mfcc6: 2.242, mfcc7: 0.075, mfcc8: -1.622, mfcc9: -0.187, mfcc10: -0.403, mfcc11: 0.942, mfcc12: 1.733, mfcc13: -0.83, mfccDelta: 1.58, hnr: 3.12, cpp: 14.93, h1h2: 1.26, jitter: 0.00654, shimmer: 0.0975, rate: 1.54, rateVar: null, pauseShare: 0.174, pauseLen: 0.48, runLen: 1.52, rhythm: null, voicedShare: 0.2, levelRange: 15.93, tilt: 13.87 });
  });
  it('240 Hz の女性の声（F1 850 Hz・幅 40 Hz、語尾が 45 Hz までかすれる）: 45 項目が 3.3.0 と全く同じ', () => {
    const x = narrow(240, 850, 45, 0, bursts(5, { share: 0.8, floor: 0.25, group: 7, pause: 0.45 }), 1900, 2900, 2, 0.35);
    expect(ok(measureVoice(x, R, ONE)).features).toEqual({ pitch: 268.9, pitchRange: 11.53, pitchSkew: 4.76, pitchMotion: 2.8, f1: 835, f2: 1894, f3: 2917, f4: null, formantSpacing: 1207, f1Range: 2, f2Range: 0.54, b1: 68, b2: 101, centroid: 1081, hammarberg: 24.49, slopeLow: 37.84, slopeMid: -17.77, mfcc1: 14.621, mfcc2: -8.534, mfcc3: -2.355, mfcc4: -0.723, mfcc5: -3.197, mfcc6: 1.359, mfcc7: 1.842, mfcc8: 0.361, mfcc9: -1.212, mfcc10: -3.288, mfcc11: -0.542, mfcc12: 0.384, mfcc13: -1.883, mfccDelta: 0.998, hnr: 8.12, cpp: 18.6, h1h2: -0.11, jitter: 0.00813, shimmer: 0.1236, rate: 5.08, rateVar: null, pauseShare: 0.216, pauseLen: 0.43, runLen: 1.42, rhythm: 12.2, voicedShare: 0.782, levelRange: 18.74, tilt: -10.75 });
  });
});
