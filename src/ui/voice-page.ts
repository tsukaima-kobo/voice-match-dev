// 声のページ（index.html）: お題を出す → マイクで最大 35 秒聞く → measure.ts で数字にする → 事前に測った声の中から近い声と、自分の声の数字を出す。
// 一言（声 0.4 秒ほど）から測れる。「もう一言」で話すたびに、それまでの回の数字とまとめ（takes.ts）、結果を絞り込む。
// 短い回では、短いと揺れる項目（抑揚・速さなど）を使わない（features.ts の needOf）。確かさを 3 段で出す。
// 音はメモリーの中だけ。数字にしたらすぐ捨てる（前の回の音も残さない。残すのは数字だけ）。どこにも送らない（fetch などを使わない）、端末にも残さない。
// 終わった時・やめた時・ページが隠れた時は、すぐマイクを止める。声から性別や年齢を判断しない。
// 言葉は日本語と英語（i18n.ts）。切り替えた時は、お題・案内・結果を、今の言葉で出し直す（数字はそのまま）。
import { nextPromptIndex, nextReadingIndex, promptText, readingText } from '../prompts/prompts.ts';
import { openMic, micErrorText, type Mic } from '../voice/listen.ts';
import { MEASURE_VERSION, type MeasureFail, type Measured } from '../voice/measure.ts';
import { createWave } from '../voice/wave.ts';
import { createOrb, type OrbMode } from './orb.ts';
import { micPicker } from './mic-picker.ts';
import { createLiveAnalysis } from './live-analysis.ts';
import { measureAsync } from '../voice/measure-async.ts';
import { mountShapes } from './voiceprint.ts';
import { FEATURE_BY_KEY, FEATURES, FEW_SECONDS, formatFeature, LONG_SECONDS, ONE_LINE_SECONDS, type Features } from '../voice/features.ts';
import { CERTAINTY_WORDS, certaintyOf, combineTakes, type Combined, type Take } from '../voice/takes.ts';
import { el, itemRow, renderGroups } from './items.ts';
import { closeness, closenessWord, farScale, rank } from '../match/match.ts';
import { ENTRY_BY_ID, MODEL, PROFILES, voicesReady } from '../data/load.ts';
import { mountLang, onLang, t } from '../i18n.ts';
import { KIND_BY_ID, KINDS, kindLabel } from '../data/kinds.ts';
import { clearMine, loadMine } from '../data/mine.ts';
import type { CatalogEntry } from '../data/types.ts';
import { groupOf, nameOf } from '../data/names.ts';
import { mountFooter, mountGithubLink, mountShare } from './share.ts';

mountLang({ ja: 'voice-match｜あなたの声は誰に近い？', en: 'voice-match | Whose voice is yours closest to?' });
mountGithubLink();
mountFooter();

/** 聞く長さ（秒）: 最大と、「話し終えた」を押せるまで */
const LISTEN_MAX = 35;
const DONE_AFTER = 1;
/** 計算中の演出の長さ（ミリ秒）。その間に Worker が測る */
const ANALYSE_MS = 1500;

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
/** 録っている間の解析パネル（見せるためだけ。数字は measure.ts） */
const live = createLiveAnalysis($('live'));
/** 結果のシェア（X など） */
const share = mountShare($('share'));

type State = 'idle' | 'asking' | 'listening' | 'analysing' | 'failed' | 'done';
/** 案内の文（今の言葉で作る関数。切り替えた時に作り直す） */
type Msg = () => string;
const M = (ja: string, en: string): Msg => () => t(ja, en);

// マイクの一覧が出せなかった時の知らせも、言葉を切り替えたら出し直す
const mics = micPicker([{ box: $('mic-pick'), select: $<HTMLSelectElement>('mic-select'), find: $<HTMLButtonElement>('mic-find') }], (msg) => {
  statusMsg = msg;
  statusBad = true;
  statusEl.textContent = msg();
  statusEl.classList.add('bad');
});
const ORB_MODE: Partial<Record<State, OrbMode>> = { listening: 'listening', analysing: 'analysing', done: 'done' };

let state: State = 'idle';
let statusMsg: Msg = () => '';
let statusBad = false;
let mic: Mic | null = null;
let chunks: Float32Array[] = [];
let got = 0;
let raf = 0;
let topic = 0;
let reading = false;
/** 決まった文の番号 */
let passage = nextReadingIndex(null);
/** これまでの回の数字（音は持たない） */
let takes: Take[] = [];
/**
 * 出している結果（言葉・探す範囲・比べる相手を変えた時に出し直すため）。prev は、この回の前までの回をまとめた数字。
 * 上がった・下がったは、prev を「今の」比べる相手で並べた物と比べる（大枠やあなたの声を変えても、同じ相手どうしで比べる）
 */
