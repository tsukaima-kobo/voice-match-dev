// 収集の拡張機能の、動画の音を受けるグラフ（collector/src/capture.ts）の試験。AudioContext の代わりを渡す（音は出さない）
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCapture, SP_SIZE, SpClock, type Sink } from '../collector/src/capture.ts';
import { chunkTime, Windower, type Finished } from '../collector/src/windowing.ts';

/* ---- ScriptProcessor の時刻と、上書きされた入れ物 ---- */

/**
 * Chrome の ScriptProcessor のまね: 音の時計で B サンプルたまるごとに、入れ物（2 つを交互）の番号をページへ送る。
 * ページが受けた時に読む入れ物の中身は、その時までに書かれた一番新しい音（遅れると、次の音で上書きされている）。
 * 音の中身は、何番目のサンプルか（つながっているかを確かめるため）。
 * H: 音の出力の区切り（この単位でまとめて進む。ページから見た時計も、この単位で進む）
 */
function simulate(opts: { seconds: number; block: number; H: number; lose?: Set<number> }) {
  const sr = 48000,
    B = SP_SIZE,
    dur = B / sr;
  const clock = new SpClock(dur);
  const w = new Windower(sr);
  const got: Finished[] = [];
  let free = 0,
    gaps = 0,
    jumps = 0;
  // ページから見た音の時計（区切り H ごとに進む）。サンプルの番号で
  const frameAt = (t: number) => Math.ceil(Math.round(t * sr * 1000) / 1000 / opts.H) * opts.H;
  for (let k = 0; (k + 1) * dur < opts.seconds; k++) {
    if (opts.lose?.has(k)) continue;
    // 録り終えた（音の時計の区切りで、まとめて進む）。ページは空いていれば少し後に、測っている間は終わってから受ける
    const posted = Math.ceil(((k + 1) * B) / opts.H) * opts.H;
    const at = Math.max(posted / sr + 0.002, free);
    free = at + 0.0001;
    const F = frameAt(at);
    const now = F / sr;
    const end = clock.take(now);
    if (end === null) {
      w.gap();
      gaps++;
      continue;
    }
    // 受けた時の入れ物の中身: 同じ番号の入れ物に書かれた一番新しい音
    const pcm = new Float32Array(B);
    for (let i = 0; i < B; i++) {
      let j = Math.floor((F - 1 - i) / B);
      if ((j - k) % 2) j--;
      pcm[i] = j * B + i;
    }
    // 動画は 100 秒の所から。読んだ時の再生位置は 100 + 今の音の時計
    const d = w.push(pcm, { video: 'abc123def45', time: chunkTime(100 + now, 1, now, end), paused: false, seeking: false, rate: 1, ad: false, stalled: false });
    if (w.lastBreak === 'jump') jumps++;
    if (d) {
      got.push(d);
      free = at + opts.block;
    }
  }
  return { got, gaps, jumps, sr };
}

describe('ScriptProcessor のかたまり', () => {
  it('ページが止まっても、窓の音はつながっていて（上書きされた入れ物を使わない）、時刻は音の通り', () => {
    for (const H of [128, 2048, 8192])
      for (const block of [0.05, 0.5, 0.9, 1.5, 2.5]) {
        const { got, jumps, sr } = simulate({ seconds: 200, block, H });
        const at = `区切り ${H}・${block} 秒止まる時`;
        expect(jumps, at).toBe(0);
        expect(got.length, at).toBeGreaterThanOrEqual(5);
        for (const d of got) {
          for (let i = 1; i < d.pcm.length; i++) if (d.pcm[i] !== d.pcm[0]! + i) throw new Error(`${at}: ${d.t0} 秒の窓の ${i} 番目がつながっていない`);
          // 窓の時刻は、入っている音の時刻（100 + 何番目のサンプルか / sr）
          expect(d.t0, at).toBeCloseTo(100 + d.pcm[0]! / sr, 0);
          expect(d.t1 - d.t0, at).toBeCloseTo(d.pcm.length / sr, 0);
        }
      }
  });
  it('止まらなければ、どのかたまりも捨てない', () => {
    for (const H of [128, 2048, 8192]) {
      const { gaps } = simulate({ seconds: 120, block: 0, H });
      expect(gaps, `区切り ${H}`).toBe(0);
    }
  });
  it('受け損ねたかたまりがあっても、数え直して続ける', () => {
    const { got, gaps } = simulate({ seconds: 200, block: 0, H: 128, lose: new Set([40, 200]) });
    expect(gaps).toBeLessThanOrEqual(4);
    expect(got.length).toBeGreaterThanOrEqual(5);
  });
  it('受けた時ではなく、数えた時刻を返す。先の時刻にはしない', () => {
    const c = new SpClock(0.25);
    expect(c.take(10)).toBe(10);
    expect(c.take(10.26)).toBe(10.25);
    // 早めに受けた: 今より先にはしない
    expect(c.take(10.4)).toBe(10.4);
    // 半かたまりより遅れた: 上書きされているかもしれないので捨てる
    expect(c.take(10.8)).toBe(null);
  });
});

/* ---- グラフをつなぐ・片付ける ---- */

