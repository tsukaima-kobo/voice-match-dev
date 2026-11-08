// 声の登録（アキネーター方式）の試験: 送る内容（壁 ①）、壁 ③、取り込み、CSV。数字は合成音から測る（録音なし）。
import { describe, expect, it } from 'vitest';
import { measureVoice, type Measured } from '../src/voice/measure.ts';
import { type Features } from '../src/voice/features.ts';
import { defaultModel } from '../src/match/match.ts';
import { MEASURE_VERSION } from '../src/voice/measure.ts';
import { checkLink, checkSubmission, CODE_PREFIX, decodeSubmission, encodeSubmission, makeSubmission, nameKey } from '../src/submit/code.ts';
import { consensus } from '../src/submit/consensus.ts';
import { dayOf, intake, INTAKE, rowsFromTable, userIdOf, type Row } from '../tools/intake-lib.ts';
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
const sub = (o: Partial<Parameters<typeof makeSubmission>[0]> = {}) => makeSubmission({ name: '試験のキャラ', group: '試験の作品', kinds: 0b1001, link: 'https://example.com/chara', quality, features: A, consent: true, ...o });

describe('送る内容と壁 ①', () => {
  it('書き出して読み戻すと同じ。よい物には問題が無い', () => {
    const s = sub();
    const back = decodeSubmission(`  ${encodeSubmission(s)}\n`);
    expect(back).toEqual(s);
    expect(checkSubmission(back!)).toEqual([]);
  });
  it('送る内容でない物は読まない', () => {
    expect(decodeSubmission('hello')).toBeNull();
    expect(decodeSubmission('voice-twin:{oops')).toBeNull();
    expect(decodeSubmission('voice-twin:{"v":2}')).toBeNull();
  });
  it('同意なし・よくない名前・よくないリンク・質の悪い録音は断る', () => {
    const kinds = (s: ReturnType<typeof sub>) => checkSubmission(s).map((p) => p.kind);
    expect(kinds(sub({ consent: false }))).toContain('consent');
    expect(kinds(sub({ kinds: 0 }))).toContain('kinds');
    expect(kinds(sub({ kinds: 1 << 12 }))).toContain('kinds');
    expect(kinds(sub({ name: '' }))).toContain('name');
    expect(kinds(sub({ name: 'https://spam.example' }))).toContain('name');
    expect(kinds(sub({ link: 'http://example.com' }))).toContain('link');
    expect(kinds(sub({ quality: { ...quality, voicedSeconds: 5 } }))).toContain('quality');
    expect(kinds(sub({ quality: { ...quality, gapTonal: 0.6 } }))).toContain('quality');
  });
  it('どの声にも無い数字・こちらの測り方では出ない数字・順番の狂ったフォルマントは断る', () => {
    expect(checkSubmission(sub({ features: { ...A, pitch: 5000 } })).map((p) => p.kind)).toContain('range');
    expect(checkSubmission(sub({ features: { ...A, pitch: 220.123456 } })).map((p) => p.kind)).toContain('range');
    expect(checkSubmission(sub({ features: { ...A, f2: 300, f1: 900 } })).map((p) => p.kind)).toContain('order');
    expect(checkSubmission(sub({ features: { ...A, pitch: null } })).map((p) => p.kind)).toContain('missing');
    const old = { ...sub(), m: '2.0.0' };
    expect(checkSubmission(old).map((p) => p.kind)).toContain('version');
  });
  it('公式らしい https のリンクだけ受ける', () => {
    expect(checkLink('https://www.example.co.jp/talent/a')).toBeNull();
    for (const bad of ['ftp://example.com', 'https://user:pw@example.com', 'https://127.0.0.1/', 'https://bit.ly/abc', 'https://localhost/', 'not a url', '']) expect(checkLink(bad), bad).not.toBeNull();
  });
  it('少し違う書き方の名前を、同じ物にまとめる', () => {
    expect(nameKey('試験 の・キャラ！')).toBe(nameKey('試験のキャラ'));
    expect(nameKey('ＡＢＣ')).toBe(nameKey('abc'));
  });
});