let shown: { c: Combined; m: Extract<Measured, { ok: true }>; prev: Combined | null } | null = null;

/* ---- お題 ---- */
function showTopic() {
  topicLabel.textContent = reading ? t('決まった文（ふだんの声で読んでください）', 'Set text (read it in your usual voice)') : t('お題（自由に話してください）', 'Prompt (talk freely)');
  topicText.textContent = reading ? readingText(passage) : promptText(topic);
  topicText.classList.toggle('reading', reading);
  btn.read.textContent = reading ? t('お題にもどす', 'Back to prompts') : t('決まった文を読む', 'Read a set text');
  btn.next.textContent = reading ? t('次の文', 'Next text') : t('次のお題', 'Next prompt');
}
btn.next.addEventListener('click', () => {
  if (reading) passage = nextReadingIndex(passage);
  else topic = nextPromptIndex(topic);
  showTopic();
});
btn.read.addEventListener('click', () => {
  reading = !reading;
  if (reading) passage = nextReadingIndex(passage);
  showTopic();
});
topic = nextPromptIndex(null);
showTopic();

/* ---- 見せ方 ---- */
function texts() {
  statusEl.textContent = statusMsg();
  btn.start.textContent = takes.length ? t('もう一言話して、絞り込む', 'Say one more thing to narrow it down') : state === 'idle' ? t('話しはじめる', 'Start talking') : t('もう一度話す', 'Talk again');
  btn.done.textContent = t('話し終えた', 'Done');
  btn.cancel.textContent = t('やめる', 'Stop');
  btn.reset.textContent = t('最初から', 'Start over');
  btn.more.textContent = t('もう一言話して、絞り込む', 'Say one more thing to narrow it down');
}
function show(next: State, msg: Msg, bad = false) {
  state = next;
  statusMsg = msg;
  statusBad = bad;
  stage.dataset.state = next;
  statusEl.classList.toggle('bad', bad);
  const waiting = next === 'idle' || next === 'failed' || next === 'done';
  btn.start.hidden = !waiting;
  btn.reset.hidden = !(waiting && takes.length);
  btn.more.disabled = !waiting;
  btn.done.hidden = next !== 'listening';
  btn.cancel.hidden = !(next === 'listening' || next === 'asking');
  btn.next.disabled = btn.read.disabled = next === 'listening' || next === 'asking' || next === 'analysing';
  orb.mode(ORB_MODE[next] ?? 'idle');
  live.mode(next === 'listening' ? 'listening' : next === 'analysing' ? 'analysing' : 'off');
  mics.lock(next === 'listening' || next === 'asking' || next === 'analysing');
  texts();
  if (next !== 'listening') {
    cancelAnimationFrame(raf);
    wave.draw(false);
  }
}
function tick() {
  const sec = mic ? got / mic.rate : 0;
  fill.style.width = `${Math.min(100, (sec / LISTEN_MAX) * 100)}%`;
  secEl.textContent = t(`${Math.floor(sec)} / ${LISTEN_MAX} 秒`, `${Math.floor(sec)} / ${LISTEN_MAX} s`);
  orb.progress(sec / LISTEN_MAX);
  btn.done.disabled = sec < DONE_AFTER;
  wave.draw(true);
  if (sec >= LISTEN_MAX) void finish();
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
  live.reset();
  show('asking', M('マイクの許可を待っています…', 'Waiting for microphone permission…'));
  try {
    const onChunk = (x: Float32Array) => {
      if (state !== 'listening') return;
      chunks.push(x);
      got += x.length;
      wave.push(x, m.rate);
      orb.push(x, m.rate);
      live.push(x, m.rate);
    };
    const m = await openMic(onChunk, micEnded, mics.get());
    if (state !== 'asking') {
      // 許可を待つ間に取り消された
      m.stop();
      return;
    }
    mic = m;
    void mics.refresh();
    const label = m.label ?? '';
    show('listening', () =>
      t(
        `話してください。一言でもかまいません。話し終えたら「話し終えた」を押してください（最大 ${LISTEN_MAX} 秒）。${label ? `マイク: ${label}` : ''}`,
        `Go ahead and talk — a single phrase is enough. Press “Done” when you finish (up to ${LISTEN_MAX} s).${label ? ` Microphone: ${label}` : ''}`,
      ),
    );
    raf = requestAnimationFrame(tick);
  } catch (e) {
    stopMic();
    if ((e as { name?: string } | null)?.name === 'MicGoneError') mics.reset();
    show('failed', () => micErrorText(e), true);
  }
}
async function finish() {
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
  show('analysing', M(`${FEATURES.length} 項目を計算しています…`, `Working out ${FEATURES.length} items…`));
  // 測るのは Worker（使えなければ、その場で）。音はそちらに渡し、測り終えたら 0 で埋まる。その間、パネルは計算中の演出を見せる
  const [m] = await Promise.all([measureAsync(pcm, rate, { minVoicedSeconds: ONE_LINE_SECONDS }), live.analysing(ANALYSE_MS)]);
  if ((state as State) !== 'analysing') return;
  if (!m.ok) {
    const had = takes.length > 0;
    show('failed', () => failText(m.reason, m.info.voicedSeconds) + (had ? t('（前までの結果はそのままです）', ' (Your earlier result is kept.)') : ''), true);
    return;
  }
  takes.push({ features: m.features, voicedSeconds: m.info.voicedSeconds });
  await voicesReady; // ページを開いた時から裏で読んでいる。ここに来るずっと前に終わっている
  if ((state as State) !== 'analysing') return;
  render(combineTakes(takes), m);
  const n = takes.length;
  show('done', n > 1 ? M(`${n} 回分をまとめて、絞り込みました。結果は下にあります。`, `Narrowed down using ${n} takes. The result is below.`) : M('測りました。結果は下にあります。', 'Measured. The result is below.'));
  result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
/** マイクが外れた時（抜いた・ほかのアプリに取られたなど）: それまでの声で測る。ほとんど録れていなければ、外れたことを伝える */
function micEnded() {
  if (state !== 'listening' || !mic) return;
  if (got / mic.rate >= DONE_AFTER) {
    void finish();
    return;
  }
  stopMic();
  dropSound();
  const had = takes.length > 0;
  show('failed', () => t('マイクが外れたので止めました。つなぎ直して、もう一度押してください。', 'The microphone went away, so this stopped. Plug it back in and press again.') + (had ? t('（前までの結果はそのままです）', ' (Your earlier result is kept.)') : ''), true);
}
function cancel() {
  stopMic();
  dropSound();
  show(takes.length ? 'done' : 'idle', M('やめました。音は捨てました。', 'Stopped. The sound was thrown away.'));
}
function reset() {
  takes = [];
  shown = null;
  result.hidden = true;
  show('idle', M('はじめからにしました。前の回の数字も消しました。', 'Started over. The earlier numbers were cleared too.'));
}
btn.start.addEventListener('click', () => void start());
btn.more.addEventListener('click', () => {
  stage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  void start();
});
btn.reset.addEventListener('click', reset);
btn.done.addEventListener('click', () => void finish());
btn.cancel.addEventListener('click', cancel);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state === 'listening' || state === 'asking')) cancel();
});
window.addEventListener('pagehide', stopMic);

