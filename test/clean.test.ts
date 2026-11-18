// 声真似練習場の「音をきれいにする」の前後の計算の試験（AI そのものは使わない）。
// demucs.ts: AI の代わりに「入力をそのまま返す」偽物を通すと、元の音に戻ること（STFT・逆 STFT の切り出しと、つなぎ方の確かめ）。
// denoise.ts: 960 サンプル遅れる偽物の RNNoise を通すと、時刻のそろった元の音に戻ること。
import { describe, expect, it } from 'vitest';
import { fft, prepareSegment, reflectPad, SEGMENT, separateVocals, vocalsOf, type SegmentRunner } from '../src/voice/demucs.ts';
import { DENOISE_DELAY, denoiseWith, type FrameDenoiser } from '../src/voice/denoise.ts';
import { rng } from './voice-synth.ts';

const noise = (n: number, seed: number) => {
  const r = rng(seed);
  return Float32Array.from({ length: n }, () => r() * 2 - 1);
};
/** 一番高い周波数（ナイキスト）を含まない雑音（Demucs は 2049 番目の周波数を使わないので、そこは戻らない） */
const smooth = (n: number, seed: number) => {
  const x = noise(n + 3, seed);
  return Float32Array.from({ length: n }, (_, i) => (x[i]! + x[i + 1]! + x[i + 2]! + x[i + 3]!) / 4);
};

/** AI の代わり: 声の音（4 番目）に、入力の STFT をそのまま入れる。時間の側は 0 */
const identity: SegmentRunner = async (_mix, mag) => {
  const per = mag.length; // 4 × 2048 × 336
  const x = new Float32Array(4 * per);
  x.set(mag, 3 * per);
  return { x, xt: new Float32Array(4 * 2 * SEGMENT) };
};

describe('音楽を消す（Demucs）の前後の計算', () => {
  it('FFT と逆 FFT で元に戻る', () => {
    const x = noise(4096, 1);
    const re = Float64Array.from(x);
    const im = new Float64Array(4096);
    fft(re, im);
    fft(re, im, true);
    let err = 0;
    for (let i = 0; i < 4096; i++) err = Math.max(err, Math.abs(re[i]! / 4096 - x[i]!), Math.abs(im[i]! / 4096));
    expect(err).toBeLessThan(1e-9);
  });
  it('反射の詰め物は torch と同じ（端の値を繰り返さない）', () => {
    expect([...reflectPad(Float32Array.from([1, 2, 3, 4]), 2, 3)]).toEqual([3, 2, 1, 2, 3, 4, 3, 2, 1]);
  });
  it('1 回分: STFT → 逆 STFT で、切り出した所が元の音に戻る（端の 2048 サンプルは AI と同じく枠が足りない）', () => {
    const seg = smooth(SEGMENT, 2);
    const { mix, mag } = prepareSegment(seg);
    expect(mix.subarray(0, 5)).toEqual(seg.subarray(0, 5));
    expect(mix.subarray(SEGMENT, SEGMENT + 5)).toEqual(seg.subarray(0, 5));
    const x = new Float32Array(4 * mag.length);
    x.set(mag, 3 * mag.length);
    const v = vocalsOf(x, new Float32Array(4 * 2 * SEGMENT));
    let err = 0;
    for (let i = 2048; i < SEGMENT - 2048; i++) err = Math.max(err, Math.abs(v[i]! - seg[i]!));
    expect(err).toBeLessThan(1e-4);
  });
  it('時間の側の声（4 番目の音の左右の平均）を足す', () => {
    const per = 4 * 2048 * 336;
    const xt = new Float32Array(4 * 2 * SEGMENT);
    xt[(3 * 2 + 0) * SEGMENT + 100] = 1;
    xt[(3 * 2 + 1) * SEGMENT + 100] = 0.5;
    xt[(2 * 2 + 0) * SEGMENT + 200] = 9; // ほかの音は使わない
    const v = vocalsOf(new Float32Array(4 * per), xt);
    expect(v[100]).toBeCloseTo(0.75, 6);
    expect(v[200]).toBe(0);
  });
  it('長い音（20 秒）: 7.8 秒ずつ 4 分の 1 を重ねて 4 回に切ってつなぐと、元の音に戻る', async () => {
    const n = 44100 * 20;
    const x = smooth(n, 3);
    const steps: number[] = [];
    const y = await separateVocals(x, identity, (done) => steps.push(done));
    expect(steps).toEqual([1, 2, 3, 4]);
    let err = 0;
    for (let i = 3000; i < n - 3000; i++) err = Math.max(err, Math.abs(y[i]! - x[i]!));
    expect(err).toBeLessThan(2e-3); // 切れ目の近くは、枠の足りない端が小さな重みで混ざる（元の demucs と同じ）
  });
  it('短い音（3 秒）も 1 回で、同じ長さで返す', async () => {
    const x = smooth(44100 * 3, 4);
    const y = await separateVocals(x, identity);
    expect(y.length).toBe(x.length);
    let err = 0;
    for (let i = 3000; i < x.length - 3000; i++) err = Math.max(err, Math.abs(y[i]! - x[i]!));
    expect(err).toBeLessThan(1e-4);
  });
});

describe('ノイズを減らす（RNNoise）の時刻合わせ', () => {
  it('960 サンプル遅れて出す偽物を通すと、時刻のそろった同じ音になる', () => {
    const queue: number[] = new Array(DENOISE_DELAY).fill(0);
    const fake: FrameDenoiser = {
      processFrame(f) {
        for (let i = 0; i < f.length; i++) {
          queue.push(f[i]!);
          f[i] = queue.shift()!;
        }
        return 1;
      },
    };
    const x = noise(48000 + 123, 5).map((v) => v * 0.5);
    const y = denoiseWith(fake, 480, x);
    expect(y.length).toBe(x.length);
    let err = 0;
    for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(y[i]! - x[i]!));
    expect(err).toBeLessThan(1e-6);
  });
});
