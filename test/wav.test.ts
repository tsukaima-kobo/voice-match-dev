// tools/wav.ts の試験（書いて読むと同じ音になるか）
import { describe, expect, it } from 'vitest';
import { readWav, writeWav } from '../tools/wav.ts';

describe('WAV', () => {
  it('reads back what it wrote (16-bit, mono)', () => {
    const x = Float32Array.from({ length: 4800 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000));
    const { rate, samples } = readWav(writeWav(x, 48000));
    expect(rate).toBe(48000);
    expect(samples.length).toBe(x.length);
    for (let i = 0; i < x.length; i += 97) expect(Math.abs(samples[i]! - x[i]!)).toBeLessThan(1 / 30000);
  });
  it('says so when it is not a WAV', () => {
    expect(() => readWav(new Uint8Array(64))).toThrow('WAV ではありません');
  });
});