function failText(reason: MeasureFail, voiced: number | undefined): string {
  switch (reason) {
    case 'silent':
      return t('声が聞こえませんでした。マイクが消音になっていないか、使うマイクが合っているか確かめてください。', 'No voice was heard. Check that the microphone is not muted and that the right one is chosen.');
    case 'quiet':
      return t('声が小さくて測れませんでした。マイクに少し近づいて、ふだんの声で話してください。', 'The voice was too quiet to measure. Move a little closer and talk in your usual voice.');
    case 'noisy':
      return t('まわりの音が大きくて、声とうまく分けられませんでした。静かな所で、もう一度測ってください。', 'The surroundings were too loud to separate the voice. Try again somewhere quiet.');
    case 'clipped':
      return t('声が大きすぎて、音が割れていました。マイクから少し離れてください。', 'The voice was so loud that it distorted. Move a little away from the microphone.');
    case 'short':
      return t(`声を ${(voiced ?? 0).toFixed(1)} 秒分しか測れませんでした。「おはようございます」くらいの長さで、ささやかずに話してください。`, `Only ${(voiced ?? 0).toFixed(1)} s of voice was measured. Say at least a short phrase, like “good morning everyone”, without whispering.`);
    default:
      return t('うまく数字にできませんでした。もう一度測ってください。', 'It could not be measured. Please try again.');
  }
}

