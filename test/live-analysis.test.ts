// 録っている間の高さの線（src/ui/live-analysis.ts の pitchOf。measure.ts の pitchNow と同じ）の試験。図を描く所は画面で確かめる。
// 線と最後の数字（measureVoice）が食い違わないこと: 同じ探し方なので、決まった高さの声なら同じ高さになる。
import { describe, expect, it } from 'vitest';
import { pitchOf } from '../src/ui/live-analysis.ts';
import { F0_MAX, measureVoice, NOW_LEN } from '../src/voice/measure.ts';
import { concat, silence, vowel } from './voice-synth.ts';

const SR = 16000;
/** 倍音を含む声のような音（16 kHz・直近の 128 ms） */
function tone(f: number, harmonics = true): Float32Array {
  const x = new Float32Array(NOW_LEN);
  for (let i = 0; i < x.length; i++) {
    let v = 0;
    for (let h = 1; h * f < 7000 && (harmonics || h === 1); h++) v += Math.sin((2 * Math.PI * h * f * i) / SR + h * 0.3) / h;
    x[i] = 0.3 * v;
  }
  return x;
}
/** 声を 20 ms ずつずらして追った線の中央値（声の無い所は除く） */
function lineOf(x: Float32Array): number {
  const p: number[] = [];
  for (let end = NOW_LEN; end <= x.length; end += 320) {
    const f = pitchOf(x.subarray(end - NOW_LEN, end));
    if (f) p.push(f);
  }
  p.sort((a, b) => a - b);
  return p.length ? p[p.length >> 1]! : 0;
}

describe('高さの線', () => {
  it('65〜1090 Hz の高さを、2 % 以内で追う（歌や高い声真似も）', () => {
    for (const f of [65, 100, 220, 440, 600, 800, 1000, 1090]) {
      expect(Math.abs(pitchOf(tone(f)) / f - 1), `${f} Hz`).toBeLessThan(0.02);
      expect(Math.abs(pitchOf(tone(f, false)) / f - 1), `${f} Hz の純音`).toBeLessThan(0.02);
    }
  });
  it('上限より高い音は、1 オクターブ下と取り違えずに、無しにする', () => {
    expect(F0_MAX).toBe(1100);
    for (const f of [1150, 1300, 1500, 2000, 3000]) {
      expect(pitchOf(tone(f)), `${f} Hz`).toBe(0);
      expect(pitchOf(tone(f, false)), `${f} Hz の純音`).toBe(0);
    }
  });
  it('雑音や無音・短すぎる音には、高さを付けない', () => {
    let s = 1;
    const noise = new Float32Array(NOW_LEN).map(() => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
    expect(pitchOf(noise)).toBe(0);
    expect(pitchOf(new Float32Array(NOW_LEN))).toBe(0);
    expect(pitchOf(tone(220).subarray(1))).toBe(0);
  });
  it('2 倍音が強い女性の声（350 Hz・F1 700 Hz など）を、1 オクターブ高く出さない（3.2.0 の線は 702 Hz）', () => {
    for (const [f0, F1] of [[350, 700], [380, 760], [400, 800], [420, 840], [300, 600]] as const) {
      const x = vowel({ rate: SR, seconds: 2, f0, jitter: 0.005, shimmer: 0.02, formants: [[F1, 80], [F1 + 700, 110], [2800, 160]], seed: 5 });
      expect(Math.abs(lineOf(x) / f0 - 1), `${f0} Hz F1 ${F1}`).toBeLessThan(0.01);
    }
  });
  it('決まった高さの声では、線の高さが最後の数字（measureVoice）と同じ', () => {
    const cases: [number, [number, number][]][] = [
      [110, [[700, 90], [1200, 110], [2600, 160]]],
      [220, [[300, 60], [2300, 100], [3000, 150]]],
      [350, [[700, 80], [1400, 110], [2800, 160]]],
      [450, [[1350, 80], [2050, 110], [2800, 160]]],
      [650, [[1300, 120], [1900, 150], [2900, 200]]],
      [1000, [[1100, 120], [1700, 150], [2900, 200]]],
    ];
    for (const [f0, formants] of cases) {
      const x = vowel({ rate: SR, seconds: 2, f0, jitter: 0.005, shimmer: 0.02, formants, seed: 5 });
      const m = measureVoice(concat(silence(SR, 0.5), x, silence(SR, 0.5, 0.0003, 9)), SR, { minVoicedSeconds: 0.4 });
      if (!m.ok) throw new Error(`${f0} Hz: ${m.reason}`);
      expect(Math.abs(lineOf(x) / m.features.pitch! - 1), `${f0} Hz`).toBeLessThan(0.005);
      expect(Math.abs(m.features.pitch! / f0 - 1), `${f0} Hz`).toBeLessThan(0.01);
    }
  });
});
