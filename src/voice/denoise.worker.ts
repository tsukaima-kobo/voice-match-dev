// 「ノイズを減らす」を、画面とは別の処理（Web Worker）で動かす（src/voice/clean.ts から）。RNNoise は最初の 1 回だけ用意する。
// 受け取った音（48 kHz）は、雑音を減らした音を返したら 0 で埋める。どこにも送らない。
import { Rnnoise } from '@shiguredo/rnnoise-wasm';
import { denoiseWith } from './denoise.ts';

let rn: Promise<Rnnoise> | null = null;

self.onmessage = async (e: MessageEvent<{ id: number; pcm: Float32Array }>) => {
  const { id, pcm } = e.data;
  try {
    rn ??= Rnnoise.load();
    const r = await rn;
    const st = r.createDenoiseState();
    let out: Float32Array;
    try {
      out = denoiseWith(st, r.frameSize, pcm);
    } finally {
      st.destroy();
    }
    (self as unknown as Worker).postMessage({ id, ok: true, pcm: out }, [out.buffer]);
  } catch (err) {
    rn = null;
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  } finally {
    pcm.fill(0);
  }
};
