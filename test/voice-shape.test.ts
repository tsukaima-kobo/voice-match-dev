// 声のかたち（src/ui/voice-shape.ts）の、数字から図の値への写し方と、図の読み方の言葉。描く所は画面で確かめる。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { levelWord, SHAPE_LAYERS, shapeParams } from '../src/ui/voice-shape.ts';
import { setLang } from '../src/i18n.ts';
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

describe('図の読み方の言葉', () => {
  afterEach(() => {
    setLang('ja');
    vi.unstubAllGlobals();
  });
  it('層と項目の名前・説明は、読み込んだ後に切り替えた言葉で出る（音色の名前も）', () => {
    // 言葉を切り替えるのに要る物だけの、ページの代わり
    vi.stubGlobal('document', { documentElement: { lang: 'ja', dataset: {} }, querySelectorAll: () => [] });
    vi.stubGlobal('location', { href: 'https://example.com/' });
    const timbre = () => SHAPE_LAYERS.flatMap((l) => l.items).find((i) => i.key === 'mfcc2')!;
    expect(timbre().name).toBe('音色');
    setLang('en');
    expect(timbre().name).toBe('Timbre');
    expect(SHAPE_LAYERS[0]!.name).toBe('Shape');
    expect(timbre().fig).toMatch(/^The fingerprint/);
    setLang('ja');
    expect(timbre().name).toBe('音色');
    // 名前の無い項目は、項目の名前を使う（name を持たない）
    expect(SHAPE_LAYERS[0]!.items.every((i) => !('name' in i))).toBe(true);
  });
});
