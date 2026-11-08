// voice-match 収集（運営用の Chrome 拡張機能）: YouTube の再生ページの右下に小さな板を出す。運営がお手本の声を選んで
// 「測る」を押し、自分で配信を再生すると、<video> の音を 30 秒ずつ measure.ts（サイトと同じコード）で数字にする。
// 音はメモリーの中だけに置き、数字にしたら捨てる。どこにも送らない。残すのは数字・動画 ID・時刻だけ（chrome.storage.local）。
// 「書き出し」で data/voices/<id>.json の形のファイルを保存し、運営がリポジトリへ入れる。
// 再生は人が行う（この拡張は動画を開かない・再生しない・飛ばさない）。広告中・一時停止・シーク・読み込みで止まった所・速度 1 以外の間は測らない。
// 保存できない時（拡張機能が読み直された・保存する場所がいっぱい）は、板に出して測るのをやめる。
// YouTube のページは Trusted Types を求めるので、innerHTML を使わず、要素を 1 つずつ作る。
import catalog from '../../data/catalog.json';
import type { Catalog, VoiceFile } from '../../src/data/types.ts';
import { openCapture, type Capture } from './capture.ts';
import { alive, clearFile, loadFile, recordWindow, TROUBLE_TEXT, troubleOf, troubleText, type Trouble } from './store.ts';
import { chunkTime, videoIdOf, Windower, WINDOW_SECONDS, type BreakReason } from './windowing.ts';

const LIST = (catalog as Catalog).voices;

