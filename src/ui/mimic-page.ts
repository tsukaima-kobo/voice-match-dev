// 声真似の点数のページ（mimic.html）: お手本を選ぶか聞かせる → 数字にする → 真似して話す → 近さの点数と直し方。
// 声のページ（index.html）の結果から `?target=<ID>` で来た時は、その声をお手本にする。
// 音（お手本も利用者の声も）はメモリーの中だけ。数字にしたらすぐ捨てる。どこにも送らない、端末にも残さない。
// お手本の数字もメモリーの中だけで、ページを閉じれば消える（localStorage なども使わない）。
// お手本を聞かせている間は、ほかのタブで動画を流せるよう、ページが隠れても止めない（音が来てから 35 秒で止まる）。
// お手本は、マイク・ほかのタブの音・音声ファイル、またはこのサイトで事前に測ったお手本の代表値（data/profiles.json）。
// 真似して話す時は、ページが隠れたらすぐ止める。声から性別や年齢を判断しない。お題のランダムはお題の選び方だけ。
import { micErrorText, openMic, openTabAudio, tabAudioSupported, tabErrorText, type Mic } from '../voice/listen.ts';
import { measureVoice, type MeasureFail } from '../voice/measure.ts';
import { LONG_MAX_SECONDS, measureLong } from '../voice/combine.ts';
import { createWave, type Wave } from '../voice/wave.ts';
import { createOrb, type OrbMode } from './orb.ts';
import { FEATURE_BY_KEY, formatFeature, type Features } from '../voice/features.ts';
import { el, itemRow, renderGroups } from './items.ts';
import { adviceFor, differences, mimicScore, scoreWord } from '../mimic/mimic.ts';
import { ENTRY_BY_ID, PROFILES } from '../data/load.ts';
import { nextPrompt, READING } from '../prompts/prompts.ts';
import { checkSubmission, encodeSubmission, makeSubmission, type Source } from '../submit/code.ts';
import { SUBMIT_FORM } from '../submit/config.ts';

/** 聞く長さの最大（秒） */
const LISTEN_MAX = 35;
/** 「聞かせ終えた」「話し終えた」を押せるまで（秒） */
const REF_DONE_AFTER = 8;
const MIM_DONE_AFTER = 10;
/** 要る声（秒） */
const MIN_VOICED = 8;
/** お手本の音声ファイルの大きさの上限 */
const FILE_MAX_BYTES = 20 * 1024 * 1024;
/** 音声ファイルは、この速さで読む（measure.ts もこの速さにしてから測る） */
const FILE_RATE = 16000;
/** お手本を聞かせる時、これより小さい音は「まだ始まっていない」として数えない（RMS） */
const START_RMS = 0.003;

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
/** 声の玉（お手本と真似の両方で使う。見た目だけ） */
const orb = createOrb($('orb'));
const ORB_MODE: Record<string, OrbMode> = { listening: 'listening', analysing: 'analysing', ready: 'done', done: 'done' };

/* ---- 録る（お手本と真似で共通） ---- */
interface TakeUi {
  wave: Wave;
  fill: HTMLElement;
  sec: HTMLElement;
  done: HTMLButtonElement;
}
class Take {
  private chunks: Float32Array[] = [];
  private got = 0;
  private raf = 0;
  private rate = 0;
  private live = false;
  private mic: Mic | null = null;
  constructor(
    private ui: TakeUi,
    private doneAfter: number,
    private waitForSound: boolean,
    private onFull: () => void,
  ) {}
  readonly onChunk = (x: Float32Array): void => {
    if (!this.live) return;
    if (this.waitForSound && this.got === 0 && rms(x) < START_RMS) return;
    this.chunks.push(x);
    this.got += x.length;
    this.ui.wave.push(x, this.rate);
    orb.push(x, this.rate);
    // (checked here and not in the frame loop: the page may be hidden while a model plays in another tab)
    if (this.got / this.rate >= LISTEN_MAX) this.onFull();
  };
  begin(mic: Mic): void {
    this.mic = mic;
    this.rate = mic.rate;
    this.live = true;
    this.tick();
  }
  private readonly tick = (): void => {
    const sec = this.rate ? this.got / this.rate : 0;
    this.ui.fill.style.width = `${Math.min(100, (sec / LISTEN_MAX) * 100)}%`;
    this.ui.sec.textContent = `${Math.floor(sec)} / ${LISTEN_MAX} 秒`;
    orb.progress(sec / LISTEN_MAX);
    this.ui.done.disabled = sec < this.doneAfter;
    this.ui.wave.draw(true);
    if (this.live) this.raf = requestAnimationFrame(this.tick);
  };
  /** 止めて、録った音を 1 つにして渡す（中はすぐ空にする） */
  take(): { pcm: Float32Array; rate: number } | null {
    const rate = this.rate;
    this.stop();
    if (!rate || !this.got) {
      this.drop();
      return null;
    }
    const pcm = new Float32Array(this.got);
    let at = 0;
    for (const c of this.chunks) {
      pcm.set(c, at);
      at += c.length;
    }
    this.drop();
    return { pcm, rate };
  }
  stop(): void {
    this.live = false;
    cancelAnimationFrame(this.raf);
    this.mic?.stop();
    this.mic = null;
    this.ui.wave.draw(false);
  }
  drop(): void {
    this.chunks = [];
    this.got = 0;
    this.ui.wave.clear();
    this.ui.fill.style.width = '0';
    this.ui.sec.textContent = '';
  }
}
function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, x.length));
}

