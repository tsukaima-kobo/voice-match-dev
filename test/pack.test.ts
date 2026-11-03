// 声のデータを詰める・ほどく（src/data/pack.ts）
import { describe, expect, it } from 'vitest';
import { packVoices, unpackVoices } from '../src/data/pack.ts';
import { defaultModel, rank } from '../src/match/match.ts';
import { FEATURE_KEYS, roundFeature, type Features } from '../src/voice/features.ts';
import { MEASURE_VERSION } from '../src/voice/measure.ts';
import { PLAUSIBLE } from '../src/submit/code.ts';
import type { CatalogEntry } from '../src/data/types.ts';

/** 決まった並びの数（乱数は使わない） */
function series(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}
function voicesOf(n: number, seed = 1): { voices: CatalogEntry[]; features: Features[] } {
  const r = series(seed);
  const voices: CatalogEntry[] = [];
  const features: Features[] = [];
  for (let i = 0; i < n; i++) {
    voices.push({ id: `v-${String(i).padStart(4, '0')}`, name: `声 ${i}`, ...(i % 3 ? { group: `所属 ${i % 4}` } : {}), links: { profile: `https://example.com/${i}` }, ...(i % 5 === 0 ? { by: 'users' as const } : {}) });
    features.push(
      Object.fromEntries(
        FEATURE_KEYS.map((k) => {
          const [a, b] = PLAUSIBLE[k] ?? [-10, 10];
          // (some items missing, as in short takes)
          return [k, (i + k.length) % 11 === 0 ? null : roundFeature(k, a + (b - a) * r())];
        }),
      ) as Features,
    );
  }
  return { voices, features };
}

describe('声のデータを詰める', () => {
  it('ほどくと、名前・所属・リンク・登録の印・無い項目が元のとおり', () => {
    const { voices, features } = voicesOf(37);
    const out = unpackVoices(packVoices(MEASURE_VERSION, voices, features));
    expect(out.voices).toEqual(voices);
    expect(out.profiles.map((p) => p.id)).toEqual(voices.map((v) => v.id));
    out.profiles.forEach((p, i) => {
      for (const k of FEATURE_KEYS) expect(p.features[k] === null).toBe(features[i]![k] === null);
    });
  });

  it('数字のずれは、1 段の幅の半分まで', () => {
    const { voices, features } = voicesOf(50, 2);
    const pack = packVoices(MEASURE_VERSION, voices, features);
    const out = unpackVoices(pack);
    out.profiles.forEach((p, i) => {
      pack.keys.forEach((k, j) => {
        const a = features[i]![k as keyof Features];
        const b = p.features[k];
        if (a === null || a === undefined) return;
        expect(Math.abs(b! - a)).toBeLessThanOrEqual(pack.step[j]! / 2 + 1e-9);
      });
    });
  });

  it('同じデータなら同じ物になる・数字は 1 つ 1 バイト', () => {
    const { voices, features } = voicesOf(10, 3);
    const a = packVoices(MEASURE_VERSION, voices, features);
    expect(JSON.stringify(packVoices(MEASURE_VERSION, voices, features))).toBe(JSON.stringify(a));
    // (base64: 4 letters per 3 bytes)
    expect(a.f.length).toBe(Math.ceil((a.keys.length * 10) / 3) * 4);
  });

  it('声の数が 1・2・3 で割り切れない時も、ほどける', () => {
    for (const n of [1, 2, 4, 5]) {
      const { voices, features } = voicesOf(n, n);
      const out = unpackVoices(packVoices(MEASURE_VERSION, voices, features));
      expect(out.profiles).toHaveLength(n);
    }
  });

  it('声が 0 件でも、全部の声が同じ数字でも、壊れない', () => {
    expect(unpackVoices(packVoices(MEASURE_VERSION, [], [])).profiles).toEqual([]);
    const { voices, features } = voicesOf(1, 4);
    const two = unpackVoices(packVoices(MEASURE_VERSION, [voices[0]!, { ...voices[0]!, id: 'v-x' }], [features[0]!, features[0]!]));
    expect(two.profiles[1]!.features).toEqual(two.profiles[0]!.features);
  });

  it('照合の 1 位は、詰める前と同じ', () => {
    const { voices, features } = voicesOf(300, 5);
    const model = defaultModel(MEASURE_VERSION);
    const before = voices.map((v, i) => ({ id: v.id, features: features[i]! }));
    const after = unpackVoices(packVoices(MEASURE_VERSION, voices, features)).profiles as typeof before;
    const r = series(9);
    for (let t = 0; t < 40; t++) {
      const base = features[(t * 7) % 300]!;
      // (a visitor near one of the voices)
      const user = Object.fromEntries(FEATURE_KEYS.map((k) => [k, base[k] === null ? null : base[k]! * (1 + (r() - 0.5) * 0.04)])) as Features;
      expect(rank(model, user, after, 1)[0]!.id).toBe(rank(model, user, before, 1)[0]!.id);
    }
  });

  it('声の数と数字の数が違えば止める・壊れたデータはほどかない', () => {
    const { voices, features } = voicesOf(3, 6);
    expect(() => packVoices(MEASURE_VERSION, voices, features.slice(1))).toThrow();
    const pack = packVoices(MEASURE_VERSION, voices, features);
    expect(() => unpackVoices({ ...pack, f: pack.f.slice(4) })).toThrow();
  });
});
