// 運営が測った声の代表値を作る（tools/voices-release.ts が使う。DOM なし・ファイルの読み書きなし。test/operator-voices.test.ts で試す）。
// 元: 収集の書き出し（スプレッドシートと同じ数字。snapshot.json の peoples・measurements・summary.measureVersions）。
// 窓: 数字のある窓だけ → その人の高さの中央値から外れた窓を除く（tools/lib.ts の SELECT と同じ）→ SELECT.minWindows 以上の人だけ。
// 代表値は項目ごとの中央値（サイトと同じ計算）。氏名が空の人・公式ページの URL が無い・おかしい人は入れない。
// 測り方の版: 今の版か、比べてよい前の版（MEASURE_COMPATIBLE）の窓だけを使い、ファイルには使った窓の中でいちばん古い版を書く
// （前の版を MEASURE_COMPATIBLE から外した時に、サイトのビルドが止まるように。src/data/sources.ts の checkOperatorVoices）。
// サイトでは、名前か英語名が同じ（nameKey でそろえる）人は 1 人しか出ないので、そういう人がいれば warnings に出す（make が大きく知らせる）。
// 大枠（VTuber・歌手など）は、シートの「大枠」の列（無ければ make の --kind）から。
// 英語の名前は、シートの「英語名」「所属の英語名」の列（任意。公式の英語の書き方）から。
// 同じ人の行がいくつかある時は、項目ごとに、空でない最初の値を使う（名前・所属・公式ページ・大枠・英語名のどれも）。
// 所属: 所属区分が集めた時の分け方（地域・言語・名簿・未確認）や、録った時の所属の時、現在所属が「…を卒業済み」の時は出さない。所属区分ID ごとに書き方を 1 つにそろえる（affiliation）。
// 所属の英語名は、画面に出す所属（affiliation でそろえた物）ごとに 1 つにそろえる（groupEnByGroup）。
// 書き出すのは名前（あれば英語名も）・所属・大枠・公式ページ・数字だけ（Release は公開なので、人物ID や窓の数は手元の記録だけに出す）。
import { FEATURE_BY_KEY, FEATURE_KEYS, formatFeature, type Features } from '../src/voice/features.ts';
import type { Cell } from './xlsx.ts';
import { quantileOf, readableVersion } from '../src/voice/measure.ts';
import { checkLink, nameKey } from '../src/submit/code.ts';
import type { OperatorVoices } from '../src/data/types.ts';
import { medianFeatures, SELECT } from './lib.ts';
import { idsOf, parseKinds } from '../src/data/kinds.ts';
import { oldestVersion } from './versions.ts';
import { fromOperatorVoices, mergeVoices, voiceKeys } from '../src/data/sources.ts';

export interface Snapshot {
  summary?: { measureVersions?: string[] };
  peoples: { personId: string; name: string; nameEn?: string | null; groupId?: string | null; groupName?: string | null; currentAffiliation?: string | null; groupEn?: string | null; officialProfile?: string | null; kinds?: string | null }[];
  /** measureVersion: その行の測り方の版（シートから読んだ時。無い時は summary.measureVersions） */
  measurements: ({ personId: string; videoId: string; measureVersion?: string } & Record<string, unknown>)[];
}

export interface BuildResult {
  file: OperatorVoices;
  /** 人ごとの記録（使った窓・入れなかった理由） */
  notes: string[];
  /** 大きく知らせること（サイトで同じ名前として 1 人しか出ない人たち） */
  warnings: string[];
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/**
 * 人ごとの窓: 数字のある窓（all）と、そこから高さが外れた窓を除いた物（kept。tools/lib.ts の SELECT と同じ）。
 * 代表値（buildOperatorVoices）と、照合のモデル作り（tools/eval.ts --sheet）が同じ窓を使う。
 */
export function sheetWindows(snap: Snapshot): Map<string, { all: SheetWindow[]; kept: SheetWindow[] }> {
  const rows = new Map<string, SheetWindow[]>();
  for (const m of snap.measurements) {
    if (num(m.pitch) === null) continue; // 測っていない、または測れなかった
    const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, num(m[k])])) as Features;
    const version = typeof m.measureVersion === 'string' ? m.measureVersion : undefined;
    (rows.get(m.personId) ?? rows.set(m.personId, []).get(m.personId)!).push({ video: m.videoId, features, ...(version ? { version } : {}) });
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
  /** 測り方の版（シートから読んだ時だけ） */
  version?: string;
}

