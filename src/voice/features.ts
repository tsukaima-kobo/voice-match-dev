// 声の項目の定義（measure.ts が出す 45 項目の名前・単位・説明・画面の目盛り）。DOM なし。
// 数字は自然な単位のまま持つ（Hz・半音・dB・秒など）。真似の点数（src/mimic/mimic.ts）は、ここの `log` を見て
// Hz の項目を比で比べる。画面の 0〜1（`lo`〜`hi`）は見せ方だけの暫定の値で、
// 点数には使わない（2026-10-31、文献の典型値から。人の声のデータで見直す）。
// 声から性別や年齢は判断しない。項目は声の音の性質だけ。

export const FEATURE_KEYS = [
  // 高さ
  'pitch',
  'pitchRange',
  'pitchSkew',
  'pitchMotion',
  // 響き（口と喉の形）
  'f1',
  'f2',
  'f3',
  'f4',
  'formantSpacing',
  'f1Range',
  'f2Range',
  'b1',
  'b2',
  'centroid',
  'hammarberg',
  'slopeLow',
  'slopeMid',
  'mfcc1',
  'mfcc2',
  'mfcc3',
  'mfcc4',
  'mfcc5',
  'mfcc6',
  'mfcc7',
  'mfcc8',
  'mfcc9',
  'mfcc10',
  'mfcc11',
  'mfcc12',
  'mfcc13',
  'mfccDelta',
  // 声の質
  'hnr',
  'cpp',
  'h1h2',
  'jitter',
  'shimmer',
  // 時間
  'rate',
  'rateVar',
  'pauseShare',
  'pauseLen',
  'runLen',
  'rhythm',
  'voicedShare',
  // 強さ
  'levelRange',
  'tilt',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
/** 測れなかった項目は null（例: 30 秒の中に間が 1 つも無ければ「間の長さ」は無い） */
export type Features = Record<FeatureKey, number | null>;

export type FeatureGroup = 'pitch' | 'timbre' | 'quality' | 'time' | 'strength';
export const GROUP_NAMES: Record<FeatureGroup, string> = {
  pitch: '高さ',
  timbre: '響き',
  quality: '声の質',
  time: '話す速さと間',
  strength: '強さ',
};

export interface FeatureDef {
  key: FeatureKey;
  group: FeatureGroup;
  /** 画面での名前 */
  name: string;
  /** 単位（画面用） */
  unit: string;
  /** 何を測っているか（画面用、短く） */
  about: string;
  /** 画面の目盛りの 0 と 1（暫定）。`log` なら対数で */
  lo: number;
  hi: number;
  /** 点数と目盛りで対数にするか（Hz の物） */
  log: boolean;
  /** 0 側・1 側の言葉 */
  low: string;
  high: string;
  /** 数字を丸める小数の桁（同じ音なら、どの端末でも同じ数字にするため） */
  digits: number;
  /** 照合の仮のモデル（tools/eval.ts がモデルを作る前）での重み。既定 1 */
  prior?: number;
  /** 画面では「細かい項目」に畳み、「似ている所・違う所」には出さない（意味を言葉にしにくい項目） */
  detail?: boolean;
}

const def = (d: FeatureDef) => d;

export const FEATURES: readonly FeatureDef[] = [
  def({ key: 'pitch', group: 'pitch', name: '声の高さ', unit: 'Hz', about: '話している時の声の高さの中央値', lo: 80, hi: 320, log: true, low: '低い', high: '高い', digits: 1 }),
  def({ key: 'pitchRange', group: 'pitch', name: '抑揚', unit: '半音', about: '声の高さの上がり下がりの幅（10〜90%）', lo: 1.5, hi: 13.5, log: false, low: '平ら', high: '大きい', digits: 2 }),
  def({ key: 'pitchSkew', group: 'pitch', name: '高さの偏り', unit: '半音', about: '中央から上への広がりと、下への広がりの差（90%−中央 と 中央−10%）', lo: -4, hi: 4, log: false, low: '下に広い', high: '上に広い', digits: 2 }),
  def({ key: 'pitchMotion', group: 'pitch', name: '高さの動きの速さ', unit: '半音/秒', about: '声の高さが動く速さ（中央値）', lo: 4, hi: 30, log: false, low: 'ゆっくり', high: '速い', digits: 1 }),

  def({ key: 'f1', group: 'timbre', name: '第1フォルマント', unit: 'Hz', about: '口の開き方で決まる響き（F1）', lo: 350, hi: 900, log: true, low: '低い', high: '高い', digits: 0 }),
  def({ key: 'f2', group: 'timbre', name: '第2フォルマント', unit: 'Hz', about: '舌の前後で決まる響き（F2）', lo: 1100, hi: 2200, log: true, low: '低い', high: '高い', digits: 0 }),
  def({ key: 'f3', group: 'timbre', name: '第3フォルマント', unit: 'Hz', about: '声の通り道全体の響き（F3）', lo: 2300, hi: 3500, log: true, low: '低い', high: '高い', digits: 0 }),
  def({ key: 'f4', group: 'timbre', name: '第4フォルマント', unit: 'Hz', about: '喉の奥の形で決まる響き（F4）', lo: 3200, hi: 4800, log: true, low: '低い', high: '高い', digits: 0 }),
  def({ key: 'formantSpacing', group: 'timbre', name: '響きの間隔', unit: 'Hz', about: 'フォルマントの間隔。声の通り道が短いほど広い', lo: 850, hi: 1350, log: true, low: '狭い', high: '広い', digits: 0 }),
  def({ key: 'f1Range', group: 'timbre', name: '口の開きの幅', unit: '半音', about: 'F1 の動く幅（10〜90%）。母音ごとの口の開きの違い', lo: 2, hi: 18, log: false, low: '小さい', high: '大きい', digits: 2 }),
  def({ key: 'f2Range', group: 'timbre', name: '舌の動きの幅', unit: '半音', about: 'F2 の動く幅（10〜90%）。母音ごとの舌の前後の違い', lo: 2, hi: 16, log: false, low: '小さい', high: '大きい', digits: 2 }),
  def({ key: 'b1', group: 'timbre', name: 'F1 の幅', unit: 'Hz', about: '第1フォルマントの山の幅（狭いほど響きがくっきり）', lo: 30, hi: 300, log: true, low: '狭い', high: '広い', digits: 0, prior: 0.5, detail: true }),
  def({ key: 'b2', group: 'timbre', name: 'F2 の幅', unit: 'Hz', about: '第2フォルマントの山の幅', lo: 40, hi: 400, log: true, low: '狭い', high: '広い', digits: 0, prior: 0.5, detail: true }),
  def({ key: 'centroid', group: 'timbre', name: '明るさ', unit: 'Hz', about: '300 Hz〜4 kHz の音の重心（高域の傾きを除いて）', lo: 900, hi: 2200, log: true, low: '暗い', high: '明るい', digits: 0 }),
  def({ key: 'hammarberg', group: 'timbre', name: '高域の弱さ', unit: 'dB', about: '0〜2 kHz の山と 2〜5 kHz の山の差', lo: 15, hi: 45, log: false, low: '高域が強い', high: '高域が弱い', digits: 2 }),
  def({ key: 'slopeLow', group: 'timbre', name: '低域の傾き', unit: 'dB/kHz', about: '0〜500 Hz の音の傾き', lo: 0, hi: 100, log: false, low: '下がる', high: '上がる', digits: 2 }),
  def({ key: 'slopeMid', group: 'timbre', name: '中域の傾き', unit: 'dB/kHz', about: '500〜1500 Hz の音の傾き', lo: -35, hi: -5, log: false, low: '急に下がる', high: 'なだらか', digits: 2 }),
  def({ key: 'mfcc1', group: 'timbre', name: '音色 1', unit: '', about: '音色の形（MFCC 1、全体の傾き）', lo: 15, hi: 40, log: false, low: '−', high: '+', digits: 3 }),
  def({ key: 'mfcc2', group: 'timbre', name: '音色 2', unit: '', about: '音色の形（MFCC 2）', lo: -20, hi: 5, log: false, low: '−', high: '+', digits: 3 }),
  def({ key: 'mfcc3', group: 'timbre', name: '音色 3', unit: '', about: '音色の形（MFCC 3）', lo: -10, hi: 10, log: false, low: '−', high: '+', digits: 3 }),
  def({ key: 'mfcc4', group: 'timbre', name: '音色 4', unit: '', about: '音色の形（MFCC 4）', lo: -10, hi: 10, log: false, low: '−', high: '+', digits: 3 }),
  ...[5, 6, 7, 8, 9, 10, 11, 12, 13].map((q) =>
    def({ key: `mfcc${q}` as FeatureKey, group: 'timbre', name: `音色 ${q}`, unit: '', about: `音色の細かい形（MFCC ${q}）`, lo: -6, hi: 6, log: false, low: '−', high: '+', digits: 3, prior: 0.3, detail: true }),
  ),
  def({ key: 'mfccDelta', group: 'timbre', name: '音色の動き', unit: '', about: '音色が 10 ms ごとに変わる大きさ（となりの枠との MFCC の差の平均）', lo: 0, hi: 4, log: false, low: 'なめらか', high: 'よく動く', digits: 3 }),

  def({ key: 'hnr', group: 'quality', name: '声の澄み', unit: 'dB', about: '声の中の、息などの雑音の少なさ（HNR）', lo: 5, hi: 30, log: false, low: '息が多い', high: '澄んでいる', digits: 2 }),
  def({ key: 'cpp', group: 'quality', name: '声のはっきりさ', unit: 'dB', about: '声の周期のはっきりさ（CPP）', lo: 8, hi: 30, log: false, low: 'ぼやける', high: 'はっきり', digits: 2 }),
  def({ key: 'h1h2', group: 'quality', name: '声の柔らかさ', unit: 'dB', about: '1 番目と 2 番目の倍音の差（H1−H2）', lo: -6, hi: 16, log: false, low: '張った声', high: '柔らかい声', digits: 2 }),
  def({ key: 'jitter', group: 'quality', name: '高さのゆらぎ', unit: '%', about: '1 周期ごとの長さのゆらぎ（jitter RAP）', lo: 0.004, hi: 0.02, log: false, low: '安定', high: 'ゆらぐ', digits: 5 }),
  def({ key: 'shimmer', group: 'quality', name: '大きさのゆらぎ', unit: '%', about: '1 周期ごとの大きさのゆらぎ（shimmer APQ3）', lo: 0.02, hi: 0.09, log: false, low: '安定', high: 'ゆらぐ', digits: 4 }),

  def({ key: 'rate', group: 'time', name: '速さ', unit: '音/秒', about: '話している間の、1 秒あたりの音の山の数', lo: 2.5, hi: 7.5, log: false, low: 'ゆっくり', high: '速い', digits: 2 }),
  def({ key: 'rateVar', group: 'time', name: '速さのムラ', unit: '%', about: 'ひと続きごとの話す速さの散らばり（標準偏差 ÷ 平均）', lo: 0.05, hi: 0.4, log: false, low: '一定', high: 'ムラがある', digits: 3 }),
  def({ key: 'pauseShare', group: 'time', name: '間の多さ', unit: '', about: '話の途中の 0.25 秒以上の間の割合', lo: 0.05, hi: 0.35, log: false, low: '少ない', high: '多い', digits: 3 }),
  def({ key: 'pauseLen', group: 'time', name: '間の長さ', unit: '秒', about: '間 1 つの長さ（中央値）', lo: 0.25, hi: 1.2, log: false, low: '短い', high: '長い', digits: 2 }),
  def({ key: 'runLen', group: 'time', name: 'ひと続きの長さ', unit: '秒', about: '間から間まで続けて話す長さ（中央値）', lo: 0.8, hi: 5, log: false, low: '短い', high: '長い', digits: 2 }),
  def({ key: 'rhythm', group: 'time', name: 'リズムのムラ', unit: '', about: '音の山どうしの間隔の、となりとの違い（nPVI）', lo: 20, hi: 70, log: false, low: '一定', high: 'ムラがある', digits: 1 }),
  def({ key: 'voicedShare', group: 'time', name: '声の続き方', unit: '', about: '話している間のうち、声帯が鳴っている割合', lo: 0.4, hi: 0.9, log: false, low: '途切れがち', high: 'つながる', digits: 3 }),

  def({ key: 'levelRange', group: 'strength', name: '強弱の幅', unit: 'dB', about: '声の大きさの幅（5〜95%）。マイクの音量には左右されない', lo: 8, hi: 26, log: false, low: '一定', high: '大きい', digits: 2 }),
  def({ key: 'tilt', group: 'strength', name: '声の力', unit: 'dB', about: '高い倍音の強さ（1〜4 kHz と 80 Hz〜1 kHz の差）', lo: -26, hi: -6, log: false, low: '柔らかい', high: '力強い', digits: 2 }),
];

export const FEATURE_BY_KEY: Record<FeatureKey, FeatureDef> = Object.fromEntries(FEATURES.map((f) => [f.key, f])) as Record<FeatureKey, FeatureDef>;

/** 画面の目盛り（0〜1、端で止める） */
export function displayValue(key: FeatureKey, v: number): number {
  const d = FEATURE_BY_KEY[key];
  const t = d.log ? Math.log(v / d.lo) / Math.log(d.hi / d.lo) : (v - d.lo) / (d.hi - d.lo);
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
}

/** 画面に出す文字（jitter・shimmer・割合は % で） */
export function formatFeature(key: FeatureKey, v: number | null): string {
  if (v === null) return '—';
  const d = FEATURE_BY_KEY[key];
  if (d.unit === '%') return `${(v * 100).toFixed(2)} %`;
  if (key === 'pauseShare' || key === 'voicedShare') return `${Math.round(v * 100)} %`;
  const digits = Math.max(0, Math.min(2, d.digits));
  return `${v.toFixed(digits)}${d.unit ? ` ${d.unit}` : ''}`;
}

/** 丸め（features の各項目の `digits`）。非数は null */
export function roundFeature(key: FeatureKey, v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const k = 10 ** FEATURE_BY_KEY[key].digits;
  const r = Math.round(v * k) / k;
  return Object.is(r, -0) ? 0 : r;
}
