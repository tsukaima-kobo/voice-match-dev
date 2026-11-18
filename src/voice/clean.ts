// 声真似練習場で、録った音をきれいにする（利用者が選んだ時だけ）。どれも、この端末の中だけで動かす。音はどこにも送らない。
//   音楽を消す: Demucs（src/voice/demucs.ts・music.worker.ts）。WebGPU の使えるブラウザー（パソコンの Chrome・Edge など）だけ。
//               AI の部品（約 155 MB）は、最初に使う時だけ、このサイトから読む（ブラウザーのキャッシュに残る）。
//   ノイズを減らす: RNNoise（src/voice/denoise.ts・denoise.worker.ts）。スマホでも動く。
// 両方を選んだ時は、音楽を消してから、ノイズを減らす。速さの直しはブラウザーの OfflineAudioContext で（Demucs は 44.1 kHz、
// RNNoise は 48 kHz の音を受ける）。お手本と真似の両方に、同じ物をかける（呼ぶ側の mimic-page.ts が、お手本ごとに決める）。
import DenoiseWorker from './denoise.worker.ts?worker';
import MusicWorker from './music.worker.ts?worker';
import { DENOISE_RATE } from './denoise.ts';
import { DEMUCS_RATE } from './demucs.ts';

export interface CleanChoice {
  /** ノイズを減らす */
  denoise: boolean;
  /** 音楽を消す */
  music: boolean;
}
export type CleanStage = 'download' | 'prepare' | 'separate' | 'denoise';
export type CleanProgress = (stage: CleanStage, done: number, total: number) => void;

/** 音楽を消せるか（できない時は、その理由）。読む大きさ（バイト）も */
export type MusicSupport = { ok: true; bytes: number } | { ok: false; why: 'gpu' | 'files' };

const modelsBase = () => new URL('./models/', document.baseURI).href;

let support: Promise<MusicSupport> | null = null;
/** 音楽を消せるかを調べる（WebGPU と fp16 の計算・AI の部品があるか）。1 回だけ調べて覚える */
export function musicSupport(): Promise<MusicSupport> {
  support ??= (async (): Promise<MusicSupport> => {
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
      const adapter = gpu ? await gpu.requestAdapter() : null;
      if (!adapter || !adapter.features.has('shader-f16')) return { ok: false, why: 'gpu' };
    } catch {
      return { ok: false, why: 'gpu' };
    }
    try {
      const r = await fetch(new URL('models.json', modelsBase()));
      if (!r.ok) return { ok: false, why: 'files' };
      const index = (await r.json()) as { demucs: { pieces: { bytes: number }[] }; ort: { parts: { bytes: number }[] } };
      const bytes = index.demucs.pieces.reduce((s, p) => s + p.bytes, 0) + index.ort.parts.reduce((s, p) => s + p.bytes, 0);
      return { ok: true, bytes };
    } catch {
      return { ok: false, why: 'files' };
    }
  })();
  return support;
}

/** 音の速さを変える（ブラウザーの OfflineAudioContext で。同じ速さなら写しを返す） */
export async function resample(pcm: Float32Array, from: number, to: number): Promise<Float32Array> {
  if (from === to) return pcm.slice();
  const OAC = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const n = Math.max(1, Math.round((pcm.length * to) / from));
  const ctx = new OAC(1, n, to);
  const buf = ctx.createBuffer(1, pcm.length, from);
  buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0).slice();
}

/** Worker を 1 つ持って、頼んで答えを待つ */
class Helper {
  private w: Worker | null = null;
  private next = 0;
  private waiting = new Map<number, { resolve: (x: Float32Array) => void; reject: (e: Error) => void; progress?: (p: { stage: CleanStage; done: number; total: number }) => void }>();
  constructor(private make: () => Worker) {}
  run(msg: Record<string, unknown>, pcm: Float32Array, progress?: (p: { stage: CleanStage; done: number; total: number }) => void): Promise<Float32Array> {
    if (!this.w) {
      const w = this.make();
      w.onmessage = (e: MessageEvent<{ id: number; ok?: boolean; pcm?: Float32Array; error?: string; progress?: { stage: CleanStage; done: number; total: number } }>) => {
        const job = this.waiting.get(e.data.id);
        if (!job) return;
        if (e.data.progress) {
          job.progress?.(e.data.progress);
          return;
        }
        this.waiting.delete(e.data.id);
        if (e.data.ok && e.data.pcm) job.resolve(e.data.pcm);
        else job.reject(new Error(e.data.error ?? 'failed'));
      };
      w.onerror = () => {
        for (const job of this.waiting.values()) job.reject(new Error('worker'));
        this.waiting.clear();
        this.w?.terminate();
        this.w = null;
      };
      this.w = w;
    }
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, ...(progress ? { progress } : {}) });
      this.w!.postMessage({ id, pcm, ...msg }, [pcm.buffer]);
    });
  }
}
const denoiser = new Helper(() => new DenoiseWorker());
const separator = new Helper(() => new MusicWorker());

/**
 * 音をきれいにする（選んだ物だけ）。返す音は、選んだ物によって速さが変わる（ノイズを減らした時は 48 kHz、音楽だけを消した時は
 * 44.1 kHz、どちらも選ばない時は元のまま）。渡した pcm は変えない
 */
export async function cleanAudio(pcm: Float32Array, rate: number, choice: CleanChoice, onProgress?: CleanProgress): Promise<{ pcm: Float32Array; rate: number }> {
  let x = pcm;
  let r = rate;
  if (choice.music) {
    const at = await resample(x, r, DEMUCS_RATE);
    x = await separator.run({ base: modelsBase() }, at, (p) => onProgress?.(p.stage, p.done, p.total));
    r = DEMUCS_RATE;
  }
  if (choice.denoise) {
    const at = await resample(x, r, DENOISE_RATE);
    onProgress?.('denoise', 0, 1);
    x = await denoiser.run({}, at);
    onProgress?.('denoise', 1, 1);
    r = DENOISE_RATE;
  }
  return { pcm: x === pcm ? pcm.slice() : x, rate: r };
}
