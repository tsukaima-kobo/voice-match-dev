// サイトに入れる声のデータを小さくする（詰める・ほどく）。数万件でも、来た人が読む量を小さくするため。
// - 数字: 項目ごとに、全部の声の最小〜最大を 254 段に分け、1 つの数字を 1 バイトにする（255 は「無い」）。
//   段の幅は散らばりのおよそ 1/40 以下なので、照合の結果はほぼ変わらない（test/pack.test.ts で確かめる）。
//   バイトは「項目ごと」に並べる（同じ項目の数字が続くと、配る時の圧縮がよく効く）。文字にするのは base64。
// - 名前など: 声ごとの物を、項目ごとの並び（ID・名前・リンク）にする。所属は 1 回だけ書いて番号で指す。
// 乱数なし。同じデータなら同じ物になる。ここはブラウザーの物にも Node の物にも頼らない（vite.config.ts からも使う）。
import type { CatalogEntry } from './types.ts';

type Features = Record<string, number | null>;

export interface VoicePack {
  /** 形の版 */
  v: 1;
  /** 測り方の版 */
  m: string;
  /** 項目の並び */
  keys: string[];
  /** 項目ごとの最小と、1 段の幅 */
  lo: number[];
  step: number[];
  id: string[];
  name: string[];
  /** 所属の一覧と、声ごとの番号（-1 は無し） */
  groups: string[];
  g: number[];
  link: string[];
  /** 利用者の登録から出した声の番号 */
  users: number[];
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
    const xs = profiles.map((p) => p[k]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    const min = xs.length ? Math.min(...xs) : 0;
    const max = xs.length ? Math.max(...xs) : 0;
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
  const g = voices.map((v) => {
    if (!v.group) return -1;
    let at = groups.indexOf(v.group);
    if (at < 0) at = groups.push(v.group) - 1;
    return at;
  });
  return {
    v: 1,
    m: measureVersion,
    keys,
    lo,
    step,
    id: voices.map((v) => v.id),
    name: voices.map((v) => v.name),
    groups,
    g,
    link: voices.map((v) => v.links.profile),
    users: voices.flatMap((v, i) => (v.by === 'users' ? [i] : [])),
    f: toBase64(bytes),
  };
}

/** ほどく。数字は、段の真ん中の値に戻す（元の数字との差は、1 段の幅の半分まで） */
export function unpackVoices(pack: VoicePack): { voices: CatalogEntry[]; profiles: { id: string; features: Features }[] } {
  const n = pack.id.length;
  const bytes = fromBase64(pack.f);
  if (bytes.length !== pack.keys.length * n) throw new Error('声のデータが壊れています');
  const users = new Set(pack.users);
  const voices: CatalogEntry[] = pack.id.map((id, i) => {
    const gi = pack.g[i] ?? -1;
    return { id, name: pack.name[i]!, ...(gi >= 0 ? { group: pack.groups[gi]! } : {}), links: { profile: pack.link[i]! }, ...(users.has(i) ? { by: 'users' as const } : {}) };
  });
  const profiles = pack.id.map((id, i) => {
    const features: Features = {};
    pack.keys.forEach((k, j) => {
      const b = bytes[j * n + i]!;
      features[k] = b === NONE ? null : pack.lo[j]! + b * pack.step[j]!;
    });
    return { id, features };
  });
  return { voices, profiles };
}
