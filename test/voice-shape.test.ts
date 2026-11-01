// 声のかたち（src/ui/voice-shape.ts）の、数字から図の値への写し方と、図の読み方の言葉。描く所は画面で確かめる。
import { describe, expect, it } from 'vitest';
import { levelWord, SHAPE_LAYERS, shapeParams } from '../src/ui/voice-shape.ts';
import { FEATURE_BY_KEY, FEATURE_KEYS, type Features } from '../src/voice/features.ts';

const none = Object.fromEntries(FEATURE_KEYS.map((k) => [k, null])) as Features;

describe('声のかたち', () => {
  it('reads every item it names from the real items', () => {
    for (const l of SHAPE_LAYERS) for (const i of l.items) expect(FEATURE_BY_KEY[i.key], i.key).toBeDefined();
  });
  it('puts the numbers on the same 0–1 scale as the bars, and leaves the unmeasured ones empty', () => {
    const d = FEATURE_BY_KEY.pitch;
    const p = shapeParams({ ...none, pitch: d.hi, rate: null, hnr: FEATURE_BY_KEY.hnr.lo });
    expect(p.pitch).toBe(1);
    expect(p.hnr).toBe(0);
    expect(p.rate).toBeNull();
    expect(shapeParams({ ...none, pitch: 150 })).toEqual(shapeParams({ ...none, pitch: 150 }));
  });
  it('says where a number sits, in words', () => {
    const d = FEATURE_BY_KEY.pitch;
    expect(levelWord('pitch', d.lo)).toBe(`かなり${d.low}`);
    expect(levelWord('pitch', d.hi)).toBe(`かなり${d.high}`);
    expect(levelWord('pitch', null)).toBe('まだ測っていません');
    expect(levelWord('mfcc2', 0)).toBe('');
  });
});
