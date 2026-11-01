// セリフ真似: お手本の 1 つのセリフと、同じセリフを真似した声を、高さの動き（抑揚）と言うタイミングで比べる。DOM なし・乱数なし。
// 1. 2 つの動き（measure.ts の Contour）を、大きさの形と、自分の真ん中からの高さの動きで、時間を伸び縮みさせてそろえる（DTW）。
// 2. 抑揚: そろえた所どうしの「自分の真ん中からの高さ」のずれ（半音）の二乗平均から 100·exp(−(rms/2)²)。
//    声の高さそのもの（高い・低い）は、声の質の点（mimic.ts）で見る。ここでは上がり下がりの形だけ。
// 3. タイミング: 全体の長さの比と、途中の伸び縮みのずれから。
// 4. 直し方: 出だし・真ん中・語尾のどこで、上げすぎ・下げすぎか。長さが違えば、速く・ゆっくり。
// 幅（2 半音など）は暫定。本物の声で、同じ人が同じセリフを 2 回言った時のずれが分かったら見直す。
import type { Contour } from '../voice/measure.ts';
import { t } from '../i18n.ts';

/** セリフとして比べる長さの上限（話しはじめから話し終わりまで、秒）。これより長いお手本は声全体で比べる */
export const LINE_MAX_SECONDS = 12;
/** 抑揚の点の幅（半音） */
export const INTONATION_WIDTH = 2;
/** タイミングの点の幅: 長さの比（log）と、途中のずれ（全体に対する割合） */
export const LENGTH_WIDTH = 0.5;
export const DRIFT_WIDTH = 0.08;
/** 直し方を出す、出だし・真ん中・語尾の平均のずれ（半音）と、長さの比 */
export const TIP_SEMITONES = 1.5;
export const TIP_LENGTH = 1.2;
/** 比べるのに要る、両方に声がある所の数 */
export const MIN_PAIRS = 10;

export interface LineTip {
  text: string;
  /** 大きいほど先に出す */
  size: number;
}
export interface LineResult {
  /** 0〜100 */
  intonation: number;
  timing: number;
  /** お手本の時間（こま）に合わせた、あなたの高さ（半音、100 Hz が 0。声の無い所は NaN） */
  warped: Float32Array;
  /** 長さ（秒） */
  refSeconds: number;
  mineSeconds: number;
  tips: LineTip[];
}

