// 声の登録（アキネーター方式）の試験: 送る内容（壁 ①）、壁 ③、取り込み、CSV。数字は合成音から測る（録音なし）。
import { describe, expect, it } from 'vitest';
import { measureVoice, type Measured } from '../src/voice/measure.ts';
import { type Features } from '../src/voice/features.ts';
import { defaultModel } from '../src/match/match.ts';
import { MEASURE_VERSION } from '../src/voice/measure.ts';
import { checkLink, checkSubmission, CODE_PREFIX, decodeSubmission, encodeSubmission, makeSubmission, nameKey } from '../src/submit/code.ts';
import { consensus } from '../src/submit/consensus.ts';
import { consensusMembers, dayOf, intake, INTAKE, rowsFromTable, userIdOf, type Row } from '../tools/intake-lib.ts';
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
    expect(decodeSubmission('voice-match:{oops')).toBeNull();
    expect(decodeSubmission('voice-match:{"v":2}')).toBeNull();
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
  // 幅の無い空白・つなぎの字・書く向きを変える字・異体字の印・ハングルの埋め字・ソフトハイフン・BOM・点字の空白・制御文字
  const INVISIBLES = ['\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u202a', '\u202e', '\u2060', '\u2064', '\u2066', '\u00ad', '\ufe0f', '\ufe00', '\u3164', '\uffa0', '\u115f', '\u1160', '\u034f', '\u180e', '\u2800', '\u0085', '\u{e0041}'];
  it('見えない文字の入った名前・所属は断る（ページでも取り込みでも同じ壁 ①）', () => {
    for (const c of INVISIBLES) {
      const code = c.codePointAt(0)!.toString(16);
      expect(checkSubmission(sub({ name: `試験${c}のキャラ` })).map((p) => p.kind), code).toContain('name');
      expect(checkSubmission(sub({ group: `試験${c}の作品` })).map((p) => p.kind), code).toContain('group');
    }
    // 見えない文字や記号だけで、比べる形が空になる名前も断る
    expect(checkSubmission(sub({ name: '・！？' })).map((p) => p.kind)).toContain('name');
    // ふつうの空白・絵文字・濁点などはよい
    for (const ok of ['試験 の キャラ', 'キャラ★', 'ガギグゲゴ', '한국어', 'Ünïcödé']) expect(checkSubmission(sub({ name: ok })), ok).toEqual([]);
  });
  it('名前を比べる時は、見えない文字を除く（前のデータとも同じ名前として合う）', () => {
    for (const c of INVISIBLES) expect(nameKey(`試験の${c}キャラ`), c.codePointAt(0)!.toString(16)).toBe(nameKey('試験のキャラ'));
    // 見えない文字が間に入って、濁点がくっつかなかった物も同じ
    expect(nameKey('か\u200b\u3099')).toBe(nameKey('が'));
  });
});

