import { describe, expect, it } from 'vitest';
import { nextIndex, nextReadingIndex, PROMPTS, PROMPTS_EN, READINGS, READINGS_EN } from '../src/prompts/prompts.ts';

describe('お題と決まった文', () => {
  it('日本語と英語が同じ数だけある', () => {
    expect(PROMPTS_EN.length).toBe(PROMPTS.length);
    expect(READINGS_EN.length).toBe(READINGS.length);
    expect(READINGS.length).toBeGreaterThanOrEqual(20);
  });

  it('決まった文は 30 秒前後で読める長さ（日本語 200〜260 字・英語 80〜115 語）', () => {
    for (const s of READINGS) {
      expect(s.length).toBeGreaterThanOrEqual(200);
      expect(s.length).toBeLessThanOrEqual(260);
    }
    for (const s of READINGS_EN) {
      const words = s.split(/\s+/).length;
      expect(words).toBeGreaterThanOrEqual(80);
      expect(words).toBeLessThanOrEqual(115);
    }
  });

  it('同じ文が 2 つない', () => {
    expect(new Set(READINGS).size).toBe(READINGS.length);
    expect(new Set(READINGS_EN).size).toBe(READINGS_EN.length);
  });

  it('次の番号は、前と同じ物を避ける', () => {
    const seq = [0.1, 0.1, 0.5];
    let k = 0;
    const random = () => seq[k++ % seq.length]!;
    const first = nextIndex(10, null, random);
    expect(first).toBe(1);
    expect(nextIndex(10, first, random)).toBe(5);
    expect(nextIndex(1, 0)).toBe(0);
    for (let i = 0, prev: number | null = null; i < 200; i++) {
      const n = nextReadingIndex(prev);
      expect(n).not.toBe(prev);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(READINGS.length);
      prev = n;
    }
  });
});
