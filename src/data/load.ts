// サイトに入れるデータ（ビルドの時に JSON を取り込む。外へは何も読みに行かない）。
// 事前に測った声: 名前とリンク（data/catalog.json）、代表値（data/profiles.json）、照合のモデル（data/model.json）。
// 利用者の登録から出した声（data/user-catalog.json・user-profiles.json。tools/intake.ts が作る）も合わせる。
import catalogJson from '../../data/catalog.json';
import profilesJson from '../../data/profiles.json';
import userCatalogJson from '../../data/user-catalog.json';
import userProfilesJson from '../../data/user-profiles.json';
import modelJson from '../../data/model.json';
import { MEASURE_VERSION } from '../voice/measure.ts';
import { defaultModel, type MatchModel } from '../match/match.ts';
import type { Features } from '../voice/features.ts';
import type { Catalog, CatalogEntry, ProfileList } from './types.ts';

export const CATALOG: readonly CatalogEntry[] = [...(catalogJson as unknown as Catalog).voices, ...(userCatalogJson as unknown as Catalog).voices];
export const ENTRY_BY_ID: ReadonlyMap<string, CatalogEntry> = new Map(CATALOG.map((v) => [v.id, v]));

/** 今の測り方と同じ版で測った物だけ（版が違う数字とは比べない） */
export const PROFILES: readonly { id: string; features: Features }[] = [...(profilesJson as unknown as ProfileList).profiles, ...(userProfilesJson as unknown as ProfileList).profiles]
  .filter((p) => p.version === MEASURE_VERSION && ENTRY_BY_ID.has(p.id))
  .map((p) => ({ id: p.id, features: p.features }));

/** 照合のモデル（tools/eval.ts が作る）。無い時・版が違う時は、画面の目盛りから作った仮の物 */
const m = modelJson as unknown as Partial<MatchModel> & { version: string };
export const MODEL: MatchModel = m.version !== 'none' && m.measureVersion === MEASURE_VERSION && Array.isArray(m.keys) ? (m as MatchModel) : defaultModel(MEASURE_VERSION);