describe('壁 ③', () => {
  const near = [voice(220, 2), voice(222, 3), voice(218, 4)];
  it('合う物が 3 つ要る。その中央値を出す', () => {
    expect(consensus(model, near.slice(0, 2).map((features) => ({ features })))).toBeNull();
    const c = consensus(model, near.map((features) => ({ features })));
    expect(c?.used).toBe(3);
    expect(c!.features.pitch).toBe(near.map((f) => f.pitch!).sort((x, y) => x - y)[1]);
  });
  it('同じ数字は 1 回と数え、ほかから遠い物は除く', () => {
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
  it('dots が OK を付けた行だけ使い、合う 3 つから声を作る。ID は名前から', () => {
    const r = intake(
      rows([
        ['2026/11/01 10:00:00', code(three[0]!), 'OK'],
        ['2026/11/01 10:05:00', code(three[1]!), 'NG'],
        ['2026/11/01 10:06:00', code(three[1]!), ''],
        ['2026/11/02 09:00:00', code(three[1]!, '試験の キャラ'), 'ok'],
        ['2026/11/02 09:30:00', code(three[2]!), 'OK'],
      ]),
      { model, ngWords: [], blocked: [] },
    );
    expect(r.counts).toMatchObject({ rows: 5, judgedNg: 1, pending: 1, accepted: 3 });
    expect(r.voices).toHaveLength(1);
    expect(r.voices[0]).toMatchObject({ id: userIdOf(nameKey('試験のキャラ')), name: '試験のキャラ', kinds: 0b1001, link: 'https://example.com/chara', used: 3 });
    // 少し違う書き方でも同じ名前なら、どの日も同じ ID。別の名前なら別の ID
    expect(userIdOf(nameKey('試験の キャラ'))).toBe(r.voices[0]!.id);
    expect(userIdOf(nameKey('べつのこえ'))).not.toBe(r.voices[0]!.id);
    expect(r.voices[0]!.id).toMatch(/^u-[0-9a-z]{11}$/);
  });
  it('止めた名前・使えない言葉・前と同じ数字・1 つの名前で 1 日の上限を超えた分は除く', () => {
    const many = Array.from({ length: INTAKE.perNamePerDay + 2 }, (_, i): [string, string, string] => ['2026/11/03 10:00:00', code(voice(200 + i, 10 + i), 'たくさん'), 'OK']);
    const r = intake(
      rows([
        ['2026/11/03 09:00:00', code(three[0]!, '消された声'), 'OK'],
        ['2026/11/03 09:00:00', code(three[0]!, 'だめなことば入り'), 'OK'],
        ['2026/11/03 09:00:00', code(three[0]!), 'OK'],
        ['2026/11/03 09:01:00', code(three[0]!), 'OK'],
        ...many,
      ]),
      { model, ngWords: ['だめなことば'], blocked: ['消された 声'] },
    );
    expect(r.counts).toMatchObject({ blocked: 1, ngWord: 1, duplicate: 1, overName: 2 });
  });
  it('シートを読む: 見出しは飛ばし、列はそのまま', () => {
    const t = parseCsv('タイムスタンプ,送る内容,判定,理由\r\n"2026/11/01 1:00:00","voice-twin:{""v"":1}",OK,"よい, とても"\n');
    expect(t[1]).toEqual(['2026/11/01 1:00:00', 'voice-twin:{"v":1}', 'OK', 'よい, とても']);
    expect(rowsFromTable(t)).toEqual([{ at: '2026/11/01 1:00:00', code: 'voice-twin:{"v":1}', verdict: 'OK', reason: 'よい, とても' }]);
    expect(dayOf('2026/1/2 3:04:05')).toBe('2026-01-02');
    expect(dayOf('?')).toBe('unknown');
  });
});

describe('送る内容に入る物', () => {
  it('数字・名前・所属・大枠・公式ページ・測り方と声の質・同意だけ（お手本の聞かせ方は入れない）', () => {
    expect(Object.keys(sub()).sort()).toEqual(['f', 'g', 'k', 'l', 'm', 'n', 'ok', 'q', 'v']);
  });
  it('前の形（聞かせ方 s が入った物）も読める。s は使わない', () => {
    const old = { ...sub(), s: 'mic' };
    expect(decodeSubmission(CODE_PREFIX + JSON.stringify(old))?.n).toBe('試験のキャラ');
  });
});

describe('登録の大枠', () => {
  it('そろった登録の半分以上が選んだ大枠だけを付ける', async () => {
    const { majorityKinds } = await import('../tools/intake-lib.ts');
    // VTuber は 3 つとも、歌手は 2 つ、声優は 1 つ
    expect(majorityKinds([0b101, 0b101, 0b1001])).toBe(0b101);
    expect(majorityKinds([0b1, 0b10])).toBe(0b11);
    expect(majorityKinds([])).toBe(0);
  });
});
