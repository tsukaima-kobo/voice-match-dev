// 照合（src/match/match.ts）の、相手に無い項目の見込みと、速さのために覚えておく物の試験。数字は種つきの乱数で作る（声の合成はしない）。
import { describe, expect, it } from 'vitest';
import { FEATURE_BY_KEY, FEATURE_KEYS, forLength, ONE_LINE_SECONDS, FEW_SECONDS, type Features } from '../src/voice/features.ts';
import { closenessWord, distances, farScale, queryKind, rank, type MatchModel } from '../src/match/match.ts';
import { fitModel, likenessScale, LIKENESS_SHARE, medianFeatures, replaceProblem } from '../tools/lib.ts';
import type { VoiceWindow } from '../src/data/types.ts';
import { gauss, rng } from './voice-synth.ts';

const V = 'test';
const at = (k: (typeof FEATURE_KEYS)[number], t: number) => {
  const d = FEATURE_BY_KEY[k];
  return d.log ? d.lo * (d.hi / d.lo) ** t : d.lo + (d.hi - d.lo) * t;
};
const voiceAt = (pos: Record<string, number>): Features => Object.fromEntries(FEATURE_KEYS.map((k) => [k, at(k, pos[k] ?? 0.5)])) as Features;
/** n 人、1 人 2 本の動画で `per` 窓ずつ。f2 と mfcc2 は f1・mfcc1 とつながる（白色化に意味を持たせる） */
function crowd(n: number, noise: number, seed: number, per = 8): { id: string; windows: VoiceWindow[] }[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const pos = Object.fromEntries(FEATURE_KEYS.map((k, j) => [k, j % 3 === 2 ? 0.5 : 0.2 + 0.6 * r()]));
    const windows: VoiceWindow[] = [];
    for (const video of ['a', 'b'])
      for (let w = 0; w < per; w++) {
        const f = voiceAt(Object.fromEntries(FEATURE_KEYS.map((k) => [k, pos[k]! + noise * gauss(r)])));
        windows.push({ video, t0: w * 30, t1: w * 30 + 30, measuredAt: '2026-11-08', version: V, features: { ...f, f2: f.f1! * 1.6 * (1 + 0.02 * gauss(r)), mfcc2: f.mfcc1! / 40 + 0.1 * gauss(r) }, voicedSeconds: 12, gapTonal: 0, snrDb: 30 });
      }
    return { id: `vt-${String(i + 1).padStart(4, '0')}`, windows };
  });
}
const only = (f: Features, keys: readonly string[]): Features => Object.fromEntries(FEATURE_KEYS.map((k) => [k, keys.includes(k) ? f[k] : null])) as Features;
const FEW = ['pitch', 'pitchRange', 'f1', 'f2', 'f3', 'hnr', 'rate'];

/** 逆行列（掃き出し。答え合わせ用） */
function inverse(a: number[][]): number[][] {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    const d = m[c]![c]!;
    for (let j = 0; j < 2 * n; j++) m[c]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]!;
      for (let j = 0; j < 2 * n; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  return m.map((row) => row.slice(n));
}

