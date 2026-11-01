// 声のページ（index.html）: お題を出す → マイクで最大 35 秒聞く → measure.ts で数字にする → 事前に測った声の中から近い声と、自分の声の数字を出す。
// 一言（声 0.4 秒ほど）から測れる。「もう一言」で話すたびに、それまでの回の数字とまとめ（takes.ts）、結果を絞り込む。
// 短い回では、短いと揺れる項目（抑揚・速さなど）を使わない（features.ts の needOf）。確かさを 3 段で出す。
// 音はメモリーの中だけ。数字にしたらすぐ捨てる（前の回の音も残さない。残すのは数字だけ）。どこにも送らない（fetch などを使わない）、端末にも残さない。
// 終わった時・やめた時・ページが隠れた時は、すぐマイクを止める。声から性別や年齢を判断しない。
import { nextPrompt, READING } from '../prompts/prompts.ts';
import { openMic, micErrorText, type Mic } from '../voice/listen.ts';
import { measureVoice, type MeasureFail, type Measured } from '../voice/measure.ts';
import { createWave } from '../voice/wave.ts';
import { createOrb, type OrbMode } from './orb.ts';
import { micPicker } from './mic-picker.ts';
import { mountShapes } from './voiceprint.ts';
import { FEATURE_BY_KEY, FEATURES, FEW_SECONDS, formatFeature, LONG_SECONDS, ONE_LINE_SECONDS, type Features } from '../voice/features.ts';
import { CERTAINTY_WORDS, certaintyOf, combineTakes, type Combined, type Take } from '../voice/takes.ts';
import { el, itemRow, renderGroups } from './items.ts';
import { closeness, closenessWord, rank } from '../match/match.ts';
import { ENTRY_BY_ID, MODEL, PROFILES } from '../data/load.ts';

/** 聞く長さ（秒）: 最大と、「話し終えた」を押せるまで */
const LISTEN_MAX = 35;
const DONE_AFTER = 1;

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
  more: $<HTMLButtonElement>('more'),
  reset: $<HTMLButtonElement>('reset'),
};
const statusEl = $('status');
const fill = $('fill');
const secEl = $('sec');
const wave = createWave($<HTMLCanvasElement>('wave'));
const result = $('result');
const orb = createOrb($('orb'));
const mics = micPicker([{ box: $('mic-pick'), select: $<HTMLSelectElement>('mic-select'), find: $<HTMLButtonElement>('mic-find') }], (text) => {
  statusEl.textContent = text;
  statusEl.classList.add('bad');
});
const ORB_MODE: Partial<Record<State, OrbMode>> = { listening: 'listening', analysing: 'analysing', done: 'done' };

type State = 'idle' | 'asking' | 'listening' | 'analysing' | 'failed' | 'done';
let state: State = 'idle';
let mic: Mic | null = null;
let chunks: Float32Array[] = [];
let got = 0;
let raf = 0;
let topic: string | null = null;
let reading = false;
/** これまでの回の数字（音は持たない） */
let takes: Take[] = [];
/** 前の結果の並び（上がった・下がったを出すため） */
let lastRank: string[] = [];

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
  const waiting = next === 'idle' || next === 'failed' || next === 'done';
  btn.start.hidden = !waiting;
  btn.start.textContent = takes.length ? 'もう一言話して、絞り込む' : next === 'idle' ? '話しはじめる' : 'もう一度話す';
  btn.reset.hidden = !(waiting && takes.length);
  btn.more.disabled = !waiting;
  btn.done.hidden = next !== 'listening';
  btn.cancel.hidden = !(next === 'listening' || next === 'asking');
  btn.next.disabled = btn.read.disabled = next === 'listening' || next === 'asking' || next === 'analysing';
  orb.mode(ORB_MODE[next] ?? 'idle');
  mics.lock(next === 'listening' || next === 'asking' || next === 'analysing');
  if (next !== 'listening') {
    cancelAnimationFrame(raf);
    wave.draw(false);
  }
}
function tick() {
  const sec = mic ? got / mic.rate : 0;
  fill.style.width = `${Math.min(100, (sec / LISTEN_MAX) * 100)}%`;
  secEl.textContent = `${Math.floor(sec)} / ${LISTEN_MAX} 秒`;
  orb.progress(sec / LISTEN_MAX);
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
      orb.push(x, m.rate);
    }, undefined, mics.get());
    if (state !== 'asking') {
      // (cancelled while asking)
      m.stop();
      return;
    }
    mic = m;
    void mics.refresh();
    show('listening', `話してください。一言でもかまいません。話し終えたら「話し終えた」を押してください（最大 ${LISTEN_MAX} 秒）。${m.label ? `マイク: ${m.label}` : ''}`);
    raf = requestAnimationFrame(tick);
  } catch (e) {
    stopMic();
    if ((e as { name?: string } | null)?.name === 'MicGoneError') mics.reset();
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
  // (a few frames for the words and the orb to show, then the measuring; the sound is let go right after)
  setTimeout(() => {
    const m = measureVoice(pcm, rate, { minVoicedSeconds: ONE_LINE_SECONDS });
    pcm.fill(0);
    if (!m.ok) {
      show('failed', failText(m.reason, m.info.voicedSeconds) + (takes.length ? '（前までの結果はそのままです）' : ''), true);
      return;
    }
    takes.push({ features: m.features, voicedSeconds: m.info.voicedSeconds });
    render(combineTakes(takes), m);
    show('done', takes.length > 1 ? `${takes.length} 回分をまとめて、絞り込みました。結果は下にあります。` : '測りました。結果は下にあります。');
    result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, 160);
}
function cancel() {
  stopMic();
  dropSound();
  show(takes.length ? 'done' : 'idle', 'やめました。音は捨てました。');
}
function reset() {
  takes = [];
  lastRank = [];
  result.hidden = true;
  show('idle', 'はじめからにしました。前の回の数字も消しました。');
}
btn.start.addEventListener('click', () => void start());
btn.more.addEventListener('click', () => {
  stage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  void start();
});
btn.reset.addEventListener('click', reset);
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
      return `声を ${(voiced ?? 0).toFixed(1)} 秒分しか測れませんでした。「おはようございます」くらいの長さで、ささやかずに話してください。`;
    default:
      return 'うまく数字にできませんでした。もう一度測ってください。';
  }
}

