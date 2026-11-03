// サイトに入れる声を、いくつかの元からまとめる（vite.config.ts の voicePack が使う。DOM なし）。
// 元の順: 運営が測った声（Release の operator-voices.json）→ 拡張機能で測った声（data/catalog.json・profiles.json）→ 利用者の登録。
// 前の元にある声は、後の元では入れない（同じ ID、または同じ名前）。測り方の版が違う数字と、一覧に無い声も入れない。
import { nameKey } from '../submit/code.ts';
import type { Features } from '../voice/features.ts';
import type { CatalogEntry, OperatorVoices, ProfileEntry } from './types.ts';

export interface VoiceSource {
  voices: readonly CatalogEntry[];
  profiles: readonly ProfileEntry[];
}

/** 運営が測った声のファイルを、一覧と代表値の形にする */
export function fromOperatorVoices(file: OperatorVoices): VoiceSource {
  return {
    voices: file.voices.map((v) => ({ id: v.id, name: v.name, ...(v.group ? { group: v.group } : {}), links: { profile: v.link } })),
    profiles: file.voices.map((v) => ({ id: v.id, version: file.measureVersion, windows: v.windows, videos: v.videos, features: v.features })),
  };
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
      if (!v || p.version !== measureVersion) continue;
      const key = nameKey(v.name);
      if (ids.has(v.id) || names.has(key)) continue;
      ids.add(v.id);
      names.add(key);
      voices.push(v);
      features.push(p.features);
    }
  }
  return { voices, features };
}
