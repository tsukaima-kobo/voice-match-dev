// 収集の拡張機能の、動画の音を受けるグラフ（AudioContext。test/collector-capture.test.ts で、AudioContext の代わりを渡して試す）。
// 動画の音は「音を出す」の GainNode から、そのまま出す。同じ音を AudioWorklet（使えなければ ScriptProcessor）で受けて、かたまりごとに渡す。
// 渡す時刻は、かたまりを録り終えた時（AudioContext の時計）: ページが止まって遅れて受けても、録った時の時刻で並べるため。
// 止めた・片付けたグラフから遅れて届いたかたまりは捨てる。

export interface Sink {
  /** 音のかたまり（1 チャンネル）。end は録り終えた時刻（AudioContext の時計、秒） */
  chunk(pcm: Float32Array, end: number): void;
  /** かたまりを受け損ねた（音が途切れた） */
  gap(): void;
}

export interface Capture {
  readonly ctx: AudioContext;
  /** 音を出すか（出さなくても測れる） */
  audible(on: boolean): void;
  /** 受けるのをやめる。動画の音は、そのまま出す（拡張機能が読み直された時に、動画の音を消さない） */
  stop(): void;
  /** 片付ける: 受けるのをやめ、つないだ物を外して AudioContext を閉じる（別の動画の要素に移る時。閉じた後、前の要素の音は、このページでは出ない） */
  close(): void;
}

/** ScriptProcessor の 1 かたまり（音の出力の区切りより十分長く。短いと、出力がまとめて進む時に遅れと取り違える） */
export const SP_SIZE = 16384;

/**
 * ScriptProcessor のかたまりの、録り終えた時刻。playbackTime は、ページが受けた時の時計から決まるので使わない。
 * かたまりを数えて時刻を出す（受けた時の時計より先にはしない）。
 * Chrome の ScriptProcessor は入れ物 2 つを交互に使う: 受けるのが 1 かたまり分より遅れると、その入れ物には次の音が書かれている。
 * そういうかたまりは捨てる（null）。ページから見た時計は、音の出力の区切りの分だけ先に進んでいることがあり、
 * 数えた時刻もその分遅れうるので、半かたまりより遅れた物を捨てる。
 * 遅れが続けて同じ（ページは止まっていない）なら、受け損ねたかたまりがあったので数え直す。
 */
export class SpClock {
  private end = NaN;
  private late = NaN;
  readonly dur: number;

  constructor(dur: number) {
    this.dur = dur;
  }

  /** now: 受けた時の AudioContext の時計 */
  take(now: number): number | null {
    const counted = this.end + this.dur;
    let end: number | null;
    if (!(counted < now)) end = now; // 最初・数えた時刻が今より先
    else if (now - counted < this.dur / 2) end = counted;
    else if (Math.abs(now - counted - this.late) < this.dur / 2) end = now;
    else end = null;
    this.late = end === null ? now - counted : NaN;
    this.end = end ?? counted;
    return end;
  }
}

/** いくつかのチャンネルを平均して 1 つに（新しい入れ物に写す） */
function mixDown(b: AudioBuffer): Float32Array {
  const x = new Float32Array(b.length);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < x.length; i++) x[i] = x[i]! + d[i]! / b.numberOfChannels;
  }
  return x;
}

/**
 * 動画の要素の音を受け始める。動画の要素を AudioContext に取り込めるのは 1 回だけ: ここから先、その音はこのグラフを通る。
 * ほかの物（別の拡張機能・読み直す前のこの拡張機能）が先に取り込んでいると失敗する: 作った AudioContext は閉じて、投げる（呼んだ側が知らせる）
 */
export async function openCapture(video: HTMLMediaElement, workletUrl: string, sink: Sink, audible: boolean, make: () => AudioContext = () => new AudioContext()): Promise<Capture> {
  const ctx = make();
  let src: MediaElementAudioSourceNode;
  try {
    src = ctx.createMediaElementSource(video);
  } catch (e) {
    void ctx.close().catch(() => {});
    throw e;
  }
  const out = ctx.createGain();
  out.gain.value = audible ? 1 : 0;
  src.connect(out).connect(ctx.destination);
  let live = true,
    closed = false;
  const tap = await openTap(ctx, workletUrl, sink, () => live);
  src.connect(tap.node);
  tap.node.connect(ctx.destination);
  const stop = () => {
    if (!live) return;
    live = false;
    tap.halt();
    try {
      src.disconnect(tap.node);
      tap.node.disconnect();
    } catch {
      /* もう外れている */
    }
  };
  return {
    ctx,
    audible(on) {
      out.gain.value = on ? 1 : 0;
    },
    stop,
    close() {
      stop();
      if (closed) return;
      closed = true;
      try {
        src.disconnect();
        out.disconnect();
      } catch {
        /* もう外れている */
      }
      void ctx.close().catch(() => {});
    },
  };
}

/** 音を受ける所（AudioWorklet か ScriptProcessor）。live() が false になった後に届いた物は渡さない */
async function openTap(ctx: AudioContext, workletUrl: string, sink: Sink, live: () => boolean): Promise<{ node: AudioNode; halt: () => void }> {
  try {
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, 'voice-match-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = (e: MessageEvent<{ pcm: Float32Array; end: number }>) => {
      if (live()) sink.chunk(e.data.pcm, e.data.end);
    };
    return {
      node,
      halt() {
        node.port.onmessage = null;
        node.port.postMessage('stop');
      },
    };
  } catch {
    // ここでは AudioWorklet が使えない: 古い ScriptProcessor で
    const sp = ctx.createScriptProcessor(SP_SIZE, 2, 1);
    const clock = new SpClock(SP_SIZE / ctx.sampleRate);
    sp.onaudioprocess = (e) => {
      if (!live()) return;
      const end = clock.take(ctx.currentTime);
      if (end === null) return sink.gap();
      // 入れ物は次の音で上書きされるので、受けたその場で写す
      sink.chunk(mixDown(e.inputBuffer), end);
    };
    return {
      node: sp,
      halt() {
        sp.onaudioprocess = null;
      },
    };
  }
}
