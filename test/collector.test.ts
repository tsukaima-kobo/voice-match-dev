// 収集の拡張機能の、DOM を使わない部分（collector/src/windowing.ts）の試験
import { describe, expect, it } from 'vitest';
import { addWindow, videoIdOf, Windower, WINDOW_SECONDS, type PlayState } from '../collector/src/windowing.ts';
import type { VoiceFile, VoiceWindow } from '../src/data/types.ts';

const RATE = 1000;
const chunk = () => new Float32Array(500);
const playing = (time: number, over: Partial<PlayState> = {}): PlayState => ({ video: 'abc123def45', time, paused: false, seeking: false, rate: 1, ad: false, ...over });

/** `from` から `seconds` 秒分の音を流す（動画の時刻も一緒に進む） */
function feed(w: Windower, from: number, seconds: number, over: Partial<PlayState> = {}) {
  const out = [];
  for (let t = from + 0.5; t <= from + seconds + 1e-9; t += 0.5) {
    const d = w.push(chunk(), playing(t, over));
    if (d) out.push(d);
  }
  return out;
}

describe('窓にまとめる', () => {
  it('止まらずに再生されたら、30 s ごとに窓を 1 つ、その時刻つきで出す', () => {
    const w = new Windower(RATE);
    const got = feed(w, 100, 65);
    expect(got.length).toBe(2);
    expect(got[0]).toMatchObject({ video: 'abc123def45', t0: 100, t1: 130 });
    expect(got[0]!.pcm.length).toBe(WINDOW_SECONDS * RATE);
    expect(got[1]).toMatchObject({ t0: 130, t1: 160 });
  });
  it('広告・一時停止・速さの変更・再生位置の移動・別の動画で、途中までの窓を捨てる', () => {
    for (const [over, reason] of [
      [{ ad: true }, 'ad'],
      [{ paused: true }, 'paused'],
      [{ rate: 1.5 }, 'speed'],
      [{ video: 'zzzzzzzzzzz' }, 'other-video'],
    ] as const) {
      const w = new Windower(RATE);
      feed(w, 0, 20);
      w.push(chunk(), playing(20.5, over));
      expect(w.lastBreak).toBe(reason);
      // 前の 20 s は消える。あと 30 秒要る
      expect(feed(w, 20.5, 25, over.video ? { video: over.video } : {}).length).toBe(0);
    }
    const w = new Windower(RATE);
    feed(w, 0, 20);
    expect(feed(w, 300, 29).length).toBe(0);
    expect(w.lastBreak).toBe('jump');
  });
});

describe('記録', () => {
  const win = (video: string, t0: number): VoiceWindow => ({ video, t0, t1: t0 + 30, measuredAt: '2026-10-31', version: '2.0.0', features: {} as VoiceWindow['features'], voicedSeconds: 12, gapTonal: 0, snrDb: 30 });
  it('動画の同じ所を二度足さない', () => {
    const f: VoiceFile = { id: 'v-0001', windows: [] };
    expect(addWindow(f, win('a', 100))).toBe(true);
    expect(addWindow(f, win('a', 110))).toBe(false);
    expect(addWindow(f, win('a', 120))).toBe(true);
    expect(addWindow(f, win('b', 100))).toBe(true);
    expect(f.windows.map((x) => `${x.video}${x.t0}`)).toEqual(['a100', 'a120', 'b100']);
  });
  it('watch と live のアドレスから動画の ID を読む', () => {
    expect(videoIdOf('https://www.youtube.com/watch?v=abc123def45&t=10')).toBe('abc123def45');
    expect(videoIdOf('https://www.youtube.com/live/abc123def45?si=x')).toBe('abc123def45');
    expect(videoIdOf('https://www.youtube.com/@someone')).toBe(null);
  });
});
