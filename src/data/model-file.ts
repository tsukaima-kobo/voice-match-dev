// 照合のモデルのファイル（data/model.json。tools/eval.ts が作る）を使えるか確かめる。DOM なし。
// ビルド（vite.config.ts）は、使えない時に止める（黙って仮のモデルで公開しない）。ページ（load.ts）と取り込み（tools/intake.ts）も同じ決まり。
import { MEASURE_VERSION, readableVersion } from '../voice/measure.ts';
import type { MatchModel } from '../match/match.ts';

/** 使えない理由。使える時は null。version が "none" の物（まだモデルを作っていない印）は、使えない物として扱う */
export function modelProblem(json: unknown, measureVersion: string = MEASURE_VERSION): string | null {
  const m = (typeof json === 'object' && json !== null ? json : {}) as Partial<MatchModel>;
  if (typeof m.version !== 'string' || m.version === 'none') return 'data/model.json に照合のモデルがありません';
  if (!readableVersion(m.measureVersion, measureVersion)) return `data/model.json の測り方の版（${m.measureVersion ?? '書いていない'}）は、今のサイト（${measureVersion}）と比べられません`;
  const n = Array.isArray(m.keys) ? m.keys.length : -1;
  if (n <= 0 || [m.center, m.spread, m.weight].some((a) => !Array.isArray(a) || a.length !== n)) return 'data/model.json の形が違います（keys・center・spread・weight）';
  return null;
}