/* ---- 1. お手本 ---- */
const ref = {
  stage: $('ref'),
  pick: $('ref-pick'),
  mic: $<HTMLButtonElement>('ref-mic'),
  tab: $<HTMLButtonElement>('ref-tab'),
  tabNote: $('ref-tab-note'),
  fileButton: $<HTMLButtonElement>('ref-file-button'),
  file: $<HTMLInputElement>('ref-file'),
  catalogBox: $('ref-catalog-box'),
  catalog: $<HTMLInputElement>('ref-catalog'),
  name: $<HTMLInputElement>('ref-name'),
  done: $<HTMLButtonElement>('ref-done'),
  cancel: $<HTMLButtonElement>('ref-cancel'),
  change: $<HTMLButtonElement>('ref-change'),
  summary: $('ref-summary'),
  status: $('ref-status'),
  fill: $('ref-fill'),
  sec: $('ref-sec'),
};
const refTake = new Take({ wave: createWave($<HTMLCanvasElement>('ref-wave')), fill: ref.fill, sec: ref.sec, done: ref.done }, REF_DONE_AFTER, true, () => refFinish());

type RefState = 'idle' | 'asking' | 'listening' | 'analysing' | 'ready' | 'failed';
let refState: RefState = 'idle';
let refToken = 0;
/** お手本。利用者が聞かせた物（マイク・タブ・ファイル）は、登録に使う聞かせ方と声の質も持つ */
interface Target {
  features: Features;
  name: string;
  reg?: { source: Source; quality: { voicedSeconds: number; gapTonal: number; snrDb: number } };
}
let target: Target | null = null;
let refKind: 'mic' | 'tab' = 'mic';
let best = 0;
let tries = 0;

function showRef(next: RefState, text: string, bad = false): void {
  refState = next;
  ref.stage.dataset.state = next;
  orb.mode(ORB_MODE[next] ?? 'idle');
  ref.status.textContent = text;
  ref.status.classList.toggle('bad', bad);
  const busy = next === 'asking' || next === 'listening' || next === 'analysing';
  ref.pick.hidden = next === 'ready';
  for (const b of [ref.mic, ref.tab, ref.fileButton]) b.disabled = busy;
  ref.catalog.disabled = busy;
  ref.name.disabled = busy;
  ref.done.hidden = next !== 'listening';
  ref.cancel.hidden = !(next === 'listening' || next === 'asking');
  ref.change.hidden = next !== 'ready';
  ref.summary.hidden = next !== 'ready';
  reg.box.hidden = !(next === 'ready' && target?.reg);
}

async function refListen(kind: 'mic' | 'tab'): Promise<void> {
  const my = ++refToken;
  refKind = kind;
  refTake.drop();
  showRef('asking', kind === 'mic' ? 'マイクの許可を待っています…' : '共有するタブを選んでください…');
  try {
    const m = await (kind === 'mic' ? openMic : openTabAudio)(refTake.onChunk, () => refFinish());
    if (my !== refToken || refState !== 'asking') {
      m.stop();
      return;
    }
    refTake.begin(m);
    showRef(
      'listening',
      kind === 'mic'
        ? `お手本を流して、マイクに聞かせてください。音が聞こえたら数えはじめます。${REF_DONE_AFTER} 秒すぎたら「聞かせ終えた」を押せます（最大 ${LISTEN_MAX} 秒）。`
        : `選んだタブで、お手本を再生してください。音が来てから ${LISTEN_MAX} 秒で止まります。早く終える時は、このページに戻って「聞かせ終えた」を押してください。`,
    );
  } catch (e) {
    if (my !== refToken) return;
    refTake.stop();
    refTake.drop();
    showRef('failed', kind === 'mic' ? micErrorText(e) : tabErrorText(e), true);
  }
}

