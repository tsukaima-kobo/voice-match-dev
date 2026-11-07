// 運営が測った声の代表値を作る（tools/voices-release.ts が使う。DOM なし・ファイルの読み書きなし。test/operator-voices.test.ts で試す）。
// 元: 収集の書き出し（スプレッドシートと同じ数字。snapshot.json の peoples・measurements・summary.measureVersions）。
// 窓: 数字のある窓だけ → その人の高さの中央値から外れた窓を除く（tools/lib.ts の SELECT と同じ）→ SELECT.minWindows 以上の人だけ。
// 代表値は項目ごとの中央値（サイトと同じ計算）。公式ページの URL が無い・おかしい人は入れない。
// 大枠（VTuber・歌手など）は、シートの「大枠」の列（無ければ make の --kind）から。
// 書き出すのは名前・所属・大枠・公式ページ・数字だけ（Release は公開なので、人物ID や窓の数は手元の記録だけに出す）。
import { FEATURE_BY_KEY, FEATURE_KEYS, formatFeature, type Features } from '../src/voice/features.ts';
import type { Cell } from './xlsx.ts';
import { quantileOf } from '../src/voice/measure.ts';
import { checkLink } from '../src/submit/code.ts';
import type { OperatorVoices } from '../src/data/types.ts';
import { medianFeatures, SELECT } from './lib.ts';
import { idsOf, parseKinds } from '../src/data/kinds.ts';

export interface Snapshot {
  summary?: { measureVersions?: string[] };
  peoples: { personId: string; name: string; groupName?: string | null; currentAffiliation?: string | null; officialProfile?: string | null; kinds?: string | null }[];
  measurements: ({ personId: string; videoId: string } & Record<string, unknown>)[];
}

export interface BuildResult {
  file: OperatorVoices;
  /** 人ごとの記録（使った窓・入れなかった理由） */
  notes: string[];
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/**
 * 人ごとの窓: 数字のある窓（all）と、そこから高さが外れた窓を除いた物（kept。tools/lib.ts の SELECT と同じ）。
 * 代表値（buildOperatorVoices）と、照合のモデル作り（tools/eval.ts --sheet）が同じ窓を使う。
 */
export function sheetWindows(snap: Snapshot): Map<string, { all: SheetWindow[]; kept: SheetWindow[] }> {
  const rows = new Map<string, SheetWindow[]>();
  for (const m of snap.measurements) {
    if (num(m.pitch) === null) continue; // (not measured, or failed)
    const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, num(m[k])])) as Features;
    (rows.get(m.personId) ?? rows.set(m.personId, []).get(m.personId)!).push({ video: m.videoId, features });
  }
  const out = new Map<string, { all: SheetWindow[]; kept: SheetWindow[] }>();
  for (const [id, all] of rows) {
    let kept = all;
    if (all.length >= SELECT.pitchCheckFrom) {
      const st = all.map((w) => 12 * Math.log2(w.features.pitch! / 100));
      const mid = quantileOf(st, 0.5);
      kept = all.filter((_, i) => Math.abs(st[i]! - mid) <= SELECT.maxPitchOffSt);
    }
    out.set(id, { all, kept });
  }
  return out;
}

export interface SheetWindow {
  video: string;
  features: Features;
}

/**
 * defaultKinds: 「大枠」が書いていない人に付ける大枠（src/data/kinds.ts の印の束。0 なら付けない＝「すべて」の中でだけ出る）。
 */
export function buildOperatorVoices(snap: Snapshot, o: { measureVersion: string; only: ReadonlySet<string> | null; defaultKinds?: number }): BuildResult {
  const versions = snap.summary?.measureVersions ?? [];
  if (versions.length !== 1 || versions[0] !== o.measureVersion) throw new Error(`測り方の版が合いません（データ: ${versions.join('・') || '書いていない'}、今のサイト: ${o.measureVersion}）`);
  const people = new Map<string, Snapshot['peoples'][number]>();
  for (const p of snap.peoples) if (p.personId && !people.has(p.personId)) people.set(p.personId, p);
  const windows = sheetWindows(snap);
  const notes: string[] = [];
  if (o.only) for (const id of o.only) if (!people.has(id)) notes.push(`${id}: データに無い人物ID です`);
  const voices: OperatorVoices['voices'] = [];
  for (const id of [...people.keys()].sort()) {
    if (o.only && !o.only.has(id)) continue;
    const p = people.get(id)!;
    const { all, kept } = windows.get(id) ?? { all: [], kept: [] };
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
    const group = affiliation(p.currentAffiliation, p.groupName);
    const parsed = parseKinds(p.kinds ?? '');
    const kinds = idsOf(parsed.mask || (o.defaultKinds ?? 0));
    const extra = [group && group !== (p.currentAffiliation ?? '').trim() ? `所属「${group}」` : '', parsed.unknown.length ? `大枠の読めない言葉「${parsed.unknown.join('・')}」` : '', kinds.length ? '' : '大枠なし'].filter(Boolean);
    notes.push(extra.length ? `${note}、${extra.join('、')}` : note);
    voices.push({ name: p.name.trim(), ...(group ? { group } : {}), ...(kinds.length ? { kinds } : {}), link, features: medianFeatures(kept) });
  }
  return { file: { version: 1, measureVersion: o.measureVersion, voices }, notes };
}

