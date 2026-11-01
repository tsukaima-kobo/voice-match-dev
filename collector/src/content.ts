// voice-twin 収集（運営用の Chrome 拡張機能）: YouTube の再生ページの右下に小さな板を出す。運営がお手本の声を選んで
// 「測る」を押し、自分で配信を再生すると、<video> の音を 30 秒ずつ measure.ts（サイトと同じコード）で数字にする。
// 音はメモリーの中だけに置き、数字にしたら捨てる。どこにも送らない。残すのは数字・動画 ID・時刻だけ（chrome.storage.local）。
// 「書き出し」で data/voices/<id>.json の形のファイルを保存し、運営がリポジトリへ入れる。
// 再生は人が行う（この拡張は動画を開かない・再生しない・飛ばさない）。広告中・一時停止・シーク・速度 1 以外の間は測らない。
// YouTube のページは Trusted Types を求めるので、innerHTML を使わず、要素を 1 つずつ作る。
import catalog from '../../data/catalog.json';
import { MEASURE_VERSION, measureVoice } from '../../src/voice/measure.ts';
import type { Catalog, VoiceFile } from '../../src/data/types.ts';
import { addWindow, videoIdOf, windowOf, Windower, WINDOW_SECONDS, type BreakReason } from './windowing.ts';

const LIST = (catalog as Catalog).voices;
const MIN_VOICED = 8;
const keyOf = (id: string) => `voices:${id}`;

const BREAK_TEXT: Record<BreakReason, string> = {
  ad: '広告中は測りません',
  paused: '一時停止・シーク中は測りません',
  speed: '再生速度が 1 倍の時だけ測ります',
  jump: '再生位置が飛んだので、その窓は捨てました',
  'other-video': '動画が変わったので、その窓は捨てました',
  'no-video': '再生ページではありません',
};
const FAIL_TEXT: Record<string, string> = {
  silent: '音が無い',
  quiet: '小さすぎる',
  noisy: '雑音が多い',
  clipped: '音割れ',
  short: '声が少ない',
  invalid: '測れない',
  overlap: '測り済みの所',
};

/* ---- 板（Shadow DOM の中に、要素を 1 つずつ作る） ---- */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { style?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { style, ...rest } = props;
  Object.assign(e, rest);
  if (style) e.setAttribute('style', style);
  for (const k of kids) e.append(k);
  return e;
}

const host = el('div', { id: 'voice-twin-collector' });
const shadow = host.attachShadow({ mode: 'closed' });
const css = new CSSStyleSheet();
css.replaceSync(`
  :host { all: initial; }
  .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 300px; background: #fff; color: #1d2320; border: 1px solid #c9d1cc; border-radius: 10px; box-shadow: 0 4px 18px rgba(0,0,0,.18); font: 13px/1.6 system-ui, sans-serif; padding: 12px; display: grid; gap: 8px; }
  .box.min > :not(.head) { display: none; }
  .head { display: flex; justify-content: space-between; align-items: center; font-weight: 700; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  input[type=text] { flex: 1; min-width: 0; padding: 4px 6px; border: 1px solid #c9d1cc; border-radius: 6px; font: inherit; }
  button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid #23725a; background: #fff; color: #23725a; cursor: pointer; }
  button.go { background: #23725a; color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  .muted { color: #5d6762; font-size: 12px; }
  .warn { color: #8a5a00; font-size: 12px; min-height: 1.2em; }
  .bar { height: 6px; background: #e3ece8; border-radius: 3px; overflow: hidden; }
  .bar > div { height: 100%; width: 0; background: #23725a; }
`);
shadow.adoptedStyleSheets = [css];

