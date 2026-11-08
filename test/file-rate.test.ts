// 声真似の点数のページで、音声ファイルを 24 kHz で読むことの確かめ（src/ui/mimic-page.ts の FILE_RATE）。
// 同じ音を 48 kHz のままと、24 kHz に直してから（ブラウザーが読む時の代わりに measure.ts の resample）測り、数字がほぼ同じか。
// measure.ts は、どちらからも 16 kHz の 0.45（7.2 kHz）で切って直すので、使う帯域は同じ。
import { describe, expect, it } from 'vitest';
import { FEATURE_BY_KEY, FEATURE_KEYS } from '../src/voice/features.ts';
import { measureVoice, resample, type Measured } from '../src/voice/measure.ts';
import { bursts, concat, silence, vowel } from './voice-synth.ts';

const ok = (m: Measured) => {
  if (!m.ok) throw new Error(`not measured: ${m.reason}`);
  return m;
};
/** 話し声のような F0: `mid` Hz を中心に上下 `span` 半音、2 秒に 1 回 */
const glide = (span: number, mid: number) => (t: number) => mid * 2 ** ((span * 2 * (Math.abs(((t * 0.5) % 1) - 0.5) - 0.25)) / 12);
const talk = bursts(5, { share: 0.8, floor: 0.3, group: 7, pause: 0.4 });
/** 声の質の項目は、細かい揺れを見るので少しずれやすい */
const FINE = new Set(['hnr', 'cpp', 'jitter', 'shimmer']);

describe('音声ファイルを 24 kHz で読む', () => {
  it('48 kHz のまま測った時と、ほぼ同じ数字になる（低い声・高い声）', () => {
    for (const mid of [120, 230]) {
      const x48 = concat(silence(48000, 0.6), vowel({ rate: 48000, seconds: 10, f0: glide(6, mid), jitter: 0.01, shimmer: 0.04, breath: 0.02, envelope: talk }), silence(48000, 0.6, 0.0003, 9));
      const x24 = Float32Array.from(resample(Float64Array.from(x48), 48000, 24000));
      const a = ok(measureVoice(x48, 48000)).features;
      const b = ok(measureVoice(x24, 24000)).features;
      for (const k of FEATURE_KEYS) {
        const va = a[k],
          vb = b[k];
        expect(vb === null, `${mid} Hz ${k}`).toBe(va === null);
        if (va === null || vb === null) continue;
        const tol = Math.abs(va) * (FINE.has(k) ? 0.05 : 0.01) + 10 ** -FEATURE_BY_KEY[k].digits;
        expect(Math.abs(va - vb), `${mid} Hz ${k}: ${va} / ${vb}`).toBeLessThanOrEqual(tol);
      }
    }
  });
});
