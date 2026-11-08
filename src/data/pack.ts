// サイトに入れる声のデータを小さくする（詰める・ほどく）。数万件でも、来た人が読む量を小さくするため。
// - 数字: 項目ごとに、全部の声の最小〜最大を 254 段に分け、1 つの数字を 1 バイトにする（255 は「無い」）。
//   段の幅は散らばりのおよそ 1/40 以下なので、照合の結果はほぼ変わらない（test/pack.test.ts で確かめる）。
//   バイトは「項目ごと」に並べる（同じ項目の数字が続くと、配る時の圧縮がよく効く）。文字にするのは base64。
// - 名前など: 声ごとの物を、項目ごとの並び（名前・リンク）にする。所属は 1 回だけ書いて番号で指す。
//   英語の名前は、誰か 1 人でもある時だけ、名前と同じ並び（無い人は空）で入れる。所属の英語の名前も、所属と同じ並びで。
//   所属の英語の名前は所属ごとに 1 つ: その所属の声に付いている英語の名前のうち、いちばん多い物（同じ数なら先に出た物）。
//   大枠（src/data/kinds.ts）は、声ごとに 16 個の印を 1 つの数（0〜65535）にする。
// - 入れるのは、名前（あれば英語名も）・所属・大枠・公式ページ・数字だけ（「しくみと約束」の 05 のとおり）。ID は入れない。
//   ほどいた後の ID は、ページの中だけの番号（"0"・"1"…）。データが変わると変わるので、リンクには名前を使う。
// 乱数なし。同じデータなら同じ物になる。ここはブラウザーの物にも Node の物にも頼らない（vite.config.ts からも使う）。
import type { CatalogEntry } from './types.ts';
import { idsOf, maskOf } from './kinds.ts';

type Features = Record<string, number | null>;

export interface VoicePack {
  /** 形の版 */
  v: 3;
  /** 測り方の版 */
  m: string;
  /** 項目の並び */
  keys: string[];
  /** 項目ごとの最小と、1 段の幅 */
  lo: number[];
  step: number[];
  name: string[];
  /** 英語の名前（name と同じ並び。空は無し）。誰にも無ければ入れない */
  nameEn?: string[];
  /** 所属の一覧と、声ごとの番号（-1 は無し） */
  groups: string[];
  /** 所属の英語の名前（groups と同じ並び。空は無し）。どこにも無ければ入れない */
  groupsEn?: string[];
  g: number[];
  /** 大枠の印（声ごと。0 は無し） */
  k: number[];
  link: string[];
  /** 数字（項目ごと × 声ごと、1 バイトずつ、base64） */
  f: string;
}

const LEVELS = 254;
const NONE = 255;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < b.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < b.length ? B64[n & 63]! : '=');
  }
  return s;
}
function fromBase64(s: string): Uint8Array {
  const map = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) map[B64.charCodeAt(i)] = i;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = (map[s.charCodeAt(i)]! << 18) | (map[s.charCodeAt(i + 1)]! << 12) | (Math.max(0, map[s.charCodeAt(i + 2)]!) << 6) | Math.max(0, map[s.charCodeAt(i + 3)]!);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** 詰める。voices と profiles は同じ並び（profiles[i] が voices[i] の数字） */
export function packVoices(measureVersion: string, voices: readonly CatalogEntry[], profiles: readonly Features[]): VoicePack {
  if (voices.length !== profiles.length) throw new Error('声の数と数字の数が合いません');
  const keys: string[] = [];
  for (const p of profiles) for (const k of Object.keys(p)) if (!keys.includes(k)) keys.push(k);
  const n = voices.length;
  const bytes = new Uint8Array(keys.length * n).fill(NONE);
  const lo: number[] = [];
  const step: number[] = [];
  keys.forEach((k, j) => {
    // Math.min(...xs) は、声が十数万になると呼び出しの深さがあふれるので、1 つずつ見る
    let min = Infinity;
    let max = -Infinity;
    for (const p of profiles) {
      const x = p[k];
      if (typeof x !== 'number' || !Number.isFinite(x)) continue;
      if (x < min) min = x;
      if (x > max) max = x;
    }
    if (min > max) min = max = 0;
    const s = max > min ? (max - min) / LEVELS : 0;
    lo.push(min);
    step.push(s);
    profiles.forEach((p, i) => {
      const x = p[k];
      if (typeof x !== 'number' || !Number.isFinite(x)) return;
      bytes[j * n + i] = s > 0 ? Math.min(LEVELS, Math.max(0, Math.round((x - min) / s))) : 0;
    });
  });
  const groups: string[] = [];
  const groupAt = new Map<string, number>();
  /** 所属ごとの、英語の名前と付いていた数（出た順） */
  const enVotes: Map<string, number>[] = [];
  const g = voices.map((v) => {
    if (!v.group) return -1;
    let at = groupAt.get(v.group);
    if (at === undefined) {
      at = groups.push(v.group) - 1;
      groupAt.set(v.group, at);
      enVotes.push(new Map());
    }
    if (v.groupEn) enVotes[at]!.set(v.groupEn, (enVotes[at]!.get(v.groupEn) ?? 0) + 1);
    return at;
  });
  const groupsEn = enVotes.map((votes) => {
    let best = '';
    let bestN = 0;
    for (const [en, n] of votes) if (n > bestN) [best, bestN] = [en, n];
    return best;
  });
  const nameEn = voices.map((v) => v.nameEn ?? '');
  return {
    v: 3,
    m: measureVersion,
    keys,
    lo,
    step,
    name: voices.map((v) => v.name),
    ...(nameEn.some(Boolean) ? { nameEn } : {}),
    groups,
    ...(groupsEn.some(Boolean) ? { groupsEn } : {}),
    g,
    k: voices.map((v) => maskOf(v.kinds ?? [])),
    link: voices.map((v) => v.links.profile),
    f: toBase64(bytes),
  };
}

/** ほどく。数字は、段の真ん中の値に戻す（元の数字との差は、1 段の幅の半分まで）。ID はページの中だけの番号。kinds は大枠の印 */
export function unpackVoices(pack: VoicePack): { voices: CatalogEntry[]; profiles: { id: string; features: Features; kinds: number }[] } {
  const n = pack.name.length;
  const bytes = fromBase64(pack.f);
  if (bytes.length !== pack.keys.length * n || pack.link.length !== n || (pack.nameEn && pack.nameEn.length !== n)) throw new Error('声のデータが壊れています');
  const ids = pack.name.map((_, i) => String(i));
  const voices: CatalogEntry[] = ids.map((id, i) => {
    const gi = pack.g[i] ?? -1;
    const kinds = idsOf(pack.k?.[i] ?? 0);
    const nameEn = pack.nameEn?.[i];
    const groupEn = gi >= 0 ? pack.groupsEn?.[gi] : undefined;
    return {
      id,
      name: pack.name[i]!,
      ...(nameEn ? { nameEn } : {}),
      ...(gi >= 0 ? { group: pack.groups[gi]! } : {}),
      ...(groupEn ? { groupEn } : {}),
      ...(kinds.length ? { kinds } : {}),
      links: { profile: pack.link[i]! },
    };
  });
  const profiles = ids.map((id, i) => {
    const features: Features = {};
    pack.keys.forEach((k, j) => {
      const b = bytes[j * n + i]!;
      features[k] = b === NONE ? null : pack.lo[j]! + b * pack.step[j]!;
    });
    return { id, features, kinds: pack.k?.[i] ?? 0 };
  });
  return { voices, profiles };
}