const idInput = el('input', { type: 'text', placeholder: 'お手本の ID（例 v-0001）' });
idInput.setAttribute('list', 'voice-list');
const datalist = el('datalist', { id: 'voice-list' });
for (const v of LIST) datalist.append(el('option', { value: v.id, label: v.name }));
const nameLine = el('div', { className: 'muted' });
const startBtn = el('button', { className: 'go', textContent: '測る' });
const exportBtn = el('button', { textContent: '書き出し' });
const clearBtn = el('button', { textContent: '記録を消す' });
const audible = el('input', { type: 'checkbox', checked: true });
const minBtn = el('button', { textContent: '－', title: '小さくする' });
const barFill = el('div');
const status = el('div', { textContent: '止まっています' });
const warn = el('div', { className: 'warn' });
const tallyLine = el('div', { className: 'muted' });
const box = el(
  'div',
  { className: 'box' },
  el('div', { className: 'head' }, 'voice-twin 収集', minBtn),
  el('div', { className: 'row' }, idInput, datalist),
  nameLine,
  el('div', { className: 'row' }, startBtn, exportBtn, clearBtn),
  el('label', { className: 'row muted' }, audible, '音を出す（消しても測れます）'),
  el('div', { className: 'bar' }, barFill),
  status,
  warn,
  tallyLine,
  el('div', { className: 'muted', textContent: '音は保存も送信もしません。残すのは数字・動画 ID・時刻だけです。' }),
);
shadow.append(box);

/* ---- 状態 ---- */
let running = false;
let currentId = '';
let file: VoiceFile | null = null;
const tally: Record<string, number> = {};
let graph: { video: HTMLVideoElement; ctx: AudioContext; out: GainNode; win: Windower; stop: () => void } | null = null;
let busy = false;

const validId = (s: string) => /^[a-z0-9][a-z0-9-]{0,40}$/.test(s);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function loadFile(id: string): Promise<VoiceFile> {
  const got = await chrome.storage.local.get(keyOf(id));
  const f = got[keyOf(id)] as VoiceFile | undefined;
  return f && Array.isArray(f.windows) ? f : { id, windows: [] };
}
async function saveFile(f: VoiceFile): Promise<void> {
  await chrome.storage.local.set({ [keyOf(f.id)]: f });
}

function render() {
  const v = LIST.find((x) => x.id === currentId);
  nameLine.textContent = currentId ? (v ? v.name : 'data/catalog.json に無い ID です（書き出しても build-voices.ts で使われません）') : '';
  startBtn.textContent = running ? '止める' : '測る';
  startBtn.disabled = !validId(currentId) && !running;
  exportBtn.disabled = !file || !file.windows.length;
  clearBtn.disabled = !file || !file.windows.length || running;
  idInput.disabled = running;
  const n = file?.windows.length ?? 0;
  const videos = new Set(file?.windows.map((w) => w.video)).size;
  const fails = Object.entries(tally)
    .filter(([, c]) => c > 0)
    .map(([k, c]) => `${FAIL_TEXT[k] ?? k} ${c}`)
    .join('・');
  tallyLine.textContent = `記録: 窓 ${n} 個・動画 ${videos} 本${fails ? `（このページで除いた: ${fails}）` : ''}`;
}

/* ---- 音を受ける ---- */
function playState(video: HTMLVideoElement) {
  return {
    video: videoIdOf(location.href),
    time: video.currentTime,
    paused: video.paused || video.ended,
    seeking: video.seeking,
    rate: video.playbackRate,
    ad: !!document.querySelector('#movie_player.ad-showing'),
  };
}

function onChunk(samples: Float32Array) {
  if (!running || !graph) return;
  const done = graph.win.push(samples, playState(graph.video));
  const sec = graph.win.seconds();
  barFill.style.width = `${Math.min(100, (sec / WINDOW_SECONDS) * 100)}%`;
  warn.textContent = graph.win.lastBreak ? BREAK_TEXT[graph.win.lastBreak] : '';
  if (!done) return;
  if (busy) {
    // (the last window still being measured: this one is let go rather than queued, to keep the page light)
    tally.busy = (tally.busy ?? 0) + 1;
    return;
  }
  busy = true;
  status.textContent = '数字にしています…';
  const id = currentId;
  setTimeout(async () => {
    try {
      const m = measureVoice(done.pcm, graph!.ctx.sampleRate, { minVoicedSeconds: MIN_VOICED });
      // (the sound is let go here: only the numbers stay)
      done.pcm.fill(0);
      const w = windowOf(m, done, MEASURE_VERSION, today());
      if (!w) {
        const reason = m.ok ? 'invalid' : m.reason;
        tally[reason] = (tally[reason] ?? 0) + 1;
        status.textContent = `${done.t0.toFixed(0)}〜${done.t1.toFixed(0)} 秒: 除きました（${FAIL_TEXT[reason] ?? reason}）`;
      } else {
        const f = await loadFile(id);
        if (addWindow(f, w)) {
          await saveFile(f);
          status.textContent = `${done.t0.toFixed(0)}〜${done.t1.toFixed(0)} 秒: 記録しました（声 ${w.voicedSeconds.toFixed(1)} 秒・高さ ${w.features.pitch} Hz）`;
        } else {
          tally.overlap = (tally.overlap ?? 0) + 1;
          status.textContent = `${done.t0.toFixed(0)}〜${done.t1.toFixed(0)} 秒: 測り済みの所でした`;
        }
        if (id === currentId) file = f;
      }
    } finally {
      busy = false;
      render();
    }
  }, 0);
}

