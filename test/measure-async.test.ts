// src/voice/measure-async.ts の試験。Worker はにせ物（読めない・落ちる・答える）に置き換える。
// 確かめること: Worker が読めない（入れ替えの後の 404 など）・中で誤りが出た時も、待っている物がその場で測られて必ず答えが出る。
// その後は Worker を作り直さず、その場で測る。答えが出たら、渡した音は 0 で埋まっている。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureVoice, type Measured, type MeasureOptions } from '../src/voice/measure.ts';
import { bursts, concat, silence, vowel } from './voice-synth.ts';

type Mode = 'load-fail' | 'ok' | 'inner-fail' | 'no-worker';
const fake = { mode: 'ok' as Mode, made: 0, posted: 0, terminated: 0 };

vi.mock('../src/voice/measure.worker.ts?worker', () => ({
  default: class {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onmessageerror: ((e: Event) => void) | null = null;
    constructor() {
      if (fake.mode === 'no-worker') throw new Error('Worker is not available');
      fake.made++;
      // 読めない Worker: 少し後に error が来て、答えは来ない
      if (fake.mode === 'load-fail') setTimeout(() => this.onerror?.(new Event('error')), 5);
    }
    postMessage(data: { id: number; pcm: Float32Array; rate: number; opts: MeasureOptions }) {
      fake.posted++;
      if (fake.mode === 'load-fail') return;
      // 本物と同じく、写しを受け取る
      const { id, pcm, rate, opts } = structuredClone(data);
      setTimeout(() => {
        const m = fake.mode === 'ok' ? measureVoice(pcm, rate, opts) : undefined;
        pcm.fill(0);
        this.onmessage?.({ data: m ? { id, m } : { id } } as MessageEvent);
      }, 5);
    }
    terminate() {
      fake.terminated++;
    }
  },
}));

const R = 16000;
const voice = () => concat(silence(R, 0.5), vowel({ rate: R, seconds: 2, f0: () => 150, envelope: bursts(5, { share: 0.8, floor: 0.4 }) }), silence(R, 0.5, 0.0003, 9));
const opts: MeasureOptions = { minVoicedSeconds: 0.4 };
const within = <T>(p: Promise<T>, ms = 2000) => Promise.race([p, new Promise<'hung'>((r) => setTimeout(() => r('hung'), ms))]);
const load = async () => {
  vi.resetModules();
  return (await import('../src/voice/measure-async.ts')).measureAsync;
};
const zeroed = (x: Float32Array) => x.every((v) => v === 0);

afterEach(() => {
  Object.assign(fake, { mode: 'ok', made: 0, posted: 0, terminated: 0 });
});

describe('measureAsync', () => {
  it('Worker が答える時は、その答え。渡した音は答えの後に 0 で埋まる', async () => {
    fake.mode = 'ok';
    const measureAsync = await load();
    const pcm = voice();
    const want = measureVoice(pcm.slice(), R, opts);
    const r = await within(measureAsync(pcm, R, opts));
    expect(r).not.toBe('hung');
    expect(JSON.stringify(r)).toBe(JSON.stringify(want));
    expect((r as Measured).ok).toBe(true);
    expect(zeroed(pcm)).toBe(true);
    expect(fake.posted).toBe(1);
  });

  it('Worker が読めない時（404 など）: 待っている物を全部その場で測り、その後もその場で測る', async () => {
    fake.mode = 'load-fail';
    const measureAsync = await load();
    const a = voice(),
      b = voice();
    const want = measureVoice(a.slice(), R, opts);
    const [ra, rb] = await within(Promise.all([measureAsync(a, R, opts), measureAsync(b, R, opts)]));
    expect(JSON.stringify(ra)).toBe(JSON.stringify(want));
    expect(JSON.stringify(rb)).toBe(JSON.stringify(want));
    expect(zeroed(a) && zeroed(b)).toBe(true);
    expect(fake.posted).toBe(2);
    expect(fake.terminated).toBe(1);
    // その後は Worker を作り直さず、その場で
    const c = voice();
    const rc = await within(measureAsync(c, R, opts));
    expect(JSON.stringify(rc)).toBe(JSON.stringify(want));
    expect(zeroed(c)).toBe(true);
    expect(fake.made).toBe(1);
    expect(fake.posted).toBe(2);
  });

  it('Worker の中で測れなかった時は、その場で測り直す', async () => {
    fake.mode = 'inner-fail';
    const measureAsync = await load();
    const pcm = voice();
    const want = measureVoice(pcm.slice(), R, opts);
    const r = await within(measureAsync(pcm, R, opts));
    expect(JSON.stringify(r)).toBe(JSON.stringify(want));
    expect(zeroed(pcm)).toBe(true);
  });

  it('Worker を作れない時は、その場で測る', async () => {
    fake.mode = 'no-worker';
    const measureAsync = await load();
    const pcm = voice();
    const want = measureVoice(pcm.slice(), R, opts);
    const r = await within(measureAsync(pcm, R, opts));
    expect(JSON.stringify(r)).toBe(JSON.stringify(want));
    expect(zeroed(pcm)).toBe(true);
  });

  it('測る途中で誤りが出ても、測れなかった（invalid）として答え、音は 0 で埋まる', async () => {
    fake.mode = 'no-worker';
    const measureAsync = await load();
    const pcm = voice();
    const r = await within(measureAsync(pcm, R, { get minVoicedSeconds(): number { throw new Error('boom'); } } as MeasureOptions));
    expect(r).toEqual({ ok: false, reason: 'invalid', info: {} });
    expect(zeroed(pcm)).toBe(true);
  });
});
