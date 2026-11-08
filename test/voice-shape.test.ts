// 声のかたち（src/ui/voice-shape.ts）の、数字から図の値への写し方と、図の読み方の言葉。描く所は画面で確かめる。
import { describe, expect, it } from 'vitest';
import { levelWord, SHAPE_LAYERS, shapeParams } from '../src/ui/voice-shape.ts';
import { FEATURE_BY_KEY, FEATURE_KEYS, type Features } from '../src/voice/features.ts';

const none = Object.fromEntries(FEATURE_KEYS.map((k) => [k, null])) as Features;

describe('声のかたち', () => {
  it('名前を挙げた項目は、どれも本当にある項目から読む', () => {
    for (const l of SHAPE_LAYERS) for (const i of l.items) expect(FEATURE_BY_KEY[i.key], i.key).toBeDefined();
  });
  it('数字を棒と同じ 0–1 の目盛りに置き、測っていない物は空にする', () => {
    const d = FEATURE_BY_KEY.pitch;
    const p = shapeParams({ ...none, pitch: d.hi, rate: null, hnr: FEATURE_BY_KEY.hnr.lo });
    expect(p.pitch).toBe(1);
    expect(p.hnr).toBe(0);
    expect(p.rate).toBeNull();
    expect(shapeParams({ ...none, pitch: 150 })).toEqual(shapeParams({ ...none, pitch: 150 }));
  });
  it('数字がどのあたりかを、言葉で言う', () => {
    const d = FEATURE_BY_KEY.pitch;
    expect(levelWord('pitch', d.lo)).toBe(`かなり${d.low}`);
    expect(levelWord('pitch', d.hi)).toBe(`かなり${d.high}`);
    expect(levelWord('pitch', null)).toBe('まだ測っていません');
    expect(levelWord('mfcc2', 0)).toBe('');
  });
});
