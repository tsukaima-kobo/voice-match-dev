// 長い音を 30 秒ずつに分けて測り、項目ごとの中央値で 1 つにまとめる。DOM なし・乱数なし。
// 声真似の練習のお手本（音声ファイル）と、tools/ のお手本の代表値づくり（medianFeatures）で使う。
// 音は受け取った配列のまま読むだけで、写しを残さない。
import { FEATURE_KEYS, roundFeature, type Features } from './features.ts';
import { measureVoice, quantileOf, type MeasureFail } from './measure.ts';

/** 1 つの窓の長さ（秒）。拡張機能の窓と同じ */
export const LONG_WINDOW_SECONDS = 30;
/** 長い音は、最初のこれだけを使う（秒） */
export const LONG_MAX_SECONDS = 180;
/** 窓 1 つに要る声（秒）。足りない窓は使わない */
export const LONG_MIN_WINDOW_VOICED = 4;

/** 項目ごとの中央値（無い項目は除いて。全部無ければ null） */
export function medianFeatures(windows: readonly { features: Features }[]): Features {
  const out = {} as Features;
  for (const k of FEATURE_KEYS) {
    const v = windows.map((w) => w.features[k]).filter((x): x is number => x !== null && Number.isFinite(x));
    out[k] = v.length ? roundFeature(k, quantileOf(v, 0.5)) : null;
  }
  return out;
}

export type LongMeasured =
  | { ok: true; features: Features; windows: number; voicedSeconds: number; seconds: number; gapTonal: number; snrDb: number }
  | { ok: false; reason: MeasureFail; voicedSeconds: number; seconds: number };

export interface LongOptions {
  /** 全体で要る声（秒） */
  minVoicedSeconds: number;
  /** 窓を 1 つ測るごとに呼ぶ（画面の進み具合用） */
  onProgress?: (done: number, total: number) => void;
  /** 窓と窓の間に待つ（画面を止めないため）。既定は setTimeout 0 */
  pause?: () => Promise<void>;
}

/** 長い音を測る。40 秒以下なら 1 回で、それより長ければ 30 秒ずつ（最初の 3 分まで）測って中央値 */
export async function measureLong(pcm: Float32Array, rate: number, opts: LongOptions): Promise<LongMeasured> {
  const pause = opts.pause ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const n = Math.min(pcm.length, Math.floor(LONG_MAX_SECONDS * rate));
  const seconds = Math.round((n / rate) * 10) / 10;
  if (n <= 40 * rate) {
    opts.onProgress?.(0, 1);
    await pause();
    const m = measureVoice(pcm.subarray(0, n), rate, { minVoicedSeconds: opts.minVoicedSeconds });
    opts.onProgress?.(1, 1);
    if (!m.ok) return { ok: false, reason: m.reason, voicedSeconds: m.info.voicedSeconds ?? 0, seconds };
    return { ok: true, features: m.features, windows: 1, voicedSeconds: m.info.voicedSeconds, seconds, gapTonal: m.info.gapTonal, snrDb: m.info.loudDb - m.info.floorDb };
  }
  const step = Math.floor(LONG_WINDOW_SECONDS * rate);
  const starts: number[] = [];
  // 最後の切れ端が 10 秒より短ければ使わない
  for (let s = 0; s < n; s += step) if (n - s >= 10 * rate) starts.push(s);
  const good: { features: Features }[] = [];
  const tonal: number[] = [],
    snr: number[] = [];
  let voiced = 0;
  let worst: { reason: MeasureFail; voiced: number } | null = null;
  for (let i = 0; i < starts.length; i++) {
    opts.onProgress?.(i, starts.length);
    await pause();
    const s = starts[i]!;
    const m = measureVoice(pcm.subarray(s, Math.min(n, s + step)), rate, { minVoicedSeconds: LONG_MIN_WINDOW_VOICED });
    if (m.ok) {
      good.push({ features: m.features });
      tonal.push(m.info.gapTonal);
      snr.push(m.info.loudDb - m.info.floorDb);
      voiced += m.info.voicedSeconds;
    } else {
      const v = m.info.voicedSeconds ?? 0;
      // 伝える理由は、声がいちばん多かった窓の物（いちばん測れそうだった窓）
      if (!worst || v > worst.voiced) worst = { reason: m.reason, voiced: v };
    }
  }
  opts.onProgress?.(starts.length, starts.length);
  voiced = Math.round(voiced * 10) / 10;
  if (!good.length) return { ok: false, reason: worst?.reason ?? 'short', voicedSeconds: worst?.voiced ?? 0, seconds };
  if (voiced < opts.minVoicedSeconds) return { ok: false, reason: 'short', voicedSeconds: voiced, seconds };
  return { ok: true, features: medianFeatures(good), windows: good.length, voicedSeconds: voiced, seconds, gapTonal: quantileOf(tonal, 0.5), snrDb: quantileOf(snr, 0.5) };
}