/**
 * defaultKinds: 「大枠」が書いていない人に付ける大枠（src/data/kinds.ts の印の束。0 なら付けない＝「すべて」の中でだけ出る）。
 */
export function buildOperatorVoices(snap: Snapshot, o: { measureVersion: string; only: ReadonlySet<string> | null; defaultKinds?: number }): BuildResult {
  const versions = snap.summary?.measureVersions ?? [];
  if (!versions.length || !versions.every((v) => readableVersion(v, o.measureVersion))) throw new Error(`測り方の版が合いません（データ: ${versions.join('・') || '書いていない'}、今のサイト: ${o.measureVersion}）`);
  const people = new Map<string, Snapshot['peoples'][number]>();
  for (const p of snap.peoples) {
    if (!p.personId) continue;
    const had = people.get(p.personId);
    if (!had) people.set(p.personId, { ...p });
    // 同じ人の行がいくつかある時: 項目ごとに、空でない最初の値（前の行が空で、後の行にだけ書いてあってもよい）
    else for (const k of PERSON_FIELDS) if (!had[k]?.trim() && p[k]?.trim()) had[k] = p[k];
  }
  const windows = sheetWindows(snap);
  const notes: string[] = [];
  const labels = groupLabelsById(people.values());
  if (o.only) for (const id of o.only) if (!people.has(id)) notes.push(`${id}: データに無い人物ID です`);
  const picked: { id: string; name: string; nameEn: string; group: string; groupEn: string; exact: boolean; kinds: string[]; link: string; features: Features }[] = [];
  /** 使った窓の測り方の版（窓に版が無い時は、データ全体の版） */
  const used = new Set<string>();
  for (const id of [...people.keys()].sort()) {
    if (o.only && !o.only.has(id)) continue;
    const p = people.get(id)!;
    const { all, kept } = windows.get(id) ?? { all: [], kept: [] };
    const videos = new Set(kept.map((w) => w.video)).size;
    const note = `${id}: 窓 ${all.length} → 使う ${kept.length}（高さが外れる ${all.length - kept.length}）、動画 ${videos} 本`;
    if (kept.length < SELECT.minWindows) {
      // 記録に 1 行書くのは、名指しで頼まれた時か、窓が 1 つでもある人だけ（窓が 0 の人まで並べると長くなる）
      if (o.only || all.length) notes.push(`${note} → 窓が ${SELECT.minWindows} に足りないので入れません`);
      continue;
    }
    if (!nameKey(p.name ?? '')) {
      notes.push(`${note} → 氏名が空（または記号だけ）なので入れません`);
      continue;
    }
    const link = (p.officialProfile ?? '').trim();
    if (checkLink(link) !== null) {
      notes.push(`${note} → 公式ページの URL が無いか、使えない形なので入れません`);
      continue;
    }
    const group = affiliation(p.currentAffiliation, p.groupName, p.groupId ? labels.get(p.groupId) : undefined);
    const parsed = parseKinds(p.kinds ?? '');
    const kinds = idsOf(parsed.mask || (o.defaultKinds ?? 0));
    // exact: 所属を「現在所属」のまま出す人（「ホロライブ4期生」→「ホロライブ」のように、そろえた人ではない）
    const cur = currentOf(p.currentAffiliation);
    const extra = [group && group !== (p.currentAffiliation ?? '').trim() ? `所属「${group}」` : '', LEFT.test(cur) ? `所属を出しません（現在所属「${cur}」）` : '', parsed.unknown.length ? `大枠の読めない言葉「${parsed.unknown.join('・')}」` : '', kinds.length ? '' : '大枠なし'].filter(Boolean);
    notes.push(extra.length ? `${note}、${extra.join('、')}` : note);
    for (const w of kept) used.add(w.version ?? oldestVersion(versions, o.measureVersion));
    picked.push({ id, name: p.name.trim(), nameEn: (p.nameEn ?? '').trim(), group, groupEn: group ? (p.groupEn ?? '').trim() : '', exact: !cur || cur === group, kinds, link, features: medianFeatures(kept) });
  }
  // 所属区分のうち、所属として出さなかった物（集めた時の分け方・録った時の所属など）。シートを直す時の手がかり（手元の記録だけ）
  const hidden = new Map<string, number>();
  for (const v of picked) {
    const k = (people.get(v.id)!.groupName ?? '').trim();
    if (k && !v.group && !groupLabel(k)) hidden.set(k, (hidden.get(k) ?? 0) + 1);
  }
  if (hidden.size) notes.push(`所属として出さない所属区分（所属が空になる人）: ${[...hidden].sort((a, b) => b[1] - a[1]).map(([k, n]) => `「${k}」${n} 人`).join('・')}`);
  // 所属の英語名は、所属ごとに 1 つにそろえる（書いていない人にも、同じ所属なら同じ物が付く。サイトでも所属ごとに 1 つ）
  const groupEn = groupEnByGroup(picked.filter((v) => v.groupEn));
  for (const [group, { chosen, others }] of groupEn) if (others.length) notes.push(`所属「${group}」の英語名は「${chosen}」にそろえます（ほかに ${others.map((x) => `「${x}」`).join('')}）`);
  const voices: OperatorVoices['voices'] = picked.map((v) => {
    const en = groupEn.get(v.group)?.chosen;
    return { name: v.name, ...(v.nameEn ? { nameEn: v.nameEn } : {}), ...(v.group ? { group: v.group } : {}), ...(en ? { groupEn: en } : {}), ...(v.kinds.length ? { kinds: v.kinds } : {}), link: v.link, features: v.features };
  });
  const bad = [...used].filter((v) => !readableVersion(v, o.measureVersion));
  if (bad.length) throw new Error(`測り方の版が合いません（窓: ${bad.join('・')}、今のサイト: ${o.measureVersion}）`);
  const file: OperatorVoices = { version: 1, measureVersion: oldestVersion(used, oldestVersion(versions, o.measureVersion)), voices };
  // サイトに出る人は、サイトと同じまとめ方で決める（名前がつながった 3 人以上では、出るのが先の 1 人だけとは限らない）
  const shown = new Set(mergeVoices([fromOperatorVoices(file)], o.measureVersion).voices.map((v) => v.id));
  const shownOf = (v: (typeof picked)[number]) => shown.has(`o-${picked.indexOf(v)}`);
  const warnings = sameNameGroups(picked).map((g) => `同じ名前として扱われる人がいます。サイトに出るのは${g.filter(shownOf).map((v) => `「${v.name}」`).join('')}だけです: ${g.map((v) => `${v.id}「${v.name}${v.nameEn ? ` / ${v.nameEn}` : ''}」`).join('・')}（シートの氏名・英語名を確かめてください）`);
  return { file, notes, warnings };
}

