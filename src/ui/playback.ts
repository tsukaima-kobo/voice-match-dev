// 声真似練習場で、録った音（お手本・真似）を何回でも聞き直す。音はこのページのメモリーにあるものを鳴らすだけ（どこにも送らない）。
// 一度に鳴らすのは 1 つだけ（新しく鳴らすと、前のは止まる）。前後の静かな所は飛ばし、小さい音は聞き取れる大きさまで上げる
// （上げるのは 8 倍まで。割れないよう、いちばん大きい所を 0.9 に）。逆再生もできる。
// 鳴らすための AudioContext は、初めて鳴らした時に作り、ページを離れる時に閉じる（close）。

export interface Clip {
  pcm: Float32Array;
  rate: number;
}

/** 前後の静かな所を除いた範囲（写しはしない）。声が無ければ全部 */
export function trimmed(pcm: Float32Array, rate: number): Float32Array {
  const hop = Math.max(1, Math.round(rate / 100));
  const n = Math.floor(pcm.length / hop);
  if (n < 3) return pcm;
  const level = new Float32Array(n);
  let max = 0;
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += pcm[i]! * pcm[i]!;
    level[f] = Math.sqrt(s / hop);
    if (level[f]! > max) max = level[f]!;
  }
  if (max <= 0) return pcm;
  // いちばん大きい所から 30 dB 下より大きい所を声とみなし、前後に 0.12 秒の余白を残す
  const floor = max * 0.0316;
  let a = 0;
  while (a < n && level[a]! < floor) a++;
  let b = n - 1;
  while (b > a && level[b]! < floor) b--;
  const pad = Math.round(0.12 * rate);
  return pcm.subarray(Math.max(0, a * hop - pad), Math.min(pcm.length, (b + 1) * hop + pad));
}

/** 逆にした写し */
export function reversed(pcm: Float32Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[pcm.length - 1 - i]!;
  return out;
}

export interface Playback {
  /** `key` の音を鳴らす（鳴っている物は止める） */
  play(key: string, clip: Clip, reverse?: boolean): void;
  stop(): void;
  /** 今鳴らしている物の key（無ければ null） */
  readonly playing: string | null;
  /** 止めて、AudioContext を閉じる（ページを離れる時） */
  close(): void;
}

/** 鳴らす所を作る。鳴りはじめ・止まった時に `onChange`（ボタンの文字を変えるため） */
export function createPlayback(onChange: (key: string | null) => void): Playback {
  let ctx: AudioContext | null = null;
  let src: AudioBufferSourceNode | null = null;
  let key: string | null = null;
  const stop = () => {
    if (src) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* もう止まっている */
      }
      src.disconnect();
      src = null;
    }
    if (key !== null) {
      key = null;
      onChange(null);
    }
  };
  return {
    play(k, clip, reverse = false) {
      stop();
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx ??= new AC();
      // 閉じた時に待っている resume は断られる（ページを離れる時）。その断りは捨てる
      ctx.resume().catch(() => {});
      const part = trimmed(clip.pcm, clip.rate);
      if (!part.length) return;
      const buf = ctx.createBuffer(1, part.length, clip.rate);
      const data = buf.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < part.length; i++) {
        const v = reverse ? part[part.length - 1 - i]! : part[i]!;
        data[i] = v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      const gain = ctx.createGain();
      gain.gain.value = peak > 0 ? Math.min(8, 0.9 / peak) : 1;
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(gain).connect(ctx.destination);
      s.onended = () => {
        if (src !== s) return;
        src = null;
        key = null;
        onChange(null);
      };
      s.start();
      src = s;
      key = k;
      onChange(k);
    },
    stop,
    get playing() {
      return key;
    },
    close() {
      stop();
      if (ctx) {
        void ctx.close().catch(() => {});
        ctx = null;
      }
    },
  };
}