function refFinish(): void {
  if (refState !== 'listening') return;
  const got = refTake.take();
  if (!got) {
    showRef('failed', 'お手本の音が届きませんでした。音量を上げて、もう一度試してください。', true);
    return;
  }
  showRef('analysing', '数字にしています…');
  setTimeout(() => {
    const m = measureVoice(got.pcm, got.rate, { minVoicedSeconds: MIN_VOICED });
    got.pcm.fill(0);
    if (!m.ok) {
      showRef('failed', failText(m.reason, m.info.voicedSeconds, true), true);
      return;
    }
    setTarget(m.features, ref.name.value.trim(), `声 ${m.info.voicedSeconds.toFixed(1)} 秒分`, {
      source: refKind,
      quality: { voicedSeconds: m.info.voicedSeconds, gapTonal: m.info.gapTonal, snrDb: m.info.loudDb - m.info.floorDb },
    });
  }, 30);
}

function refCancel(): void {
  refToken++;
  refTake.stop();
  refTake.drop();
  showRef('idle', 'やめました。音は捨てました。');
}

async function decodeFile(f: File): Promise<{ pcm: Float32Array; rate: number }> {
  const buf = await f.arrayBuffer();
  const OAC = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  // (only for decoding: it gives the file's sound at FILE_RATE)
  const ctx = new OAC(1, FILE_RATE, FILE_RATE);
  const audio = await new Promise<AudioBuffer>((resolve, reject) => {
    const p = ctx.decodeAudioData(buf, resolve, reject) as Promise<AudioBuffer> | undefined;
    p?.then(resolve, reject);
  });
  const n = Math.min(audio.length, Math.floor(LONG_MAX_SECONDS * audio.sampleRate));
  const pcm = new Float32Array(n);
  const ch = audio.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < n; i++) pcm[i] = pcm[i]! + d[i]! / ch;
  }
  return { pcm, rate: audio.sampleRate };
}

async function refFromFile(f: File): Promise<void> {
  if (f.size > FILE_MAX_BYTES) {
    showRef('failed', 'ファイルが大きすぎます（20 MB まで）。使いたい所だけを切り出したファイルにしてください。', true);
    return;
  }
  const my = ++refToken;
  showRef('analysing', 'ファイルを読んでいます…');
  let sound: { pcm: Float32Array; rate: number };
  try {
    sound = await decodeFile(f);
  } catch {
    if (my === refToken) showRef('failed', 'このファイルは読めませんでした。mp3・m4a・wav などの音声ファイルを選んでください。', true);
    return;
  }
  const m = await measureLong(sound.pcm, sound.rate, {
    minVoicedSeconds: MIN_VOICED,
    onProgress: (done, total) => {
      if (total > 1 && my === refToken) ref.status.textContent = `数字にしています… ${done} / ${total}`;
    },
  });
  sound.pcm.fill(0);
  if (my !== refToken) return;
  if (!m.ok) {
    showRef('failed', failText(m.reason, m.voicedSeconds, true), true);
    return;
  }
  const part = m.seconds >= LONG_MAX_SECONDS ? `最初の ${LONG_MAX_SECONDS / 60} 分のうち、声 ${m.voicedSeconds.toFixed(1)} 秒分` : `声 ${m.voicedSeconds.toFixed(1)} 秒分`;
  setTarget(m.features, ref.name.value.trim(), part, { source: 'file', quality: { voicedSeconds: m.voicedSeconds, gapTonal: m.gapTonal, snrDb: m.snrDb } });
}

function setTarget(features: Features, name: string, from: string, regInfo?: Target['reg']): void {
  target = { features, name, ...(regInfo ? { reg: regInfo } : {}) };
  resetRegister(name);
  best = 0;
  tries = 0;
  $('result').hidden = true;
  const f = features;
  ref.summary.textContent = `${name ? `「${name}」をお手本にしました` : 'お手本を測りました'}（${from}）。声の高さ ${formatFeature('pitch', f.pitch)}・抑揚 ${formatFeature('pitchRange', f.pitchRange)}・速さ ${formatFeature('rate', f.rate)}。`;
  showRef('ready', 'お手本の準備ができました。次は、真似して話してください。');
  showMim('idle', '「真似して話す」を押して、お手本のように話してください。');
}