describe('相手に無い項目', () => {
  const speakers = crowd(40, 0.08, 5);
  const model = fitModel(speakers, V, { whiten: true });
  const profiles = speakers.map((s) => ({ id: s.id, features: medianFeatures(s.windows) }));

  it('答え合わせ: 両方にある項目のマハラノビス距離に、別の人と比べた時の見込みの差（来た声から）を足して、来た声の項目の数で割る', () => {
    const z = (f: Features) => model.keys.map((k, i) => (f[k] === null ? null : ((FEATURE_BY_KEY[k].log ? Math.log(f[k]!) : f[k]!) - model.center[i]!) / model.spread[i]!));
    const W = model.whiten!;
    const cov = inverse(W[0]!.map((_, i) => W[0]!.map((_, j) => W.reduce((s, row) => s + row[i]! * row[j]!, 0))));
    const { mean, cov: P } = model.people!;
    /** 項目の組 S での (a−b)ᵀ Σ_S⁻¹ (a−b) と tr(Σ_S⁻¹ P_S) */
    const quad = (S: number[], d: number[]) => {
      const inv = inverse(S.map((i) => S.map((j) => cov[i]![j]!)));
      return d.reduce((s, x, r) => s + x * d.reduce((t, y, c) => t + inv[r]![c]! * y, 0), 0);
    };
    const tr = (S: number[]) => {
      const inv = inverse(S.map((i) => S.map((j) => cov[i]![j]!)));
      return S.reduce((s, _, r) => s + S.reduce((t, j, c) => t + inv[r]![c]! * P[j]![S[r]!]!, 0), 0);
    };
    const expectOf = (S: number[], q: (number | null)[]) => quad(S, S.map((i) => q[i]! - mean[i]!)) + tr(S);
    for (const query of [speakers[3]!.windows[2]!.features, forLength(speakers[3]!.windows[2]!.features, ONE_LINE_SECONDS)]) {
      const q = z(query);
      const Q = model.keys.flatMap((_, i) => (q[i] !== null ? [i] : []));
      for (const missing of [['mfcc5', 'mfcc6', 'pitch'], ['f2'], FEATURE_KEYS.filter((k) => !FEW.includes(k))]) {
        const p = { ...profiles[9]!.features, ...Object.fromEntries(missing.map((k) => [k, null])) } as Features;
        const v = z(p);
        const I = Q.filter((i) => v[i] !== null);
        const want = Math.sqrt((quad(I, I.map((i) => q[i]! - v[i]!)) + Math.max(0, expectOf(Q, q) - expectOf(I, q))) / Q.length);
        const got = rank(model, query, [{ id: 'p', features: p }], 1)[0]!;
        expect(got.distance, missing.join(',')).toBeCloseTo(want, 2);
        expect(got.used).toBe(I.length);
      }
    }
  });

  it('項目の少ない声は、項目が少ないだけでは 1 位にならない（マイクのずれで全員から遠い声でも）', () => {
    // 5 人に 1 人を、7 項目だけの声にする。来た声はデータに居ない人（本人を除いて比べる）
    const pool = profiles.map((p, i) => (i % 5 === 0 ? { id: p.id, features: only(p.features, FEW) } : p));
    for (const shift of [0, 0.08]) {
      let n = 0,
        sparse = 0;
      speakers.forEach((s, si) => {
        const others = pool.filter((_, i) => i !== si);
        for (const w of s.windows.slice(0, 4)) {
          const f = Object.fromEntries(FEATURE_KEYS.map((k) => [k, FEATURE_BY_KEY[k].log ? w.features[k]! * Math.exp(shift) : w.features[k]! + shift * (FEATURE_BY_KEY[k].hi - FEATURE_BY_KEY[k].lo)])) as Features;
          const top = rank(model, f, others, 1)[0]!;
          n++;
          if (profiles.findIndex((p) => p.id === top.id) % 5 === 0) sparse++;
        }
      });
      // 7 項目だけの声は、ほかの人の 2 割。それより多く 1 位にならない
      expect(sparse / n, `shift ${shift}`).toBeLessThan(0.2);
    }
  });

  it('全部の項目がある相手には何も足さない。来た声に無い項目は数えない（一言でも同じ）', () => {
    const q = forLength(speakers[1]!.windows[0]!.features, FEW_SECONDS);
    const p = profiles[2]!.features;
    // 来た声に無い項目を相手からも消しても、近さは同じ
    const trimmed = Object.fromEntries(FEATURE_KEYS.map((k) => [k, q[k] === null ? null : p[k]])) as Features;
    expect(rank(model, q, [{ id: 'a', features: trimmed }], 1)[0]!.distance).toBe(rank(model, q, [{ id: 'a', features: p }], 1)[0]!.distance);
  });

  it('本人の声に無い項目が少しあっても（速さのムラ・間の長さ・リズム）、本人はほぼ変わらず当たる', () => {
    let n = 0,
      full = 0,
      holes = 0;
    speakers.forEach((s, si) => {
      const own = medianFeatures(s.windows.filter((w) => w.video === 'a'));
      const pool = profiles.map((p, i) => (i === si ? { id: s.id, features: own } : p));
      const poolHoles = profiles.map((p, i) => (i === si ? { id: s.id, features: { ...own, rateVar: null, pauseLen: null, rhythm: null } } : p));
      for (const w of s.windows.filter((x) => x.video === 'b')) {
        n++;
        if (rank(model, w.features, pool, 1)[0]!.id === s.id) full++;
        if (rank(model, w.features, poolHoles, 1)[0]!.id === s.id) holes++;
      }
    });
    expect(holes / n).toBeGreaterThan(full / n - 0.05);
  });
});

