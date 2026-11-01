// 声のページ（index.html）: お題を出す → マイクで最大 35 秒聞く → measure.ts で数字にする → 事前に測った声の中から近い声と、自分の声の数字を出す。
// 音はメモリーの中だけ。数字にしたらすぐ捨てる。どこにも送らない（fetch などを使わない）、端末にも残さない。
// 終わった時・やめた時・ページが隠れた時は、すぐマイクを止める。声から性別や年齢を判断しない。
import { nextPrompt, READING } from '../prompts/prompts.ts';
import { openMic, micErrorText, type Mic } from '../voice/listen.ts';
import { measureVoice, type MeasureFail, type Measured } from '../voice/measure.ts';
import { createWave } from '../voice/wave.ts';
import { FEATURE_BY_KEY, formatFeature, type Features } from '../voice/features.ts';
import { el, itemRow, renderGroups } from './items.ts';
import { closeness, closenessWord, rank } from '../match/match.ts';
import { ENTRY_BY_ID, MODEL, PROFILES } from '../data/load.ts';

/** 聞く長さ（秒）: 最大と、「話し終えた」を押せるまで */
const LISTEN_MAX = 35;
const DONE_AFTER = 15;
/** 判定に要る声（秒） */
const MIN_VOICED = 8;

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
const stage = $('stage');
const topicLabel = $('topic-label');
const topicText = $('topic-text');
const btn = {
  next: $<HTMLButtonElement>('topic-next'),
  read: $<HTMLButtonElement>('topic-read'),
  start: $<HTMLButtonElement>('start'),
  done: $<HTMLButtonElement>('done'),
  cancel: $<HTMLButtonElement>('cancel'),
};
const statusEl = $('status');
const fill = $('fill');
const secEl = $('sec');
const wave = createWave($<HTMLCanvasElement>('wave'));
const result = $('result');

type State = 'idle' | 'asking' | 'listening' | 'analysing' | 'failed' | 'done';
let state: State = 'idle';
let mic: Mic | null = null;
let chunks: Float32Array[] = [];
let got = 0;
let raf = 0;
let topic: string | null = null;
let reading = false;

/* ---- お題 ---- */
function showTopic() {
  topicLabel.textContent = reading ? '決まった文（ふだんの声で読んでください）' : 'お題（自由に話してください）';
  topicText.textContent = reading ? READING : topic!;
  topicText.classList.toggle('reading', reading);
  btn.read.textContent = reading ? 'お題にもどす' : '決まった文を読む';
}
btn.next.addEventListener('click', () => {
  reading = false;
  topic = nextPrompt(topic);
  showTopic();
});
btn.read.addEventListener('click', () => {
  reading = !reading;
  showTopic();
});
topic = nextPrompt(null);
showTopic();

/* ---- 見せ方 ---- */
function show(next: State, text: string, bad = false) {
  state = next;
  stage.dataset.state = next;
  statusEl.textContent = text;
  statusEl.classList.toggle('bad', bad);
  btn.start.hidden = !(next === 'idle' || next === 'failed' || next === 'done');
  btn.start.textContent = next === 'idle' ? '話しはじめる' : 'もう一度測る';
  btn.done.hidden = next !== 'listening';
  btn.cancel.hidden = !(next === 'listening' || next === 'asking');
  btn.next.disabled = btn.read.disabled = next === 'listening' || next === 'asking' || next === 'analysing';
  if (next !== 'listening') {
    cancelAnimationFrame(raf);
    wave.draw(false);
  }
}
function tick() {
  const sec = mic ? got / mic.rate : 0;
  fill.style.width = `${Math.min(100, (sec / LISTEN_MAX) * 100)}%`;
  secEl.textContent = `${Math.floor(sec)} / ${LISTEN_MAX} 秒`;
  btn.done.disabled = sec < DONE_AFTER;
  wave.draw(true);
  if (sec >= LISTEN_MAX) finish();
  else raf = requestAnimationFrame(tick);
}

