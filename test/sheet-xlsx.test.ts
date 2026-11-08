// スプレッドシートの xlsx を読む（tools/xlsx.ts）と、運営が測った声の元にする（tools/operator-voices-lib.ts の snapshotFromSheet）
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readXlsx, type Cell } from '../tools/xlsx.ts';
import { buildOperatorVoices, sheetLabel, snapshotFromSheet } from '../tools/operator-voices-lib.ts';
import { FEATURE_KEYS } from '../src/voice/features.ts';
import { MEASURE_VERSION } from '../src/voice/measure.ts';

/** 小さな zip を作る（試験用。CRC は読む側が見ないので 0） */
function zip(files: Record<string, string>, deflate: (name: string) => boolean): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const raw = Buffer.from(body, 'utf8');
    const packed = deflate(name) ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate(name) ? 8 : 0, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(deflate(name) ? 8 : 0, 10);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    parts.push(local, n, packed);
    central.push(c, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const col = (i: number) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** 表（シート名 → 行）から xlsx を作る。文字は shared strings、数字はそのまま。上に 5 行の説明を置く（本物と同じ） */
function xlsx(tables: Record<string, Cell[][]>): Buffer {
  const shared: string[] = [];
  const sid = (s: string) => (shared.includes(s) ? shared.indexOf(s) : shared.push(s) - 1);
  const files: Record<string, string> = {};
  const names = Object.keys(tables);
  names.forEach((name, i) => {
    const rows = [[`データ更新：試験`], [], [], [], [], ...tables[name]!];
    const xml = rows
      .map((r, ri) =>
        r.length
          ? `<row r="${ri + 1}">${r
              .map((c, ci) => (c === null ? '' : typeof c === 'number' ? `<c r="${col(ci)}${ri + 1}" s="2"><v>${c}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${sid(c)}</v></c>`))
              .join('')}</row>`
          : `<row r="${ri + 1}"/>`,
      )
      .join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<?xml version="1.0"?><worksheet><sheetData>${xml}</sheetData></worksheet>`;
  });
  files['xl/workbook.xml'] = `<workbook><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;
  files['xl/sharedStrings.xml'] = `<sst>${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`;
  return zip(files, (n) => n.endsWith('sheet1.xml') || n.includes('shared'));
}

const PEOPLE_HEAD = ['人物ID', '氏名', '所属区分ID', '所属区分', '現在所属', '出典動画ID', '公式プロフィール'];
const MEASURE_HEAD = ['人物ID', '氏名', '所属区分ID', '所属区分', '出典動画ID', '出典動画URL', '測定区間の開始秒', '測定区間の終了秒', ...FEATURE_KEYS.map(sheetLabel)];
/** 画面では % で出す項目（シートの数は比率のまま） */
const RATIO = FEATURE_KEYS.find((k) => sheetLabel(k).endsWith('(%)'))!;
function measureRow(id: string, video: string, pitch: number | null): Cell[] {
  return [id, `名前 ${id}`, 'g', '所属区分', video, `https://www.youtube.com/watch?v=${video}`, 0, 30, ...FEATURE_KEYS.map((k) => (k === 'pitch' ? pitch : k === RATIO ? 0.123 : 1.5))];
}

describe('スプレッドシートの xlsx を読む', () => {
  it('文字・数字・空のセル・飛んだ列を、シートの位置のまま読む。& などの記号も戻す', () => {
    const t = readXlsx(xlsx({ 'A & B': [['人物ID', null, 3.25, 'x<y']] }));
    expect([...t.keys()]).toEqual(['A & B']);
    expect(t.get('A & B')![5]).toEqual(['人物ID', null, 3.25, 'x<y']);
    expect(t.get('A & B')![1]).toEqual([]);
  });

  it('ふりがな付きの文字・その場の文字（inlineStr）も読める', () => {
    const files = {
      'xl/workbook.xml': '<workbook><sheets><sheet name="s" sheetId="1" r:id="r1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="/xl/worksheets/a.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><r><t>葛</t></r><r><t>葉</t></r><rPh sb="0" eb="2"><t>クズハ</t></rPh></si></sst>',
      'xl/worksheets/a.xml': '<worksheet><sheetData><row r="2"><c r="B2" t="s"><v>0</v></c><c r="C2" t="inlineStr"><is><t>その場</t></is></c></row></sheetData></worksheet>',
    };
    const t = readXlsx(zip(files, () => false)).get('s')!;
    expect(t[1]).toEqual([null, '葛葉', 'その場']);
  });

  it('xlsx でない物は止める', () => {
    expect(() => readXlsx(Buffer.from('not a zip'))).toThrow(/zip/);
  });
});

describe('シートから、運営が測った声の代表値を作る', () => {
  const pitches = Array.from({ length: 12 }, (_, i) => 200 + i);
  const people: Cell[][] = [PEOPLE_HEAD, ['a', '名前 a', 'g', '所属区分', '今の所属', 'v1', 'https://example.com/a'], ['a', '名前 a', 'g', '所属区分', '今の所属', 'v2', 'https://example.com/a'], ['b', '名前 b', 'g', '所属区分', null, 'v1', null]];
  const rows: Cell[][] = [MEASURE_HEAD, ...pitches.map((p, i) => measureRow('a', i < 6 ? 'v1' : 'v2', p)), measureRow('a', 'v2', null), ...pitches.map((p) => measureRow('b', 'v1', p))];

  it('人物一覧と声の測定値から、名前・所属・公式ページ・数字を作る（比率の項目も、数のまま）', () => {
    const snap = snapshotFromSheet(readXlsx(xlsx({ 人物一覧: people, 声の測定値: rows, 項目の説明: [['特徴量キー']] })), MEASURE_VERSION);
    expect(snap.peoples).toHaveLength(3);
    expect(snap.measurements).toHaveLength(25);
    const { file, notes } = buildOperatorVoices(snap, { measureVersion: MEASURE_VERSION, only: null });
    expect(file.voices).toHaveLength(1);
    const v = file.voices[0]!;
    expect(v).toMatchObject({ name: '名前 a', group: '今の所属', link: 'https://example.com/a' });
    expect(v.features.pitch).toBeCloseTo(205.5, 1);
    expect(RATIO).toBeTruthy();
    expect(v.features[RATIO]).toBeCloseTo(0.123, 2);
    expect(notes.join('\n')).toMatch(/a: 窓 12 → 使う 12.*動画 2 本/);
    expect(notes.join('\n')).toMatch(/b: .*公式ページ/);
  });

  it('追加10分の測定値のタブがあれば、同じ人の窓に足す（見出しは人物ID で始まらなくてよい）。版が違えば止める', () => {
    const EXTRA_HEAD = ['追加タスクID', '人物ID', '追加動画ID', '測定バージョン', ...FEATURE_KEYS.map(sheetLabel)];
    const extraRow = (id: string, video: string, pitch: number, ver = MEASURE_VERSION): Cell[] => ['task', id, video, ver, ...measureRow(id, video, pitch).slice(8)];
    // c は元の窓が 6 つで足りない。追加の 6 窓で 12 になり、入る
    const few: Cell[][] = [MEASURE_HEAD, ...pitches.slice(0, 6).map((p) => measureRow('c', 'v1', p))];
    const ppl: Cell[][] = [PEOPLE_HEAD, ['c', '名前 c', 'g', '所属区分', '今の所属', 'v1', 'https://example.com/c']];
    const before = buildOperatorVoices(snapshotFromSheet(readXlsx(xlsx({ 人物一覧: ppl, 声の測定値: few })), MEASURE_VERSION), { measureVersion: MEASURE_VERSION, only: null });
    expect(before.file.voices).toHaveLength(0);
    const extra: Cell[][] = [EXTRA_HEAD, ...pitches.slice(6).map((p) => extraRow('c', 'x1', p))];
    const after = buildOperatorVoices(snapshotFromSheet(readXlsx(xlsx({ 人物一覧: ppl, 声の測定値: few, 追加10分の測定値: extra })), MEASURE_VERSION), { measureVersion: MEASURE_VERSION, only: null });
    expect(after.file.voices).toHaveLength(1);
    expect(after.notes.join('\n')).toMatch(/c: 窓 12 → 使う 12.*動画 2 本/);
    const old: Cell[][] = [EXTRA_HEAD, extraRow('c', 'x1', 200, '0.0.1')];
    expect(() => snapshotFromSheet(readXlsx(xlsx({ 人物一覧: ppl, 声の測定値: few, 追加10分の測定値: old })), MEASURE_VERSION)).toThrow(/版/);
  });

  it('タブ・見出しが足りない時は止める（項目が今のサイトと違う時など）', () => {
    expect(() => snapshotFromSheet(readXlsx(xlsx({ 人物一覧: people })), MEASURE_VERSION)).toThrow(/声の測定値/);
    const old = [MEASURE_HEAD.slice(0, -1), ...rows.slice(1)];
    expect(() => snapshotFromSheet(readXlsx(xlsx({ 人物一覧: people, 声の測定値: old })), MEASURE_VERSION)).toThrow(/無い見出し/);
  });
});