class FakeNode {
  readonly to = new Set<FakeNode>();
  connect(n: FakeNode) {
    this.to.add(n);
    return n;
  }
  disconnect(n?: FakeNode) {
    if (n) this.to.delete(n);
    else this.to.clear();
  }
}
class FakePort {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  readonly posted: unknown[] = [];
  postMessage(m: unknown) {
    this.posted.push(m);
  }
}
class FakeWorkletNode extends FakeNode {
  static last: FakeWorkletNode | null = null;
  readonly port = new FakePort();
  constructor() {
    super();
    FakeWorkletNode.last = this;
  }
}
class FakeSp extends FakeNode {
  onaudioprocess: ((e: unknown) => void) | null = null;
}
class FakeCtx {
  sampleRate = 48000;
  currentTime = 0;
  closed = false;
  readonly destination = new FakeNode();
  src: FakeNode | null = null;
  out: (FakeNode & { gain: { value: number } }) | null = null;
  sp: FakeSp | null = null;
  private worklet: boolean;
  private taken: boolean;
  constructor(worklet = true, taken = false) {
    this.worklet = worklet;
    this.taken = taken;
  }
  readonly audioWorklet = { addModule: async () => (this.worklet ? undefined : Promise.reject(new Error('no worklet'))) };
  createMediaElementSource() {
    if (this.taken) throw new Error('already connected');
    return (this.src = new FakeNode());
  }
  createGain() {
    return (this.out = Object.assign(new FakeNode(), { gain: { value: 1 } }));
  }
  createScriptProcessor() {
    return (this.sp = new FakeSp());
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}
const sinkOf = () => {
  const chunks: { pcm: Float32Array; end: number }[] = [];
  let gaps = 0;
  const sink: Sink = { chunk: (pcm, end) => chunks.push({ pcm, end }), gap: () => gaps++ };
  return { sink, chunks, gaps: () => gaps };
};
const video = {} as HTMLMediaElement;

describe('動画の音を受けるグラフ', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('片付けたグラフから遅れて届いたかたまりは捨て、つないだ物を外して閉じる', async () => {
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    const ctx = new FakeCtx();
    const s = sinkOf();
    const cap = await openCapture(video, 'w.js', s.sink, true, () => ctx as unknown as AudioContext);
    const node = FakeWorkletNode.last!;
    const deliver = node.port.onmessage!;
    deliver({ data: { pcm: new Float32Array(4), end: 1 } });
    expect(s.chunks.length).toBe(1);
    cap.close();
    // 片付ける前に送られて、後から届いたかたまり
    deliver({ data: { pcm: new Float32Array(4), end: 2 } });
    expect(s.chunks.length).toBe(1);
    expect(node.port.posted).toContain('stop');
    expect(node.port.onmessage).toBe(null);
    expect(ctx.src!.to.size).toBe(0);
    expect(ctx.closed).toBe(true);
  });

  it('受けるのをやめても、動画の音は出したまま（AudioContext は閉じない）', async () => {
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    const ctx = new FakeCtx();
    const s = sinkOf();
    const cap = await openCapture(video, 'w.js', s.sink, false, () => ctx as unknown as AudioContext);
    expect(ctx.out!.gain.value).toBe(0);
    cap.audible(true);
    expect(ctx.out!.gain.value).toBe(1);
    const deliver = FakeWorkletNode.last!.port.onmessage!;
    cap.stop();
    deliver({ data: { pcm: new Float32Array(4), end: 2 } });
    expect(s.chunks.length).toBe(0);
    expect(ctx.closed).toBe(false);
    expect([...ctx.src!.to]).toEqual([ctx.out]);
    expect(ctx.out!.to.has(ctx.destination)).toBe(true);
  });

  it('動画の音をほかの物が取り込んでいたら、作った AudioContext を閉じて知らせる', async () => {
    const ctx = new FakeCtx(true, true);
    await expect(openCapture(video, 'w.js', sinkOf().sink, true, () => ctx as unknown as AudioContext)).rejects.toThrow();
    expect(ctx.closed).toBe(true);
  });

  it('AudioWorklet が無い時の ScriptProcessor: 受けたその場で写し、時刻は数えた物（playbackTime ではない）', async () => {
    const ctx = new FakeCtx(false);
    const s = sinkOf();
    await openCapture(video, 'w.js', s.sink, true, () => ctx as unknown as AudioContext);
    const sp = ctx.sp!;
    const dur = SP_SIZE / ctx.sampleRate;
    const chans = [new Float32Array(SP_SIZE).fill(1), new Float32Array(SP_SIZE).fill(3)];
    const ev = { playbackTime: 99, inputBuffer: { length: SP_SIZE, numberOfChannels: 2, getChannelData: (c: number) => chans[c]! } };
    ctx.currentTime = 5;
    sp.onaudioprocess!(ev);
    // 入れ物は、次の音で上書きされる
    chans[0]!.fill(9);
    expect(s.chunks[0]!.pcm[0]).toBe(2);
    expect(s.chunks[0]!.end).toBe(5);
    ctx.currentTime = 5 + dur + 0.01;
    sp.onaudioprocess!(ev);
    expect(s.chunks[1]!.end).toBeCloseTo(5 + dur, 9);
    // ページが止まっていた: まとめて届いた古いかたまりは捨てる
    ctx.currentTime = 5 + 5 * dur;
    sp.onaudioprocess!(ev);
    expect(s.gaps()).toBe(1);
    expect(s.chunks.length).toBe(2);
  });
});
