// src/voice/measure.ts の、測れなかった時だけ動く道の試験。合成音だけを使う（録音なし。乱数は種つき）。
// 1. 低い声の短い声: 周期の数でなく長さで足りるか見る。足りなければ noisy でなく short。
// 2. 長い録音の一部だけで話した声: 話した所を切り出して、同じセリフの短い録音と同じに測る。
import { describe, expect, it } from 'vitest';
import { measureVoice, type Measured } from '../src/voice/measure.ts';
import { bursts, concat, silence, vowel } from './voice-synth.ts';

const R = 16000;
const ONE = { minVoicedSeconds: 0.4 };
const steady = (f0: number, seconds: number) => concat(silence(R, 0.6), vowel({ rate: R, seconds, f0, jitter: 0.003, shimmer: 0.02 }), silence(R, 0.6, 0.0003, 9));
const ok = (m: Measured) => {
  if (!m.ok) throw new Error(`not measured: ${m.reason} ${JSON.stringify(m.info)}`);
  return m;
};

describe('低い声の短い声', () => {
  it('同じ 0.6 秒なら、70〜220 Hz のどの高さでも測れる（前は 120 Hz より下だけ noisy）', () => {
    for (const f0 of [70, 85, 100, 120, 220]) {
      const m = ok(measureVoice(steady(f0, 0.6), R, ONE));
      expect(Math.abs(m.features.pitch! / f0 - 1), `${f0} Hz`).toBeLessThan(0.01);
      expect(m.features.jitter).not.toBe(null);
    }
  });
  it('声が足りない時は noisy でなく short（高さによらない）', () => {
    for (const f0 of [85, 150]) expect(measureVoice(steady(f0, 0.4), R, ONE), `${f0} Hz`).toMatchObject({ ok: false, reason: 'short' });
  });
});

describe('長い録音の一部だけで話した声', () => {
  const phrase = vowel({ rate: R, seconds: 1.5, f0: 180, jitter: 0.004, shimmer: 0.02, envelope: bursts(5, { share: 0.6 }), rms: 0.1 });
  for (const room of [0.0003, 0.003]) {
    it(`セリフの後に止まるまで待った 35 秒（部屋の音 ${room}）: 同じセリフの短い録音とほぼ同じ数字（前は silent）`, () => {
      const long = concat(silence(R, 1, room, 3), phrase, silence(R, 32.5, room, 9));
      const short = concat(silence(R, 1, room, 3), phrase, silence(R, 1, room, 9));
      const a = ok(measureVoice(long, R, { ...ONE, contour: true }));
      const b = ok(measureVoice(short, R, { ...ONE, contour: true }));
      expect(a.info.seconds).toBe(35);
      // 切り出しの端が短い録音と少し違うので、背景を引く時（部屋の音が大きい時）は、ごくわずかにずれる
      if (room < 0.001) expect(a.features).toEqual(b.features);
      for (const [k, v] of Object.entries(b.features)) {
        const w = a.features[k as keyof typeof a.features];
        if (v === null) expect(w, k).toBe(null);
        else expect(Math.abs(w! - v), k).toBeLessThanOrEqual(0.05 * Math.max(1, Math.abs(v)));
      }
      expect(Array.from(a.info.contour!.pitch)).toEqual(Array.from(b.info.contour!.pitch));
      a.info.contour!.level.forEach((v, i) => expect(Math.abs(v - b.info.contour!.level[i]!)).toBeLessThan(0.25));
    });
  }
  it('声の後に物音が 1 つあっても、いちばん大きな話のまとまりを測る', () => {
    const x = concat(silence(R, 1, 0.001, 3), phrase, silence(R, 32.5, 0.001, 9));
    const at = R * 20;
    for (let i = 0; i < 480; i++) x[at + i] = x[at + i]! + 0.3 * Math.exp(-i / 80) * (i % 2 ? 1 : -1);
    expect(ok(measureVoice(x, R, ONE)).features.pitch).toBeCloseTo(180, -1);
  });
  it('声が求めた長さより少なければ short（前は silent）。音が無い・物音だけなら今までどおり', () => {
    const long = concat(silence(R, 1, 0.001, 3), phrase, silence(R, 32.5, 0.001, 9));
    expect(measureVoice(long, R, { minVoicedSeconds: 8 })).toMatchObject({ ok: false, reason: 'short' });
    expect(measureVoice(silence(R, 35, 0.001), R, ONE)).toMatchObject({ ok: false, reason: 'silent' });
    const click = silence(R, 35, 0.001);
    for (let i = 0; i < 480; i++) click[R * 10 + i] = click[R * 10 + i]! + 0.3 * Math.exp(-i / 80) * (i % 2 ? 1 : -1);
    expect(measureVoice(click, R, ONE).ok).toBe(false);
  });
});
