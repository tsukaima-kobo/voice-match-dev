// 測定を Web Worker で（使えなければ、その場で）。音は Worker に渡し（渡した後、こちらの配列は空になる）、Worker が測って捨てる。
import { measureVoice, type Measured, type MeasureOptions } from './measure.ts';
import MeasureWorker from './measure.worker.ts?worker';

let worker: Worker | null = null;
let next = 0;
const waiting = new Map<number, (m: Measured) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new MeasureWorker();
    worker.onmessage = (e: MessageEvent<{ id: number; m: Measured }>) => {
      waiting.get(e.data.id)?.(e.data.m);
      waiting.delete(e.data.id);
    };
    worker.onerror = () => {
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function measureAsync(pcm: Float32Array, rate: number, opts: MeasureOptions): Promise<Measured> {
  const w = getWorker();
  if (!w) {
    const m = measureVoice(pcm, rate, opts);
    pcm.fill(0);
    return Promise.resolve(m);
  }
  const id = ++next;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    w.postMessage({ id, pcm, rate, opts }, [pcm.buffer]);
  });
}
