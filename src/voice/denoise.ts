// 声真似練習場の「ノイズを減らす」: RNNoise（BSD-3-Clause。@shiguredo/rnnoise-wasm、Apache-2.0）で、録った音の雑音を減らす。
// 録り終えた音をまとめて通す（その場ではしない）。動かすのは src/voice/clean.worker.ts（画面を止めないよう Worker で）。
// RNNoise は 48 kHz・480 サンプルずつ・16 ビットの大きさ（±32768）の音を受ける。出てくる音は 960 サンプル（20 ms）遅れるので、
// 後ろに 960 サンプルの無音を足して通し、前の 960 サンプルを捨てて、元の音と時刻をそろえる（声真似の線の重なりがずれないように）。
// 確かめ方（2026-11-18、macOS の say で作った話し声）: 遅れは 960 サンプルちょうど。雑音を足した声で、HNR・F1 が雑音の無い声の数字に
// 近づき、233 Hz と 420 Hz の声の高さは変わらなかった。合成の母音だけの音（子音が無い）は、声と見なされず消されることがある。

/** RNNoise が受ける音の速さ */
export const DENOISE_RATE = 48000;
/** RNNoise の出す音の遅れ（サンプル） */
export const DENOISE_DELAY = 960;

/** RNNoise の 1 つの状態（@shiguredo/rnnoise-wasm の DenoiseState と同じ形。試験では偽物を渡す） */
export interface FrameDenoiser {
  /** frame（frameSize 個、±32768 の大きさ）を、その場で書き換える */
  processFrame(frame: Float32Array): number;
}

/** 48 kHz の音 x の雑音を減らした、同じ長さ・同じ時刻の音を返す（x は変えない） */
export function denoiseWith(st: FrameDenoiser, frameSize: number, x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  const frame = new Float32Array(frameSize);
  // 遅れの分だけ後ろに無音を足して通し、出てきた音の前の DENOISE_DELAY を捨てる
  const total = x.length + DENOISE_DELAY;
  for (let at = 0; at < total; at += frameSize) {
    for (let i = 0; i < frameSize; i++) {
      const k = at + i;
      frame[i] = k < x.length ? x[k]! * 32768 : 0;
    }
    st.processFrame(frame);
    for (let i = 0; i < frameSize; i++) {
      const k = at + i - DENOISE_DELAY;
      if (k >= 0 && k < out.length) out[k] = frame[i]! / 32768;
    }
  }
  return out;
}
