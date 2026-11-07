// じっくり測る（src/voice/session.ts）: 30 秒ずつに切る・窓をまとめる・書き出すファイル
import { describe, expect, it } from 'vitest';
import { SESSION_SELECT, sessionFile, shuffled, summarize, WindowCutter, type SessionWindow } from '../src/voice/session.ts';
import { SELECT } from '../tools/lib.ts';
import { FEATURE_KEYS, type Features } from '../src/voice/features.ts';

const feats = (pitch: number): Features => Object.fromEntries(FEATURE_KEYS.map((k) => [k, k === 'pitch' ? pitch : 1])) as Features;
const win = (t0: number, pitch: number, voiced = 15): SessionWindow => ({ t0, ok: true, voicedSeconds: voiced, snrDb: 30, features: feats(pitch) });

describe('じっくり測る', () => {
  it('窓の決まりは、サイトの声（tools/lib.ts の SELECT）と同じ', () => {
    expect(SESSION_SELECT).toEqual({ minVoicedSeconds: SELECT.minVoicedSeconds, maxPitchOffSt: SELECT.maxPitchOffSt, pitchCheckFrom: SELECT.pitchCheckFrom, minWindows: SELECT.minWindows });
  });

  it('届いた音を、決まった長さの窓に、順番どおり切る（余りは次へ）', () => {
    const c = new WindowCutter(5);
    const seq = (a: number, n: number) => Float32Array.from({ length: n }, (_, i) => a + i);
    expect(c.push(seq(0, 3))).toEqual([]);
    expect(c.pending).toBe(3);
    const out = c.push(seq(3, 9));
    expect(out.map((w) => [...w])).toEqual([
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
    ]);
    expect(c.pending).toBe(2);
    c.drop();
    expect(c.pending).toBe(0);
    expect(c.push(seq(20, 5)).map((w) => [...w])).toEqual([[20, 21, 22, 23, 24]]);
  });

  it('まとめる: 声の少ない窓・測れない窓・高さが外れた窓を除いて中央値。10 窓に足りなければ代表値なし', () => {
    const ws: SessionWindow[] = [...Array.from({ length: 10 }, (_, i) => win(i * 30, 200 + i)), win(300, 400), win(330, 205, 3), { t0: 360, ok: false, reason: 'quiet' }];
    const s = summarize(ws);
    expect(s.used).toBe(10);
    expect(s.pitchOff).toBe(1);
    expect(s.failed).toBe(2);
    expect(s.median!.pitch).toBeCloseTo(204.5, 1);
    expect(summarize(ws.slice(0, 9)).median).toBeNull();
  });

  it('決まった文の並びは、全部を 1 回ずつ', () => {
    let s = 7;
    const random = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const order = shuffled(23, random);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 23 }, (_, i) => i));
  });

  it('書き出すファイルは数字だけ（音・名前は入らない）', () => {
    const f = sessionFile({ measureVersion: '3.1.0', date: '2026-11-07', mic: '内蔵マイク', windows: Array.from({ length: 10 }, (_, i) => win(i * 30, 200)) });
    expect(Object.keys(f).sort()).toEqual(['date', 'kind', 'measureVersion', 'median', 'mic', 'version', 'windows']);
    expect(Object.keys(f.windows[0]!).sort()).toEqual(['features', 'ok', 'snrDb', 't0', 'voicedSeconds']);
    expect(f.median!.pitch).toBe(200);
  });
});
