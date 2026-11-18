// 声真似練習場の「音楽を消す」: Demucs（htdemucs。Meta の Alexandre Défossez ほか。MIT）で、録った音から声だけを取り出す。
// ここは AI の前後の計算だけ（AI そのものは src/voice/clean.worker.ts が onnxruntime-web の WebGPU で動かす）。
// 使う AI は、ブラウザー向けに 21 個に分けた物（Hugging Face の monteslu/htdemucs-web-onnx。MIT）。入力は 44.1 kHz の 2 チャンネルの
// 7.8 秒（343980 サンプル）の音 `mix` と、その STFT `mag`。出力は、周波数の側 `x`（4 つの音 × 2 チャンネル × 実部・虚部 × 2048 × 336）と
// 時間の側 `xt`（4 つの音 × 2 チャンネル × 343980）。声 = `xt` の声 + `x` の声の逆 STFT。
// 前後の計算（STFT の窓・ずらし方・反射の詰め物・逆 STFT の切り出し）は、元の demucs（htdemucs の _spec・_ispec。torch.stft の
// normalized=True・center=True・reflect）と、timcsy/demucs-web（MIT）の src/processor.js・src/fft.js に合わせた。
// 長い音は 7.8 秒ずつ、4 分の 1 を重ねて切り、元の demucs（apply_model）と同じ三角の重みで重ねてつなぐ。
// 録った音は 1 チャンネル（マイク）なので、左右に同じ音を入れ、左右の声の平均を返す（逆 STFT は線形なので、左右の平均を 1 回で計算する）。

export const DEMUCS_RATE = 44100;
/** AI の 1 回の長さ（サンプル。7.8 秒） */
export const SEGMENT = 343980;
const NFFT = 4096;
const HOP = 1024;
const BINS = 2048;
const FRAMES = 336;
/** 声の音の番号（drums・bass・other・vocals の順） */
const VOCALS = 3;
const TRACKS = 4;
/** 切った所の重なり（元の demucs の既定） */
const OVERLAP = 0.25;

/* ---- FFT（4096 点。基数 2） ---- */
const LOG = 12;
const REV = new Uint16Array(NFFT);
for (let i = 0; i < NFFT; i++) {
  let r = 0;
  for (let b = 0, v = i; b < LOG; b++, v >>= 1) r = (r << 1) | (v & 1);
  REV[i] = r;
}
const COS = new Float64Array(NFFT / 2);
const SIN = new Float64Array(NFFT / 2);
for (let k = 0; k < NFFT / 2; k++) {
  COS[k] = Math.cos((2 * Math.PI * k) / NFFT);
  SIN[k] = Math.sin((2 * Math.PI * k) / NFFT);
}
/** その場で FFT（inverse の時は 1/N を掛けない） */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  for (let i = 0; i < NFFT; i++) {
    const j = REV[i]!;
    if (j > i) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1;
    const step = NFFT / size;
    for (let i = 0; i < NFFT; i += size) {
      for (let j = 0; j < half; j++) {
        const c = COS[j * step]!;
        const s = sign * SIN[j * step]!;
        const a = i + j;
        const b = a + half;
        const or = re[b]! * c - im[b]! * s;
        const oi = re[b]! * s + im[b]! * c;
        re[b] = re[a]! - or;
        im[b] = im[a]! - oi;
        re[a] = re[a]! + or;
        im[a] = im[a]! + oi;
      }
    }
  }
}
/** Hann 窓（torch.hann_window の既定と同じ、周期的な物） */
const WIN = new Float64Array(NFFT);
for (let i = 0; i < NFFT; i++) WIN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / NFFT));

/** 反射の詰め物（torch・numpy の 'reflect'。端の値そのものは繰り返さない） */
export function reflectPad(x: Float32Array, left: number, right: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(left + n + right);
  for (let i = 0; i < left; i++) out[i] = x[Math.min(left - i, n - 1)]!;
  out.set(x, left);
  for (let i = 0; i < right; i++) out[left + n + i] = x[Math.max(0, n - 2 - i)]!;
  return out;
}

/** 詰め物（_spec の pad = hop / 2 × 3） */
const PAD = (HOP >> 1) * 3;

/**
 * 1 回分（SEGMENT サンプル。足りない所は 0）の 1 チャンネルの音から、AI の入力 mix（2 × SEGMENT）と mag（4 × 2048 × 336）を作る。
 * 左右は同じ音
 */
