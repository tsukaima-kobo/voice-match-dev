// 大枠（VTuber・歌手などの分類）。1 つの声に、いくつでも付けられる。来た人は「VTuber の中で」「歌手の中で」のように絞り込んで探せる。
// 番号（bit）は 16 個の印の何番目か。データ（サイトのデータ・登録の送る内容）に番号で入るので、並べ替えない・消さない・使い回さない。
// 10〜14 は予備（新しい大枠はここに足す）。15 は「その他」。DOM なし・乱数なし。
import { t } from '../i18n.ts';

export const KINDS = [
  { id: 'vtuber', bit: 0, ja: 'VTuber', en: 'VTuber' },
  { id: 'streamer', bit: 1, ja: '配信者・YouTuber', en: 'Streamer / YouTuber' },
  { id: 'singer', bit: 2, ja: '歌手', en: 'Singer' },
  { id: 'voice-actor', bit: 3, ja: '声優', en: 'Voice actor' },
  { id: 'actor', bit: 4, ja: '俳優', en: 'Actor' },
  { id: 'comedian', bit: 5, ja: 'お笑い', en: 'Comedian' },
  { id: 'idol', bit: 6, ja: 'アイドル', en: 'Idol' },
  { id: 'announcer', bit: 7, ja: 'アナウンサー・ナレーター', en: 'Announcer / narrator' },
  { id: 'anime', bit: 8, ja: 'アニメのキャラ', en: 'Anime character' },
  { id: 'game', bit: 9, ja: 'ゲームのキャラ', en: 'Game character' },
  { id: 'other', bit: 15, ja: 'その他', en: 'Other' },
] as const;

export type Kind = (typeof KINDS)[number];
export type KindId = Kind['id'];

/** 16 個の印のうち、使ってよい物（予備の印は入れない） */
export const KIND_BITS_ALL = KINDS.reduce((m, k) => m | (1 << k.bit), 0);

export const KIND_BY_ID: ReadonlyMap<string, Kind> = new Map(KINDS.map((k) => [k.id, k]));

/** 大枠の名前（今の言葉で） */
export const kindLabel = (k: Kind): string => t(k.ja, k.en);

/** 印の束（16 ビットの数）から、大枠の一覧（KINDS の順） */
export const kindsOf = (mask: number): Kind[] => KINDS.filter((k) => (mask & (1 << k.bit)) !== 0);

/** 大枠の ID の一覧から、印の束（知らない ID は無視） */
export const maskOf = (ids: readonly string[]): number => ids.reduce((m, id) => m | (KIND_BY_ID.has(id) ? 1 << KIND_BY_ID.get(id)!.bit : 0), 0);

/** 大枠の ID の一覧（KINDS の順） */
export const idsOf = (mask: number): KindId[] => kindsOf(mask).map((k) => k.id);

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/**
 * 人が書いた大枠（スプレッドシートの「大枠」の列など）を読む。「VTuber、歌手」「vtuber, singer」「1,3」のように、
 * 日本語の名前・英語の名前・ID・番号（1〜16。1 が VTuber、16 がその他）を、読点・カンマ・改行で区切って書ける。
 * 読めなかった言葉は unknown に返す。
 */
export function parseKinds(text: string): { mask: number; unknown: string[] } {
  let mask = 0;
  const unknown: string[] = [];
  for (const raw of text.split(/[、,，;；\n]+/)) {
    const w = norm(raw);
    if (!w) continue;
    const n = /^\d+$/.test(w) ? Number(w) - 1 : -1;
    const k = KINDS.find((k) => k.bit === n || norm(k.id) === w || norm(k.ja) === w || norm(k.en) === w);
    if (k) mask |= 1 << k.bit;
    else unknown.push(raw.trim());
  }
  return { mask, unknown };
}