/* ---- 聞く ---- */
function stopMic() {
  mic?.stop();
  mic = null;
}
function dropSound() {
  chunks = [];
  got = 0;
  wave.clear();
}
async function start() {
  dropSound();
  show('asking', 'マイクの許可を待っています…');
  try {
    const m = await openMic((x) => {
      if (state !== 'listening') return;
      chunks.push(x);
      got += x.length;
      wave.push(x, m.rate);
    });
    if (state !== 'asking') {
      // (cancelled while asking)
      m.stop();
      return;
    }
    mic = m;
    show('listening', `話してください。${DONE_AFTER} 秒すぎたら「話し終えた」を押せます（最大 ${LISTEN_MAX} 秒）。`);
    raf = requestAnimationFrame(tick);
  } catch (e) {
    stopMic();
    show('failed', micErrorText(e), true);
  }
}
function finish() {
  if (state !== 'listening' || !mic) return;
  const rate = mic.rate;
  stopMic();
  const pcm = new Float32Array(got);
  let at = 0;
  for (const c of chunks) {
    pcm.set(c, at);
    at += c.length;
  }
  dropSound();
  show('analysing', '数字にしています…');
  // (a frame for the words to show, then the measuring; the sound is let go right after)
  setTimeout(() => {
    const m = measureVoice(pcm, rate, { minVoicedSeconds: MIN_VOICED });
    pcm.fill(0);
    if (!m.ok) {
      show('failed', failText(m.reason, m.info.voicedSeconds), true);
      return;
    }
    render(m);
    show('done', '測りました。結果は下にあります。');
    result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, 30);
}
function cancel() {
  stopMic();
  dropSound();
  show('idle', 'やめました。音は捨てました。');
}
btn.start.addEventListener('click', () => void start());
btn.done.addEventListener('click', finish);
btn.cancel.addEventListener('click', cancel);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state === 'listening' || state === 'asking')) cancel();
});
window.addEventListener('pagehide', stopMic);

function failText(reason: MeasureFail, voiced: number | undefined): string {
  switch (reason) {
    case 'silent':
      return '声が聞こえませんでした。マイクが消音になっていないか、使うマイクが合っているか確かめてください。';
    case 'quiet':
      return '声が小さくて測れませんでした。マイクに少し近づいて、ふだんの声で話してください。';
    case 'noisy':
      return 'まわりの音が大きくて、声とうまく分けられませんでした。静かな所で、もう一度測ってください。';
    case 'clipped':
      return '声が大きすぎて、音が割れていました。マイクから少し離れてください。';
    case 'short':
      return `声を ${(voiced ?? 0).toFixed(1)} 秒分しか測れませんでした（${MIN_VOICED} 秒以上いります）。ささやかずに、もう少し長く話してください。`;
    default:
      return 'うまく数字にできませんでした。もう一度測ってください。';
  }
}

/* ---- 結果 ---- */
function render(m: Extract<Measured, { ok: true }>) {
  const f = m.features;
  renderMatches(f);
  renderMine(f);
  const i = m.info;
  $('info').textContent = `録った長さ ${i.seconds.toFixed(1)} 秒、声 ${i.voicedSeconds.toFixed(1)} 秒、話していた所 ${i.speechSeconds.toFixed(1)} 秒、声と静かな所の差 ${(i.loudDb - i.floorDb).toFixed(0)} dB。`;
  result.hidden = false;
}

function renderMatches(f: Features) {
  const list = $('matches');
  list.replaceChildren();
  $('no-data').hidden = PROFILES.length > 0;
  if (!PROFILES.length) return;
  const byId = new Map(PROFILES.map((p) => [p.id, p]));
  for (const r of rank(MODEL, f, PROFILES, 5)) {
    const v = ENTRY_BY_ID.get(r.id)!;
    const li = el('li', 'match');
    const name = el('div', 'name');
    const a = el('a', undefined, v.name);
    a.href = v.links.profile;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    name.append(a, el('span', 'near', closenessWord(r.distance)));
    if (v.by === 'users') name.append(el('span', 'by', 'みんなの登録'));
    li.append(name);
    if (v.group) li.append(el('div', 'why', v.group));
    const c = closeness(MODEL, f, byId.get(r.id)!.features).filter(([k]) => !FEATURE_BY_KEY[k].detail);
    const near = c.slice(0, 3).map(([k]) => FEATURE_BY_KEY[k].name);
    const far = c.slice(-2).map(([k]) => FEATURE_BY_KEY[k].name);
    li.append(el('div', 'why', `似ている所: ${near.join('・')}　違う所: ${far.join('・')}`));
    const practice = el('a', 'practice', 'この声で声真似の点数をみる');
    practice.href = `./mimic.html?target=${encodeURIComponent(r.id)}`;
    li.append(practice);
    list.append(li);
  }
}

function renderMine(f: Features) {
  renderGroups($('mine'), (d) => itemRow(d, [{ value: f[d.key] }], el('div', 'value', formatFeature(d.key, f[d.key]))));
}

show('idle', 'マイクは「話しはじめる」を押した時だけ使います。');
