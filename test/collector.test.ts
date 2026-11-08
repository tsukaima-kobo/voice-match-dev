// 収集の拡張機能の、DOM を使わない部分（collector/src/windowing.ts）の試験
import { describe, expect, it } from 'vitest';
import { addWindow, chunkTime, videoIdOf, Windower, WINDOW_SECONDS, type Finished, type PlayState } from '../collector/src/windowing.ts';
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

describe('ページが測っている間に、たまって届いたかたまり', () => {
  it('かたまりの時刻は、今の再生位置から、届くのが遅れた分を引いた物', () => {
    expect(chunkTime(130, 1, 50.6, 50)).toBeCloseTo(129.4, 9);
    // 遅れていなければ（終わりが今より後でも）、今の再生位置のまま
    expect(chunkTime(130, 1, 50, 50)).toBe(130);
    expect(chunkTime(130, 1, 50, 50.05)).toBe(130);
  });
  it('窓が出るたびにページが止まっても、窓の時刻は音の通りで、再生位置が飛んだと取り違えない', () => {
    // 48 kHz・2048 サンプルのかたまりが、音の時計どおりに出る。窓が出るたびに、ページは B 秒止まり（measureVoice）、
    // その間のかたまりは後でまとめて読まれる（読んだ時の再生位置は、どれも同じ）
    const sr = 48000,
      n = 2048,
      dur = n / sr;
    for (const B of [0.5, 0.9, 1.5, 2.5]) {
      const w = new Windower(sr);
      const queue: number[] = [];
      const got: Finished[] = [];
      let audio = 0,
        blockedUntil = -1,
        jumps = 0;
      for (let k = 0; k < Math.round(95 / dur); k++) {
        audio += dur;
        queue.push(audio);
        if (audio < blockedUntil) continue;
        while (queue.length) {
          const end = queue.shift()!;
          // 動画は 100 秒の所から。読んだ時の再生位置は 100 + 今の音の時計
          const d = w.push(new Float32Array(n), playing(chunkTime(100 + audio, 1, audio, end)));
          if (w.lastBreak === 'jump') jumps++;
          if (d) {
            got.push(d);
            blockedUntil = audio + B;
          }
        }
      }
      expect(jumps, `${B} 秒止まる時`).toBe(0);
      expect(got.length, `${B} 秒止まる時`).toBe(3);
      got.forEach((d, i) => {
        expect(d.t1 - d.t0).toBeCloseTo(d.pcm.length / sr, 0);
        expect(d.t0).toBeCloseTo(i ? got[i - 1]!.t1 : 100, 5);
      });
    }
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
