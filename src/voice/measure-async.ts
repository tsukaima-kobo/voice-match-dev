// 測定を Web Worker で（使えなければ、その場で）。Worker には音の写しを渡し、Worker が測ったら 0 で埋める。
// こちらの音は、答えが来るまでだけ持つ（Worker が読めない・落ちた時に、その場で測り直すため）。答えが来たら 0 で埋める。
// Worker が読めない（入れ替えの後の 404 など）・落ちた時は、待っている物を全部その場で測り、その後もその場で測る。
// 測る途中で誤りが出ても、測れなかった（invalid）として返す（画面が「計算しています」のまま止まらないように）。
import { measureVoice, type Measured, type MeasureOptions } from './measure.ts';
import MeasureWorker from './measure.worker.ts?worker';

interface Job {
  pcm: Float32Array;
  rate: number;
  opts: MeasureOptions;
  resolve: (m: Measured) => void;
}

let worker: Worker | null = null;
/** Worker が使えないと分かった（この後は、その場で測る） */
let broken = false;
let next = 0;
const waiting = new Map<number, Job>();

/** その場で測る。誤りが出ても測れなかったとして返し、音は 0 で埋める */
function measureHere(pcm: Float32Array, rate: number, opts: MeasureOptions): Measured {
  try {
    return measureVoice(pcm, rate, opts);
  } catch {
    return { ok: false, reason: 'invalid', info: {} };
  } finally {
    pcm.fill(0);
  }
}

/** 待っている 1 つを、その場で測って答える（ほかの処理を止め続けないよう、1 つずつ順に） */
function measureLater(job: Job): void {
  setTimeout(() => job.resolve(measureHere(job.pcm, job.rate, job.opts)), 0);
}

/** Worker が使えなくなった: 止めて、待っている物を全部その場で測る */
function giveUp(): void {
  broken = true;
  const w = worker;
  worker = null;
  try {
    w?.terminate();
  } catch {
    /* 止められない時も、もう使わない */
  }
  const jobs = [...waiting.values()];
  waiting.clear();
  for (const job of jobs) measureLater(job);
}

function getWorker(): Worker | null {
  if (worker || broken) return worker;
  try {
    const w = new MeasureWorker();
    w.onmessage = (e: MessageEvent<{ id: number; m?: Measured }>) => {
      const job = waiting.get(e.data.id);
      if (!job) return;
      waiting.delete(e.data.id);
      if (e.data.m) {
        job.pcm.fill(0);
        job.resolve(e.data.m);
      } else {
        // Worker の中で測れなかった: こちらで測り直す
        measureLater(job);
      }
    };
    w.onerror = giveUp;
    w.onmessageerror = giveUp;
    worker = w;
  } catch {
    broken = true;
    worker = null;
  }
  return worker;
}

/** 測る。`pcm` は答えが出たら 0 で埋める（呼んだ側は、渡した後に使わない）。失敗はしない（測れない時は ok: false） */
export function measureAsync(pcm: Float32Array, rate: number, opts: MeasureOptions): Promise<Measured> {
  const w = getWorker();
  if (!w) return Promise.resolve(measureHere(pcm, rate, opts));
  const id = ++next;
  return new Promise((resolve) => {
    const job: Job = { pcm, rate, opts, resolve };
    waiting.set(id, job);
    try {
      // 写しを渡す（こちらの音は、答えが来るまで残す）
      w.postMessage({ id, pcm, rate, opts });
    } catch {
      giveUp();
    }
  });
}