/**
 * サイトで同じ声として扱われる人のまとまり（名前か英語名が、ほかの人の名前か英語名と同じ。src/data/sources.ts の voiceKeys と同じ見方）。
 * 2 人以上のまとまりだけを、元の並びの順で返す。
 */
export function sameNameGroups<T extends { name: string; nameEn?: string }>(people: readonly T[]): T[][] {
  const parent = people.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  const at = new Map<string, number>();
  people.forEach((p, i) => {
    for (const k of voiceKeys(p)) {
      const j = at.get(k);
      if (j === undefined) at.set(k, i);
      else parent[root(i)] = root(j);
    }
  });
  const groups = new Map<number, T[]>();
  people.forEach((p, i) => (groups.get(root(i)) ?? groups.set(root(i), []).get(root(i))!).push(p));
  return [...groups.values()].filter((g) => g.length > 1);
}

/** 人物一覧の、同じ人の行をまとめる時に見る項目 */
const PERSON_FIELDS = ['name', 'nameEn', 'groupId', 'groupName', 'currentAffiliation', 'groupEn', 'officialProfile', 'kinds'] as const;

/**
 * 所属の英語名を、所属ごとに 1 つ選ぶ。所属をそろえていない人（exact）の物があればその中から、無ければ全員の中から、
 * いちばん多い物（同じ数なら先に出た物＝人物ID の順で先の人）。others は選ばなかった物（記録に出す）。
 */
