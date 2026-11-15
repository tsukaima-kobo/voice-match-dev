// 照合のモデルのファイル（data/model.json。tools/eval.ts が作る）を使えるか確かめる。DOM なし。
// ビルド（vite.config.ts）は、使えない時に止める（黙って仮のモデルで公開しない）。ページ（load.ts）と取り込み（tools/intake.ts）も同じ決まり。
import { MEASURE_VERSION, readableVersion } from '../voice/measure.ts';
import { FEATURE_KEYS } from '../voice/features.ts';
import type { MatchModel } from '../match/match.ts';

/** 使えない理由。使える時は null。version が "none" の物（まだモデルを作っていない印）は、使えない物として扱う */
export function modelProblem(json: unknown, measureVersion: string = MEASURE_VERSION): string | null {
  const m = (typeof json === 'object' && json !== null ? json : {}) as Partial<MatchModel>;
  if (typeof m.version !== 'string' || m.version === 'none') return 'data/model.json に照合のモデルがありません';
  if (!readableVersion(m.measureVersion, measureVersion)) return `data/model.json の測り方の版（${m.measureVersion ?? '書いていない'}）は、今のサイト（${measureVersion}）と比べられません`;
  const n = Array.isArray(m.keys) ? m.keys.length : -1;
  if (n <= 0 || [m.center, m.spread, m.weight].some((a) => !Array.isArray(a) || a.length !== n)) return 'data/model.json の形が違います（keys・center・spread・weight）';
  // 照合（match.ts）が読む所も確かめる。項目の名前・行列の大きさ・目安の形が違うと、ページで近い声を出す所が落ちる
  const unknown = m.keys!.filter((k) => !(FEATURE_KEYS as readonly string[]).includes(k));
  if (unknown.length) return `data/model.json に、今のサイトに無い項目があります（${unknown.join('・')}）`;
  const nums = (a: unknown, len: number) => Array.isArray(a) && a.length === len && a.every((x) => typeof x === 'number' && Number.isFinite(x));
  const square = (a: unknown) => Array.isArray(a) && a.length === n && a.every((row) => nums(row, n));
  if (m.whiten !== undefined && !square(m.whiten)) return 'data/model.json の形が違います（whiten）';
  if (m.people !== undefined && !(nums(m.people?.mean, n) && square(m.people?.cov))) return 'data/model.json の形が違います（people）';
  const l = m.likeness;
  if (l !== undefined && ![l, ...Object.values(l?.kinds ?? {})].every((s) => typeof s?.typical === 'number' && nums(s.cuts, 3))) return 'data/model.json の形が違います（likeness）';
  return null;
}
