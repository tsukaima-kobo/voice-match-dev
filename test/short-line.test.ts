// 一言から測る・話すほど絞り込む（features.ts の needOf・takes.ts）と、セリフ真似（measure.ts の Contour・mimic/line.ts）の試験。
// 音は合成音（録音なし）。
import { describe, expect, it } from 'vitest';
import { CONTOUR_STEP, measureVoice, type Contour } from '../src/voice/measure.ts';
import { FEATURE_KEYS, forLength, LONG_SECONDS, needOf, ONE_LINE_SECONDS, type Features } from '../src/voice/features.ts';
import { certaintyOf, combineTakes } from '../src/voice/takes.ts';
import { align, compareLines, lineScore } from '../src/mimic/line.ts';
import { mimicScore } from '../src/mimic/mimic.ts';
import { concat, silence, vowel } from './voice-synth.ts';

const R = 16000;
/** 一言: 声 `seconds` 秒（前後に静かな所）。高さは f0(t) */
const line = (seconds: number, f0: number | ((t: number) => number), seed = 1) =>
  concat(silence(R, 0.4), vowel({ rate: R, seconds, f0, jitter: 0.006, shimmer: 0.03, breath: 0.02, seed, envelope: (t) => Math.min(1, t / 0.05, (seconds - t) / 0.05) }), silence(R, 0.4));
const ok = (x: Float32Array, contour = false) => {
  const m = measureVoice(x, R, { minVoicedSeconds: ONE_LINE_SECONDS, contour });
  if (!m.ok) throw new Error(m.reason);
  return m;
};

describe('一言から測る', () => {
  it('1 秒ほどの一言で、声の高さ・フォルマント・声の質を測る', () => {
    const m = ok(line(1, 180));
    expect(m.features.pitch).toBeGreaterThan(175);
    expect(m.features.pitch).toBeLessThan(185);
    for (const k of ['f1', 'f2', 'f3', 'hnr', 'cpp', 'h1h2', 'tilt'] as const) expect(m.features[k], k).not.toBeNull();
  });
  it('決まった最短より短い物は断る', () => {
    const m = measureVoice(line(0.25, 180), R, { minVoicedSeconds: ONE_LINE_SECONDS });
    expect(m.ok).toBe(false);
  });
  it('短い回では、もっと長い回が要る項目を除く', () => {
    const f = forLength(ok(line(1, 180)).features, 1);
    expect(f.pitch).not.toBeNull();
    expect(f.pitchRange).toBeNull();
    expect(f.rate).toBeNull();
    expect(needOf('pitch')).toBe(ONE_LINE_SECONDS);
    expect(needOf('pauseShare')).toBe(LONG_SECONDS);
  });
});

describe('話すほど絞り込む', () => {
  const base = Object.fromEntries(FEATURE_KEYS.map((k) => [k, null])) as Features;
  it('回を長さに応じてまとめる。Hz の項目は幾何平均で、どの項目も長さの足りる回だけから', () => {
    const a = { ...base, pitch: 100, hnr: 10, rate: 5 };
    const b = { ...base, pitch: 400, hnr: 20, rate: 3 };
    const c = combineTakes([
      { features: a, voicedSeconds: 1 },
      { features: b, voicedSeconds: 1 },
    ]);
    expect(c.features.pitch).toBe(200);
    expect(c.features.hnr).toBe(15);
    expect(c.features.rate).toBeNull();
    const d = combineTakes([
      { features: a, voicedSeconds: 1 },
      { features: b, voicedSeconds: 9 },
    ]);
    expect(d.features.rate).toBe(3);
    expect(d.features.hnr).toBe(19);
    expect(d.voicedSeconds).toBe(10);
    expect(d.takes).toBe(2);
  });
  it('どれだけ確かかを言う: 一言・1 回で数秒・長い回 1 つ', () => {
    expect(certaintyOf({ voicedSeconds: 1, longest: 1 })).toBe(1);
    expect(certaintyOf({ voicedSeconds: 3.5, longest: 3.5 })).toBe(2);
    expect(certaintyOf({ voicedSeconds: 12, longest: 3 })).toBe(2);
    expect(certaintyOf({ voicedSeconds: 9, longest: 8.5 })).toBe(3);
  });
  it('一言を何回足しても「だいたい」にはならない（抑揚などの項目が出ないため）', () => {
    expect(certaintyOf({ voicedSeconds: 4, longest: 1 })).toBe(1);
    const a = { ...base, pitch: 200, pitchRange: 5, hnr: 12 };
    const c = combineTakes([1.2, 1.2, 1.2].map((voicedSeconds) => ({ features: a, voicedSeconds })));
    expect(c.voicedSeconds).toBeGreaterThan(3);
    expect(c.features.pitchRange).toBeNull();
    expect(certaintyOf(c)).toBe(1);
    const d = combineTakes([1.2, 3.2].map((voicedSeconds) => ({ features: a, voicedSeconds })));
    expect(d.features.pitchRange).toBe(5);
    expect(certaintyOf(d)).toBe(2);
  });
  it('短い回で項目が抜けても、声の点数は上がらない', () => {
    const t = ok(line(1, 180)).features;
    const off = { ...t, pitch: t.pitch! * 2 ** (3 / 12) };
    const full = mimicScore(t, off)!;
    const fewer = mimicScore({ ...t, f2: null, centroid: null }, { ...off, f2: null, centroid: null })!;
    expect(fewer.score).toBeLessThanOrEqual(full.score);
  });
});

