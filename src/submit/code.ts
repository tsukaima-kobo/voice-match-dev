// 声の登録（アキネーター方式）の「送る内容」: 作る・読む・確かめる（壁 ①）。DOM なし・乱数なし。
// 声真似の点数のページ（mimic.html）が、利用者が聞かせたお手本の数字から作り、利用者が Google フォームに貼って送る。
// 受け取った後に tools/intake.ts がもう一度確かめる（ページの確認は回り込めるため）。
// 入るのは数字・名前・所属や作品名・公式ページのリンク・測り方と測れた声の質だけ。音は入らない。送った人の情報も入らない。
import { FEATURE_BY_KEY, FEATURE_KEYS, roundFeature, type FeatureKey, type Features } from '../voice/features.ts';
import { MEASURE_VERSION } from '../voice/measure.ts';
import { t } from '../i18n.ts';

/** 送る内容の頭（フォームの回答の中から見つけるため） */
export const CODE_PREFIX = 'voice-twin:';

export interface Submission {
  /** 形の版 */
  v: 1;
  /** 測り方の版（MEASURE_VERSION）。違う版の数字は使わない */
  m: string;
  /** 名前 */
  n: string;
  /** 所属や作品名（任意） */
  g?: string;
  /** 公式ページのリンク */
  l: string;
  /** 測れた声の質: 声の秒数・間の音楽らしさ・声と静かな所の差（dB） */
  q: { vs: number; gt: number; snr: number };
  /** 数字（FEATURE_KEYS の順、無い項目は null） */
  f: (number | null)[];
  /** 「公開されている声で、一般の人の声ではない」に印をつけた */
  ok: boolean;
}

/** 壁 ① の決まり */
export const LIMITS = {
  name: 40,
  group: 40,
  link: 300,
  /** 測れた声（秒） */
  minVoiced: 8,
  /** 間に音楽が続く割合（tools/lib.ts の SELECT と同じ） */
  maxGapTonal: 0.3,
  /** 声と静かな所の差（dB） */
  minSnr: 15,
} as const;

/** 人の声としてありうる幅（広め。外れたら壊れた数字か、作った数字） */
export const PLAUSIBLE: Record<FeatureKey, [number, number]> = {
  pitch: [50, 700],
  pitchRange: [0, 36],
  pitchSkew: [-24, 24],
  pitchMotion: [0, 200],
  f1: [150, 1400],
  f2: [500, 3600],
  f3: [1200, 4800],
  f4: [2400, 5600],
  formantSpacing: [500, 2000],
  f1Range: [0, 40],
  f2Range: [0, 40],
  b1: [0, 600],
  b2: [0, 600],
  centroid: [200, 5000],
  hammarberg: [-20, 80],
  slopeLow: [-300, 300],
  slopeMid: [-150, 100],
  mfcc1: [-100, 100],
  mfcc2: [-100, 100],
  mfcc3: [-100, 100],
  mfcc4: [-100, 100],
  mfcc5: [-100, 100],
  mfcc6: [-100, 100],
  mfcc7: [-100, 100],
  mfcc8: [-100, 100],
  mfcc9: [-100, 100],
  mfcc10: [-100, 100],
  mfcc11: [-100, 100],
  mfcc12: [-100, 100],
  mfcc13: [-100, 100],
  mfccDelta: [0, 50],
  hnr: [-10, 60],
  cpp: [0, 60],
  h1h2: [-40, 40],
  jitter: [0, 0.3],
  shimmer: [0, 1],
  rate: [0.5, 15],
  rateVar: [0, 3],
  pauseShare: [0, 1],
  pauseLen: [0.25, 10],
  runLen: [0.05, 40],
  rhythm: [0, 200],
  voicedShare: [0, 1],
  levelRange: [0, 80],
  tilt: [-80, 40],
};
/** 無いと使えない項目 */
export const REQUIRED: readonly FeatureKey[] = ['pitch', 'pitchRange', 'f1', 'f2', 'f3', 'hnr', 'rate'];

/** 短縮 URL（行き先が分からないので受け付けない） */
const SHORTENERS = ['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'is.gd', 'ow.ly', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'x.gd', 'amzn.to'];

export function makeSubmission(o: { name: string; group?: string; link: string; quality: { voicedSeconds: number; gapTonal: number; snrDb: number }; features: Features; consent: boolean }): Submission {
  const g = o.group?.trim();
  return {
    v: 1,
    m: MEASURE_VERSION,
    n: o.name.trim(),
    ...(g ? { g } : {}),
    l: o.link.trim(),
    q: { vs: Math.round(o.quality.voicedSeconds * 10) / 10, gt: Math.round(o.quality.gapTonal * 1000) / 1000, snr: Math.round(o.quality.snrDb * 10) / 10 },
    f: FEATURE_KEYS.map((k) => o.features[k]),
    ok: o.consent,
  };
}

export const encodeSubmission = (s: Submission): string => CODE_PREFIX + JSON.stringify(s);

/** 送る内容を読む（前後の文字は無視）。形が違えば null */
export function decodeSubmission(text: string): Submission | null {
  const at = text.indexOf(CODE_PREFIX);
  if (at < 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(at + CODE_PREFIX.length).trim());
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const q = o.q as Record<string, unknown> | undefined;
  const ok =
    o.v === 1 &&
    typeof o.m === 'string' &&
    typeof o.n === 'string' &&
    (o.g === undefined || typeof o.g === 'string') &&
    typeof o.l === 'string' &&
    typeof q === 'object' &&
    q !== null &&
    typeof q.vs === 'number' &&
    typeof q.gt === 'number' &&
    typeof q.snr === 'number' &&
    Array.isArray(o.f) &&
    o.f.every((x) => x === null || typeof x === 'number') &&
    typeof o.ok === 'boolean';
  return ok ? (raw as Submission) : null;
}

/** 名前を比べるための形（全角・半角や大文字・小文字、空白と記号の違いをそろえる） */
export function nameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・･、。,.\-_~〜!！?？'"“”‘’()（）[\]［］【】「」『』]/g, '');
}