/** かっこの中（調べた時のメモ）を除く */
const stripNote = (s: string) => s.replace(/[（(][^（）()]*[）)]/g, '').trim();

/**
 * 画面に出す所属の名前。シートの「現在所属」には、調べた時のメモ（「ホロライブ（公式個人プロフィール掲載）」など）が入っているので、
 * かっこの中を除く。「所属区分」で始まる物は所属区分の名前に（「ホロライブ4期生」→「ホロライブ」）、個人で活動している人は「個人」にそろえる。
 */
export function affiliation(current: string | null | undefined, kind: string | null | undefined): string {
  const cur = stripNote(current ?? '');
  const k = stripNote(kind ?? '');
  if (!cur) return k;
  if (k && cur.startsWith(k)) return k;
  if (/^個人/.test(cur)) return '個人';
  return cur;
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

/** シートの見出し（tools/export-voice-sheet.py と同じ作り方: 日本語名 (単位)。比率は % と書いてあるが、数はそのまま） */
export function sheetLabel(key: (typeof FEATURE_KEYS)[number]): string {
  const unit = formatFeature(key, 0.123456).endsWith(' %') ? '%' : FEATURE_BY_KEY[key].unit;
  return FEATURE_BY_KEY[key].name + (unit ? ` (${unit})` : '');
}

/**
 * スプレッドシート（xlsx をほどいた表）を、収集の書き出しと同じ形にする。
 * 使うタブ: 人物一覧（人物ID・氏名・所属区分・現在所属・公式プロフィール、あれば大枠）と 声の測定値（人物ID・出典動画ID・45 項目）。
 * 見出しは「人物ID」で始まる行。シートには測り方の版が書いていないので、45 項目の見出しが今のサイトと全部同じ時だけ、
 * 今の版（measureVersion）で測った物として扱う。違えば止める。
 */
export function snapshotFromSheet(tables: ReadonlyMap<string, Cell[][]>, measureVersion: string): Snapshot {
  const table = (name: string, need: string[]) => {
    const rows = tables.get(name);
    if (!rows) throw new Error(`シートに「${name}」のタブがありません`);
    const h = rows.findIndex((r) => r[0] === '人物ID');
    if (h < 0) throw new Error(`「${name}」に「人物ID」で始まる見出しの行がありません`);
    const at = new Map(rows[h]!.map((c, i) => [String(c ?? '').trim(), i]));
    const missing = need.filter((l) => !at.has(l));
    if (missing.length) throw new Error(`「${name}」に無い見出し: ${missing.join('・')}（測り方や項目が今のサイトと違うかもしれません）`);
    return rows.slice(h + 1).filter((r) => String(r[0] ?? '').trim()).map((r) => (l: string) => (at.has(l) ? (r[at.get(l)!] ?? null) : null));
  };
  const str = (c: Cell) => (c === null ? null : String(c).trim() || null);
  const peoples = table('人物一覧', ['人物ID', '氏名', '所属区分', '現在所属', '公式プロフィール']).map((get) => ({
    personId: str(get('人物ID'))!,
    name: str(get('氏名')) ?? '',
    groupName: str(get('所属区分')),
    currentAffiliation: str(get('現在所属')),
    officialProfile: str(get('公式プロフィール')),
    kinds: str(get('大枠')),
  }));
  const labels = FEATURE_KEYS.map(sheetLabel);
  const measurements = table('声の測定値', ['人物ID', '出典動画ID', ...labels]).map((get) => ({
    personId: str(get('人物ID'))!,
    videoId: str(get('出典動画ID')) ?? '',
    ...Object.fromEntries(
      FEATURE_KEYS.map((k, i) => {
        const c = get(labels[i]!);
        const x = typeof c === 'number' ? c : c === null || String(c).trim() === '' ? null : Number(c);
        return [k, x !== null && Number.isFinite(x) ? x : null];
      }),
    ),
  }));
  return { summary: { measureVersions: [measureVersion] }, peoples, measurements };
}