describe('覚えておく物（結果は同じ）', () => {
  const speakers = crowd(60, 0.1, 6);
  const model = fitModel(speakers, V, { whiten: true });
  const r = rng(9);
  // 相手ごとに、いろいろな項目が抜けている（覚えておく項目の組の上限 512 を超える）
  const pool = speakers.flatMap((s, i) =>
    s.windows.map((w, j) => {
      const f = { ...w.features };
      for (let k = 0; k < 2; k++) f[FEATURE_KEYS[Math.floor(r() * FEATURE_KEYS.length)]!] = null;
      return { id: `p${String(i * 100 + j).padStart(5, '0')}`, features: f };
    }),
  );
  const queries = speakers.slice(0, 6).map((s) => s.windows[5]!.features);
  const plain = (m: MatchModel) => JSON.parse(JSON.stringify(m)) as MatchModel;

  it('上位だけを持つ並べ方と、全部を並べた物の先頭は同じ。何回比べても、相手の並びを変えても、作り直したモデルでも同じ', () => {
    const first = queries.map((q) => rank(model, q, pool, 5));
    for (const [i, q] of queries.entries()) {
      expect(rank(model, q, pool, pool.length).slice(0, 5)).toEqual(first[i]);
      expect(rank(model, { ...q }, [...pool].reverse(), 5)).toEqual(first[i]);
      expect(rank(plain(model), q, pool, 5)).toEqual(first[i]);
      expect(rank(model, forLength(q, ONE_LINE_SECONDS), pool, 5)).toEqual(rank(plain(model), forLength(q, ONE_LINE_SECONDS), pool, 5));
    }
    // ほかの声を比べた後でも
    expect(queries.map((q) => rank(model, q, pool, 5))).toEqual(first);
  });
  it('並べた近さと、並べない近さと、言葉の物差しは、同じ声なら同じ値（同じ数字の別の入れ物でも）', () => {
    const q = queries[2]!;
    const all = new Map(distances(model, q, pool).map((x) => [x.id, x.distance]));
    for (const x of rank(model, { ...q }, pool, 20)) expect(all.get(x.id)).toBe(x.distance);
    expect(farScale(model, { ...q }, pool)).toEqual(farScale(plain(model), q, pool));
  });
  it('数字の違う声は、前の声の結果を使わない', () => {
    const q = queries[0]!;
    const moved = { ...q, pitch: q.pitch! * 1.5 };
    expect(rank(model, q, pool, 5)).not.toEqual(rank(model, moved, pool, 5));
    expect(rank(model, moved, pool, 5)).toEqual(rank(plain(model), moved, pool, 5));
  });
});

