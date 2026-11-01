// 測定を、画面とは別の処理（Web Worker）で動かす。計算の間も、解析の演出が止まらないように。
// 音は、このページの中（端末のメモリー）で受け渡すだけ。測ったらすぐ 0 で埋めて捨てる。どこにも送らない。
import { measureVoice, type MeasureOptions } from './measure.ts';

self.onmessage = (e: MessageEvent<{ id: number; pcm: Float32Array; rate: number; opts: MeasureOptions }>) => {
  const { id, pcm, rate, opts } = e.data;
  const m = measureVoice(pcm, rate, opts);
  pcm.fill(0);
  (self as unknown as Worker).postMessage({ id, m });
};
