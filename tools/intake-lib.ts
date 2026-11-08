// 声の登録の取り込みの計算（ファイルの読み書き・通信なし。test/intake.test.ts で試す）。
// フォームの回答の 1 行 = [タイムスタンプ, 送る内容, 判定, 理由]。判定は dots が書く（壁 ②。OK の行だけ使う）。
// 壁 ① をもう一度（ページの確認は回り込めるため）、禁止の言葉・削除済みの名前・1 日の上限・同じ数字の重なりを除き、
// 名前ごとに壁 ③（3 件以上そろったら中央値）で声にする。ID は名前（nameKey）から決まる（記録を持たずに、毎日同じ ID）。
import { checkSubmission, decodeSubmission, featuresOf, nameKey, type Submission } from '../src/submit/code.ts';
import { consensus } from '../src/submit/consensus.ts';
import { FEATURE_KEYS, type Features } from '../src/voice/features.ts';
import type { MatchModel } from '../src/match/match.ts';

export const INTAKE = {
  /** 1 日に受け付ける件数（壁 ② の後で数える。あふれた分は使わない） */
  perDay: 200,
  /** 1 つの名前について 1 日に受け付ける件数 */
  perNamePerDay: 3,
} as const;

export interface Row {
  at: string;
  code: string;
  verdict: string;
  reason: string;
}

export interface Accepted {
  at: string;
  key: string;
  name: string;
  group?: string;
  /** 大枠の印（src/data/kinds.ts） */
  kinds: number;
  link: string;
  quality: Submission['q'];
  features: Features;
}

export interface UserVoice {
  id: string;
  key: string;
  name: string;
  group?: string;
  /** 大枠の印: そろった登録の半分以上が選んだ物 */
  kinds: number;
  link: string;
  used: number;
  features: Features;
}

export type CountKey = 'rows' | 'pending' | 'judgedNg' | 'unreadable' | 'wall1' | 'ngWord' | 'blocked' | 'overDay' | 'overName' | 'duplicate' | 'accepted';

/** 表（シートや CSV）から行を取り出す。送る内容が無い行（見出しなど）は飛ばす */
export function rowsFromTable(table: readonly (readonly string[])[]): Row[] {
  return table.filter((r) => (r[1] ?? '').includes('voice-twin:')).map((r) => ({ at: (r[0] ?? '').trim(), code: r[1] ?? '', verdict: r[2] ?? '', reason: r[3] ?? '' }));
}

/** タイムスタンプの日付（"2026/11/01 12:34:56" → "2026-11-01"）。読めなければ "unknown" */
export function dayOf(at: string): string {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(at.trim());
  return m ? `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}` : 'unknown';
}

/** いちばん多い物（同じ数なら先に出た物） */
function mostCommon(values: readonly string[]): string | undefined {
  const n = new Map<string, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  let best: string | undefined,
    bestN = 0;
  for (const v of values) if (n.get(v)! > bestN) [best, bestN] = [v, n.get(v)!];
  return best;
}

/** 名前（nameKey）から決まる声の ID（u- と 11 文字。53 ビットのハッシュ cyrb53）。運営の声の ID（v-）とは重ならない */
export function userIdOf(key: string): string {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `u-${n.toString(36).padStart(11, '0')}`;
}

export function intake(rows: readonly Row[], o: { model: MatchModel; ngWords: readonly string[]; blocked: readonly string[] }): { accepted: Accepted[]; voices: UserVoice[]; counts: Record<CountKey, number> } {
  const counts = Object.fromEntries((['rows', 'pending', 'judgedNg', 'unreadable', 'wall1', 'ngWord', 'blocked', 'overDay', 'overName', 'duplicate', 'accepted'] as CountKey[]).map((k) => [k, 0])) as Record<CountKey, number>;
  const blocked = new Set(o.blocked.map(nameKey));
  const ng = o.ngWords.map(nameKey).filter(Boolean);
  const perDay = new Map<string, number>();
  const perName = new Map<string, number>();
  const seen = new Set<string>();
  const accepted: Accepted[] = [];
  for (const row of rows) {
    counts.rows++;
    const verdict = row.verdict.trim().toUpperCase();
    if (!verdict) {
      counts.pending++;
      continue;
    }
    if (verdict !== 'OK') {
      counts.judgedNg++;
      continue;
    }
    const s = decodeSubmission(row.code);
    if (!s) {
      counts.unreadable++;
      continue;
    }
    if (checkSubmission(s).length) {
      counts.wall1++;
      continue;
    }
    const key = nameKey(s.n);
    if (blocked.has(key)) {
      counts.blocked++;
      continue;
    }
    const text = nameKey(`${s.n} ${s.g ?? ''}`);
    if (ng.some((w) => text.includes(w))) {
      counts.ngWord++;
      continue;
    }
    const day = dayOf(row.at);
    if ((perDay.get(day) ?? 0) >= INTAKE.perDay) {
      counts.overDay++;
      continue;
    }
    const nk = `${day} ${key}`;
    if ((perName.get(nk) ?? 0) >= INTAKE.perNamePerDay) {
      counts.overName++;
      continue;
    }
    const same = `${key} ${JSON.stringify(s.f)}`;
    if (seen.has(same)) {
      counts.duplicate++;
      continue;
    }
    seen.add(same);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    perName.set(nk, (perName.get(nk) ?? 0) + 1);
    counts.accepted++;
    accepted.push({ at: row.at, key, name: s.n.trim(), ...(s.g?.trim() ? { group: s.g.trim() } : {}), kinds: s.k ?? 0, link: s.l.trim(), quality: s.q, features: featuresOf(s) });
  }

  // 壁 ③: 名前ごとに、その名前が初めて来た順で
  const keys = [...new Set(accepted.map((a) => a.key))];
  const used = new Set<string>();
  const voices: UserVoice[] = [];
  for (const key of keys) {
    const items = accepted.filter((a) => a.key === key);
    const c = consensus(o.model, items);
    if (!c) continue;
    // 2 つの名前が同じ ID になることは、まず無い。もし起きたら、後の方に印を付ける
    let id = userIdOf(key);
    for (let n = 2; used.has(id); n++) id = `${userIdOf(key)}-${n}`;
    used.add(id);
    const group = mostCommon(items.map((a) => a.group ?? '').filter(Boolean));
    voices.push({ id, key, name: mostCommon(items.map((a) => a.name))!, ...(group ? { group } : {}), kinds: majorityKinds(items.map((a) => a.kinds)), link: mostCommon(items.map((a) => a.link))!, used: c.used, features: c.features });
  }
  voices.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { accepted, voices, counts };
}

/** 大枠: 半分以上の登録が選んだ印だけ（1 件だけのいたずらで、ほかの大枠に出ないように） */
export function majorityKinds(masks: readonly number[]): number {
  let out = 0;
  for (let bit = 0; bit < 16; bit++) if (masks.filter((m) => (m & (1 << bit)) !== 0).length * 2 >= masks.length && masks.length > 0) out |= 1 << bit;
  return out;
}

/** 数字の並びを features の順の配列に（ファイルを小さく、読みやすく） */
export const featureArray = (f: Features): (number | null)[] => FEATURE_KEYS.map((k) => f[k]);
