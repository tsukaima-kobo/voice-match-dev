// マイク（または、ほかのタブの音）から音を受ける。ブラウザーの加工（エコー消し・雑音消し・自動の音量）は切る（数字が変わるため）。
// 音はメモリーの中だけに置き、呼んだ側が数字にしたら捨てる。どこにも送らない、端末にも残さない。
// 止めた時はすぐトラックを止め、AudioContext を閉じる。
// タブの音は、ブラウザーの「共有」の画面で利用者がタブを選んだ時だけ取れる（声真似の練習のお手本用）。映像は使わない。
// `?test=1` の時だけ window.__voiceTwin.feed(samples, rate) で、マイクの代わりに決まった音を流せる（画面の確認用）。
import workletUrl from './capture.worklet.js?url&no-inline';

export interface Mic {
  rate: number;
  stop(): void;
}

interface TestHook {
  feed(samples: ArrayLike<number>, rate: number): void;
}
declare global {
  interface Window {
    __voiceTwin?: TestHook;
    webkitAudioContext?: typeof AudioContext;
  }
}

let fed: { samples: Float32Array; rate: number } | null = null;
if (new URLSearchParams(location.search).has('test')) {
  window.__voiceTwin = {
    feed(samples, rate) {
      fed = { samples: Float32Array.from(samples), rate };
    },
  };
}

/** マイクを開いて、音を `onChunk` に渡し続ける。マイクが外れた時などは `onEnded` */
export async function openMic(onChunk: (x: Float32Array) => void, onEnded?: () => void): Promise<Mic> {
  if (fed) {
    // (the test's sound, in chunks of 2048, at 8 times the real speed)
    const { samples, rate } = fed;
    let at = 0;
    const timer = setInterval(() => {
      for (let k = 0; k < 8 && at < samples.length; k++) {
        onChunk(samples.slice(at, at + 2048));
        at += 2048;
      }
    }, (2048 / rate) * 1000);
    return { rate, stop: () => clearInterval(timer) };
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    video: false,
  });
  return listenTo(stream, onChunk, onEnded);
}

/** ほかのタブの音を取れるブラウザーか（パソコンの Chrome・Edge など。スマホは取れない） */
export function tabAudioSupported(): boolean {
  const md = navigator.mediaDevices as MediaDevices | undefined;
  const touch = matchMedia('(pointer: coarse)').matches;
  return !!md && typeof md.getDisplayMedia === 'function' && !touch;
}

/** ほかのタブの音を取る。共有の画面で「タブの音声も共有」を選ばなかった時は、名前が NoAudioError の誤りにする */
export async function openTabAudio(onChunk: (x: Float32Array) => void, onEnded?: () => void): Promise<Mic> {
  const options = {
    video: { displaySurface: 'browser' },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
    preferCurrentTab: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'exclude',
    systemAudio: 'include',
    monitorTypeSurfaces: 'exclude',
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options as unknown as DisplayMediaStreamOptions);
  if (!stream.getAudioTracks().length) {
    for (const t of stream.getTracks()) t.stop();
    const e = new Error('no audio track');
    e.name = 'NoAudioError';
    throw e;
  }
  return listenTo(stream, onChunk, onEnded);
}

async function listenTo(stream: MediaStream, onChunk: (x: Float32Array) => void, onEnded?: () => void): Promise<Mic> {
  const AC = window.AudioContext ?? window.webkitAudioContext!;
  const ctx = new AC();
  const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  let detach = () => {};
  try {
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, 'voice-twin-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data);
    src.connect(node);
    node.connect(ctx.destination);
    detach = () => {
      node.port.postMessage('stop');
      node.disconnect();
    };
  } catch {
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (e) => onChunk(Float32Array.from(e.inputBuffer.getChannelData(0)));
    src.connect(sp);
    sp.connect(ctx.destination);
    detach = () => sp.disconnect();
  }
  let stopped = false;
  const ended = () => {
    if (!stopped) onEnded?.();
  };
  for (const t of stream.getAudioTracks()) t.addEventListener('ended', ended);
  await ctx.resume();
  return {
    rate: ctx.sampleRate,
    stop() {
      if (stopped) return;
      stopped = true;
      detach();
      src.disconnect();
      for (const t of stream.getTracks()) {
        t.removeEventListener('ended', ended);
        t.stop();
      }
      void ctx.close();
    },
  };
}

/** マイクが使えない時の言葉（getUserMedia の誤りの名前から） */
export function micErrorText(e: unknown): string {
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'マイクが許可されていません。ブラウザーの設定でこのページにマイクを許可してから、もう一度押してください。';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'マイクが見つかりません。マイクをつないでから、もう一度押してください。';
    case 'NotReadableError':
    case 'AbortError':
      return 'マイクを始められませんでした。ほかのアプリやタブがマイクを使っていないか確かめてください。';
    default:
      return 'マイクを始められませんでした。もう一度押してください。';
  }
}

/** タブの音が取れない時の言葉 */
export function tabErrorText(e: unknown): string {
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
  switch (name) {
    case 'NoAudioError':
      return 'タブの音が共有されませんでした。共有するタブを選ぶ画面で「タブの音声も共有する」をオンにしてから、もう一度押してください。';
    case 'NotAllowedError':
      return '共有がキャンセルされました。お手本の動画を開いたタブを選んで、もう一度押してください。';
    case 'NotSupportedError':
    case 'TypeError':
      return 'このブラウザーでは、タブの音を取れません。パソコンの Chrome か Edge を使うか、マイクで聞かせてください。';
    default:
      return 'タブの音を取れませんでした。もう一度押すか、マイクで聞かせてください。';
  }
}