ref.mic.addEventListener('click', () => void refListen('mic'));
ref.tab.addEventListener('click', () => void refListen('tab'));
ref.fileButton.addEventListener('click', () => ref.file.click());
ref.file.addEventListener('change', () => {
  const f = ref.file.files?.[0];
  ref.file.value = '';
  if (f) void refFromFile(f);
});
ref.done.addEventListener('click', refFinish);
ref.cancel.addEventListener('click', refCancel);
ref.change.addEventListener('click', () => {
  target = null;
  $('result').hidden = true;
  showRef('idle', 'お手本の聞かせ方を選んでください。');
  showMim('locked', '先にお手本を聞かせてください。');
});
/* お手本の声をサイトに登録する（アキネーター方式。壁 ① をここで確かめ、送るのは利用者が Google フォームで） */
const reg = {
  box: $<HTMLDetailsElement>('register'),
  name: $<HTMLInputElement>('reg-name'),
  group: $<HTMLInputElement>('reg-group'),
  link: $<HTMLInputElement>('reg-link'),
  ok: $<HTMLInputElement>('reg-ok'),
  make: $<HTMLButtonElement>('reg-make'),
  problems: $('reg-problems'),
  out: $('reg-out'),
  code: $<HTMLTextAreaElement>('reg-code'),
  copy: $<HTMLButtonElement>('reg-copy'),
  form: $<HTMLAnchorElement>('reg-form'),
  howto: $('reg-howto'),
};
function resetRegister(name: string): void {
  reg.box.open = false;
  reg.name.value = name;
  reg.group.value = '';
  reg.link.value = '';
  reg.ok.checked = false;
  reg.problems.hidden = reg.out.hidden = true;
  reg.problems.replaceChildren();
  reg.code.value = '';
}
reg.make.addEventListener('click', () => {
  if (!target?.reg) return;
  const sub = makeSubmission({ name: reg.name.value, group: reg.group.value, link: reg.link.value, source: target.reg.source, quality: target.reg.quality, features: target.features, consent: reg.ok.checked });
  const problems = checkSubmission(sub);
  reg.problems.replaceChildren(...problems.map((p) => el('li', undefined, p.text)));
  reg.problems.hidden = !problems.length;
  reg.out.hidden = problems.length > 0;
  if (problems.length) return;
  const code = encodeSubmission(sub);
  reg.code.value = code;
  if (SUBMIT_FORM.url) {
    reg.form.hidden = false;
    reg.form.href = SUBMIT_FORM.entry ? `${SUBMIT_FORM.url}?usp=pp_url&entry.${SUBMIT_FORM.entry}=${encodeURIComponent(code)}` : SUBMIT_FORM.url;
    reg.howto.textContent = SUBMIT_FORM.entry ? '「フォームを開く」で、送る内容が入ったフォームが開きます。そのまま送信してください。' : '「コピー」してから「フォームを開く」で、送る内容を貼って送信してください。';
  } else {
    reg.form.hidden = true;
    reg.howto.textContent = '登録の受け付けは準備中です。もうしばらくお待ちください。';
  }
});
reg.copy.addEventListener('click', () => {
  const done = () => (reg.copy.textContent = 'コピーしました');
  navigator.clipboard?.writeText(reg.code.value).then(done, () => {
    reg.code.select();
  }) ?? reg.code.select();
});

/* このサイトで事前に測ったお手本（名前で探して選ぶ） */
const labelOf = (id: string) => {
  const v = ENTRY_BY_ID.get(id)!;
  return v.group ? `${v.name}（${v.group}）` : v.name;
};
const byLabel = new Map(PROFILES.map((p) => [labelOf(p.id), p]));
ref.catalog.addEventListener('change', () => {
  const p = byLabel.get(ref.catalog.value.trim());
  if (!p) return;
  ref.catalog.value = '';
  setTarget(p.features, ENTRY_BY_ID.get(p.id)!.name, 'このサイトで測った代表値');
});
if (tabAudioSupported()) ref.tab.hidden = ref.tabNote.hidden = false;
if (PROFILES.length) {
  ref.catalogBox.hidden = false;
  $('ref-catalog-count').textContent = `${PROFILES.length} 件`;
  const list = $('ref-catalog-list');
  for (const label of [...byLabel.keys()].sort((a, b) => a.localeCompare(b, 'ja'))) {
    const o = document.createElement('option');
    o.value = label;
    list.append(o);
  }
}