/* ---- 探す範囲（大枠で絞る。0 はすべて） ---- */
// ?kind=vtuber なら、最初からその大枠に絞った状態でページを開く
const kindParam = KIND_BY_ID.get(new URLSearchParams(location.search).get('kind') ?? '');
let kindFilter = kindParam ? 1 << kindParam.bit : 0;
/** 声を読み終えたか（読む前は大枠のボタンを作らない。空の一覧で ?kind= を消さないように） */
let ready = false;
let poolCache: { mask: number; from: typeof PROFILES; list: typeof PROFILES } | null = null;
/** 比べる相手（今の探す範囲の中の声） */
function pool(): typeof PROFILES {
  if (!kindFilter) return PROFILES;
  if (poolCache?.mask !== kindFilter || poolCache.from !== PROFILES) poolCache = { mask: kindFilter, from: PROFILES, list: PROFILES.filter((p) => (p.kinds & kindFilter) !== 0) };
  return poolCache.list;
}
/** 大枠のボタン（声が 1 つ以上ある大枠だけ）。選んでいる大枠に声が無ければ、すべてに戻す */
function drawKindChips() {
  const counts = KINDS.map((k) => [k, PROFILES.filter((p) => (p.kinds & (1 << k.bit)) !== 0).length] as const).filter(([, n]) => n > 0);
  if (kindFilter && !counts.some(([k]) => 1 << k.bit === kindFilter)) kindFilter = 0;
  const box = $('kind-filter');
  box.hidden = !counts.length;
  const chip = (mask: number, label: string, n: number) => {
    const b = el('button', 'kind-chip');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(mask === kindFilter));
    b.append(label, el('span', 'n', String(n)));
    b.addEventListener('click', () => setKind(mask));
    return b;
  };
  $('kind-chips').replaceChildren(chip(0, t('すべて', 'All'), PROFILES.length), ...counts.map(([k, n]) => chip(1 << k.bit, kindLabel(k), n)));
}
function setKind(mask: number) {
  if (mask === kindFilter) return;
  kindFilter = mask;
  drawKindChips();
  // 出している結果を、この範囲で並べ直す（矢印も、前の回をこの範囲で並べた物と比べる）
  if (shown) draw();
}
void voicesReady.then(() => {
  ready = true;
  drawKindChips();
});

/* ---- じっくり測ったあなたの声（じっくり測るページで入れた時だけ。この端末のブラウザーにある数字。探す範囲に関わらず比べる） ---- */
const MINE_ID = 'mine';
let mine = loadMine(MEASURE_VERSION);
/** 比べる相手: 探す範囲の声と、じっくり測ったあなたの声 */
function candidates(): typeof PROFILES {
  return mine ? [...pool(), { id: MINE_ID, features: mine.features, kinds: 0 }] : pool();
}
function entryOf(id: string): CatalogEntry {
  if (id === MINE_ID) return { id, name: t(`あなた（じっくり測った声・${mine?.date ?? ''}）`, `You (measured in depth, ${mine?.date ?? ''})`), links: { profile: './measure.html' } };
  return ENTRY_BY_ID.get(id)!;
}
function drawMineNote() {
  $('mine-in').hidden = !mine;
  $('mine-in-text').textContent = t('じっくり測ったあなたの声も、比べる相手に入っています（この端末のブラウザーだけ）。', 'Your voice measured in depth is also among the voices compared (this browser only).');
  $('mine-clear').textContent = t('外す', 'Remove');
}
/** 比べる相手が変わった時: 出している結果を、今の相手で並べ直す（矢印も、前の回を今の相手で並べた物と比べる） */
function rerank() {
  if (shown) draw();
}
$('mine-clear').addEventListener('click', () => {
  clearMine();
  mine = null;
  drawMineNote();
  rerank();
});
drawMineNote();
// ほかのタブのじっくり測るページで、入れた・外した時（あなたの声が変わった時だけ、並べ直す）
window.addEventListener('storage', () => {
  const was = JSON.stringify(mine);
  mine = loadMine(MEASURE_VERSION);
  drawMineNote();
  if (JSON.stringify(mine) !== was) rerank();
});

