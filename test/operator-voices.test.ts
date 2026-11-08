// 運営が測った声の代表値（tools/operator-voices-lib.ts）と、サイトでのまとめ方（src/data/sources.ts）
import { describe, expect, it } from 'vitest';
import { buildOperatorVoices, parseIdList, type Snapshot } from '../tools/operator-voices-lib.ts';
import { checkOperatorVoices, fromOperatorVoices, mergeVoices } from '../src/data/sources.ts';
import { FEATURE_KEYS } from '../src/voice/features.ts';
import { MEASURE_VERSION } from '../src/voice/measure.ts';

/** 1 人分の窓（高さだけ変える。ほかの項目は決まった値） */
function windows(id: string, video: string, pitches: (number | null)[]) {
  return pitches.map((p, i) => ({ personId: id, videoId: video, t0: i * 30, ...Object.fromEntries(FEATURE_KEYS.map((k) => [k, k === 'pitch' ? p : 1])) }));
}
const person = (id: string, extra: Partial<Snapshot['peoples'][number]> = {}) => ({ personId: id, name: `名前 ${id}`, groupName: '所属区分', currentAffiliation: null, officialProfile: `https://example.com/${id}`, ...extra });
const snap = (peoples: Snapshot['peoples'], measurements: Snapshot['measurements'], v = MEASURE_VERSION): Snapshot => ({ summary: { measureVersions: [v] }, peoples, measurements });

