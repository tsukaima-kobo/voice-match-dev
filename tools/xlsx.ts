// Google スプレッドシートから「ダウンロード → Microsoft Excel (.xlsx)」した物を読む（道具だけで使う。入れる物は増やさない）。
// xlsx は zip の中に XML が入った物。zip をほどき、シート名ごとに「行 × 列」の表にする。
// 数字は、表示の形（% や小数の桁）ではなく、シートに入っている数のまま読む（CSV だと表示の桁に丸まるため）。
import { inflateRawSync } from 'node:zlib';

export type Cell = string | number | null;

/** zip の中のファイル（名前 → 中身） */
function unzip(buf: Buffer): Map<string, Buffer> {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('xlsx（zip）の形ではありません');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('xlsx（zip）が壊れています');
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('xlsx（zip）が壊れています');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, inflateRawSync(raw));
    else throw new Error(`xlsx の中の ${name} が、読めない詰め方です`);
  }
  return files;
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e]!,
  );
}

function attrs(s: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) o[m[1]!] = decode(m[2]!);
  return o;
}

/** <t> の文字をつなぐ（ふりがな <rPh> は除く） */
function texts(xml: string): string {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join('');
}

/** "AB12" の AB → 27（0 から） */
function columnOf(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** シート名ごとの表。行と列は 0 から（シートの 1 行目が [0]）。空のセルは null */
export function readXlsx(buf: Buffer): Map<string, Cell[][]> {
  const files = unzip(buf);
  const text = (name: string) => files.get(name)?.toString('utf8');
  const workbook = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new Error('xlsx の中に、シートの一覧がありません');
  const shared = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!));
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)>/g)) {
    const a = attrs(m[1]!);
    if (a.Id && a.Target) targets.set(a.Id, a.Target.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target}`);
  }
  const out = new Map<string, Cell[][]>();
  for (const m of workbook.matchAll(/<sheet\b([^>]*)>/g)) {
    const a = attrs(m[1]!);
    const xml = text(targets.get(a['r:id'] ?? '') ?? '');
    if (!a.name || xml === undefined) continue;
    const rows: Cell[][] = [];
    let next = 0;
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const ri = attrs(r[1]!).r ? Number(attrs(r[1]!).r) - 1 : next;
      next = ri + 1;
      const row: Cell[] = [];
      let col = 0;
      for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ca = attrs(c[1]!);
        const ci = ca.r ? columnOf(ca.r) : col;
        col = ci + 1;
        const inner = c[2] ?? '';
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let cell: Cell = null;
        if (ca.t === 's') cell = v === undefined ? null : (shared[Number(v)] ?? null);
        else if (ca.t === 'inlineStr') cell = texts(inner);
        else if (ca.t === 'str' || ca.t === 'b') cell = v === undefined ? null : decode(v);
        else if (ca.t !== 'e' && v !== undefined && v !== '') cell = Number(v);
        while (row.length < ci) row.push(null);
        row[ci] = cell;
      }
      rows[ri] = row;
    }
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    out.set(a.name, rows);
  }
  return out;
}