export function prepareSegment(seg: Float32Array): { mix: Float32Array; mag: Float32Array } {
  const le = Math.ceil(SEGMENT / HOP);
  const x = reflectPad(reflectPad(seg, PAD, PAD + le * HOP - SEGMENT), NFFT / 2, NFFT / 2);
  const mag = new Float32Array(4 * BINS * FRAMES);
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  const scale = 1 / Math.sqrt(NFFT);
  for (let f = 0; f < FRAMES; f++) {
    // STFT の 2 つ目からの 336 枠（_spec は前後 2 枠を捨てる）
    const start = (f + 2) * HOP;
    for (let i = 0; i < NFFT; i++) {
      re[i] = x[start + i]! * WIN[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < BINS; b++) {
      const r = re[b]! * scale;
      const m = im[b]! * scale;
      mag[(0 * BINS + b) * FRAMES + f] = r;
      mag[(1 * BINS + b) * FRAMES + f] = m;
      mag[(2 * BINS + b) * FRAMES + f] = r;
      mag[(3 * BINS + b) * FRAMES + f] = m;
    }
  }
  const mix = new Float32Array(2 * SEGMENT);
  mix.set(seg, 0);
  mix.set(seg, SEGMENT);
  return { mix, mag };
}

/**
 * AI の出力から、1 回分の声（1 チャンネル。左右の平均）を作る。
 * x: [1, 4, 4, 2048, 336]（周波数の側）、xt: [1, 4, 2, SEGMENT]（時間の側）
 */
export function vocalsOf(x: ArrayLike<number>, xt: ArrayLike<number>): Float32Array {
  const frames = FRAMES + 4; // 前後に 2 枠ずつ 0 を足す（_ispec）
  const ola = new Float64Array((frames - 1) * HOP + NFFT);
  const wsum = new Float64Array(ola.length);
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  const at = (c: number, b: number, f: number) => x[((VOCALS * 4 + c) * BINS + b) * FRAMES + f]!;
  for (let j = 0; j < frames; j++) {
    const f = j - 2;
    re.fill(0);
    im.fill(0);
    if (f >= 0 && f < FRAMES) {
      // 左右の平均（逆 STFT は線形）。2049 番目の周波数は 0（_ispec の詰め物）
      for (let b = 0; b < BINS; b++) {
        re[b] = (at(0, b, f) + at(2, b, f)) / 2;
        im[b] = (at(1, b, f) + at(3, b, f)) / 2;
      }
      for (let b = 1; b < BINS; b++) {
        re[NFFT - b] = re[b]!;
        im[NFFT - b] = -im[b]!;
      }
      im[0] = 0;
      fft(re, im, true);
    }
    const start = j * HOP;
    // 逆 FFT の 1/N と、normalized=True の √N
    const k = 1 / Math.sqrt(NFFT);
    for (let i = 0; i < NFFT; i++) {
      ola[start + i] = ola[start + i]! + re[i]! * k * WIN[i]!;
      wsum[start + i] = wsum[start + i]! + WIN[i]! * WIN[i]!;
    }
  }
  const out = new Float32Array(SEGMENT);
  const off = NFFT / 2 + PAD;
  for (let i = 0; i < SEGMENT; i++) {
    const w = wsum[off + i]!;
    const freq = w > 1e-8 ? ola[off + i]! / w : 0;
    const time = (xt[(VOCALS * 2 + 0) * SEGMENT + i]! + xt[(VOCALS * 2 + 1) * SEGMENT + i]!) / 2;
    out[i] = freq + time;
  }
  return out;
}

/** AI を 1 回動かす（mix・mag を渡し、x・xt を受ける） */
export type SegmentRunner = (mix: Float32Array, mag: Float32Array) => Promise<{ x: ArrayLike<number>; xt: ArrayLike<number> }>;

/** 元の demucs（apply_model）の三角の重み */
function triangle(n: number): Float32Array {
  const w = new Float32Array(n);
  const half = n >> 1;
  for (let i = 0; i < n; i++) w[i] = (i < half ? i + 1 : n - i) / half;
  return w;
}

/** 44.1 kHz の 1 チャンネルの音から、声だけを取り出す（同じ長さ）。`onProgress` は 1 回分ごと */
export async function separateVocals(mono: Float32Array, run: SegmentRunner, onProgress?: (done: number, total: number) => void): Promise<Float32Array> {
  const n = mono.length;
  const stride = Math.floor(SEGMENT * (1 - OVERLAP));
  const starts: number[] = [];
  for (let s = 0; s < n; s += stride) {
    starts.push(s);
    if (s + SEGMENT >= n) break;
  }
  const out = new Float32Array(n);
  const sum = new Float32Array(n);
  const weight = triangle(SEGMENT);
  for (const [k, start] of starts.entries()) {
    const seg = new Float32Array(SEGMENT);
    seg.set(mono.subarray(start, Math.min(n, start + SEGMENT)));
    const { mix, mag } = prepareSegment(seg);
    const { x, xt } = await run(mix, mag);
    const v = vocalsOf(x, xt);
    const len = Math.min(SEGMENT, n - start);
    // 1 回分だけの時は重みを掛けない（三角の端で 0 に近づくため）
    for (let i = 0; i < len; i++) {
      const w = starts.length === 1 ? 1 : weight[i]!;
      out[start + i] = out[start + i]! + v[i]! * w;
      sum[start + i] = sum[start + i]! + w;
    }
    onProgress?.(k + 1, starts.length);
  }
  for (let i = 0; i < n; i++) if (sum[i]! > 0) out[i] = out[i]! / sum[i]!;
  return out;
}

export const DEMUCS_TRACKS = TRACKS;