describe('運営が測った声の代表値', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => 200 + i);
  it('数字のある窓の中央値。窓と動画の数は手元の記録に出す', () => {
    const { file, notes } = buildOperatorVoices(snap([person('a')], [...windows('a', 'v1', twelve.slice(0, 6)), ...windows('a', 'v2', [...twelve.slice(6), null, null])]), { measureVersion: MEASURE_VERSION, only: null });
    expect(file.voices).toHaveLength(1);
    const v = file.voices[0]!;
    expect(v.features.pitch).toBeCloseTo(205.5, 1);
    expect(v.link).toBe('https://example.com/a');
    expect(notes.join('\n')).toMatch(/使う 12.*動画 2 本/);
  });

  it('公開のファイルには、名前・所属・公式ページ・数字だけ（人物ID・窓の数は入れない）', () => {
    const { file } = buildOperatorVoices(snap([person('a')], windows('a', 'v1', twelve)), { measureVersion: MEASURE_VERSION, only: null });
    expect(Object.keys(file.voices[0]!).sort()).toEqual(['features', 'group', 'link', 'name']);
  });

  it('大枠はシートの「大枠」から。書いていない人は --kind の大枠。読めない言葉は記録に出す', () => {
    const { file, notes } = buildOperatorVoices(
      snap([person('a', { kinds: 'VTuber、歌手' }), person('b'), person('c', { kinds: 'ぬいぐるみ' })], [...windows('a', 'v1', twelve), ...windows('b', 'v1', twelve), ...windows('c', 'v1', twelve)]),
      { measureVersion: MEASURE_VERSION, only: null, defaultKinds: 1 },
    );
    expect(file.voices.map((v) => v.kinds)).toEqual([['vtuber', 'singer'], ['vtuber'], ['vtuber']]);
    expect(notes.join('\n')).toMatch(/c:.*大枠の読めない言葉「ぬいぐるみ」/);
    const none = buildOperatorVoices(snap([person('b')], windows('b', 'v1', twelve)), { measureVersion: MEASURE_VERSION, only: null });
    expect(none.file.voices[0]!.kinds).toBeUndefined();
    expect(none.notes.join('')).toMatch(/大枠なし/);
  });

  it('高さが大きく外れた窓（別の人など）は除く', () => {
    const { notes } = buildOperatorVoices(snap([person('a')], windows('a', 'v1', [...twelve, 400, 410])), { measureVersion: MEASURE_VERSION, only: null });
    expect(notes.join('\n')).toMatch(/窓 14 → 使う 12/);
  });

  it('窓が足りない人・公式ページの無い人は入れない', () => {
    const r = buildOperatorVoices(snap([person('a'), person('b', { officialProfile: '' })], [...windows('a', 'v1', twelve.slice(0, 9)), ...windows('b', 'v1', twelve)]), { measureVersion: MEASURE_VERSION, only: null });
    expect(r.file.voices).toHaveLength(0);
    expect(r.notes.join('\n')).toMatch(/a: .*足りない/);
    expect(r.notes.join('\n')).toMatch(/b: .*公式ページ/);
  });

  it('一覧にある人だけ。一覧に無い人物ID は知らせる', () => {
    const r = buildOperatorVoices(snap([person('a'), person('b')], [...windows('a', 'v1', twelve), ...windows('b', 'v1', twelve)]), { measureVersion: MEASURE_VERSION, only: new Set(['b', 'zz']) });
    expect(r.file.voices.map((v) => v.name)).toEqual(['名前 b']);
    expect(r.notes.join('\n')).toMatch(/zz: データに無い/);
  });

  it('英語名は書いてある人だけに付ける（同じ人の後の行だけにあってもよい）。所属の英語名は所属ごとに 1 つ。サイトにもそのまま入る', () => {
    const { file } = buildOperatorVoices(
      snap([person('a', { nameEn: ' Name A ', groupEn: 'Group EN' }), person('b'), person('b', { nameEn: 'Name B' }), person('c', { groupName: '別の所属' })], [...windows('a', 'v1', twelve), ...windows('b', 'v1', twelve), ...windows('c', 'v1', twelve)]),
      { measureVersion: MEASURE_VERSION, only: null },
    );
    // b は a と同じ所属なので、所属の英語名も同じ。c は別の所属で、英語名が無い
    expect(file.voices.map((v) => [v.nameEn, v.groupEn])).toEqual([['Name A', 'Group EN'], ['Name B', 'Group EN'], [undefined, undefined]]);
    const site = fromOperatorVoices(file).voices;
    expect(site.map((v) => [v.nameEn, v.groupEn])).toEqual([['Name A', 'Group EN'], ['Name B', 'Group EN'], [undefined, undefined]]);
    // 英語名の無い人は、今までと同じ形（キーも増えない）
    const old = buildOperatorVoices(snap([person('c')], windows('c', 'v1', twelve)), { measureVersion: MEASURE_VERSION, only: null });
    expect(Object.keys(old.file.voices[0]!).sort()).toEqual(['features', 'group', 'link', 'name']);
  });

  it('所属の英語名は、所属をそろえていない人の中でいちばん多い物（同じ数なら人物ID の順で先の人）。ほかの書き方は記録に出す', () => {
    const holo = (id: string, cur: string, groupEn?: string) => person(id, { groupName: 'ホロライブ', currentAffiliation: cur, ...(groupEn ? { groupEn } : {}) });
    const ms = ['a', 'b', 'c', 'd'].flatMap((id) => windows(id, 'v1', twelve));
    // a は「ホロライブ4期生」→「ホロライブ」にそろえた人。b・c はそのままの人。d は英語名なし
    const r = buildOperatorVoices(snap([holo('a', 'ホロライブ4期生', 'hololive 4th Generation'), holo('b', 'ホロライブ', 'hololive production'), holo('c', 'ホロライブ', 'Hololive'), holo('d', 'ホロライブ')], ms), { measureVersion: MEASURE_VERSION, only: null });
    expect(r.file.voices.map((v) => [v.group, v.groupEn])).toEqual(Array(4).fill(['ホロライブ', 'hololive production']));
    expect(r.notes.join('\n')).toMatch(/所属「ホロライブ」の英語名は「hololive production」にそろえます（ほかに 「hololive 4th Generation」「Hololive」）/);
    // そろえた人だけなら、その中でいちばん多い物
    const only = buildOperatorVoices(snap([holo('a', 'ホロライブ4期生', 'X'), holo('b', 'ホロライブ3期生', 'Y'), holo('c', 'ホロライブ5期生', 'Y')], ['a', 'b', 'c'].flatMap((id) => windows(id, 'v1', twelve))), { measureVersion: MEASURE_VERSION, only: null });
    expect(only.file.voices.map((v) => v.groupEn)).toEqual(['Y', 'Y', 'Y']);
  });

  it('同じ人の行がいくつかある時は、項目ごとに空でない最初の値を使う（大枠・公式ページ・今の所属も）', () => {
    const { file } = buildOperatorVoices(
      snap([person('a', { officialProfile: null, kinds: null, currentAffiliation: null }), person('a', { officialProfile: 'https://example.com/a2', kinds: '歌手', currentAffiliation: '今の所属' }), person('a', { officialProfile: 'https://example.com/a3', kinds: 'VTuber', currentAffiliation: '別の所属' })], windows('a', 'v1', twelve)),
      { measureVersion: MEASURE_VERSION, only: null },
    );
    expect(file.voices).toHaveLength(1);
    expect(file.voices[0]).toMatchObject({ link: 'https://example.com/a2', kinds: ['singer'], group: '今の所属' });
  });

  it('今の所属があれば、それを出す', () => {
    const { file } = buildOperatorVoices(snap([person('a', { currentAffiliation: '今の所属' })], windows('a', 'v1', twelve)), { measureVersion: MEASURE_VERSION, only: null });
    expect(file.voices[0]!.group).toBe('今の所属');
  });

  it('測り方の版が違うデータは使わない', () => {
    expect(() => buildOperatorVoices(snap([person('a')], windows('a', 'v1', twelve), '0.0.1'), { measureVersion: MEASURE_VERSION, only: null })).toThrow(/版/);
  });

  it('一覧の読み方: # から後と空の行は無視', () => {
    expect([...parseIdList('a\n\n b # memo\n# all\r\nc')]).toEqual(['a', 'b', 'c']);
  });
});