describe('セリフ真似', () => {
  // 上がって、最後に下がるセリフ
  const rise = (t: number) => 160 * 2 ** ((4 * Math.sin(Math.PI * Math.min(1, t / 1.2))) / 12);
  const fall = (t: number) => 160 * 2 ** ((-4 * Math.sin(Math.PI * Math.min(1, t / 1.2))) / 12);
  it('声の高さと大きさの移り変わりを、一定の刻みで出す', () => {
    const m = ok(line(1.2, rise), true);
    const c = m.info.contour!;
    expect(c.step).toBe(CONTOUR_STEP);
    expect(c.pitch.length).toBeGreaterThan(50);
    const voiced = Array.from(c.pitch).filter(Number.isFinite);
    expect(Math.max(...voiced) - Math.min(...voiced)).toBeGreaterThan(3);
    expect(Math.max(...Array.from(c.level))).toBe(0);
  });
  it('同じセリフは満点', () => {
    const c = ok(line(1.2, rise), true).info.contour!;
    const r = compareLines(c, c)!;
    expect(r.intonation).toBe(100);
    expect(r.timing).toBe(100);
    expect(r.tips).toEqual([]);
    expect(lineScore(r, 100)).toBe(100);
  });
  it('形と高さを分けて見る: 同じ節を高くしても抑揚は合う', () => {
    const a = ok(line(1.2, rise, 1), true).info.contour!;
    const b = ok(line(1.2, (t) => rise(t) * 2 ** (5 / 12), 2), true).info.contour!;
    expect(compareLines(a, b)!.intonation).toBeGreaterThanOrEqual(85);
  });
  it('逆向きの節に気づき、どこかを言う', () => {
    const a = ok(line(1.2, rise, 1), true).info.contour!;
    const b = ok(line(1.2, fall, 2), true).info.contour!;
    const r = compareLines(a, b)!;
    expect(r.intonation).toBeLessThan(30);
    expect(r.tips.map((t) => t.text).join('')).toContain('上げる');
  });
  it('ゆっくりのセリフは、抑揚でなくタイミングに出る', () => {
    const a = ok(line(1.2, rise, 1), true).info.contour!;
    const b = ok(line(1.9, (t) => rise((t * 1.2) / 1.9), 2), true).info.contour!;
    const r = compareLines(a, b)!;
    expect(r.intonation).toBeGreaterThanOrEqual(80);
    expect(r.timing).toBeLessThan(85);
    expect(r.tips.map((t) => t.text).join('')).toContain('速く');
  });
  it('そろえる道は、前へ進んだ時と同じ費用で戻る（一番安い道を通る）', () => {
    // 決まった種の揺れのある、短い 2 つの動き。全部の道を調べた一番安い費用と比べる
    const make = (n: number, seed: number): Contour => {
      let s = seed;
      const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
      const pitch = new Float32Array(n),
        level = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        pitch[k] = rnd() < 0.2 ? NaN : 12 + 6 * rnd();
        level[k] = -30 * rnd();
      }
      return { step: CONTOUR_STEP, pitch, level };
    };
    const cost = (a: Contour, b: Contour, ra: number, rb: number, i: number, j: number) => {
      const pa = a.pitch[i]!,
        pb = b.pitch[j]!;
      let c = Math.abs((a.level[i]! + 40) / 40 - (b.level[j]! + 40) / 40);
      if (Number.isFinite(pa) && Number.isFinite(pb)) c += Math.min(Math.abs(pa - ra - (pb - rb)), 12) / 10;
      else if (Number.isFinite(pa) !== Number.isFinite(pb)) c += 0.5;
      return c;
    };
    for (let seed = 1; seed <= 20; seed++) {
      const a = make(6 + (seed % 3), seed),
        b = make(7 + (seed % 4), seed * 31);
      const n = a.pitch.length,
        m = b.pitch.length;
      const inBand = (i: number, j: number) => Math.abs(i / (n - 1) - j / (m - 1)) <= 0.3;
      const c = (i: number, j: number) => cost(a, b, 14, 15, i, j);
      // 全部の道の一番安い費用
      const best = (i: number, j: number): number => {
        if (!inBand(i, j)) return Infinity;
        if (i === 0 && j === 0) return c(0, 0);
        const side = c(i, j) * 1.1 + 0.02;
        return Math.min(i > 0 && j > 0 ? best(i - 1, j - 1) + c(i, j) : Infinity, i > 0 ? best(i - 1, j) + side : Infinity, j > 0 ? best(i, j - 1) + side : Infinity);
      };
      const path = align(a, b, 14, 15);
      const cells = path.flatMap((js, i) => [...js].reverse().map((j) => [i, j] as const));
      let total = c(0, 0);
      for (let k = 1; k < cells.length; k++) {
        const [pi, pj] = cells[k - 1]!,
          [i, j] = cells[k]!;
        total += i > pi && j > pj ? c(i, j) : c(i, j) * 1.1 + 0.02;
      }
      expect(cells[0]).toEqual([0, 0]);
      expect(cells[cells.length - 1]).toEqual([n - 1, m - 1]);
      expect(total, `seed ${seed}`).toBeCloseTo(best(n - 1, m - 1), 9);
    }
  });
  it('抑揚・タイミング・声の質の重みは 4 : 2.5 : 3.5。声の質が無くても残りで出す', () => {
    expect(lineScore({ intonation: 100, timing: 0 }, 0)).toBe(40);
    expect(lineScore({ intonation: 100, timing: 0 }, null)).toBe(62);
  });
});
