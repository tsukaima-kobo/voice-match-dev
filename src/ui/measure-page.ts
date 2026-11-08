// じっくり測る（measure.html）: 決まった文を読み続けた声を、30 秒ごとに measure.ts で数字にし、20 分ほどで代表値を作る。
// 作り方はサイトの声と同じ（30 秒ごとの数字 → 高さが外れた窓を除く → 項目ごとの中央値。src/voice/session.ts）。
// 音はメモリーの中だけ。30 秒の窓は Worker に渡し、測り終えたら 0 で埋まる（途中の音も、止めた時に捨てる）。どこにも送らない。
// 残すのは、利用者が押した時だけ: 「声のページの相手に入れる」でこの端末のブラウザーに数字だけ（src/data/mine.ts）、
// 「数字を書き出す」で数字だけのファイル（マイクの名前も入れない）。ページが隠れたら一時停止する（マイクも止める）。声から性別や年齢を判断しない。
// マイクの許可を待っている間も「やめる」で戻れる。
import { READINGS, readingText } from '../prompts/prompts.ts';
import { openMic, micErrorText, type Mic } from '../voice/listen.ts';
import { measureAsync } from '../voice/measure-async.ts';
import { MEASURE_VERSION, type MeasureFail } from '../voice/measure.ts';
import { createWave } from '../voice/wave.ts';
import { formatFeature, type Features } from '../voice/features.ts';
import { SESSION_MINUTES, SESSION_SELECT, sessionFile, shuffled, summarize, windowSize, WindowCutter, type SessionWindow } from '../voice/session.ts';
import { closenessWord, farScale, rank } from '../match/match.ts';
import { ENTRY_BY_ID, MODEL, PROFILES, voicesReady } from '../data/load.ts';
import { clearMine, loadMine, saveMine } from '../data/mine.ts';
import { groupOf, nameOf } from '../data/names.ts';
import { micPicker } from './mic-picker.ts';
import { el, itemRow, renderGroups } from './items.ts';
import { mountLang, onLang, t } from '../i18n.ts';
import { mountFooter, mountGithubLink } from './share.ts';

mountLang({ ja: '声をじっくり測る｜voice-match', en: 'Measure your voice in depth | voice-match' });
mountGithubLink();
mountFooter();

const TARGET_SECONDS = SESSION_MINUTES * 60;

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
const stage = $('stage');
const statusEl = $('status');
const fill = $('fill');
const secEl = $('sec');
const dots = $('dots');
const wave = createWave($<HTMLCanvasElement>('wave'));
const topic = { label: $('topic-label'), text: $('topic-text'), next: $<HTMLButtonElement>('next-text') };
const btn = {
  start: $<HTMLButtonElement>('start'),
  cancel: $<HTMLButtonElement>('cancel'),
  pause: $<HTMLButtonElement>('pause'),
  resume: $<HTMLButtonElement>('resume'),
  finish: $<HTMLButtonElement>('finish'),
  use: $<HTMLButtonElement>('use'),
  unuse: $<HTMLButtonElement>('unuse'),
  export: $<HTMLButtonElement>('export'),
  again: $<HTMLButtonElement>('again'),
};
const result = $('result');

type State = 'idle' | 'asking' | 'recording' | 'paused' | 'measuring' | 'done';
type Msg = () => string;
const M = (ja: string, en: string): Msg => () => t(ja, en);

// マイクの一覧が出せなかった時の知らせも、言葉を切り替えたら出し直す
const mics = micPicker([{ box: $('mic-pick'), select: $<HTMLSelectElement>('mic-select'), find: $<HTMLButtonElement>('mic-find') }], (msg) => {
  statusMsg = msg;
  statusEl.textContent = msg();
  statusEl.classList.add('bad');
});

let state: State = 'idle';
let statusMsg: Msg = () => '';
let mic: Mic | null = null;
/** 使っているマイクの名前（この画面に出すだけ。書き出すファイルには入れない） */
let micLabel = '';
/** マイクを開くたびに増やす（許可を待つ間に「やめる」・一時停止した時、後から開いたマイクをすぐ止める） */
let listenToken = 0;
let cutter: WindowCutter | null = null;
/** 窓にした秒（止めていた間は数えない） */
let recorded = 0;
let windows: SessionWindow[] = [];
/** 測っている途中の窓の数 */
let inFlight = 0;
let raf = 0;
let deck = shuffled(READINGS.length);
let at = 0;
let summary: ReturnType<typeof summarize> | null = null;
/** 「声のページの相手に入れる」が残せなかった時の知らせ（言葉を切り替えても出したままにする） */
let useNote: Msg | null = null;