/* ---- 2. 真似 ---- */
const topic = { label: $('topic-label'), text: $('topic-text'), next: $<HTMLButtonElement>('topic-next'), read: $<HTMLButtonElement>('topic-read') };
let prompt: string | null = nextPrompt(null);
let reading = false;
function showTopic(): void {
  topic.label.textContent = reading ? '決まった文（お手本の声で読んでください）' : 'お題（お手本の声で話してください）';
  topic.text.textContent = reading ? READING : prompt!;
  topic.text.classList.toggle('reading', reading);
  topic.read.textContent = reading ? 'お題にもどす' : '決まった文を読む';
}
topic.next.addEventListener('click', () => {
  reading = false;
  prompt = nextPrompt(prompt);
  showTopic();
});
topic.read.addEventListener('click', () => {
  reading = !reading;
  showTopic();
});
showTopic();

const mim = {
  stage: $('mim'),
  start: $<HTMLButtonElement>('mim-start'),
  done: $<HTMLButtonElement>('mim-done'),
  cancel: $<HTMLButtonElement>('mim-cancel'),
  status: $('mim-status'),
};
const mimTake = new Take({ wave: createWave($<HTMLCanvasElement>('mim-wave')), fill: $('mim-fill'), sec: $('mim-sec'), done: mim.done }, MIM_DONE_AFTER, false, () => mimFinish());

type MimState = 'locked' | 'idle' | 'asking' | 'listening' | 'analysing' | 'done' | 'failed';
let mimState: MimState = 'locked';
let mimToken = 0;

function showMim(next: MimState, text: string, bad = false): void {
  mimState = next;
  mim.stage.dataset.state = next;
  orb.mode(ORB_MODE[next] ?? 'idle');
  mim.status.textContent = text;
  mim.status.classList.toggle('bad', bad);
  mim.start.hidden = !(next === 'locked' || next === 'idle' || next === 'failed' || next === 'done');
  mim.start.disabled = next === 'locked';
  mim.start.textContent = next === 'done' ? 'もう一度真似する' : '真似して話す';
  mim.done.hidden = next !== 'listening';
  mim.cancel.hidden = !(next === 'listening' || next === 'asking');
  ref.change.disabled = next === 'asking' || next === 'listening' || next === 'analysing';
  topic.next.disabled = topic.read.disabled = next === 'asking' || next === 'listening' || next === 'analysing';
}

async function mimStart(): Promise<void> {
  if (!target) return;
  const my = ++mimToken;
  mimTake.drop();
  showMim('asking', 'マイクの許可を待っています…');
  try {
    const m = await openMic(mimTake.onChunk, () => mimFinish());
    if (my !== mimToken || mimState !== 'asking') {
      m.stop();
      return;
    }
    mimTake.begin(m);
    showMim('listening', `お手本のように話してください。${MIM_DONE_AFTER} 秒すぎたら「話し終えた」を押せます（最大 ${LISTEN_MAX} 秒）。`);
  } catch (e) {
    if (my !== mimToken) return;
    mimTake.stop();
    mimTake.drop();
    showMim('failed', micErrorText(e), true);
  }
}

function mimFinish(): void {
  if (mimState !== 'listening' || !target) return;
  const got = mimTake.take();
  if (!got) {
    showMim('failed', '声が届きませんでした。もう一度試してください。', true);
    return;
  }
  showMim('analysing', '数字にしています…');
  setTimeout(() => {
    const m = measureVoice(got.pcm, got.rate, { minVoicedSeconds: MIN_VOICED });
    got.pcm.fill(0);
    if (!target) return;
    if (!m.ok) {
      showMim('failed', failText(m.reason, m.info.voicedSeconds, false), true);
      return;
    }
    if (!render(target, m.features)) {
      showMim('failed', 'お手本と比べられる項目がありませんでした。お手本か声を測り直してください。', true);
      return;
    }
    showMim('done', '測りました。結果は下にあります。');
    $('result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, 30);
}

function mimCancel(): void {
  mimToken++;
  mimTake.stop();
  mimTake.drop();
  showMim(target ? 'idle' : 'locked', 'やめました。音は捨てました。');
}

mim.start.addEventListener('click', () => void mimStart());
mim.done.addEventListener('click', mimFinish);
mim.cancel.addEventListener('click', mimCancel);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (mimState === 'listening' || mimState === 'asking')) mimCancel();
});
window.addEventListener('pagehide', () => {
  refTake.stop();
  mimTake.stop();
});