const finite = (v: number) => Number.isFinite(v);
function medianOf(v: ArrayLike<number>): number {
  const a = Array.from(v).filter(finite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/** 2 つの動きをそろえる道（お手本のこま i ごとに、あなたのこま j の並び）。帯の外は通らない */
function align(a: Contour, b: Contour, ra: number, rb: number): number[][] {
  const n = a.pitch.length,
    m = b.pitch.length;
  const cost = (i: number, j: number) => {
    const la = (a.level[i]! + 40) / 40,
      lb = (b.level[j]! + 40) / 40;
    const pa = a.pitch[i]!,
      pb = b.pitch[j]!;
    let c = Math.abs(la - lb);
    if (finite(pa) && finite(pb)) c += Math.min(Math.abs(pa - ra - (pb - rb)), 12) / 10;
    else if (finite(pa) !== finite(pb)) c += 0.5;
    return c;
  };
  const band = 0.3;
  const INF = 1e18;
  const D = new Float64Array(n * m).fill(INF);
  const inBand = (i: number, j: number) => Math.abs(i / Math.max(1, n - 1) - j / Math.max(1, m - 1)) <= band;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      if (!inBand(i, j)) continue;
      const c = cost(i, j);
      if (i === 0 && j === 0) {
        D[0] = c;
        continue;
      }
      // (a straight step costs the frame; a step that holds one side costs a little more, so the path keeps near straight)
      let best = INF;
      if (i > 0 && j > 0) best = Math.min(best, D[(i - 1) * m + j - 1]! + c);
      if (i > 0) best = Math.min(best, D[(i - 1) * m + j]! + c * 1.1 + 0.02);
      if (j > 0) best = Math.min(best, D[i * m + j - 1]! + c * 1.1 + 0.02);
      D[i * m + j] = best;
    }
  const path: number[][] = Array.from({ length: n }, () => []);
  let i = n - 1,
    j = m - 1;
  path[i]!.push(j);
  while (i > 0 || j > 0) {
    const diag = i > 0 && j > 0 ? D[(i - 1) * m + j - 1]! : INF,
      up = i > 0 ? D[(i - 1) * m + j]! : INF,
      left = j > 0 ? D[i * m + j - 1]! : INF;
    if (diag <= up && diag <= left) {
      i--;
      j--;
    } else if (up <= left) i--;
    else j--;
    path[i]!.push(j);
  }
  return path;
}

/** お手本のセリフ `ref` と、真似した声 `mine` を比べる。両方に声のある所が MIN_PAIRS より少なければ null */
export function compareLines(ref: Contour, mine: Contour): LineResult | null {
  const n = ref.pitch.length,
    m = mine.pitch.length;
  if (n < 3 || m < 3) return null;
  const ra = medianOf(ref.pitch),
    rb = medianOf(mine.pitch);
  if (!finite(ra) || !finite(rb)) return null;
  const path = align(ref, mine, ra, rb);

  const warped = new Float32Array(n).fill(NaN);
  let sq = 0,
    pairs = 0,
    drift = 0,
    steps = 0;
  const diffs: { at: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    const js = path[i]!;
    let s = 0,
      c = 0;
    for (const j of js) {
      drift += Math.abs(i / Math.max(1, n - 1) - j / Math.max(1, m - 1));
      steps++;
      if (finite(mine.pitch[j]!)) {
        s += mine.pitch[j]!;
        c++;
      }
    }
    if (c) warped[i] = Math.round((s / c) * 100) / 100;
    const p = ref.pitch[i]!;
    if (finite(p) && c) {
      // (+: yours goes higher than the model's here, each from its own middle)
      const d = warped[i]! - rb - (p - ra);
      sq += d * d;
      pairs++;
      diffs.push({ at: i / Math.max(1, n - 1), d });
    }
  }
  if (pairs < MIN_PAIRS) return null;
  const rms = Math.sqrt(sq / pairs);
  const intonation = Math.round(100 * Math.exp(-((rms / INTONATION_WIDTH) ** 2)));
  const refSeconds = Math.round(n * ref.step * 100) / 100,
    mineSeconds = Math.round(m * mine.step * 100) / 100;
  const lenLog = Math.log(mineSeconds / refSeconds);
  const meanDrift = drift / Math.max(1, steps);
  const timing = Math.round(100 * Math.exp(-((lenLog / LENGTH_WIDTH) ** 2)) * Math.exp(-((meanDrift / DRIFT_WIDTH) ** 2)));

  const tips: LineTip[] = [];
  const parts: [string, string, number, number][] = [
    ['出だし', 'the start', 0, 0.3],
    ['真ん中', 'the middle', 0.3, 0.7],
    ['語尾', 'the ending', 0.7, 1.01],
  ];
  for (const [name, nameEn, lo, hi] of parts) {
    const ds = diffs.filter((x) => x.at >= lo && x.at < hi).map((x) => x.d);
    if (ds.length < 5) continue;
    const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
    if (Math.abs(mean) <= TIP_SEMITONES) continue;
    tips.push({ text: mean < 0 ? t(`${name}をもっと上げる`, `Raise ${nameEn} more`) : t(`${name}をもっと下げる`, `Lower ${nameEn} more`), size: Math.abs(mean) / TIP_SEMITONES });
  }
  const ratio = mineSeconds / refSeconds;
  const secs = t(`（お手本 ${refSeconds.toFixed(1)} 秒・あなた ${mineSeconds.toFixed(1)} 秒）`, ` (model ${refSeconds.toFixed(1)} s, you ${mineSeconds.toFixed(1)} s)`);
  if (ratio > TIP_LENGTH) tips.push({ text: t('もう少し速く言う', 'Say it a little faster') + secs, size: ratio / TIP_LENGTH });
  else if (ratio < 1 / TIP_LENGTH) tips.push({ text: t('もう少しゆっくり言う', 'Say it a little more slowly') + secs, size: 1 / ratio / TIP_LENGTH });
  tips.sort((a, b) => b.size - a.size || (a.text < b.text ? -1 : 1));
  return { intonation, timing, warped, refSeconds, mineSeconds, tips };
}

/** セリフ真似の点数: 抑揚 4・タイミング 2.5・声の質 3.5 の重み（声の質が出なければ、残りで） */
export function lineScore(line: Pick<LineResult, 'intonation' | 'timing'>, voice: number | null): number {
  const parts: [number, number][] = [
    [line.intonation, 0.4],
    [line.timing, 0.25],
  ];
  if (voice !== null) parts.push([voice, 0.35]);
  const w = parts.reduce((a, [, x]) => a + x, 0);
  return Math.round(parts.reduce((a, [v, x]) => a + v * x, 0) / w);
}
