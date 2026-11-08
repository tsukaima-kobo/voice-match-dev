// 測り方の版の比べ方（tools/versions.ts）と、照合のモデルのファイルを使えるか（src/data/model-file.ts）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareVersions, oldestVersion } from '../tools/versions.ts';
import { modelProblem } from '../src/data/model-file.ts';
import { defaultModel } from '../src/match/match.ts';
import { MEASURE_COMPATIBLE, MEASURE_VERSION } from '../src/voice/measure.ts';

describe('測り方の版', () => {
  it('数の所は数として比べる。いちばん古い版を選ぶ', () => {
    expect(compareVersions('3.1.0', '3.2.0')).toBeLessThan(0);
    expect(compareVersions('3.10.0', '3.9.0')).toBeGreaterThan(0);
    expect(compareVersions('3.2.0', '3.2.0')).toBe(0);
    expect(compareVersions('3.2', '3.2.0')).toBe(0);
    expect(oldestVersion(['3.2.0', '3.1.0', '3.2.0'], 'x')).toBe('3.1.0');
    expect(oldestVersion([], MEASURE_VERSION)).toBe(MEASURE_VERSION);
  });
});

describe('照合のモデルのファイル', () => {
  it('今の data/model.json は使える', () => {
    expect(modelProblem(JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url), 'utf8')))).toBeNull();
  });
  it('今の版か、比べてよい前の版のモデルだけ使う。版・形が違う物・まだ無い物は理由を返す（ビルドが止まる）', () => {
    expect(modelProblem(defaultModel(MEASURE_VERSION))).toBeNull();
    for (const v of MEASURE_COMPATIBLE) expect(modelProblem(defaultModel(v)), v).toBeNull();
    expect(modelProblem(defaultModel('2.0.0'))).toMatch(/2\.0\.0.*比べられません/);
    expect(modelProblem({ ...defaultModel(MEASURE_VERSION), measureVersion: undefined })).toMatch(/書いていない/);
    expect(modelProblem({ ...defaultModel(MEASURE_VERSION), center: [1] })).toMatch(/形/);
    expect(modelProblem({ version: 'none' })).toMatch(/ありません/);
    expect(modelProblem(null)).not.toBeNull();
  });
});
