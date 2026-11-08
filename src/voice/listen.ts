// マイク（または、ほかのタブの音）から音を受ける。ブラウザーの加工（エコー消し・雑音消し・自動の音量）は切る（数字が変わるため）。
// 音はメモリーの中だけに置き、呼んだ側が数字にしたら捨てる。どこにも送らない、端末にも残さない。
// 止めた時はすぐトラックを止め、AudioContext を閉じる。
// タブの音は、ブラウザーの「共有」の画面で利用者がタブを選んだ時だけ取れる（声真似の練習のお手本用）。映像は使わない。
// `?test=1` の時だけ window.__voiceTwin.feed(samples, rate) で、マイクの代わりに決まった音を流せる（画面の確認用）。
// マイクは選べる（listMics の一覧の deviceId を openMic に渡す）。一覧の名前は、ブラウザーがマイクを許可した後にだけ見える。
import workletUrl from './capture.worklet.js?url&no-inline';
import { t } from '../i18n.ts';

export interface Mic {
  rate: number;
  /** 使っているマイクの名前（ブラウザーが教える時だけ） */
  label?: string;
  stop(): void;
}

/** 選べるマイク。id が空なら「端末の設定のマイク」 */
export interface MicChoice {
  id: string;
  label: string;
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

/** マイクを開いて、音を `onChunk` に渡し続ける。マイクが外れた時などは `onEnded`。`deviceId` で選んだマイク（空なら端末の設定のマイク） */
export async function openMic(onChunk: (x: Float32Array) => void, onEnded?: () => void, deviceId = ''): Promise<Mic> {
  if (fed) {
    // 確認用の音を、2048 ずつ、本当の 8 倍の速さで流す
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
  const audio: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
  if (deviceId) audio.deviceId = { exact: deviceId };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
  } catch (e) {
    // 選んだマイクが無くなった: ほかの誤りと分けて、ページが端末の設定のマイクに戻れるようにする
    const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
    if (deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
      const gone = new Error('the chosen microphone is gone');
      gone.name = 'MicGoneError';
      throw gone;
    }
    throw e;
  }
  return listenTo(stream, onChunk, onEnded);
}

/** マイクを選べるブラウザーか */
export function micChoiceSupported(): boolean {
  const md = navigator.mediaDevices as MediaDevices | undefined;
  return !!md && typeof md.enumerateDevices === 'function' && typeof md.getUserMedia === 'function';
}

/**
 * 選べるマイクの一覧（「端末の設定」の物は除く）。名前はマイクの許可の後にだけ見えるので、`ask` の時は一度だけ許可を求めて、
 * すぐ止める（音は受けない）。許可が無く名前が見えない時は、空の一覧。
 */
export async function listMics(ask = false): Promise<MicChoice[]> {
  if (!micChoiceSupported()) return [];
  if (ask) {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    for (const t of s.getTracks()) t.stop();
  }
  const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  if (!all.some((d) => d.label)) return [];
  const out: MicChoice[] = [];
  for (const d of all) {
    if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
    if (out.some((x) => x.id === d.deviceId)) continue;
    out.push({ id: d.deviceId, label: d.label || t(`マイク ${out.length + 1}`, `Microphone ${out.length + 1}`) });
  }
  return out;
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
  const label = stream.getAudioTracks()[0]?.label;
  return {
    rate: ctx.sampleRate,
    ...(label ? { label } : {}),
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
      return t('マイクが許可されていません。ブラウザーの設定でこのページにマイクを許可してから、もう一度押してください。', 'The microphone is not allowed. Allow it for this page in your browser settings, then press again.');
    case 'MicGoneError':
      return t('選んだマイクが見つかりませんでした。「いつものマイク」に戻したので、もう一度押してください。', 'The chosen microphone was not found. It has been set back to the default microphone; please press again.');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return t('マイクが見つかりません。マイクをつないでから、もう一度押してください。', 'No microphone was found. Connect one, then press again.');
    case 'NotReadableError':
    case 'AbortError':
      return t('マイクを始められませんでした。ほかのアプリやタブがマイクを使っていないか確かめてください。', 'The microphone could not start. Check that no other app or tab is using it.');
    default:
      return t('マイクを始められませんでした。もう一度押してください。', 'The microphone could not start. Please press again.');
  }
}

/** タブの音が取れない時の言葉 */
export function tabErrorText(e: unknown): string {
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
  switch (name) {
    case 'NoAudioError':
      return t('タブの音が共有されませんでした。共有するタブを選ぶ画面で「タブの音声も共有する」をオンにしてから、もう一度押してください。', 'The tab’s sound was not shared. Turn on “Share tab audio” when you choose the tab, then press again.');
    case 'NotAllowedError':
      return t('共有がキャンセルされました。お手本の動画を開いたタブを選んで、もう一度押してください。', 'Sharing was cancelled. Choose the tab with the model video and press again.');
    case 'NotSupportedError':
    case 'TypeError':
      return t('このブラウザーでは、タブの音を取れません。パソコンの Chrome か Edge を使うか、マイクで聞かせてください。', 'This browser cannot capture a tab’s sound. Use Chrome or Edge on a computer, or play it to the microphone.');
    default:
      return t('タブの音を取れませんでした。もう一度押すか、マイクで聞かせてください。', 'The tab’s sound could not be captured. Press again, or play it to the microphone.');
  }
}
