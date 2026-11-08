// サイトに入れる声を、いくつかの元からまとめる（vite.config.ts の voicePack が使う。DOM なし）。
// 元の順: 運営が測った声（Release の operator-voices.json）→ 拡張機能で測った声（data/catalog.json・profiles.json）→ 利用者の登録。
// 前の元にある声は、後の元では入れない（同じ ID、または同じ名前。名前と英語名のどちらかが、前の声の名前か英語名と同じなら同じ声）。
// 測り方の版が違う数字と、一覧に無い声も入れない。運営が測った声のファイルの版が違う時は、黙って 0 人にせず止める（checkOperatorVoices）。
import { readableVersion } from '../voice/measure.ts';
import { nameKey } from '../submit/code.ts';
import type { Features } from '../voice/features.ts';
import type { CatalogEntry, OperatorVoices, ProfileEntry } from './types.ts';

export interface VoiceSource {
  voices: readonly CatalogEntry[];
  profiles: readonly Pick<ProfileEntry, 'id' | 'version' | 'features'>[];
}

/** 運営が測った声のファイルを、一覧と代表値の形にする（ファイルに ID は無いので、まとめる間だけの番号を付ける） */
export function fromOperatorVoices(file: OperatorVoices): VoiceSource {
  const id = (i: number) => `o-${i}`;
  return {
    voices: file.voices.map((v, i) => ({
      id: id(i),
      name: v.name,
      ...(v.nameEn ? { nameEn: v.nameEn } : {}),
      ...(v.group ? { group: v.group } : {}),
      ...(v.group && v.groupEn ? { groupEn: v.groupEn } : {}),
      ...(v.kinds?.length ? { kinds: v.kinds } : {}),
      links: { profile: v.link },
    })),
    profiles: file.voices.map((v, i) => ({ id: id(i), version: file.measureVersion, features: v.features })),
  };
}

/** 運営が測った声のファイルの版を確かめる。今のサイトの版とも、比べてよい前の版（MEASURE_COMPATIBLE）とも違えば止める（版を上げた時に、黙って 0 人で公開しないため） */
export function checkOperatorVoices(file: OperatorVoices, measureVersion: string): void {
  if (!readableVersion(file.measureVersion, measureVersion)) throw new Error(`運営が測った声（operator-voices.json、${file.voices?.length ?? 0} 人）の測り方の版は ${file.measureVersion} で、今のサイトは ${measureVersion} です。このままでは 1 人も出ません。測り直したシートから tools/voices-release.ts make と upload で作り直してください（docs/voices-release.md）。`);
}

/** まとめる。voices[i] の数字が features[i] */
export function mergeVoices(sources: readonly VoiceSource[], measureVersion: string): { voices: CatalogEntry[]; features: Features[] } {
  const voices: CatalogEntry[] = [];
  const features: Features[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const s of sources) {
    const byId = new Map(s.voices.map((v) => [v.id, v]));
    for (const p of s.profiles) {
      const v = byId.get(p.id);
      if (!v || !readableVersion(p.version, measureVersion)) continue;
      const en = v.nameEn ? nameKey(v.nameEn) : '';
      const keys = en ? [nameKey(v.name), en] : [nameKey(v.name)];
      if (ids.has(v.id) || keys.some((k) => names.has(k))) continue;
      ids.add(v.id);
      for (const k of keys) names.add(k);
      voices.push(v);
      features.push(p.features);
    }
  }
  return { voices, features };
}
