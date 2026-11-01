// 声の登録（アキネーター方式）の試験: 送る内容（壁 ①）、壁 ③、取り込み、CSV。数字は合成音から測る（録音なし）。
import { describe, expect, it } from 'vitest';
import { measureVoice, type Measured } from '../src/voice/measure.ts';
import { type Features } from '../src/voice/features.ts';
import { defaultModel } from '../src/match/match.ts';
import { MEASURE_VERSION } from '../src/voice/measure.ts';
import { checkLink, checkSubmission, decodeSubmission, encodeSubmission, makeSubmission, nameKey } from '../src/submit/code.ts';
import { consensus } from '../src/submit/consensus.ts';
import { dayOf, intake, INTAKE, rowsFromTable, type Row } from '../tools/intake-lib.ts';
import { parseCsv } from '../tools/csv.ts';
import { bursts, concat, silence, vowel } from './voice-synth.ts';

const R = 16000;
const model = defaultModel(MEASURE_VERSION);
const talk = bursts(5, { share: 0.8, floor: 0.3, group: 7, pause: 0.4 });
const voice = (f0: number, seed: number): Features => {
  const m: Measured = measureVoice(concat(silence(R, 0.5), vowel({ rate: R, seconds: 12, f0: (t) => f0 * 2 ** ((2 * Math.sin(t * 1.3)) / 12), jitter: 0.008, shimmer: 0.03, breath: 0.02, envelope: talk, seed }), silence(R, 0.5)), R, { minVoicedSeconds: 8 });
  if (!m.ok) throw new Error(m.reason);
  return m.features;
};
const A = voice(220, 1);
const quality = { voicedSeconds: 11.2, gapTonal: 0.02, snrDb: 40 };
const sub = (o: Partial<Parameters<typeof makeSubmission>[0]> = {}) => makeSubmission({ name: '試験のキャラ', group: '試験の作品', link: 'https://example.com/chara', source: 'tab', quality, features: A, consent: true, ...o });

describe('送る内容と壁 ①', () => {
  it('goes there and back, and a good one has no problems', () => {
    const s = sub();
    const back = decodeSubmission(`  ${encodeSubmission(s)}\n`);
    expect(back).toEqual(s);
    expect(checkSubmission(back!)).toEqual([]);
  });
  it('reads nothing that is not one', () => {
    expect(decodeSubmission('hello')).toBeNull();
    expect(decodeSubmission('voice-twin:{oops')).toBeNull();
    expect(decodeSubmission('voice-twin:{"v":2}')).toBeNull();
  });
  it('turns away a missing consent, a bad name, a bad link, a poor recording', () => {
    const kinds = (s: ReturnType<typeof sub>) => checkSubmission(s).map((p) => p.kind);
    expect(kinds(sub({ consent: false }))).toContain('consent');
    expect(kinds(sub({ name: '' }))).toContain('name');
    expect(kinds(sub({ name: 'https://spam.example' }))).toContain('name');
    expect(kinds(sub({ link: 'http://example.com' }))).toContain('link');
    expect(kinds(sub({ quality: { ...quality, voicedSeconds: 5 } }))).toContain('quality');
    expect(kinds(sub({ quality: { ...quality, gapTonal: 0.6 } }))).toContain('quality');
  });
  it('turns away numbers no voice has, numbers our measuring cannot give, and formants out of order', () => {
    expect(checkSubmission(sub({ features: { ...A, pitch: 5000 } })).map((p) => p.kind)).toContain('range');
    expect(checkSubmission(sub({ features: { ...A, pitch: 220.123456 } })).map((p) => p.kind)).toContain('range');
    expect(checkSubmission(sub({ features: { ...A, f2: 300, f1: 900 } })).map((p) => p.kind)).toContain('order');
    expect(checkSubmission(sub({ features: { ...A, pitch: null } })).map((p) => p.kind)).toContain('missing');
    const old = { ...sub(), m: '2.0.0' };
    expect(checkSubmission(old).map((p) => p.kind)).toContain('version');
  });
  it('takes official-looking https links only', () => {
    expect(checkLink('https://www.example.co.jp/talent/a')).toBeNull();
    for (const bad of ['ftp://example.com', 'https://user:pw@example.com', 'https://127.0.0.1/', 'https://bit.ly/abc', 'https://localhost/', 'not a url', '']) expect(checkLink(bad), bad).not.toBeNull();
  });
  it('puts names written a little differently together', () => {
    expect(nameKey('試験 の・キャラ！')).toBe(nameKey('試験のキャラ'));
    expect(nameKey('ＡＢＣ')).toBe(nameKey('abc'));
  });
});

