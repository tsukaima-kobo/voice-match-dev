// サイトに入れるデータ（ビルドの時に取り込む。外へは何も読みに行かない）。
// 声の名前・リンク・数字は、詰めた別のファイル（vite.config.ts の voicePack、src/data/pack.ts）にして、ページを開いたらすぐ裏で読む。
// 読み終わるまでは空。使う所は voicesReady を待つ（話し終わる頃には読み終わっている）。
// ID は、ページの中だけの番号（サイトのデータには入れない）。ページをまたぐリンクには名前を使う。
// 照合のモデル（data/model.json）は小さいので、ページと一緒に読む。
import modelJson from '../../data/model.json';
import { MEASURE_VERSION } from '../voice/measure.ts';
import { defaultModel, type MatchModel } from '../match/match.ts';
import type { Features } from '../voice/features.ts';
import type { CatalogEntry } from './types.ts';
import { unpackVoices } from './pack.ts';

export let CATALOG: readonly CatalogEntry[] = [];
export let ENTRY_BY_ID: ReadonlyMap<string, CatalogEntry> = new Map();
/** 今の測り方と同じ版で測った物だけ（版が違う数字とは比べない） */
export let PROFILES: readonly { id: string; features: Features }[] = [];

/** 声のデータを読み終えた時（読めなかった時も、空のまま終わる） */
export const voicesReady: Promise<void> = import('virtual:voice-pack')
  .then(({ default: pack }) => {
    if (pack.m !== MEASURE_VERSION) return;
    const { voices, profiles } = unpackVoices(pack);
    CATALOG = voices;
    ENTRY_BY_ID = new Map(voices.map((v) => [v.id, v]));
    PROFILES = profiles as { id: string; features: Features }[];
  })
  .catch(() => undefined);

/** 照合のモデル（tools/eval.ts が作る）。無い時・版が違う時は、画面の目盛りから作った仮の物 */
const m = modelJson as unknown as Partial<MatchModel> & { version: string };
export const MODEL: MatchModel = m.version !== 'none' && m.measureVersion === MEASURE_VERSION && Array.isArray(m.keys) ? (m as MatchModel) : defaultModel(MEASURE_VERSION);