async function hook(video: HTMLVideoElement) {
  if (graph && graph.video === video) return graph;
  // (a video element can be taken into an AudioContext once only: from here its sound goes through this graph)
  const ctx = new AudioContext();
  const src = ctx.createMediaElementSource(video);
  const out = ctx.createGain();
  out.gain.value = audible.checked ? 1 : 0;
  src.connect(out).connect(ctx.destination);
  const win = new Windower(ctx.sampleRate);
  let stop = () => {};
  try {
    await ctx.audioWorklet.addModule(chrome.runtime.getURL('capture.worklet.js'));
    const node = new AudioWorkletNode(ctx, 'voice-twin-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data);
    src.connect(node);
    node.connect(ctx.destination);
    stop = () => node.port.postMessage('stop');
  } catch {
    // (no AudioWorklet here: the older ScriptProcessor)
    const sp = ctx.createScriptProcessor(4096, 2, 1);
    sp.onaudioprocess = (e) => {
      const b = e.inputBuffer;
      const x = new Float32Array(b.length);
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < x.length; i++) x[i] = x[i]! + d[i]! / b.numberOfChannels;
      }
      onChunk(x);
    };
    src.connect(sp);
    sp.connect(ctx.destination);
    stop = () => sp.disconnect();
  }
  graph = { video, ctx, out, win, stop };
  return graph;
}

/* ---- 操作 ---- */
idInput.addEventListener('input', async () => {
  currentId = idInput.value.trim();
  file = validId(currentId) ? await loadFile(currentId) : null;
  render();
});
startBtn.addEventListener('click', async () => {
  if (running) {
    running = false;
    graph?.win.reset(null);
    status.textContent = '止まっています';
    barFill.style.width = '0';
    render();
    return;
  }
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video') ?? document.querySelector('video');
  if (!video) {
    status.textContent = '動画が見つかりません。再生ページで押してください。';
    return;
  }
  const g = await hook(video);
  await g.ctx.resume();
  g.win.reset(null);
  file = await loadFile(currentId);
  running = true;
  status.textContent = `測っています（${WINDOW_SECONDS} 秒ごと）。動画を再生してください。`;
  render();
});
audible.addEventListener('change', () => {
  if (graph) graph.out.gain.value = audible.checked ? 1 : 0;
});
exportBtn.addEventListener('click', async () => {
  if (!validId(currentId)) return;
  const f = await loadFile(currentId);
  const blob = new Blob([JSON.stringify(f, null, 1) + '\n'], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${f.id}.json` });
  shadow.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});
clearBtn.addEventListener('click', async () => {
  // (two presses: the first asks, the second clears)
  if (clearBtn.dataset.sure !== '1') {
    clearBtn.dataset.sure = '1';
    clearBtn.textContent = 'もう一度押すと消えます';
    setTimeout(() => {
      clearBtn.dataset.sure = '';
      clearBtn.textContent = '記録を消す';
    }, 4000);
    return;
  }
  await chrome.storage.local.remove(keyOf(currentId));
  file = { id: currentId, windows: [] };
  clearBtn.dataset.sure = '';
  clearBtn.textContent = '記録を消す';
  render();
});
minBtn.addEventListener('click', () => {
  box.classList.toggle('min');
  minBtn.textContent = box.classList.contains('min') ? '＋' : '－';
});

/* ---- 再生ページの時だけ出す（YouTube はページを読み直さずに移る） ---- */
function place() {
  const onWatch = videoIdOf(location.href) !== null;
  if (onWatch && !host.isConnected) document.documentElement.append(host);
  if (!onWatch && host.isConnected && !running) host.remove();
}
setInterval(place, 1000);
place();
render();