export function featuresOf(s: Submission): Features {
  return Object.fromEntries(FEATURE_KEYS.map((k, i) => [k, s.f[i] ?? null])) as Features;
}

export interface Problem {
  kind: 'version' | 'shape' | 'consent' | 'name' | 'group' | 'link' | 'quality' | 'missing' | 'range' | 'order';
  text: string;
}

/** 壁 ①: 送る内容を確かめる。問題が無ければ空の配列 */
export function checkSubmission(s: Submission): Problem[] {
  const out: Problem[] = [];
  if (s.m !== MEASURE_VERSION) out.push({ kind: 'version', text: t(`測り方の版が違います（${s.m}。今は ${MEASURE_VERSION}）。ページを読み直して、測り直してください。`, `It was measured with another version (${s.m}; now ${MEASURE_VERSION}). Reload the page and measure again.`) });
  if (s.f.length !== FEATURE_KEYS.length) {
    out.push({ kind: 'shape', text: t('数字の数が合いません。', 'The number of values does not match.') });
    return out;
  }
  if (!s.ok) out.push({ kind: 'consent', text: t('「公開されている声で、一般の人の声ではない」に印をつけてください。', 'Tick “this is a public voice, not a private person’s”.') });
  const name = s.n.trim();
  if (!name || [...name].length > LIMITS.name || /[\u0000-\u001f\u007f]/.test(name) || /https?:|www\./i.test(name)) out.push({ kind: 'name', text: t(`名前は 1〜${LIMITS.name} 文字で、URL を入れないでください。`, `The name must be 1–${LIMITS.name} characters, without a URL.`) });
  if (s.g !== undefined && ([...s.g].length > LIMITS.group || /[\u0000-\u001f\u007f]/.test(s.g) || /https?:/i.test(s.g))) out.push({ kind: 'group', text: t(`所属・作品名は ${LIMITS.group} 文字までで、URL を入れないでください。`, `The agency or title must be up to ${LIMITS.group} characters, without a URL.`) });
  const linkProblem = checkLink(s.l);
  if (linkProblem) out.push({ kind: 'link', text: linkProblem });
  if (!(s.q.vs >= LIMITS.minVoiced)) out.push({ kind: 'quality', text: t(`測れた声が ${LIMITS.minVoiced} 秒に足りません。`, `Less than ${LIMITS.minVoiced} s of voice was measured.`) });
  if (!(s.q.gt <= LIMITS.maxGapTonal)) out.push({ kind: 'quality', text: t('声の間に音楽が続いています。BGM の無い所で測り直してください。', 'Music keeps playing between the words. Measure again from a part without BGM.') });
  if (!(s.q.snr >= LIMITS.minSnr)) out.push({ kind: 'quality', text: t('声のほかの音が大きすぎます。静かな所で測り直してください。', 'Other sounds are too loud. Measure again somewhere quiet.') });
  const f = featuresOf(s);
  const missing = REQUIRED.filter((k) => f[k] === null);
  if (missing.length) out.push({ kind: 'missing', text: t(`測れなかった項目があります（${missing.map((k) => FEATURE_BY_KEY[k].name).join('・')}）。`, `Some items could not be measured (${missing.map((k) => FEATURE_BY_KEY[k].name).join(', ')}).`) });
  const bad = FEATURE_KEYS.filter((k) => {
    const v = f[k];
    if (v === null) return false;
    const [lo, hi] = PLAUSIBLE[k];
    return !Number.isFinite(v) || v < lo || v > hi || roundFeature(k, v) !== v;
  });
  if (bad.length) out.push({ kind: 'range', text: t(`ありえない数字があります（${bad.map((k) => FEATURE_BY_KEY[k].name).join('・')}）。`, `Some values are impossible (${bad.map((k) => FEATURE_BY_KEY[k].name).join(', ')}).`) });
  const fs = [f.f1, f.f2, f.f3, f.f4].filter((x): x is number => x !== null);
  if (fs.some((x, i) => i > 0 && !(x > fs[i - 1]!))) out.push({ kind: 'order', text: t('フォルマントの順番がおかしい数字です。', 'The formants are out of order.') });
  return out;
}

/** 公式ページのリンクの確かめ（https・人の名前の入らない普通の住所・短縮 URL でない）。問題が無ければ null */
export function checkLink(link: string): string | null {
  if (!link || link.length > LIMITS.link) return t(`公式ページの URL を入れてください（${LIMITS.link} 文字まで）。`, `Enter the URL of an official page (up to ${LIMITS.link} characters).`);
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return t('公式ページの URL の形になっていません。', 'This is not a URL of a page.');
  }
  if (u.protocol !== 'https:') return t('URL は https:// で始まる物にしてください。', 'The URL must start with https://.');
  if (u.username || u.password) return t('URL にユーザー名やパスワードを入れないでください。', 'Do not put a user name or password in the URL.');
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost') return t('公式ページの URL にしてください。', 'Use the URL of an official page.');
  if (SHORTENERS.some((s) => host === s || host.endsWith(`.${s}`))) return t('短縮 URL は使えません。元の URL を入れてください。', 'Short links cannot be used. Enter the original URL.');
  return null;
}