describe('近さの言葉は、問いの種類ごとの目安で', () => {
  it('問いの種類: 一言・数秒・30 秒 1 回・何回分もの中央値', () => {
    const f = voiceAt({});
    expect(queryKind(forLength(f, ONE_LINE_SECONDS))).toBe('line');
    expect(queryKind(forLength(f, FEW_SECONDS))).toBe('few');
    expect(queryKind(f)).toBe('full');
    expect(queryKind(f, 9)).toBe('full');
    expect(queryKind(f, 10)).toBe('many');
    expect(queryKind(forLength(f, ONE_LINE_SECONDS), 20)).toBe('line');
  });
  it('種類ごとの区切りを使う。数だけの物差しと、種類の無いモデルは、30 秒 1 回分の区切り', () => {
    const base = fitModel(crowd(10, 0.1, 2), V, { whiten: false });
    const m: MatchModel = { ...base, likeness: { typical: 2, cuts: [1, 1.2, 1.4], kinds: { line: { typical: 2, cuts: [0.5, 0.6, 0.7] } } } };
    expect(closenessWord(m, 0.9, { scale: 1, kind: 'line' })).toBe('似ている所がある');
    expect(closenessWord(m, 0.9, { scale: 1, kind: 'few' })).toBe('とても似ている');
    expect(closenessWord(m, 0.9, 1)).toBe('とても似ている');
    const old: MatchModel = { ...base, likeness: { typical: 2, cuts: [1, 1.2, 1.4] } };
    expect(closenessWord(old, 0.9, { scale: 1, kind: 'line' })).toBe('とても似ている');
  });
  it('データに居ない人の 1 位に、どの種類の問いでも、決めた割合どおりに言葉が付く', () => {
    const speakers = crowd(40, 0.12, 3, 12);
    const fitted = fitModel(speakers, V, { whiten: true });
    const model = { ...fitted, likeness: likenessScale(speakers, fitted) };
    expect(Object.keys(model.likeness.kinds!).sort()).toEqual(['few', 'full', 'line', 'many']);
    const WORDS = ['とても似ている', 'よく似ている', '似ている', '似ている所がある'];
    const profiles = speakers.map((s) => ({ id: s.id, features: medianFeatures(s.windows) }));
    for (const [kind, make, n] of [
      ['line', (ws: VoiceWindow[]) => ws.map((w) => forLength(w.features, ONE_LINE_SECONDS)), 1],
      ['full', (ws: VoiceWindow[]) => ws.map((w) => w.features), 1],
      ['many', (ws: VoiceWindow[]) => [medianFeatures(ws.slice(0, 20))], 20],
    ] as const) {
      const c = [0, 0, 0, 0];
      speakers.forEach((s, si) => {
        const others = profiles.filter((_, i) => i !== si);
        for (const q of make(s.windows)) {
          const top = rank(model, q, others, 1)[0]!;
          const sc = farScale(model, q, others, n);
          expect(sc.kind).toBe(kind);
          c[WORDS.indexOf(closenessWord(model, top.distance, sc))]!++;
        }
      });
      const all = c.reduce((a, b) => a + b, 0);
      expect(c[0]! / all, kind).toBeCloseTo(LIKENESS_SHARE[0], 1);
      expect((c[0]! + c[1]!) / all, kind).toBeCloseTo(LIKENESS_SHARE[1], 1);
    }
  });
});

describe('モデルを作る時', () => {
  it('人ごとの代表値の平均と共分散（相手に無い項目の見込みに使う）と、人の数を持つ', () => {
    const speakers = crowd(12, 0.1, 4);
    const m = fitModel(speakers, V, { whiten: true });
    expect(m.speakers).toBe(12);
    const { mean, cov } = m.people!;
    expect(mean).toHaveLength(m.keys.length);
    expect(cov).toHaveLength(m.keys.length);
    cov.forEach((row, i) => {
      expect(row[i]!).toBeGreaterThanOrEqual(0);
      row.forEach((x, j) => expect(x).toBe(cov[j]![i]!));
    });
  });
  it('シートから作ったモデルや、ずっと多い人から作ったモデルは、黙って置き換えない', () => {
    const sheet = { version: 'whiten', speakers: 348, source: 'sheet' as const };
    expect(replaceProblem(sheet, undefined, { speakers: 5, source: 'voices' })).toContain('シート');
    expect(replaceProblem(sheet, undefined, { speakers: 400, source: 'voices' })).toContain('シート');
    expect(replaceProblem(sheet, undefined, { speakers: 350, source: 'sheet' })).toBeNull();
    // 前の形（人の数を持たない）は、評価の記録の人数で
    expect(replaceProblem({ version: 'whiten' }, 348, { speakers: 20, source: 'voices' })).toContain('348');
    expect(replaceProblem({ version: 'whiten' }, 348, { speakers: 200, source: 'voices' })).toBeNull();
    expect(replaceProblem({ version: 'none' }, undefined, { speakers: 3, source: 'voices' })).toBeNull();
    expect(replaceProblem(null, undefined, { speakers: 3, source: 'voices' })).toBeNull();
  });
});
