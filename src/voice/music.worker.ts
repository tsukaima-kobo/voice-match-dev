// 「音楽を消す」を、画面とは別の処理（Web Worker）で動かす（src/voice/clean.ts から）。onnxruntime-web（MIT）の WebGPU で、
// Demucs を 21 個に分けた AI（tools/models.ts が public/models/ に置く）を順に動かす。前後の計算は src/voice/demucs.ts。
// AI の部品は、最初の 1 回だけ、このサイトから読む（ブラウザーのキャッシュに残る。2 回目からは読まない）。読むのは、このサイトの
// models/ の下だけ。onnxruntime-web の WASM も 2 つに分けて置いた物を読んでつなぎ、wasmBinary に渡す（ほかからは読まない）。
// 受け取った音（44.1 kHz）は、声を返したら 0 で埋める。どこにも送らない。
import * as ort from 'onnxruntime-web/webgpu';
import { SEGMENT, separateVocals, type SegmentRunner } from './demucs.ts';

/** models.json（tools/models.ts が作る） */
interface ModelIndex {
  demucs: { pieces: { file: string; bytes: number; inputs: string[]; outputs: string[] }[]; outputs: { freq: string; time: string } };
  ort: { version: string; parts: { file: string; bytes: number }[] };
}
/** 1 つ目の部品で、CPU で計算させる所（fp16 だと WebGPU で NaN になる、入力の正規化。monteslu/htdemucs-web-onnx の説明どおり） */
const CPU_NODES = ['/ReduceMean', '/Sub', '/Pow', '/ReduceMean_1', '/Clip', '/Sqrt', '/Add', '/Div', '/ReduceMean_2', '/Sub_1', '/Pow_1', '/ReduceMean_3', '/Clip_1', '/Sqrt_1', '/Add_1', '/Div_1'];

type Progress = { stage: 'download'; done: number; total: number } | { stage: 'prepare'; done: number; total: number } | { stage: 'separate'; done: number; total: number };
const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let runner: Promise<SegmentRunner> | null = null;

async function load(base: string, progress: (p: Progress) => void): Promise<SegmentRunner> {
  const res = await fetch(new URL('models.json', base));
  if (!res.ok) throw new Error(`models.json: HTTP ${res.status}`);
  const index = (await res.json()) as ModelIndex;
  const total = index.ort.parts.reduce((s, p) => s + p.bytes, 0) + index.demucs.pieces.reduce((s, p) => s + p.bytes, 0);
  let got = 0;
  const read = async (file: string, bytes: number): Promise<Uint8Array> => {
    const r = await fetch(new URL(file, base));
    if (!r.ok || !r.body) throw new Error(`${file}: HTTP ${r.status}`);
    const out = new Uint8Array(bytes);
    let at = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.length > out.length) throw new Error(`${file}: 大きさが models.json と違う`);
      out.set(value, at);
      at += value.length;
      got += value.length;
      progress({ stage: 'download', done: got, total });
    }
    if (at !== bytes) throw new Error(`${file}: 大きさが models.json と違う`);
    return out;
  };
  // onnxruntime-web の WASM: 分けて置いた物をつなぐ
  const parts: Uint8Array[] = [];
  for (const p of index.ort.parts) parts.push(await read(p.file, p.bytes));
  const wasm = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    wasm.set(p, at);
    at += p.length;
  }
  ort.env.wasm.wasmBinary = wasm;
  // 「一部の計算を CPU に回した」などの知らせは出さない（誤りだけ出す）
  ort.env.logLevel = 'error';
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const { pieces, outputs } = index.demucs;
  const finals = new Set([outputs.freq, outputs.time]);
  const bytes: Uint8Array[] = [];
  for (const p of pieces) bytes.push(await read(p.file, p.bytes));
  const sessions: ort.InferenceSession[] = [];
  for (const [i, p] of pieces.entries()) {
    progress({ stage: 'prepare', done: i, total: pieces.length });
    const location = Object.fromEntries(p.outputs.map((o) => [o, finals.has(o) ? 'cpu' : 'gpu-buffer'] as const));
    sessions.push(
      await ort.InferenceSession.create(bytes[i]!, {
        executionProviders: [i === 0 ? { name: 'webgpu', forceCpuNodeNames: CPU_NODES } : { name: 'webgpu' }],
        graphOptimizationLevel: 'all',
        preferredOutputLocation: location,
      }),
    );
    bytes[i] = new Uint8Array(0);
  }
  progress({ stage: 'prepare', done: pieces.length, total: pieces.length });
  return async (mix, mag) => {
    const map = new Map<string, ort.Tensor>([
      ['mix', new ort.Tensor('float32', mix, [1, 2, SEGMENT])],
      ['mag', new ort.Tensor('float32', mag, [1, 4, 2048, 336])],
    ]);
    const onGpu: ort.Tensor[] = [];
    try {
      for (const [i, s] of sessions.entries()) {
        const feeds: Record<string, ort.Tensor> = {};
        for (const name of pieces[i]!.inputs) feeds[name] = map.get(name)!;
        const out = await s.run(feeds);
        for (const [name, t] of Object.entries(out)) {
          map.set(name, t);
          if (t.location === 'gpu-buffer') onGpu.push(t);
        }
      }
      const x = map.get(outputs.freq)!.data as Float32Array;
      const xt = map.get(outputs.time)!.data as Float32Array;
      return { x, xt };
    } finally {
      for (const t of onGpu) t.dispose();
    }
  };
}

self.onmessage = async (e: MessageEvent<{ id: number; pcm: Float32Array; base: string }>) => {
  const { id, pcm, base } = e.data;
  const progress = (p: Progress) => post({ id, progress: p });
  try {
    runner ??= load(base, progress);
    const run = await runner;
    const out = await separateVocals(pcm, run, (done, total) => progress({ stage: 'separate', done, total }));
    post({ id, ok: true, pcm: out }, [out.buffer]);
  } catch (err) {
    // 読めなかった・動かせなかった時は、次に頼まれた時に最初からやり直す
    runner = null;
    post({ id, ok: false, error: String(err) });
  } finally {
    pcm.fill(0);
  }
};