describe('サイトでのまとめ方', () => {
  const f = Object.fromEntries(FEATURE_KEYS.map((k) => [k, 1])) as never;
  const op = fromOperatorVoices({ version: 1, measureVersion: MEASURE_VERSION, voices: [{ name: 'さくら', link: 'https://example.com/s', features: f }] });
  it('前の元にある声は、後の元では入れない（同じ名前）。版違いと一覧に無い声も入れない', () => {
    const users = {
      voices: [
        { id: 'u-1', name: 'さ くら', links: { profile: 'https://example.com/u1' } },
        { id: 'u-2', name: '別の人', links: { profile: 'https://example.com/u2' } },
        { id: 'u-3', name: '版違い', links: { profile: 'https://example.com/u3' } },
      ],
      profiles: [
        { id: 'u-1', version: MEASURE_VERSION, features: f },
        { id: 'u-2', version: MEASURE_VERSION, features: f },
        { id: 'u-3', version: '0.0.1', features: f },
        { id: 'u-9', version: MEASURE_VERSION, features: f },
      ],
    };
    const m = mergeVoices([op, users], MEASURE_VERSION);
    expect(m.voices.map((v) => v.name)).toEqual(['さくら', '別の人']);
    expect(m.features).toHaveLength(2);
  });
  it('英語名も同じ声の印。前の声の名前か英語名と、後の声の名前か英語名が同じなら入れない', () => {
    const en = fromOperatorVoices({ version: 1, measureVersion: MEASURE_VERSION, voices: [{ name: 'さくら', nameEn: 'Sakura Miko', link: 'https://example.com/s', features: f }] });
    const users = {
      voices: [
        { id: 'u-1', name: 'sakura miko', links: { profile: 'https://example.com/u1' } },
        { id: 'u-2', name: '別の人', nameEn: 'さくら', links: { profile: 'https://example.com/u2' } },
        { id: 'u-3', name: 'Sakura', links: { profile: 'https://example.com/u3' } },
      ],
      profiles: ['u-1', 'u-2', 'u-3'].map((id) => ({ id, version: MEASURE_VERSION, features: f })),
    };
    expect(mergeVoices([en, users], MEASURE_VERSION).voices.map((v) => v.name)).toEqual(['さくら', 'Sakura']);
  });
  it('運営が測った声のファイルの版が今と違う時は、黙って 0 人にせず止める', () => {
    expect(() => checkOperatorVoices({ version: 1, measureVersion: '0.0.1', voices: [] }, MEASURE_VERSION)).toThrow(/版/);
    expect(() => checkOperatorVoices({ version: 1, measureVersion: MEASURE_VERSION, voices: [] }, MEASURE_VERSION)).not.toThrow();
    // 3.1.0 は、声が 500 Hz ほどより高い所だけが違う前の版。そのまま比べてよい（MEASURE_COMPATIBLE）
    expect(() => checkOperatorVoices({ version: 1, measureVersion: '3.1.0', voices: [] }, MEASURE_VERSION)).not.toThrow();
  });
});

describe('画面に出す所属の名前', () => {
  it('調べた時のメモ（かっこの中）を除き、所属区分・個人にそろえる', async () => {
    const { affiliation } = await import('../tools/operator-voices-lib.ts');
    expect(affiliation('ホロライブ（現公式タレント一覧/個人profileの本人欄掲載）', 'ホロライブ')).toBe('ホロライブ');
    expect(affiliation('ホロライブ4期生（2026-11-03公式個人プロフィールおよび本人動画表記）', 'ホロライブ')).toBe('ホロライブ');
    expect(affiliation('.LIVE（アップランド公式所属一覧掲載）', '.LIVE（ドットライブ）')).toBe('.LIVE');
    expect(affiliation('すぺしゃりて（本人の公式個人profile掲載。元所属VEEと区別）', '元VEE')).toBe('すぺしゃりて');
    expect(affiliation('個人勢Vtuber（2026-10-04本人公式の自己申告、10月よりとの記載）', '元VEE')).toBe('個人');
    expect(affiliation('REJECT', '元VEE')).toBe('REJECT');
    expect(affiliation(null, 'にじさんじ')).toBe('にじさんじ');
    expect(affiliation('', '')).toBe('');
  });
});

