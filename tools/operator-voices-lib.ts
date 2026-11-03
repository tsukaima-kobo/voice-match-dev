// 運営が測った声の代表値を作る（tools/voices-release.ts が使う。DOM なし・ファイルの読み書きなし。test/operator-voices.test.ts で試す）。
// 元: 収集の書き出し（スプレッドシートと同じ数字。snapshot.json の peoples・measurements・summary.measureVersions）。
// 窓: 数字のある窓だけ → その人の高さの中央値から外れた窓を除く（tools/lib.ts の SELECT と同じ）→ SELECT.minWindows 以上の人だけ。
// 代表値は項目ごとの中央値（サイトと同じ計算）。公式ページの URL が無い・おかしい人は入れない。
import { FEATURE_KEYS, type Features } from '../src/voice/features.ts';
import { quantileOf } from '../src/voice/measure.ts';
import { checkLink } from '../src/submit/code.ts';
import type { OperatorVoices } from '../src/data/types.ts';
import { medianFeatures, SELECT } from './lib.ts';

export interface Snapshot {
  summary?: { measureVersions?: string[] };
  peoples: { personId: string; name: string; groupName?: string | null; currentAffiliation?: string | null; officialProfile?: string | null }[];
  measurements: ({ personId: string; videoId: string } & Record<string, unknown>)[];
}

export interface BuildResult {
  file: OperatorVoices;
  /** 人ごとの記録（使った窓・入れなかった理由） */
  notes: string[];
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export function buildOperatorVoices(snap: Snapshot, o: { measureVersion: string; only: ReadonlySet<string> | null }): BuildResult {
  const versions = snap.summary?.measureVersions ?? [];
  if (versions.length !== 1 || versions[0] !== o.measureVersion) throw new Error(`測り方の版が合いません（データ: ${versions.join('・') || '書いていない'}、今のサイト: ${o.measureVersion}）`);
  const people = new Map<string, Snapshot['peoples'][number]>();
  for (const p of snap.peoples) if (p.personId && !people.has(p.personId)) people.set(p.personId, p);
  const rows = new Map<string, { video: string; features: Features }[]>();
  for (const m of snap.measurements) {
    if (num(m.pitch) === null) continue; // (not measured, or failed)
    const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, num(m[k])])) as Features;
    (rows.get(m.personId) ?? rows.set(m.personId, []).get(m.personId)!).push({ video: m.videoId, features });
  }
  const notes: string[] = [];
  if (o.only) for (const id of o.only) if (!people.has(id)) notes.push(`${id}: データに無い人物ID です`);
  const voices: OperatorVoices['voices'] = [];
  for (const id of [...people.keys()].sort()) {
    if (o.only && !o.only.has(id)) continue;
    const p = people.get(id)!;
    const all = rows.get(id) ?? [];
    let kept = all;
    if (all.length >= SELECT.pitchCheckFrom) {
      const st = all.map((w) => 12 * Math.log2(w.features.pitch! / 100));
      const mid = quantileOf(st, 0.5);
      kept = all.filter((_, i) => Math.abs(st[i]! - mid) <= SELECT.maxPitchOffSt);
    }
    const videos = new Set(kept.map((w) => w.video)).size;
    const note = `${id}: 窓 ${all.length} → 使う ${kept.length}（高さが外れる ${all.length - kept.length}）、動画 ${videos} 本`;
    if (kept.length < SELECT.minWindows) {
      // (only worth a line when the person was asked for by name)
      if (o.only || all.length) notes.push(`${note} → 窓が ${SELECT.minWindows} に足りないので入れません`);
      continue;
    }
    const link = (p.officialProfile ?? '').trim();
    if (checkLink(link) !== null) {
      notes.push(`${note} → 公式ページの URL が無いか、使えない形なので入れません`);
      continue;
    }
    const group = (p.currentAffiliation ?? '').trim() || (p.groupName ?? '').trim();
    notes.push(note);
    voices.push({ id, name: p.name.trim(), ...(group ? { group } : {}), link, windows: kept.length, videos, features: medianFeatures(kept) });
  }
  return { file: { version: 1, measureVersion: o.measureVersion, voices }, notes };
}

/** 出す人の一覧（1 行 1 人の人物ID。# から後と空の行は無視） */
export function parseIdList(text: string): Set<string> {
  return new Set(
    text
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*/, '').trim())
      .filter(Boolean),
  );
}
