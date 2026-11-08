// 測定を、画面とは別の処理（Web Worker）で動かす。計算の間も、解析の演出が止まらないように。
// 音は、このページの中（端末のメモリー）で受け渡すだけ。測ったら（測る途中で誤りが出ても）すぐ 0 で埋めて捨てる。どこにも送らない。
// 測る途中で誤りが出た時は、数字の代わりに「測れなかった」を返す（呼んだ側が、その場で測り直す）。
import { measureVoice, type Measured, type MeasureOptions } from './measure.ts';

self.onmessage = (e: MessageEvent<{ id: number; pcm: Float32Array; rate: number; opts: MeasureOptions }>) => {
  const { id, pcm, rate, opts } = e.data;
  let m: Measured | null = null;
  try {
    m = measureVoice(pcm, rate, opts);
  } catch {
    m = null;
  } finally {
    pcm.fill(0);
  }
  (self as unknown as Worker).postMessage(m ? { id, m } : { id });
};