/* ---- 結果 ---- */
function render(c: Combined, m: Extract<Measured, { ok: true }>) {
  // この回の前までの回（数字だけ）。測れなかった回は takes に入らないので、前に出した結果と同じ数字になる
  shown = { c, m, prev: takes.length > 1 ? combineTakes(takes.slice(0, -1)) : null };
  draw();
}
/** 出している結果を、今の言葉と、今の比べる相手で描く */
function draw() {
  if (!shown) return;
  const { c, m, prev } = shown;
  // 前の結果の並び（上がった・下がったを出すため）。今の比べる相手で並べ直す
  const before = prev && PROFILES.length ? rank(MODEL, prev.features, candidates(), 5).map((r) => r.id) : [];
  const f = c.features;
  const level = certaintyOf(c);
  const cert = $('certainty');
  cert.dataset.level = String(level);
  $('certainty-word').textContent = CERTAINTY_WORDS[level];
  const vs = c.voicedSeconds.toFixed(1);
  $('certainty-note').textContent =
    level === 1
      ? t(`短い声だけなので、ざっくりの結果です。言う言葉を変えると変わります。もう少し続けて話すと絞り込めます（これまで声 ${vs} 秒）。`, `Only short bits of voice so far, so this is rough; different words may give a different result. Speak a little longer to narrow it down (voice so far: ${vs} s).`)
      : level === 2
        ? t(`だいたいの結果です（これまで ${c.takes} 回・声 ${vs} 秒）。1 回で声を ${LONG_SECONDS} 秒以上（話して 15 秒ほど）話すと、速さと間も加わって、しっかりの結果になります。`, `A fair result (${c.takes} take${c.takes > 1 ? 's' : ''}, ${vs} s of voice so far). Talk for ${LONG_SECONDS} s of voice or more in one go (about 15 s of talking) to add tempo and pauses for a solid result.`)
        : t(`しっかりの結果です（これまで ${c.takes} 回・声 ${vs} 秒）。`, `A solid result (${c.takes} take${c.takes > 1 ? 's' : ''}, ${vs} s of voice so far).`);
  const top = renderMatches(f, before);
  renderMine(f);
  const missing: string[] = [];
  if (c.longest < FEW_SECONDS) missing.push(t(`抑揚・口の開きの幅などは、1 回で声を ${FEW_SECONDS} 秒以上話すと出ます`, `intonation, mouth-opening range and others appear after ${FEW_SECONDS} s of voice in one go`));
  if (c.longest < LONG_SECONDS) missing.push(t(`速さと間は、1 回で声を ${LONG_SECONDS} 秒以上話すと出ます`, `tempo and pauses appear after ${LONG_SECONDS} s of voice in one go`));
  $('mine-note').textContent = missing.length ? t(`「—」の項目: ${missing.join('。')}。`, `Items shown as “—”: ${missing.join('; ')}.`) : '';
  const i = m.info;
  $('info').textContent = t(
    `これまで ${c.takes} 回、声 合計 ${vs} 秒。今回は、録った長さ ${i.seconds.toFixed(1)} 秒、声 ${i.voicedSeconds.toFixed(1)} 秒、話していた所 ${i.speechSeconds.toFixed(1)} 秒、声と静かな所の差 ${(i.loudDb - i.floorDb).toFixed(0)} dB。`,
    `${c.takes} take${c.takes > 1 ? 's' : ''} so far, ${vs} s of voice in all. This take: ${i.seconds.toFixed(1)} s recorded, ${i.voicedSeconds.toFixed(1)} s of voice, ${i.speechSeconds.toFixed(1)} s of talk, ${(i.loudDb - i.floorDb).toFixed(0)} dB between the voice and the quiet.`,
  );
  result.hidden = false;
  // 飾り（共有カード・声紋）は最後に。古いブラウザーで描けなくても、結果は出す
  decor(() => share.update({ kind: 'voice', features: f, ...(top ? { top: { name: top.name, word: top.word } } : {}), certainty: CERTAINTY_WORDS[level] }));
  decor(() =>
    mountShapes($('shapes'), $('shape-guide'), [
      { who: t('あなた', 'You'), sub: t(`確かさ: ${CERTAINTY_WORDS[level]}（${c.takes} 回分）`, `Certainty: ${CERTAINTY_WORDS[level]} (${c.takes} take${c.takes > 1 ? 's' : ''})`), f },
      ...(top ? [{ who: t('1 位の声', 'No. 1 voice'), sub: top.name, f: top.features }] : []),
    ]),
  );
}
/** 飾りを描く。描けない時は飛ばす（結果と案内は止めない） */
function decor(f: () => void) {
  try {
    f();
  } catch {
    /* 描けない時は、その飾りだけ出さない */
  }
}