export function groupEnByGroup(candidates: readonly { group: string; groupEn: string; exact: boolean }[]): Map<string, { chosen: string; others: string[] }> {
  const by = new Map<string, { groupEn: string; exact: boolean }[]>();
  for (const c of candidates) (by.get(c.group) ?? by.set(c.group, []).get(c.group)!).push(c);
  const out = new Map<string, { chosen: string; others: string[] }>();
  for (const [group, list] of by) {
    const pool = list.some((c) => c.exact) ? list.filter((c) => c.exact) : list;
    const n = new Map<string, number>();
    for (const c of pool) n.set(c.groupEn, (n.get(c.groupEn) ?? 0) + 1);
    let chosen = '';
    let bestN = 0;
    for (const [en, k] of n) if (k > bestN) [chosen, bestN] = [en, k];
    out.set(group, { chosen, others: [...new Set(list.map((c) => c.groupEn))].filter((x) => x !== chosen) });
  }
  return out;
}

/** かっこの中（調べた時のメモ）を除く */
const stripNote = (s: string) => s.replace(/[（(][^（）()]*[）)]/g, '').trim();

/** かっこの中（調べた時のメモ）だけ */
const notesOf = (s: string) => (s.match(/[（(][^（）()]*[）)]/g) ?? []).join(' ');

/**
 * 所属ではない物: 集めた時の分け方（「国際VTuber」「台湾VTuber」などの地域、「インドネシア語・本人公式配信」などの言語と出典、
 * 「VOTUAS公式名簿」などの名簿、「Affiliation unverified」「所属未確認」など）と、調べた時のメモ（「unverified; …」）。
 */
const NOT_AFFILIATION = /unverified|未確認|vtubers?$|本人公式配信|公式名簿|語圏|affiliation claim/i;

/** 所属区分のメモが、今の所属と言えないと書いている（録った時の所属・確かめていない・前の所属） */
const NOT_CURRENT_NOTE = /recording-time|unverified|未確認|旧所属|former|当時/i;

/** 所属区分を、画面に出せる所属の名前にする（所属ではない物・今の所属と言えない物は空） */
export function groupLabel(kind: string | null | undefined): string {
  const s = kind ?? '';
  if (NOT_CURRENT_NOTE.test(notesOf(s))) return '';
  const k = stripNote(s);
  return NOT_AFFILIATION.test(k) ? '' : k;
}

/** 個人で活動している人（「個人」「個人勢」「Independent」で始まる） */
const INDEPENDENT = /^(個人|independent\b)/i;

/** 「現在所属」が、所属区分の所属を離れた・活動を終えたと書いている（「預見娛樂を卒業済み」「配信活動終了」など）。所属区分は前の所属なので、どちらも出さない */
const LEFT = /卒業|graduat|脱退|引退|活動終了/i;

/** 「現在所属」からメモを除いた物（所属ではない物は空） */
const currentOf = (current: string | null | undefined): string => {
  const cur = stripNote(current ?? '');
  if (INDEPENDENT.test(cur)) return '個人勢'; // 「個人勢Vtuber」のように VTuber で終わっても、個人で活動している人
  return NOT_AFFILIATION.test(cur) ? '' : cur;
};

/**
 * 所属区分ID ごとに、画面に出す名前を 1 つにそろえる（「NIJISANJI」と「にじさんじ」、「Independent」と「個人勢」のように、
 * 同じ区分でも書き方が違う時）。その区分の人の groupLabel のうち、いちばん多い物（同じ数なら人物ID の順で先の人の物）。
 */