describe('壁 ③', () => {
  const near = [voice(220, 2), voice(222, 3), voice(218, 4)];
  it('合う物が 3 つ要る。その中央値を出す', () => {
    expect(consensus(model, near.slice(0, 2).map((features) => ({ features })))).toBeNull();
    const c = consensus(model, near.map((features) => ({ features })));
    expect(c?.used).toBe(3);
    expect(consensusMembers(model, near.map((features) => ({ features })))).toHaveLength(3);
    expect(c!.features.pitch).toBe(near.map((f) => f.pitch!).sort((x, y) => x - y)[1]);
  });
  it('同じ数字は 1 回と数え、ほかから遠い物は除く', () => {
    expect(consensus(model, [near[0]!, near[0]!, near[0]!].map((features) => ({ features })))).toBeNull();
    const far = { ...near[0]!, pitch: 600, f1: 1200, f2: 3000, hnr: 0, rate: 12, levelRange: 70, tilt: 30, mfcc1: 90, mfcc2: -90 };
    const c = consensus(model, [...near, far].map((features) => ({ features })));
    expect(c?.used).toBe(3);
    // 取り込みが名前などを決める登録（consensusMembers）は、consensus が使った物と同じ
    expect(consensusMembers(model, [...near, far, near[1]!].map((features) => ({ features }))).map((x) => x.features)).toEqual(near);
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
  it('見えない文字で、削除の一覧・禁止の言葉を抜けられない（壁 ① で断る。一覧の側に見えない文字があっても合う）', () => {
    const r = intake(
      rows([
        ['2026/11/03 09:00:00', code(three[0]!, '消された\u200b声'), 'OK'],
        ['2026/11/03 09:00:00', code(three[1]!, 'だめな\u2060ことば入り'), 'OK'],
      ]),
      { model, ngWords: ['だめなことば'], blocked: ['消された声'] },
    );
    expect(r.counts).toMatchObject({ wall1: 2, accepted: 0 });
    // 一覧に書いた名前・言葉に見えない文字が入っていても、同じ名前・言葉として扱う
    const r2 = intake(rows([['2026/11/03 09:00:00', code(three[0]!, '消された声'), 'OK'], ['2026/11/03 09:00:00', code(three[1]!, 'だめなことば入り'), 'OK']]), { model, ngWords: ['だめな\u200bことば'], blocked: ['消された\ufeff声'] });
    expect(r2.counts).toMatchObject({ blocked: 1, ngWord: 1, accepted: 0 });
  });
  it('名前の書き方・所属・大枠・リンクは、壁 ③ でそろった登録だけで決める（外れた登録が同じ数あっても変わらない）', () => {
    // 外れた登録 3 件（上に 2 件・下に 1 件。中央値はそろった 3 件の所のまま）が先に来る。同じ数なら先の物が選ばれるので、全部で数えると負ける
    const off = (dir: 1 | -1, i: number) => ({ ...three[0]!, pitch: dir > 0 ? 600 - i : 60 + i, mfcc1: 95 * dir, mfcc2: -95 * dir, rate: dir > 0 ? 14 : 0.6 });
    const bad = (dir: 1 | -1, i: number) => encodeSubmission(sub({ features: off(dir, i), group: 'いたずら', kinds: 0b100, link: 'https://not-official.example.com/x' }));
    const r = intake(
      rows([
        ['2026/11/04 09:00:00', bad(1, 0), 'OK'],
        ['2026/11/04 09:01:00', bad(-1, 0), 'OK'],
        ['2026/11/04 09:02:00', bad(1, 1), 'OK'],
        ['2026/11/05 09:00:00', code(three[0]!), 'OK'],
        ['2026/11/05 09:01:00', code(three[1]!), 'OK'],
        ['2026/11/05 09:02:00', code(three[2]!), 'OK'],
      ]),
      { model, ngWords: [], blocked: [] },
    );
    expect(r.counts.accepted).toBe(6);
    expect(r.voices).toHaveLength(1);
    expect(r.voices[0]).toMatchObject({ used: 3, group: '試験の作品', kinds: 0b1001, link: 'https://example.com/chara' });
    expect(consensusMembers(model, r.accepted)).toHaveLength(3);
  });
  it('シートを読む: 見出しは飛ばし、列はそのまま', () => {
    const t = parseCsv('タイムスタンプ,送る内容,判定,理由\r\n"2026/11/01 1:00:00","voice-match:{""v"":1}",OK,"よい, とても"\n');
    expect(t[1]).toEqual(['2026/11/01 1:00:00', 'voice-match:{"v":1}', 'OK', 'よい, とても']);
    expect(rowsFromTable(t)).toEqual([{ at: '2026/11/01 1:00:00', code: 'voice-match:{"v":1}', verdict: 'OK', reason: 'よい, とても' }]);
    expect(dayOf('2026/1/2 3:04:05')).toBe('2026-01-02');
    expect(dayOf('?')).toBe('unknown');
  });
  it('タイムスタンプは、Google スプレッドシートのよくある形を読む。読めない行は数えて知らせる', () => {
    for (const [at, day] of [
      ['2026/11/08 12:34:56', '2026-11-08'],
      ['2026-11-08 12:34:56', '2026-11-08'],
      ['2026-11-08T03:04:05Z', '2026-11-08'],
      ['2026.11.8 1:02:03', '2026-11-08'],
      ['2026年11月8日 1:02:03', '2026-11-08'],
      ['11/8/2026 12:34:56', '2026-11-08'],
      ['25/11/2026 12:34:56', '2026-11-25'],
      ['2026/13/01', 'unknown'],
      ['8 Nov 2026', 'unknown'],
    ]) expect(dayOf(at!), at).toBe(day);
    const r = intake([{ at: 'Nov 8, 2026', code: code(three[0]!), verdict: 'OK', reason: '' }], { model, ngWords: [], blocked: [] });
    expect(r.counts).toMatchObject({ unknownDay: 1, accepted: 1 });
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