/* ---- 決まった文 ---- */
function showText() {
  topic.label.textContent = t(`決まった文（ふだんの声で読んでください）　${at + 1} / ${deck.length}`, `Set text (read it in your usual voice)  ${at + 1} / ${deck.length}`);
  topic.text.textContent = readingText(deck[at]!);
  topic.next.textContent = t('次の文', 'Next text');
}
topic.next.addEventListener('click', () => {
  at++;
  // 全部読んだら、新しい順番に（今読んだ文からは始めない）
  if (at >= deck.length) {
    const last = deck[deck.length - 1];
    deck = shuffled(READINGS.length);
    if (deck[0] === last && deck.length > 1) [deck[0], deck[1]] = [deck[1]!, deck[0]!];
    at = 0;
  }
  showText();
});

/* ---- 見せ方 ---- */
function texts() {
  btn.start.textContent = t('読みはじめる', 'Start reading');
  btn.cancel.textContent = t('やめる', 'Stop');
  btn.pause.textContent = t('一時停止', 'Pause');
  btn.resume.textContent = t('続ける', 'Continue');
  btn.finish.textContent = t('ここで終える', 'Finish here');
  btn.use.textContent = t('声のページの相手に入れる', 'Add to the comparison page');
  btn.unuse.textContent = t('声のページの相手から外す', 'Remove from the comparison page');
  btn.export.textContent = t('数字を書き出す', 'Save the numbers');
  btn.again.textContent = t('最初から測る', 'Measure again from the start');
  statusEl.textContent = statusMsg();
}
function show(next: State, msg: Msg, bad = false) {
  state = next;
  statusMsg = msg;
  stage.dataset.state = next;
  statusEl.classList.toggle('bad', bad);
  btn.start.hidden = !(next === 'idle' || next === 'done');
  btn.cancel.hidden = next !== 'asking';
  btn.pause.hidden = next !== 'recording';
  btn.resume.hidden = next !== 'paused';
  btn.finish.hidden = !(next === 'recording' || next === 'paused');
  mics.lock(next === 'asking' || next === 'recording' || next === 'measuring');
  texts();
}
function minSec(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function drawProgress() {
  const s = recorded + (cutter && mic ? cutter.pending / mic.rate : 0);
  fill.style.width = `${Math.min(100, (s / TARGET_SECONDS) * 100)}%`;
  const ok = windows.filter((w) => w.ok).length;
  secEl.textContent = t(`${minSec(s)} / ${SESSION_MINUTES}:00　測れた 30 秒: ${ok}`, `${minSec(s)} / ${SESSION_MINUTES}:00  30-second sets measured: ${ok}`);
}
function addDot(w: SessionWindow) {
  const li = el('li', w.ok ? 'ok' : 'ng');
  li.title = w.ok ? t(`${minSec(w.t0)} から: 測れました`, `From ${minSec(w.t0)}: measured`) : t(`${minSec(w.t0)} から: 測れませんでした（${failText(w.reason)}）`, `From ${minSec(w.t0)}: not measured (${failText(w.reason)})`);
  dots.append(li);
}
function failText(r: MeasureFail): string {
  return r === 'short' ? t('声が少ない', 'too little voice') : r === 'silent' || r === 'quiet' ? t('音が小さい', 'too quiet') : r === 'noisy' ? t('雑音が多い', 'too noisy') : r === 'clipped' ? t('音が割れている', 'clipped') : t('測れない', 'could not measure');
}
function tick() {
  drawProgress();
  wave.draw(true);
  if (recorded >= TARGET_SECONDS) void finish();
  else raf = requestAnimationFrame(tick);
}

/* ---- 画面を消さない（読んでいる間。使えない端末では何もしない） ---- */
let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake(on: boolean) {
  try {
    if (on && !wakeLock) wakeLock = await (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null;
    else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

/* ---- 聞く ---- */
function stopMic() {
  cancelAnimationFrame(raf);
  mic?.stop();
  mic = null;
  // 1 つの窓に満たない分は捨てる（窓はいつもちょうど 30 秒。サイトの声と同じ）
  cutter?.drop();
  void keepAwake(false);
}
async function listen() {
  const my = ++listenToken;
  show('asking', M('マイクの許可を待っています…', 'Waiting for microphone permission…'));
  try {
    const m = await openMic(
      (x) => {
        if (state !== 'recording' || !cutter) return;
        wave.push(x, m.rate);
        for (const w of cutter.push(x)) measureWindow(w, m.rate);
      },
      () => pause(M('マイクが外れたので止めました。つなぎ直して「続ける」を押してください。', 'The microphone went away, so this stopped. Plug it back in and press “Continue”.'), true),
      mics.get(),
    );
    if (my !== listenToken || state !== 'asking') {
      // 許可を待つ間に「やめる」・一時停止した
      m.stop();
      return;
    }
    mic = m;
    micLabel = m.label ?? micLabel;
    cutter = new WindowCutter(windowSize(m.rate));
    void mics.refresh();
    void keepAwake(true);
    show('recording', () =>
      t(
        `上の文を、ふだんの声で読んでください。読み終えたら「次の文」へ。30 秒ごとに数字にします（声が ${SESSION_SELECT.minVoicedSeconds} 秒より少ない 30 秒は使いません）。${micLabel ? `マイク: ${micLabel}` : ''}`,
        `Read the text above in your usual voice, then go on with “Next text”. Every 30 seconds becomes numbers (a 30 seconds with less than ${SESSION_SELECT.minVoicedSeconds} s of voice is not used).${micLabel ? ` Microphone: ${micLabel}` : ''}`,
      ),
    );
    raf = requestAnimationFrame(tick);
  } catch (e) {
    if (my !== listenToken || state !== 'asking') return;
    stopMic();
    if ((e as { name?: string } | null)?.name === 'MicGoneError') mics.reset();
    show(windows.length ? 'paused' : 'idle', () => micErrorText(e), true);
  }
}
/** マイクの許可を待つ間の「やめる」: 前に読んだ分があれば一時停止に、無ければ最初に戻る */
function cancelAsking() {
  if (state !== 'asking') return;
  listenToken++;
  stopMic();
  if (recorded > 0) show('paused', M('やめました。「続ける」で再開します。', 'Stopped. Press “Continue” to go on.'));
  else show('idle', M('やめました。「読みはじめる」で始めます。', 'Stopped. Press “Start reading” to begin.'));
  drawProgress();
}
function measureWindow(pcm: Float32Array, rate: number) {
  const t0 = recorded;
  recorded += pcm.length / rate;
  inFlight++;
  void measureAsync(pcm, rate, { minVoicedSeconds: SESSION_SELECT.minVoicedSeconds }).then((m) => {
    inFlight--;
    const w: SessionWindow = m.ok ? { t0, ok: true, voicedSeconds: m.info.voicedSeconds, snrDb: Math.round((m.info.loudDb - m.info.floorDb) * 10) / 10, features: m.features } : { t0, ok: false, reason: m.reason };
    windows.push(w);
    windows.sort((a, b) => a.t0 - b.t0);
    addDot(w);
    drawProgress();
    if (state === 'measuring' && inFlight === 0) void showResult();
  });
}
function pause(msg: Msg = M('一時停止しています。「続ける」で再開します（途中の 30 秒に満たない分は使いません）。', 'Paused. Press “Continue” to go on (the unfinished 30 seconds is not used).'), bad = false) {
  if (state !== 'recording' && state !== 'asking') return;
  listenToken++;
  stopMic();
  show('paused', msg, bad);
  drawProgress();
}
async function finish() {
  if (state !== 'recording' && state !== 'paused') return;
  stopMic();
  show('measuring', M('残りの 30 秒を数字にしています…', 'Working out the last sets…'));
  if (inFlight === 0) await showResult();
}

/* ---- 結果 ---- */
async function showResult() {
  await voicesReady;
  summary = summarize(windows);
  show('done', summary.median ? M('測り終えました。', 'Done.') : M(`測れた 30 秒が ${SESSION_SELECT.minWindows} に足りないので、代表値は作れませんでした。もう少し長く読んでください。`, `Fewer than ${SESSION_SELECT.minWindows} sets were measured, so no representative values could be made. Please read a little longer.`), !summary.median);
  drawResult();
}
function drawResult() {
  if (!summary) return;
  const s = summary;
  result.hidden = false;
  $('summary').textContent = t(
    `30 秒 ${windows.length} 回のうち、使ったのは ${s.used} 回（測れなかった ${s.failed} 回、高さが大きく外れた ${s.pitchOff} 回を除きました）。`,
    `Of ${windows.length} thirty-second sets, ${s.used} were used (${s.failed} could not be measured and ${s.pitchOff} were far off in pitch).`,
  );
  $('result-actions').hidden = !s.median;
  const mine = loadMine(MEASURE_VERSION);
  btn.use.hidden = !s.median;
  btn.unuse.hidden = !mine;
  $('use-note').textContent = useNote
    ? useNote()
    : mine
      ? t(`声のページの比べる相手に、「あなた（じっくり測った声・${mine.date}）」が入っています（この端末のブラウザーだけ。数字だけ）。声のページでふつうに話すと、何位に出るかが分かります。`, `“You (measured in depth, ${mine.date})” is among the voices on the comparison page (this browser only, numbers only). Talk on that page as usual to see where you come.`)
      : t('「声のページの相手に入れる」を押すと、この代表値を、声のページの比べる相手に入れます（この端末のブラウザーだけに数字を残します。外すと消えます）。', '“Add to the comparison page” puts these values among the voices on the comparison page (only the numbers are kept, in this browser only, until you remove them).');
  const list = $('matches');
  list.replaceChildren();
  if (s.median && PROFILES.length) {
    const scale = farScale(MODEL, s.median, PROFILES, s.used);
    for (const r of rank(MODEL, s.median, PROFILES, 5)) {
      const v = ENTRY_BY_ID.get(r.id)!;
      const li = el('li', 'match');
      const name = el('div', 'name');
      const a = el('a', undefined, nameOf(v));
      a.href = v.links.profile;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      name.append(a, el('span', 'near', closenessWord(MODEL, r.distance, scale)));
      li.append(name);
      const group = groupOf(v);
      if (group) li.append(el('div', 'why', group));
      list.append(li);
    }
  }
  const f = s.median;
  if (f) renderGroups($('mine'), (d) => itemRow(d, [{ value: f[d.key] }], el('div', 'value', formatFeature(d.key, f[d.key]))));
  else $('mine').replaceChildren();
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
btn.use.addEventListener('click', () => {
  if (!summary?.median) return;
  const ok = saveMine({ v: 1, m: MEASURE_VERSION, windows: summary.used, date: today(), features: summary.median as Features });
  useNote = ok ? null : M('このブラウザーでは残せませんでした（プライベート ブラウズなど）。', 'This browser would not keep it (private browsing, for example).');
  drawResult();
});
btn.unuse.addEventListener('click', () => {
  clearMine();
  useNote = null;
  drawResult();
});
btn.export.addEventListener('click', () => {
  // 数字だけ（窓ごとの数字と中央値）。マイクの名前は入れない（「山田の AirPods」のように人の名前が入っていることがある）
  const file = sessionFile({ measureVersion: MEASURE_VERSION, date: today(), windows });
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1) + '\n'], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = `voice-match-session-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
function reset() {
  stopMic();
  windows = [];
  recorded = 0;
  summary = null;
  useNote = null;
  cutter = null;
  dots.replaceChildren();
  wave.clear();
  result.hidden = true;
}
btn.start.addEventListener('click', () => {
  reset();
  void listen();
});
btn.again.addEventListener('click', () => {
  reset();
  show('idle', M('「読みはじめる」を押してください。', 'Press “Start reading”.'));
  drawProgress();
});
btn.cancel.addEventListener('click', cancelAsking);
btn.pause.addEventListener('click', () => pause());
btn.resume.addEventListener('click', () => void listen());
btn.finish.addEventListener('click', () => void finish());
// ページが隠れたら一時停止（マイクも止める）
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state === 'recording' || state === 'asking')) pause(M('ページが隠れたので一時停止しました。「続ける」で再開します。', 'The page was hidden, so this paused. Press “Continue” to go on.'));
});

onLang(() => {
  showText();
  texts();
  drawProgress();
  for (const [i, li] of [...dots.children].entries()) {
    const w = windows[i];
    if (w) (li as HTMLElement).title = w.ok ? t(`${minSec(w.t0)} から: 測れました`, `From ${minSec(w.t0)}: measured`) : t(`${minSec(w.t0)} から: 測れませんでした（${failText(w.reason)}）`, `From ${minSec(w.t0)}: not measured (${failText(w.reason)})`);
  }
  if (!result.hidden) drawResult();
});

showText();
drawProgress();
show('idle', M(`決まった文を ${SESSION_MINUTES} 分ほど読みます。マイクは「読みはじめる」を押した時だけ使います。途中で止めても、そこまでの数字は残ります。`, `You will read set texts for about ${SESSION_MINUTES} minutes. The microphone is used only after you press “Start reading”. If you stop part way, the numbers so far are kept.`));