export function groupLabelsById(people: Iterable<{ personId: string; groupId?: string | null; groupName?: string | null }>): Map<string, string> {
  const by = new Map<string, Map<string, number>>();
  for (const p of [...people].sort((a, b) => (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0))) {
    const id = (p.groupId ?? '').trim();
    const label = groupLabel(p.groupName);
    if (!id || !label) continue;
    const n = by.get(id) ?? by.set(id, new Map()).get(id)!;
    n.set(label, (n.get(label) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const [id, n] of by) {
    let best = '';
    let bestN = 0;
    for (const [label, k] of n) if (k > bestN) [best, bestN] = [label, k];
    out.set(id, best);
  }
  return out;
}

/**
 * 画面に出す所属の名前。シートの「現在所属」には、調べた時のメモ（「ホロライブ（公式個人プロフィール掲載）」など）が入っているので、
 * かっこの中を除く。「所属区分」で始まる物は所属区分の名前に（「ホロライブ4期生」→「ホロライブ」）、個人で活動している人は「個人勢」にそろえる。
 * 所属区分が所属ではない物（集めた時の分け方）や、今の所属と言えない物（録った時の所属など）の時は、現在所属が無ければ空（所属を出さない）。
 * 現在所属が「…を卒業済み」のように所属を離れたと書いている時も空（所属区分の名前にそろえると、前の所属を今の所属として出してしまう）。
 * label: 所属区分ID でそろえた名前（groupLabelsById）。所属区分が出せる時だけ使う。
 */
export function affiliation(current: string | null | undefined, kind: string | null | undefined, label?: string): string {
  const cur = currentOf(current);
  if (LEFT.test(cur)) return '';
  const own = groupLabel(kind);
  const k = own ? label || own : '';
  if (!cur) return INDEPENDENT.test(k) ? '個人勢' : k;
  // 現在所属が、その人の所属区分の書き方（そろえる前）で始まる時も、そろえた名前に（「NIJISANJI」→「にじさんじ」）
  if (own && (cur.startsWith(k) || cur.startsWith(own))) return k;
  return cur;
}

/**
 * Release に置けない理由（tools/voices-release.ts の upload が使う）。置ける時は null。
 * 形や測り方の版が違う物と、声が 0 人の物（一覧に人物ID ではなく名前を書いた時など。置くとサイトの運営が測った声が黙って 0 人になる）は置かない。
 */
export function releaseProblem(file: Partial<OperatorVoices>, measureVersion: string): string | null {
  if (file.version !== 1 || !Array.isArray(file.voices) || !readableVersion(file.measureVersion, measureVersion)) return `ファイルの形か測り方の版が違います（今のサイト: ${measureVersion}）。make で作り直してください。`;
  if (!file.voices.length) return '声が 1 人も入っていません（置くと、サイトの運営が測った声が 0 人になります）。出す人の一覧の人物ID を確かめて、make で作り直してください。';
  return null;
}

/** 「声の測定値」に測定バージョンの列が無かった頃の行の版 */
const SHEET_DEFAULT_VERSION = '3.1.0';

/** 窓が少ない人に足した 10 分を、収集が書くタブ */
const EXTRA_TAB = '追加10分の測定値';

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
 * 使うタブ: 人物一覧（人物ID・氏名・所属区分・現在所属・公式プロフィール、あれば所属区分ID・大枠・英語名・所属の英語名）と 声の測定値（人物ID・出典動画ID・45 項目）。
 * 追加10分の測定値（窓が少ない人に足した 10 分。人物ID・追加動画ID・45 項目・測定バージョン）があれば、それも同じ人の窓に足す。
 * 見出しは「人物ID」がある行。45 項目の見出しが今のサイトと全部同じ時だけ使う（違えば止める）。
 * 行ごとの測り方の版は「測定バージョン」の列から読む。列が無い・空の行は、列を足す前に測った 3.1.0（SHEET_DEFAULT_VERSION）とする。
 * 今の版とも、比べてよい前の版（MEASURE_COMPATIBLE）とも違う版の行があれば止める。数字の無い行は版を見ない。
 */
export function snapshotFromSheet(tables: ReadonlyMap<string, Cell[][]>, measureVersion: string): Snapshot {
  const table = (name: string, need: string[], optional = false) => {
    const rows = tables.get(name);
    if (!rows) {
      if (optional) return [];
      throw new Error(`シートに「${name}」のタブがありません`);
    }
    const h = rows.findIndex((r) => r.some((c) => String(c ?? '').trim() === '人物ID'));
    if (h < 0) throw new Error(`「${name}」に「人物ID」がある見出しの行がありません`);
    const at = new Map(rows[h]!.map((c, i) => [String(c ?? '').trim(), i]));
    const missing = need.filter((l) => !at.has(l));
    if (missing.length) throw new Error(`「${name}」に無い見出し: ${missing.join('・')}（測り方や項目が今のサイトと違うかもしれません）`);
    const id = at.get('人物ID')!;
    return rows.slice(h + 1).filter((r) => String(r[id] ?? '').trim()).map((r) => (l: string) => (at.has(l) ? (r[at.get(l)!] ?? null) : null));
  };
  const str = (c: Cell) => (c === null ? null : String(c).trim() || null);
  const peoples = table('人物一覧', ['人物ID', '氏名', '所属区分', '現在所属', '公式プロフィール']).map((get) => ({
    personId: str(get('人物ID'))!,
    name: str(get('氏名')) ?? '',
    groupId: str(get('所属区分ID')),
    groupName: str(get('所属区分')),
    currentAffiliation: str(get('現在所属')),
    officialProfile: str(get('公式プロフィール')),
    kinds: str(get('大枠')),
    nameEn: str(get('英語名')),
    groupEn: str(get('所属の英語名')),
  }));
  const labels = FEATURE_KEYS.map(sheetLabel);
  const row = (get: (l: string) => Cell, video: string): Snapshot['measurements'][number] => ({
    personId: str(get('人物ID'))!,
    videoId: str(get(video)) ?? '',
    ...Object.fromEntries(
      FEATURE_KEYS.map((k, i) => {
        const c = get(labels[i]!);
        const x = typeof c === 'number' ? c : c === null || String(c).trim() === '' ? null : Number(c);
        return [k, x !== null && Number.isFinite(x) ? x : null];
      }),
    ),
  });
  // 版は、数字のある行だけで確かめる（まだ測っていない行は、測定バージョンが空のことがある）
  const withVersion = (tab: string, rows: { version: string | null; m: Snapshot['measurements'][number] }[], blankIs: string | null) => {
    const got = rows.filter((x) => FEATURE_KEYS.some((k) => x.m[k] !== null)).map((x) => ({ ...x, version: x.version ?? blankIs }));
    const bad = [...new Set(got.map((x) => x.version).filter((v) => !readableVersion(v, measureVersion)))];
    if (bad.length) throw new Error(`「${tab}」の数字のある行に、今のサイト（${measureVersion}）と比べられない測り方の版があります: ${bad.map((v) => v ?? '（空）').join('・')}`);
    return got.map((x) => ({ ...x.m, measureVersion: x.version! }));
  };
  const main = withVersion('声の測定値', table('声の測定値', ['人物ID', '出典動画ID', ...labels]).map((get) => ({ version: str(get('測定バージョン')), m: row(get, '出典動画ID') })), SHEET_DEFAULT_VERSION);
  const extra = withVersion(EXTRA_TAB, table(EXTRA_TAB, ['人物ID', '追加動画ID', '測定バージョン', ...labels], true).map((get) => ({ version: str(get('測定バージョン')), m: row(get, '追加動画ID') })), null);
  const measurements = [...main, ...extra];
  // データの版は、数字のある行の版（3.1.0 の行が混ざっていれば 3.1.0 も。書き出すファイルには、使った窓の中でいちばん古い版を書く）
  const versions = [...new Set(measurements.map((m) => m.measureVersion))].sort();
  return { summary: { measureVersions: versions.length ? versions : [measureVersion] }, peoples, measurements };
}