function failText(reason: MeasureFail, voiced: number | undefined, model: boolean): string {
  const v = (voiced ?? 0).toFixed(1);
  switch (reason) {
    case 'silent':
      return model ? 'お手本の音が聞こえませんでした。音量を上げるか、マイクの近くで流してください。' : '声が聞こえませんでした。マイクが消音になっていないか、使うマイクが合っているか確かめてください。';
    case 'quiet':
      return model ? 'お手本の音が小さくて測れませんでした。音量を上げてください。' : '声が小さくて測れませんでした。マイクに少し近づいて話してください。';
    case 'noisy':
      return model ? 'お手本に、声のほかの音（BGM・効果音・雑音）が多くて測れませんでした。声だけの所を選んでください。' : 'まわりの音が大きくて、声とうまく分けられませんでした。静かな所で、もう一度話してください。';
    case 'clipped':
      return model ? 'お手本の音が大きすぎて、割れていました。音量を少し下げてください。' : '声が大きすぎて、音が割れていました。マイクから少し離れてください。';
    case 'short':
      return model
        ? `お手本の声を ${v} 秒分しか測れませんでした（${MIN_VOICED} 秒以上いります）。セリフをいくつか続けて聞かせてください。`
        : `声を ${v} 秒分しか測れませんでした（${MIN_VOICED} 秒以上いります）。ささやかずに、もう少し長く話してください。`;
    default:
      return 'うまく数字にできませんでした。もう一度試してください。';
  }
}

/* ---- 結果 ---- */
/** 点数: 輪（CSS の --score）と、数えあがる数字。動きを減らす設定では、すぐその数 */
function showScore(score: number): void {
  const gauge = $('gauge');
  const num = $('score');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // (the ring goes back to 0 at once, then fills to the score, each time)
  gauge.style.transition = 'none';
  gauge.style.setProperty('--score', '0');
  void getComputedStyle(gauge).getPropertyValue('--score');
  gauge.style.transition = '';
  gauge.style.setProperty('--score', String(score));
  num.textContent = String(score);
  if (still) return;
  num.textContent = '0';
  let t0 = -1;
  const step = (now: number) => {
    if (t0 < 0) t0 = now;
    const k = Math.min(1, Math.max(0, (now - t0) / 1400));
    num.textContent = String(Math.round(score * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function render(t: { features: Features; name: string }, mine: Features): boolean {
  const s = mimicScore(t.features, mine);
  if (!s) return false;
  tries++;
  const before = best;
  best = Math.max(best, s.score);
  $('score-label').textContent = `${t.name ? `「${t.name}」` : 'お手本'}との近さ`;
  showScore(s.score);
  $('score-word').textContent = scoreWord(s.score);
  $('best').textContent = tries === 1 ? '' : s.score > before ? `最高点を更新しました（${tries} 回目）` : `このお手本での最高は ${best} 点です（${tries} 回目）`;

  const diffs = differences(t.features, mine);
  const list = $('advice');
  list.replaceChildren();
  const tips = adviceFor(diffs, 3);
  if (!tips.length) list.append(el('li', undefined, 'ほぼそろっています。次は、セリフの言い回しや語尾も寄せてみてください。'));
  for (const tip of tips) {
    const li = el('li');
    li.append(el('strong', undefined, tip.text), el('span', 'why', `（${FEATURE_BY_KEY[tip.key].name}: お手本 ${formatFeature(tip.key, t.features[tip.key])}・あなた ${formatFeature(tip.key, mine[tip.key])}）`));
    list.append(li);
  }

  renderGroups($('compare'), (d) => {
    const a = t.features[d.key],
      b = mine[d.key];
    const value = el('div', 'value two');
    value.append(el('span', undefined, `お手本 ${formatFeature(d.key, a)}`), el('span', undefined, `あなた ${formatFeature(d.key, b)}`));
    return itemRow(d, [{ value: a, cls: 'ref' }, { value: b }], value);
  });
  $('result').hidden = false;
  return true;
}

showRef('idle', 'お手本の聞かせ方を選んでください。');
showMim('locked', '先にお手本を聞かせてください。');
{
  const wanted = new URLSearchParams(location.search).get('target');
  const p = wanted ? PROFILES.find((x) => x.id === wanted) : undefined;
  if (p) setTarget(p.features, ENTRY_BY_ID.get(p.id)!.name, 'このサイトで測った代表値');
}