describe('壁 ③', () => {
  const near = [voice(220, 2), voice(222, 3), voice(218, 4)];
  it('needs 3 that agree, and gives their median', () => {
    expect(consensus(model, near.slice(0, 2).map((features) => ({ features })))).toBeNull();
    const c = consensus(model, near.map((features) => ({ features })));
    expect(c?.used).toBe(3);
    expect(c!.features.pitch).toBe(near.map((f) => f.pitch!).sort((x, y) => x - y)[1]);
  });
  it('counts the same numbers once, and leaves out one far from the rest', () => {
    expect(consensus(model, [near[0]!, near[0]!, near[0]!].map((features) => ({ features })))).toBeNull();
    const far = { ...near[0]!, pitch: 600, f1: 1200, f2: 3000, hnr: 0, rate: 12, levelRange: 70, tilt: 30, mfcc1: 90, mfcc2: -90 };
    const c = consensus(model, [...near, far].map((features) => ({ features })));
    expect(c?.used).toBe(3);
  });
});

describe('取り込み', () => {
  const code = (f: Features, name = '試験のキャラ') => encodeSubmission(sub({ features: f, name }));
  const rows = (list: [string, string, string][]): Row[] => list.map(([at, c, verdict]) => ({ at, code: c, verdict, reason: '' }));
  const three = [voice(220, 2), voice(222, 3), voice(218, 4)];
  it('uses only rows dots marked OK, and makes a voice from 3 that agree, with a lasting ID', () => {
    const r = intake(
      rows([
        ['2026/11/01 10:00:00', code(three[0]!), 'OK'],
        ['2026/11/01 10:05:00', code(three[1]!), 'NG'],
        ['2026/11/01 10:06:00', code(three[1]!), ''],
        ['2026/11/02 09:00:00', code(three[1]!, '試験の キャラ'), 'ok'],
        ['2026/11/02 09:30:00', code(three[2]!), 'OK'],
      ]),
      { model, ngWords: [], blocked: [], ids: { 'べつのこえ': 'u-0007' } },
    );
    expect(r.counts).toMatchObject({ rows: 5, judgedNg: 1, pending: 1, accepted: 3 });
    expect(r.voices).toHaveLength(1);
    expect(r.voices[0]).toMatchObject({ id: 'u-0008', name: '試験のキャラ', link: 'https://example.com/chara', used: 3 });
    expect(r.ids[nameKey('試験のキャラ')]).toBe('u-0008');
  });
  it('drops blocked names, banned words, the same numbers again, and more than the daily limit for a name', () => {
    const many = Array.from({ length: INTAKE.perNamePerDay + 2 }, (_, i): [string, string, string] => ['2026/11/03 10:00:00', code(voice(200 + i, 10 + i), 'たくさん'), 'OK']);
    const r = intake(
      rows([
        ['2026/11/03 09:00:00', code(three[0]!, '消された声'), 'OK'],
        ['2026/11/03 09:00:00', code(three[0]!, 'だめなことば入り'), 'OK'],
        ['2026/11/03 09:00:00', code(three[0]!), 'OK'],
        ['2026/11/03 09:01:00', code(three[0]!), 'OK'],
        ...many,
      ]),
      { model, ngWords: ['だめなことば'], blocked: ['消された 声'], ids: {} },
    );
    expect(r.counts).toMatchObject({ blocked: 1, ngWord: 1, duplicate: 1, overName: 2 });
  });
  it('reads the sheet: skips the header, keeps the columns', () => {
    const t = parseCsv('タイムスタンプ,送る内容,判定,理由\r\n"2026/11/01 1:00:00","voice-twin:{""v"":1}",OK,"よい, とても"\n');
    expect(t[1]).toEqual(['2026/11/01 1:00:00', 'voice-twin:{"v":1}', 'OK', 'よい, とても']);
    expect(rowsFromTable(t)).toEqual([{ at: '2026/11/01 1:00:00', code: 'voice-twin:{"v":1}', verdict: 'OK', reason: 'よい, とても' }]);
    expect(dayOf('2026/1/2 3:04:05')).toBe('2026-01-02');
    expect(dayOf('?')).toBe('unknown');
  });
});