/** 近い声を並べる。1 位の名前と数字を返す（声紋で並べるため） */
function renderMatches(f: Features, before: string[]): { name: string; word: string; features: Features } | null {
  const list = $('matches');
  list.replaceChildren();
  $('no-data').hidden = PROFILES.length > 0;
  if (!PROFILES.length) return null;
  const all = candidates();
  const byId = new Map(all.map((p) => [p.id, p]));
  const model = MODEL;
  const ranked = rank(model, f, all, 5);
  // マイクや部屋のせいで、この声が全員からまとめて遠くなった分（選んだ大枠ではなく、サイトの声すべてで測る）
  const scale = farScale(model, f, PROFILES);
  ranked.forEach((r, at) => {
    const v = entryOf(r.id);
    const li = el('li', 'match');
    const name = el('div', 'name');
    const a = el('a', undefined, nameOf(v));
    a.href = v.links.profile;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    name.append(a, el('span', 'near', closenessWord(model, r.distance, scale)));
    if (before.length) {
      // この回の前の結果では何位だったか
      const was = before.indexOf(r.id);
      const move = was < 0 ? ['new', t('新しく入った', 'New')] : was > at ? ['up', `↑ ${was - at}`] : was < at ? ['down', `↓ ${at - was}`] : ['same', t('そのまま', 'Same')];
      const mv = el('span', `move ${move[0]}`, move[1]);
      mv.title = was < 0 ? t('前の結果には無かった声', 'Not in the earlier result') : t(`前の結果では ${was + 1} 位`, `No. ${was + 1} in the earlier result`);
      name.append(mv);
    }
    li.append(name);
    const group = groupOf(v);
    if (group) li.append(el('div', 'why', group));
    if (r.id === MINE_ID) li.append(el('div', 'why', t('じっくり測るページで入れた、あなたの声（この端末だけ）', 'Your voice, added on the in-depth page (this device only)')));
    const c = closeness(MODEL, f, byId.get(r.id)!.features).filter(([k]) => !FEATURE_BY_KEY[k].detail);
    const near = c.slice(0, 3).map(([k]) => FEATURE_BY_KEY[k].name);
    const far = c.slice(-2).map(([k]) => FEATURE_BY_KEY[k].name);
    li.append(el('div', 'why', t(`似ている所: ${near.join('・')}　違う所: ${far.join('・')}`, `Alike in: ${near.join(', ')} · Different in: ${far.join(', ')}`)));
    const practice = el('a', 'practice', t('この声で声真似の点数をみる', 'Try imitating this voice'));
    practice.href = `./mimic.html?target=${encodeURIComponent(v.name)}`;
    // 新しいタブで開き、このページの結果を残す（声はどこにも残さないので、結果を出し直せない）
    practice.target = '_blank';
    practice.rel = 'noopener';
    if (r.id !== MINE_ID) li.append(practice);
    list.append(li);
  });
  // 共有カードと声紋では、あなたをサイトの声の 1 位と並べる（自分の声とは並べない）
  const first = ranked.find((r) => r.id !== MINE_ID);
  return first ? { name: nameOf(ENTRY_BY_ID.get(first.id)!), word: closenessWord(model, first.distance, scale), features: byId.get(first.id)!.features } : null;
}

function renderMine(f: Features) {
  renderGroups($('mine'), (d) => itemRow(d, [{ value: f[d.key] }], el('div', 'value', formatFeature(d.key, f[d.key]))));
}

/* ---- 項目の名前の帯（飾り。同じ並びを 2 回続けて、つなぎ目なく流す） ---- */
function ticker() {
  const names = FEATURES.filter((d) => !d.detail).map((d) => d.name);
  const track = $('ticker');
  track.replaceChildren();
  for (const copy of [false, true]) for (const n of names) track.append(el('span', copy ? 'copy' : undefined, n));
}
ticker();

onLang(() => {
  showTopic();
  texts();
  statusEl.classList.toggle('bad', statusBad);
  ticker();
  if (ready) drawKindChips();
  drawMineNote();
  if (!result.hidden) draw();
});

show('idle', M('一言からでも測れます。マイクは「話しはじめる」を押した時だけ使います。', 'Even a single phrase can be measured. The microphone is used only after you press “Start talking”.'));
