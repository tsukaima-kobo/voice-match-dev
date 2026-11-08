// サイトに入れる声を、いくつかの元からまとめる（vite.config.ts の voicePack が使う。DOM なし）。
// 元の順: 運営が測った声（Release の operator-voices.json）→ 拡張機能で測った声（data/catalog.json・profiles.json）→ 利用者の登録。
// 前の元にある声は、後の元では入れない（同じ ID、または同じ名前。名前と英語名のどちらかが、前の声の名前か英語名と同じなら同じ声）。
// 同じ元の中でも、後の声は入れない（入れなかった声は dropped に返す。運営が測った声は tools/voices-release.ts の make が名前を出して知らせる）。
// 削除の一覧（登録のシートの「削除」のタブ。tools/intake.ts が data/generated/removed-names.json に書く）の名前は、どの元の声にも当てる
// （名前か英語名のどちらかが合えば入れない。入れなかった声の名前と英語名も一覧に足し、後の元の同じ名前の声も入れない）。
// 名前の無い声・測り方の版が違う数字・一覧に無い声も入れない。運営が測った声のファイルの版が違う時は、黙って 0 人にせず止める（checkOperatorVoices）。
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

/** 入れなかった声（source は sources の番号）。same: 前の声と同じ名前か ID。removed: 削除の一覧の名前。noName: 名前が無い */
export interface DroppedVoice {
  source: number;
  name: string;
  nameEn?: string;
  reason: 'same' | 'removed' | 'noName';
}

/** 同じ声を見分ける鍵（名前と、あれば英語名。nameKey でそろえた物） */
export const voiceKeys = (v: { name: string; nameEn?: string | undefined }): string[] => [...new Set([nameKey(v.name), nameKey(v.nameEn ?? '')].filter(Boolean))];

/** まとめる。voices[i] の数字が features[i]。removed は削除の一覧の名前（書き方は少し違ってもよい） */
export function mergeVoices(sources: readonly VoiceSource[], measureVersion: string, o: { removed?: readonly string[] } = {}): { voices: CatalogEntry[]; features: Features[]; dropped: DroppedVoice[] } {
  const voices: CatalogEntry[] = [];
  const features: Features[] = [];
  const dropped: DroppedVoice[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const removed = new Set((o.removed ?? []).map(nameKey).filter(Boolean));
  sources.forEach((s, source) => {
    const byId = new Map(s.voices.map((v) => [v.id, v]));
    for (const p of s.profiles) {
      const v = byId.get(p.id);
      if (!v || !readableVersion(p.version, measureVersion)) continue;
      const keys = voiceKeys(v);
      const drop = (reason: DroppedVoice['reason']) => dropped.push({ source, name: v.name, ...(v.nameEn ? { nameEn: v.nameEn } : {}), reason });
      if (!keys.length) {
        drop('noName');
        continue;
      }
      if (keys.some((k) => removed.has(k))) {
        // 名前で消した声の英語名（英語名で消した声の名前）も、後の元で入れない
        for (const k of keys) removed.add(k);
        drop('removed');
        continue;
      }
      if (ids.has(v.id) || keys.some((k) => names.has(k))) {
        drop('same');
        continue;
      }
      ids.add(v.id);
      for (const k of keys) names.add(k);
      voices.push(v);
      features.push(p.features);
    }
  });
  return { voices, features, dropped };
}