/* ---- 結果 ---- */
function render(c: Combined, m: Extract<Measured, { ok: true }>) {
  const f = c.features;
  const level = certaintyOf(c);
  const cert = $('certainty');
  cert.dataset.level = String(level);
  $('certainty-word').textContent = CERTAINTY_WORDS[level];
  $('certainty-note').textContent =
    level === 1
      ? `一言なので、ざっくりの結果です。言う言葉を変えると変わります。もう一言話すと絞り込めます（これまで声 ${c.voicedSeconds.toFixed(1)} 秒）。`
      : level === 2
        ? `だいたいの結果です（これまで ${c.takes} 回・声 ${c.voicedSeconds.toFixed(1)} 秒）。1 回で声を ${LONG_SECONDS} 秒以上（話して 15 秒ほど）話すと、速さと間も加わって、しっかりの結果になります。`
        : `しっかりの結果です（これまで ${c.takes} 回・声 ${c.voicedSeconds.toFixed(1)} 秒）。`;
  const top = renderMatches(f);
  renderMine(f);
  mountShapes($('shapes'), $('shape-guide'), [
    { who: 'あなた', sub: `確かさ: ${CERTAINTY_WORDS[level]}（${c.takes} 回分）`, f },
    ...(top ? [{ who: '1 位の声', sub: top.name, f: top.features }] : []),
  ]);
  const missing: string[] = [];
  if (c.longest < FEW_SECONDS) missing.push(`抑揚・口の開きの幅などは、1 回で声を ${FEW_SECONDS} 秒以上話すと出ます`);
  if (c.longest < LONG_SECONDS) missing.push(`速さと間は、1 回で声を ${LONG_SECONDS} 秒以上話すと出ます`);
  $('mine-note').textContent = missing.length ? `「—」の項目: ${missing.join('。')}。` : '';
  const i = m.info;
  $('info').textContent = `これまで ${c.takes} 回、声 合計 ${c.voicedSeconds.toFixed(1)} 秒。今回は、録った長さ ${i.seconds.toFixed(1)} 秒、声 ${i.voicedSeconds.toFixed(1)} 秒、話していた所 ${i.speechSeconds.toFixed(1)} 秒、声と静かな所の差 ${(i.loudDb - i.floorDb).toFixed(0)} dB。`;
  result.hidden = false;
}

/** 近い声を並べる。1 位の名前と数字を返す（声のかたちで並べるため） */
function renderMatches(f: Features): { name: string; features: Features } | null {
  const list = $('matches');
  list.replaceChildren();
  $('no-data').hidden = PROFILES.length > 0;
  if (!PROFILES.length) return null;
  const byId = new Map(PROFILES.map((p) => [p.id, p]));
  const ranked = rank(MODEL, f, PROFILES, 5);
  const before = lastRank;
  lastRank = ranked.map((r) => r.id);
  ranked.forEach((r, at) => {
    const v = ENTRY_BY_ID.get(r.id)!;
    const li = el('li', 'match');
    const name = el('div', 'name');
    const a = el('a', undefined, v.name);
    a.href = v.links.profile;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    name.append(a, el('span', 'near', closenessWord(r.distance)));
    if (v.by === 'users') name.append(el('span', 'by', 'みんなの登録'));
    if (before.length) {
      // (where it was in the result before this take)
      const was = before.indexOf(r.id);
      const move = was < 0 ? ['new', '新しく入った'] : was > at ? ['up', `↑ ${was - at}`] : was < at ? ['down', `↓ ${at - was}`] : ['same', 'そのまま'];
      const mv = el('span', `move ${move[0]}`, move[1]);
      mv.title = was < 0 ? '前の結果には無かった声' : `前の結果では ${was + 1} 位`;
      name.append(mv);
    }
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
  });
  const first = ranked[0];
  return first ? { name: ENTRY_BY_ID.get(first.id)!.name, features: byId.get(first.id)!.features } : null;
}

function renderMine(f: Features) {
  renderGroups($('mine'), (d) => itemRow(d, [{ value: f[d.key] }], el('div', 'value', formatFeature(d.key, f[d.key]))));
}

/* ---- 項目の名前の帯（飾り。同じ並びを 2 回続けて、つなぎ目なく流す） ---- */
{
  const names = FEATURES.filter((d) => !d.detail).map((d) => d.name);
  const track = $('ticker');
  for (const copy of [false, true])
    for (const n of names) {
      const s = el('span', copy ? 'copy' : undefined, n);
      track.append(s);
    }
}

show('idle', '一言からでも測れます。マイクは「話しはじめる」を押した時だけ使います。');