const BREAK_TEXT: Record<BreakReason, string> = {
  ad: '広告中は測りません',
  paused: '一時停止・シーク中は測りません',
  stall: '動画の読み込みで止まった所は測りません',
  speed: '再生速度が 1 倍の時だけ測ります',
  jump: '再生位置が飛んだので、その窓は捨てました',
  gap: 'ページが重く、音が途切れたので、その窓は捨てました',
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
  error: '数字にできない',
  busy: '前の窓を測っていた',
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

const host = el('div', { id: 'voice-match-collector' });
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
  el('div', { className: 'head' }, 'voice-match 収集', minBtn),
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
/** 今の動画の要素の音のグラフ。gen は作った順の番号（前のグラフから遅れて届いたかたまりを捨てる） */
let graph: { gen: number; video: HTMLVideoElement; cap: Capture; win: Windower } | null = null;
let gens = 0;
let busy = false;
let starting = false;
/** 拡張機能が読み直された: このページでは、もう保存できない */
let dead = false;

const validId = (s: string) => /^[a-z0-9][a-z0-9-]{0,40}$/.test(s);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function render() {
  const v = LIST.find((x) => x.id === currentId);
  nameLine.textContent = currentId ? (v ? v.name : 'data/catalog.json に無い ID です（書き出しても build-voices.ts で使われません）') : '';
  startBtn.textContent = running ? '止める' : '測る';
  startBtn.disabled = dead || (!validId(currentId) && !running);
  exportBtn.disabled = dead || !file || !file.windows.length;
  clearBtn.disabled = dead || !file || !file.windows.length || running;
  idInput.disabled = dead || running;
  const n = file?.windows.length ?? 0;
  const videos = new Set(file?.windows.map((w) => w.video)).size;
  const fails = Object.entries(tally)
    .filter(([, c]) => c > 0)
    .map(([k, c]) => `${FAIL_TEXT[k] ?? k} ${c}`)
    .join('・');
  tallyLine.textContent = `記録: 窓 ${n} 個・動画 ${videos} 本${fails ? `（このページで除いた: ${fails}）` : ''}`;
}

/** 保存などに失敗した時: 板に出す。拡張機能が読み直された・保存する場所がいっぱいなら、測るのをやめる。failed は、そのほかの失敗の時の文 */
function fail(e: unknown, failed: string) {
  stopFor(troubleOf(e), troubleText(e, failed));
}
function stopFor(trouble: Trouble, text: string) {
  if (trouble === 'gone') {
    dead = true;
    // 動画の音は消さない（受けるのだけやめる）
    graph?.cap.stop();
  }
  if (trouble !== 'other' && running) {
    running = false;
    graph?.win.reset(null);
    barFill.style.width = '0';
  }
  status.textContent = text;
  render();
}

/* ---- 音を受ける ---- */
/** YouTube のプレーヤー。測る動画も、広告中かどうかも、ここで見る（ページのほかの所の動画、たとえば一覧の試し再生は見ない） */
const player = () => document.querySelector<HTMLElement>('#movie_player');
function mainVideo(): HTMLVideoElement | null {
  const p = player();
  return p?.querySelector<HTMLVideoElement>('video.html5-main-video') ?? p?.querySelector('video') ?? null;
}

function playState(video: HTMLVideoElement) {
  const paused = video.paused || video.ended;
  return {
    video: videoIdOf(location.href),
    time: video.currentTime,
    paused,
    seeking: video.seeking,
    rate: video.playbackRate,
    ad: !!player()?.classList.contains('ad-showing'),
    // 先の音がまだ無い（読み込みで止まっている。HAVE_FUTURE_DATA より少ない）
    stalled: !paused && video.readyState < 3,
  };
}

/** end: かたまりの終わりの時刻（AudioContext の時計、秒） */
function onChunk(gen: number, samples: Float32Array, end: number) {
  if (!running || !graph || graph.gen !== gen) return;
  const s = playState(graph.video);
  // 届くのが遅れたかたまりも、音の通りの時刻に（窓の時刻と、再生位置が飛んだかどうかを、かたまりごとに正しく）
  s.time = chunkTime(s.time, s.rate, graph.cap.ctx.currentTime, end);
  const done = graph.win.push(samples, s);
  const sec = graph.win.seconds();
  barFill.style.width = `${Math.min(100, (sec / WINDOW_SECONDS) * 100)}%`;
  warn.textContent = graph.win.lastBreak ? BREAK_TEXT[graph.win.lastBreak] : '';
  if (!done) return;
  if (busy) {
    // 前の窓をまだ測っている: この窓は待たせずに手放す（ページを重くしないため）
    tally.busy = (tally.busy ?? 0) + 1;
    return;
  }
  busy = true;
  status.textContent = '数字にしています…';
  const id = currentId;
  const rate = graph.cap.ctx.sampleRate;
  setTimeout(async () => {
    try {
      const r = await recordWindow(id, done, rate, today());
      const span = `${done.t0.toFixed(0)}〜${done.t1.toFixed(0)} 秒`;
      if (r.kind === 'failed') {
        // 数字にできなかった窓は除いて続ける。保存できない時は、わけによって測るのをやめる
        if (r.step === 'measure') tally.error = (tally.error ?? 0) + 1;
        stopFor(r.trouble, r.text);
      } else if (r.kind === 'dropped') {
        tally[r.reason] = (tally[r.reason] ?? 0) + 1;
        status.textContent = `${span}: 除きました（${FAIL_TEXT[r.reason] ?? r.reason}）`;
      } else {
        if (r.kind === 'added') status.textContent = `${span}: 記録しました（声 ${r.w.voicedSeconds.toFixed(1)} 秒・高さ ${r.w.features.pitch} Hz）`;
        else {
          tally.overlap = (tally.overlap ?? 0) + 1;
          status.textContent = `${span}: 測り済みの所でした`;
        }
        if (id === currentId) file = r.f;
      }
    } catch (e) {
      fail(e, '記録できませんでした');
    } finally {
      busy = false;
      render();
    }
  }, 0);
}

/** 動画の要素の音を受ける。別の要素に移る時は、前のグラフを片付ける（前のかたまりが新しい窓に混ざらないように） */
async function hook(video: HTMLVideoElement) {
  if (graph && graph.video === video) return graph;
  const gen = gens + 1;
  const cap = await openCapture(
    video,
    chrome.runtime.getURL('capture.worklet.js'),
    {
      chunk: (pcm, end) => onChunk(gen, pcm, end),
      gap: () => {
        if (running && graph?.gen === gen) graph.win.gap();
      },
    },
    audible.checked,
  );
  gens = gen;
  graph?.cap.close();
  graph = { gen, video, cap, win: new Windower(cap.ctx.sampleRate) };
  return graph;
}

/* ---- 操作 ---- */
idInput.addEventListener('input', async () => {
  const id = (currentId = idInput.value.trim());
  try {
    const f = validId(id) ? await loadFile(id) : null;
    // 打っている間に先の ID の読み込みが後から終わっても、今の ID の記録を出す
    if (id === currentId) file = f;
  } catch (e) {
    if (id === currentId) file = null;
    fail(e, '記録を読み込めませんでした');
  }
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
  if (starting || dead) return;
  // 拡張機能が読み直された後の古いページ: 動画の音を取り込まない（取り込むと、ページを読み直すまで外せない）
  if (!alive()) return stopFor('gone', TROUBLE_TEXT.gone);
  const video = mainVideo();
  if (!video) {
    status.textContent = '動画が見つかりません。再生ページで押してください。';
    return;
  }
  starting = true;
  try {
    let g: NonNullable<typeof graph>;
    try {
      g = await hook(video);
      await g.cap.ctx.resume();
    } catch (e) {
      if (troubleOf(e) === 'gone') return fail(e, '');
      status.textContent = '動画の音を受け取れませんでした。ページを読み直してから、もう一度「測る」を押してください。';
      return;
    }
    const id = currentId;
    const f = await loadFile(id);
    if (id === currentId) file = f;
    g.win.reset(null);
    running = true;
    status.textContent = `測っています（${WINDOW_SECONDS} 秒ごと）。動画を再生してください。`;
  } catch (e) {
    fail(e, '記録を読み込めませんでした');
  } finally {
    starting = false;
    render();
  }
});
audible.addEventListener('change', () => {
  graph?.cap.audible(audible.checked);
});
exportBtn.addEventListener('click', async () => {
  if (!validId(currentId)) return;
  try {
    const f = await loadFile(currentId);
    const blob = new Blob([JSON.stringify(f, null, 1) + '\n'], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${f.id}.json` });
    shadow.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e) {
    fail(e, '書き出せませんでした');
  }
});
clearBtn.addEventListener('click', async () => {
  // 2 回押す: 1 回目は確かめ、2 回目で消す
  if (clearBtn.dataset.sure !== '1') {
    clearBtn.dataset.sure = '1';
    clearBtn.textContent = 'もう一度押すと消えます';
    setTimeout(() => {
      clearBtn.dataset.sure = '';
      clearBtn.textContent = '記録を消す';
    }, 4000);
    return;
  }
  const id = currentId;
  try {
    await clearFile(id);
    if (id === currentId) file = { id, windows: [] };
  } catch (e) {
    fail(e, '記録を消せませんでした');
  }
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
