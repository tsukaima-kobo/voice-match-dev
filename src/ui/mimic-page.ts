// 声真似の点数のページ（mimic.html）: お手本を選ぶか聞かせる → 数字にする → 真似して話す → 近さの点数と直し方。
// お手本が 1 つのセリフ（話しはじめから終わりまで LINE_MAX_SECONDS 以内）なら「セリフ真似」: 高さと大きさの動き（Contour）も持ち、
// 同じセリフを真似した声と、抑揚・タイミング（mimic/line.ts）と声の質（mimic.ts）で比べ、2 本の線を重ねた図を出す。
// それより長いお手本と、このサイトで測ったお手本は「声全体」: 声の数字だけで比べる。どちらも一言（声 0.4 秒）から。
// 声のページ（index.html）の結果から `?target=<名前>` で来た時は、その声をお手本にする。
// 音（お手本も利用者の声も）はメモリーの中だけ。数字にしたらすぐ捨てる。どこにも送らない、端末にも残さない。
// お手本の数字もメモリーの中だけで、ページを閉じれば消える（localStorage なども使わない）。
// お手本を聞かせている間は、ほかのタブやアプリで動画を流せるよう、ページが隠れても止めない（音が来てから 35 秒で止まる。
// 音が来ないまま 60 秒たった時も止める）。真似して話す時は、ページが隠れたらすぐ止める。
// マイクが外れた・タブの共有が止まった時は、聞かせ終えられる長さがあればそこまでで測り、無ければ止めて伝える。
// お手本は、マイク・ほかのタブの音・音声ファイル、またはこのサイトで事前に測ったお手本の代表値（声のデータ。src/data/load.ts が裏で読む）。
// 声から性別や年齢を判断しない。お題のランダムはお題の選び方だけ。
import { micErrorText, openMic, openTabAudio, tabAudioSupported, tabErrorText, type Mic } from '../voice/listen.ts';
import type { MeasureFail } from '../voice/measure.ts';
import { LONG_MAX_SECONDS, measureLong } from '../voice/combine.ts';
import { createWave, type Wave } from '../voice/wave.ts';
import { createOrb, type OrbMode } from './orb.ts';
import { micPicker } from './mic-picker.ts';
import { createLiveAnalysis, type LiveAnalysis } from './live-analysis.ts';
import { measureAsync } from '../voice/measure-async.ts';
import { FEATURE_BY_KEY, forLength, formatFeature, LONG_SECONDS, ONE_LINE_SECONDS, type Features } from '../voice/features.ts';
import type { Contour, Measured } from '../voice/measure.ts';
import { compareLines, LINE_MAX_SECONDS, lineScore } from '../mimic/line.ts';
import { drawLineChart } from './line-chart.ts';
import { mountShapes } from './voiceprint.ts';
import { el, itemRow, renderGroups } from './items.ts';
import { adviceFor, differences, mimicScore, scoreWord } from '../mimic/mimic.ts';
import { ENTRY_BY_ID, PROFILES, voicesReady } from '../data/load.ts';
import { nextPromptIndex, nextReadingIndex, promptText, readingText } from '../prompts/prompts.ts';
import { lang, mountLang, onLang, t, type Lang } from '../i18n.ts';
import { mountFooter, mountGithubLink, mountShare } from './share.ts';
import { checkSubmission, encodeSubmission, makeSubmission } from '../submit/code.ts';
import { SUBMIT_FORM } from '../submit/config.ts';
import { KINDS } from '../data/kinds.ts';
import { groupOf, nameOf } from '../data/names.ts';

/** 聞く長さの最大（秒） */
const LISTEN_MAX = 35;
/** 「聞かせ終えた」「話し終えた」を押せるまで（秒） */
const REF_DONE_AFTER = 1;
const MIM_DONE_AFTER = 1;
/** 計算中の演出の長さ（ミリ秒）。その間に Worker が測る */
const ANALYSE_MS = 1500;
/** お手本をマイク・タブから測っている時だけ、解析パネルの計算中の演出を出す（ファイルの時は出さない） */
let refAnalysingMic = false;
/** 声の登録に要る声（秒。壁 ① と同じ） */
const REG_MIN_VOICED = LONG_SECONDS;
/** 雑音の床が分からない短いファイル（声だけを切り出した物）は、前後に無音を足して測り直す（その時は登録しない） */
const PAD_FILE_MAX_SECONDS = 15;
/**
 * お手本の音声ファイルの大きさの上限。ファイルは、読むと全部がメモリーに乗る。mp3・m4a などは読むと 10 倍以上の大きさになる
 * （128 kbps の 10 MB で 10 分ほど・120 MB ほど）ので小さく、wav・flac などはあまり変わらないので大きく（CD の音で 3 分ほど）
 */
const FILE_MAX_BYTES = 10 * 1024 * 1024;
const RAW_FILE_MAX_BYTES = 32 * 1024 * 1024;
/** 読んでも大きさがあまり変わらない形（wav・aiff・flac） */
const isRawAudio = (f: File) => /\.(wav|wave|aiff?|aifc|flac)$/i.test(f.name) || /wav|aiff|flac/i.test(f.type);
/**
 * 音声ファイルは、この速さで読む（48 kHz の半分のメモリー。スマホで落ちないように）。measure.ts の 16 kHz への直し方は、
 * 24 kHz からでも 48 kHz からでも、同じ 7.2 kHz（16 kHz の 0.45）で切る低域通過を通すので、マイク（多くは 48 kHz）・サイトの声
 * （48 kHz で測る）と同じ帯域で測れる（ブラウザーが 24 kHz に直す時に消えるのは 12 kHz より上だけ）。16 kHz で読ませないのは、
 * ブラウザーの直し方が違って、声の澄み具合などが少しずれるため（古い Safari は 22.05 kHz より低い速さで読めない）
 */
const FILE_RATE = 24000;
/** お手本を聞かせる時、これより小さい音は「まだ始まっていない」として数えない（RMS） */
const START_RMS = 0.003;
/** お手本を聞かせる時、音が来ないまま、これだけたったら止める（秒。マイク・タブの音を開いたままにしない） */
const WAIT_MAX = 60;

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
mountLang({ ja: '声真似の点数｜voice-match', en: 'Voice-mimic score | voice-match' });
mountGithubLink();
mountFooter();
/** 結果のシェア（X など） */
const share = mountShare($('share'));
/** 案内の文（今の言葉で作る関数。切り替えた時に作り直す） */
type Msg = () => string;
const M = (ja: string, en: string): Msg => () => t(ja, en);
/** 声の玉（お手本と真似の両方で使う。見た目だけ） */
const orb = createOrb($('orb'));
const ORB_MODE: Record<string, OrbMode> = { listening: 'listening', analysing: 'analysing', ready: 'done', done: 'done' };
/** マイクを選ぶ所（お手本と真似の 2 か所。どちらで選んでも同じ） */
const mics = micPicker(
  ['ref', 'mim'].map((k) => ({ box: $(`${k}-mic-pick`), select: $<HTMLSelectElement>(`${k}-mic-select`), find: $<HTMLButtonElement>(`${k}-mic-find`) })),
  // マイクの一覧が出せなかった時: 今出している方の知らせに出す（言葉を切り替えても出したままにする）
  (msg) => {
    if (mimState === 'locked') {
      refMsg = msg;
      refBad = true;
    } else {
      mimMsg = msg;
      mimBad = true;
    }
    const st = mimState === 'locked' ? ref.status : mim.status;
    st.textContent = msg();
    st.classList.add('bad');
  },
);
const isBusy = (st: string) => st === 'asking' || st === 'listening' || st === 'analysing';
const lockMics = () => mics.lock(isBusy(refState) || isBusy(mimState));

/* ---- 録る（お手本と真似で共通） ---- */
interface TakeUi {
  wave: Wave;
  /** 録っている間の解析パネル（見せるためだけ） */
  live: LiveAnalysis;
  fill: HTMLElement;
  sec: HTMLElement;
  done: HTMLButtonElement;
}
class Take {
  private chunks: Float32Array[] = [];
  private got = 0;
  /** 音が来るのを待っている間に届いた音（サンプル数。数えるだけで、音は持たない） */
  private waited = 0;
  private raf = 0;
  private rate = 0;
  private live = false;
  private mic: Mic | null = null;
  /** 音が来ないまま止める時計（音そのものが届かなくなった時のため。ふだんは onChunk で数えて止まる） */
  private quietTimer = 0;
  constructor(
    private ui: TakeUi,
    private doneAfter: number,
    private waitForSound: boolean,
    private onFull: () => void,
    /** waitForSound の時: 音が来ないまま WAIT_MAX 秒たった */
    private onQuiet: () => void = () => {},
  ) {}
  /** 録れた長さ（秒。音が来る前に待った分は数えない） */
  get seconds(): number {
    return this.rate ? this.got / this.rate : 0;
  }
  readonly onChunk = (x: Float32Array): void => {
    if (!this.live) return;
    if (this.waitForSound && this.got === 0 && rms(x) < START_RMS) {
      // 音が来ないまま WAIT_MAX 秒たったら止める（ページが隠れていても、届いた音の長さで数える）
      this.waited += x.length;
      if (this.waited / this.rate >= WAIT_MAX) this.onQuiet();
      return;
    }
    this.chunks.push(x);
    this.got += x.length;
    this.ui.wave.push(x, this.rate);
    this.ui.live.push(x, this.rate);
    orb.push(x, this.rate);
    // 描く繰り返しの中ではなく、ここで確かめる（お手本をほかのタブで流している間は、このページが隠れていることがある）
    if (this.got / this.rate >= LISTEN_MAX) this.onFull();
  };
  begin(mic: Mic): void {
    // 前のマイクが残っていたら止める（開いたまま隠れないように）
    if (this.mic && this.mic !== mic) this.mic.stop();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.quietTimer);
    this.mic = mic;
    this.rate = mic.rate;
    this.waited = 0;
    this.live = true;
    if (this.waitForSound)
      this.quietTimer = window.setTimeout(() => {
        if (this.live && this.got === 0) this.onQuiet();
      }, (WAIT_MAX + 5) * 1000);
    this.tick();
  }
  private readonly tick = (): void => {
    const sec = this.rate ? this.got / this.rate : 0;
    this.ui.fill.style.width = `${Math.min(100, (sec / LISTEN_MAX) * 100)}%`;
    this.ui.sec.textContent = t(`${Math.floor(sec)} / ${LISTEN_MAX} 秒`, `${Math.floor(sec)} / ${LISTEN_MAX} s`);
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
    clearTimeout(this.quietTimer);
    this.mic?.stop();
    this.mic = null;
    this.ui.wave.draw(false);
  }
  drop(): void {
    this.chunks = [];
    this.got = 0;
    this.waited = 0;
    this.ui.wave.clear();
    this.ui.live.reset();
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
const refLive = createLiveAnalysis($('ref-live'));
const refTake = new Take({ wave: createWave($<HTMLCanvasElement>('ref-wave')), live: refLive, fill: ref.fill, sec: ref.sec, done: ref.done }, REF_DONE_AFTER, true, () => refFinish(), () => refQuiet());

type RefState = 'idle' | 'asking' | 'listening' | 'analysing' | 'ready' | 'failed';
let refState: RefState = 'idle';
let refToken = 0;
/** お手本。利用者が聞かせた物（マイク・タブ・ファイル）は、登録に使う声の質も持つ */
interface Target {
  features: Features;
  name: string;
  /** このサイトで測ったお手本の時だけ: 英語の名前（英語のページで出す） */
  nameEn?: string;
  reg?: { quality: { voicedSeconds: number; gapTonal: number; snrDb: number } };
  /** セリフ真似の時だけ: お手本の高さと大きさの動き */
  contour?: Contour;
  /** 利用者が聞かせたお手本の声（秒）。このサイトで測ったお手本は無し */
  voicedSeconds?: number;
}
let target: Target | null = null;
let refKind: 'mic' | 'tab' = 'mic';
let best = 0;
let tries = 0;

let refMsg: Msg = () => '',
  refBad = false,
  mimMsg: Msg = () => '',
  mimBad = false;
/** お手本の所を描く。`redraw` は言葉を切り替えた時（声の玉はそのまま。お手本を録っている間に止まって見えないように） */
function showRef(next: RefState, msg: Msg, bad = false, redraw = false): void {
  refState = next;
  refMsg = msg;
  refBad = bad;
  ref.stage.dataset.state = next;
  refLive.mode(next === 'listening' ? 'listening' : next === 'analysing' && refAnalysingMic ? 'analysing' : 'off');
  if (!redraw) orb.mode(ORB_MODE[next] ?? 'idle');
  lockMics();
  ref.status.textContent = msg();
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
  const short = next === 'ready' && target?.voicedSeconds !== undefined && !target.reg;
  regShort.hidden = !short;
  if (short) regShort.textContent = t(`この声をサイトに登録するには、声が ${REG_MIN_VOICED} 秒以上いります（今は ${target!.voicedSeconds!.toFixed(1)} 秒）。セリフをいくつか続けて聞かせると、登録もできます。`, `To add this voice to the site, ${REG_MIN_VOICED} s of voice is needed (now ${target!.voicedSeconds!.toFixed(1)} s). Play several lines in a row to be able to add it.`);
  ref.done.textContent = t('聞かせ終えた', 'Done');
  ref.cancel.textContent = t('やめる', 'Stop');
  ref.change.textContent = t('お手本を変える', 'Change the model');
}

async function refListen(kind: 'mic' | 'tab'): Promise<void> {
  const my = ++refToken;
  refKind = kind;
  // ほかの方法で聞かせはじめた: ?target= のお手本は使わない（ファイルを選ぶ画面は、もう閉じている）
  wanted = null;
  choosingFile = false;
  refTake.drop();
  showRef('asking', kind === 'mic' ? M('マイクの許可を待っています…', 'Waiting for microphone permission…') : M('共有するタブを選んでください…', 'Choose the tab to share…'));
  try {
    const m = kind === 'mic' ? await openMic(refTake.onChunk, () => refEnded('mic'), mics.get()) : await openTabAudio(refTake.onChunk, () => refEnded('tab'));
    if (my !== refToken || refState !== 'asking') {
      m.stop();
      return;
    }
    refTake.begin(m);
    if (kind === 'mic') void mics.refresh();
    const label = m.label ?? '';
    showRef('listening', () =>
      kind === 'mic'
        ? t(
            `お手本を流して、マイクに聞かせてください。音が聞こえたら数えはじめます。セリフ 1 つでもかまいません。流し終えたら「聞かせ終えた」を押してください（最大 ${LISTEN_MAX} 秒）。${label ? `マイク: ${label}` : ''}`,
            `Play the model to the microphone. Counting starts when sound is heard. A single line is fine. Press “Done” when it ends (up to ${LISTEN_MAX} s).${label ? ` Microphone: ${label}` : ''}`,
          )
        : t(
            `選んだタブで、お手本を再生してください。セリフ 1 つなら、言い終わったら動画を止めて、このページで「聞かせ終えた」を押してください（音が来てから ${LISTEN_MAX} 秒で止まります）。`,
            `Play the model in the chosen tab. For a single line, pause the video when it ends and press “Done” on this page (it stops ${LISTEN_MAX} s after the sound starts).`,
          ),
    );
  } catch (e) {
    if (my !== refToken) return;
    refTake.stop();
    refTake.drop();
    if ((e as { name?: string } | null)?.name === 'MicGoneError') mics.reset();
    showRef('failed', () => (kind === 'mic' ? micErrorText(e) : tabErrorText(e)), true);
  }
}

function refFinish(): void {
  if (refState !== 'listening') return;
  const got = refTake.take();
  if (!got) {
    showRef('failed', M('お手本の音が届きませんでした。音量を上げて、もう一度試してください。', 'No sound from the model reached the page. Turn the volume up and try again.'), true);
    return;
  }
  refAnalysingMic = true;
  showRef('analysing', M('お手本を計算しています…', 'Working out the model…'));
  const my = refToken;
  void Promise.all([measureAsync(got.pcm, got.rate, { minVoicedSeconds: ONE_LINE_SECONDS, contour: true }), refLive.analysing(ANALYSE_MS)]).then(([m]) => {
    refAnalysingMic = false;
    if (my !== refToken || refState !== 'analysing') return;
    if (!m.ok) {
      showRef('failed', () => failText(m.reason, m.info.voicedSeconds, true), true);
      return;
    }
    targetFrom(m, false);
  });
}

/** 測ったお手本から Target を作る（セリフ 1 つなら動きも。登録は声が足りて、無音を足していない時だけ） */
function targetFrom(m: Extract<Measured, { ok: true }>, padded: boolean): void {
  const i = m.info;
  const line = i.contour && i.speechSeconds <= LINE_MAX_SECONDS ? i.contour : undefined;
  const canReg = !padded && i.voicedSeconds >= REG_MIN_VOICED;
  setTarget(
    forLength(m.features, i.voicedSeconds),
    ref.name.value.trim(),
    line ? M(`セリフ ${i.speechSeconds.toFixed(1)} 秒`, `a ${i.speechSeconds.toFixed(1)} s line`) : M(`声 ${i.voicedSeconds.toFixed(1)} 秒分`, `${i.voicedSeconds.toFixed(1)} s of voice`),
    canReg ? { quality: { voicedSeconds: i.voicedSeconds, gapTonal: i.gapTonal, snrDb: i.loudDb - i.floorDb } } : undefined,
    line,
    i.voicedSeconds,
  );
}

/** 止めて、音を捨てる */
function refStop(): void {
  refToken++;
  refTake.stop();
  refTake.drop();
}
function refCancel(): void {
  refStop();
  showRef('idle', M('やめました。音は捨てました。', 'Stopped. The sound was thrown away.'));
}
/** マイクが外れた・タブの共有が止まった時: 聞かせ終えられる長さがあれば、そこまでで測る。無ければ止めて、そのことを伝える */
function refEnded(kind: 'mic' | 'tab'): void {
  if (refState !== 'listening') return;
  if (refTake.seconds >= REF_DONE_AFTER) {
    refFinish();
    return;
  }
  refStop();
  showRef(
    'failed',
    kind === 'mic'
      ? M('マイクが外れたので止めました。つなぎ直して、もう一度押してください。', 'The microphone went away, so this stopped. Plug it back in and press again.')
      : M('タブの共有が止まったので止めました。もう一度押して、お手本のタブを選んでください。', 'Sharing the tab stopped, so this stopped. Press again and choose the tab with the model.'),
    true,
  );
}
/** お手本の音が来ないまま WAIT_MAX 秒たった時: 止めて伝える（マイク・タブの音を開いたままにしない） */
function refQuiet(): void {
  if (refState !== 'listening') return;
  refStop();
  showRef('failed', M(`音が聞こえないまま ${WAIT_MAX} 秒たったので止めました。お手本を流せるようにしてから、もう一度押してください。`, `No sound was heard for ${WAIT_MAX} s, so this stopped. Get the model ready to play, then press again.`), true);
}

async function decodeFile(f: File): Promise<{ pcm: Float32Array; rate: number }> {
  const buf = await f.arrayBuffer();
  const OAC = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  // デコードだけに使う: ファイルの音を FILE_RATE で出す
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
  if (f.size > (isRawAudio(f) ? RAW_FILE_MAX_BYTES : FILE_MAX_BYTES)) {
    showRef('failed', M(`ファイルが大きすぎます（mp3・m4a などは ${FILE_MAX_BYTES >> 20} MB、wav・flac は ${RAW_FILE_MAX_BYTES >> 20} MB まで）。使いたい所だけを切り出したファイルにしてください。`, `The file is too big (up to ${FILE_MAX_BYTES >> 20} MB for mp3, m4a and the like; ${RAW_FILE_MAX_BYTES >> 20} MB for wav and flac). Cut out just the part you want to use.`), true);
    return;
  }
  const my = ++refToken;
  showRef('analysing', M('ファイルを読んでいます…', 'Reading the file…'));
  let sound: { pcm: Float32Array; rate: number };
  try {
    sound = await decodeFile(f);
  } catch {
    if (my === refToken) showRef('failed', M('このファイルは読めませんでした。mp3・m4a・wav などの音声ファイルを選んでください。', 'This file could not be read. Choose a sound file such as mp3, m4a or wav.'), true);
    return;
  }
  /** 無音を足した写し（短いファイルの測り直し用） */
  let padded: Float32Array | null = null;
  try {
    const secs = sound.pcm.length / sound.rate;
    if (secs <= 40) {
      // 短いファイル: 測る所（Worker）で測る（画面を止めない）。セリフ用に、高さと大きさの時間の動きも出す
      const opts = { minVoicedSeconds: ONE_LINE_SECONDS, contour: true };
      // 声だけに切った音には、雑音を見分けるための静かな所が無い: 雑音とされたら、前後に無音を足して、もう一度測る
      // （measureAsync は渡した音を 0 で埋めるので、足した写しを先に作っておく）
      if (secs <= PAD_FILE_MAX_SECONDS) {
        const pad = Math.round(sound.rate * 0.3);
        padded = new Float32Array(sound.pcm.length + 2 * pad);
        padded.set(sound.pcm, pad);
      }
      let m = await measureAsync(sound.pcm, sound.rate, opts);
      let usedPad = false;
      if (padded && !m.ok && m.reason === 'noisy' && my === refToken) {
        m = await measureAsync(padded, sound.rate, opts);
        usedPad = true;
      }
      if (my !== refToken) return;
      if (!m.ok) {
        showRef('failed', () => failText(m.reason, m.info.voicedSeconds, true), true);
        return;
      }
      targetFrom(m, usedPad);
      return;
    }
    // 長いファイル: 30 秒ずつ測る（窓と窓の間で、画面を描く）
    const m = await measureLong(sound.pcm, sound.rate, {
      minVoicedSeconds: ONE_LINE_SECONDS,
      onProgress: (done, total) => {
        if (total <= 1 || my !== refToken) return;
        // 言葉を切り替えても、進み具合を出したままにする
        refMsg = M(`数字にしています… ${done} / ${total}`, `Measuring… ${done} / ${total}`);
        ref.status.textContent = refMsg();
      },
    });
    if (my !== refToken) return;
    if (!m.ok) {
      showRef('failed', () => failText(m.reason, m.voicedSeconds, true), true);
      return;
    }
    const part = m.seconds >= LONG_MAX_SECONDS ? M(`最初の ${LONG_MAX_SECONDS / 60} 分のうち、声 ${m.voicedSeconds.toFixed(1)} 秒分`, `${m.voicedSeconds.toFixed(1)} s of voice in the first ${LONG_MAX_SECONDS / 60} min`) : M(`声 ${m.voicedSeconds.toFixed(1)} 秒分`, `${m.voicedSeconds.toFixed(1)} s of voice`);
    const canReg = m.voicedSeconds >= REG_MIN_VOICED;
    setTarget(forLength(m.features, m.voicedSeconds), ref.name.value.trim(), part, canReg ? { quality: { voicedSeconds: m.voicedSeconds, gapTonal: m.gapTonal, snrDb: m.snrDb } } : undefined, undefined, m.voicedSeconds);
  } catch {
    // 測る途中の思わぬ誤り: 「ファイルを読んでいます…」のまま止まらないように、ボタンを戻して伝える
    if (my === refToken) showRef('failed', M('このファイルを数字にできませんでした。もう一度試すか、ほかのファイルを選んでください。', 'This file could not be measured. Try again, or choose another file.'), true);
  } finally {
    // 音はすぐ捨てる（測れた時も、途中で誤りが出た時も）
    sound.pcm.fill(0);
    padded?.fill(0);
  }
}

/** お手本のまとめの文（言葉を切り替えた時に出し直す） */
let summaryMsg: Msg = () => '';
function setTarget(features: Features, name: string, from: Msg, regInfo?: Target['reg'], contour?: Contour, voicedSeconds?: number, nameEn?: string): void {
  // 真似を録っている・計算している途中なら、止めて音を捨てる（マイクを開いたまま隠れないように）
  const stopped = mimStop();
  target = { features, name, ...(nameEn ? { nameEn } : {}), ...(regInfo ? { reg: regInfo } : {}), ...(contour ? { contour } : {}), ...(voicedSeconds !== undefined ? { voicedSeconds } : {}) };
  resetRegister(name);
  best = 0;
  tries = 0;
  $('result').hidden = true;
  const f = features;
  summaryMsg = () => {
    const ja = name ? `「${name}」` : '';
    const en = name ? `“${nameEn || name}”` : '';
    return contour
      ? t(`${ja ? `${ja}のセリフ` : 'セリフ'}をお手本にしました（${from()}）。セリフ真似: 抑揚とタイミングまで比べます。声の高さ ${formatFeature('pitch', f.pitch)}。`, `${en ? `A line by ${en}` : 'A line'} is the model (${from()}). Line mimic: intonation and timing are compared too. Pitch ${formatFeature('pitch', f.pitch)}.`)
      : t(`${ja ? `${ja}をお手本にしました` : 'お手本を測りました'}（${from()}）。声の高さ ${formatFeature('pitch', f.pitch)}・抑揚 ${formatFeature('pitchRange', f.pitchRange)}・速さ ${formatFeature('rate', f.rate)}。`, `${en ? `${en} is the model` : 'The model was measured'} (${from()}). Pitch ${formatFeature('pitch', f.pitch)}, intonation ${formatFeature('pitchRange', f.pitchRange)}, rate ${formatFeature('rate', f.rate)}.`);
  };
  ref.summary.textContent = summaryMsg();
  topicBox.hidden = !!contour;
  lineHint.hidden = !contour;
  showRef('ready', contour ? M('お手本の準備ができました。次は、同じセリフを真似して言ってください。', 'The model is ready. Next, say the same line, imitating it.') : M('お手本の準備ができました。次は、真似して話してください。', 'The model is ready. Next, talk imitating it.'));
  const next = contour ? M('「真似して話す」を押して、お手本と同じセリフを言ってください。', 'Press “Imitate” and say the same line as the model.') : M('「真似して話す」を押して、お手本のように話してください。', 'Press “Imitate” and talk like the model.');
  showMim('idle', stopped ? () => t('お手本が変わったので、真似を止めました（音は捨てました）。', 'The model changed, so the imitation was stopped (the sound was thrown away). ') + next() : next);
}

ref.mic.addEventListener('click', () => void refListen('mic'));
ref.tab.addEventListener('click', () => void refListen('tab'));
/** 音声ファイルを選ぶ画面を開いている間（その間に ?target= のお手本を勝手に選ばないように） */
let choosingFile = false;
ref.fileButton.addEventListener('click', () => {
  choosingFile = true;
  ref.file.click();
});
ref.file.addEventListener('change', () => {
  choosingFile = false;
  const f = ref.file.files?.[0];
  ref.file.value = '';
  if (f) {
    wanted = null;
    void refFromFile(f);
  } else autoPick();
});
// 選ぶ画面を、選ばずに閉じた時（この知らせが無い古いブラウザーでは、?target= のお手本を使わないまま）
ref.file.addEventListener('cancel', () => {
  choosingFile = false;
  autoPick();
});
ref.done.addEventListener('click', refFinish);
ref.cancel.addEventListener('click', refCancel);
ref.change.addEventListener('click', () => {
  target = null;
  $('result').hidden = true;
  showRef('idle', M('お手本の聞かせ方を選んでください。', 'Choose how to play the model.'));
  showMim('locked', M('先にお手本を聞かせてください。', 'Play the model first.'));
});
/* お手本の声をサイトに登録する（アキネーター方式。壁 ① をここで確かめ、送るのは利用者が Google フォームで） */
const regShort = $('reg-short');
const reg = {
  box: $<HTMLDetailsElement>('register'),
  name: $<HTMLInputElement>('reg-name'),
  group: $<HTMLInputElement>('reg-group'),
  kinds: $('reg-kinds'),
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
// 大枠のチェックボックス: ラベルには両方の言葉を書く（ページのほかの所と同じ）
reg.kinds.replaceChildren(
  ...KINDS.map((k) => {
    const box = el('input');
    box.type = 'checkbox';
    box.value = String(k.bit);
    const label = el('label', 'check');
    const ja = el('span', undefined, k.ja);
    ja.lang = 'ja';
    const en = el('span', undefined, k.en);
    en.lang = 'en';
    label.append(box, ' ', ja, en);
    return label;
  }),
);
const kindBoxes = () => [...reg.kinds.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
/** 「コピー」のボタン（コピーした後は「コピーしました」。送る内容が変わったら戻す） */
let copied = false;
function drawCopy(): void {
  reg.copy.textContent = copied ? t('コピーしました', 'Copied') : t('コピー', 'Copy');
}
/** 直してほしい所を出した時の、送る内容（言葉を切り替えた時に、今の言葉で出し直すため） */
let problemSub: ReturnType<typeof makeSubmission> | null = null;
function drawProblems(): void {
  const problems = problemSub ? checkSubmission(problemSub) : [];
  reg.problems.replaceChildren(...problems.map((p) => el('li', undefined, p.text)));
  reg.problems.hidden = !problems.length;
}
function resetRegister(name: string): void {
  reg.box.open = false;
  reg.name.value = name;
  reg.group.value = '';
  reg.link.value = '';
  reg.ok.checked = false;
  for (const b of kindBoxes()) b.checked = false;
  reg.problems.hidden = reg.out.hidden = true;
  reg.problems.replaceChildren();
  problemSub = null;
  reg.code.value = '';
  copied = false;
  drawCopy();
}
reg.make.addEventListener('click', () => {
  if (!target?.reg) return;
  const kinds = kindBoxes().reduce((m, b) => (b.checked ? m | (1 << Number(b.value)) : m), 0);
  const sub = makeSubmission({ name: reg.name.value, group: reg.group.value, kinds, link: reg.link.value, quality: target.reg.quality, features: target.features, consent: reg.ok.checked });
  const problems = checkSubmission(sub);
  problemSub = problems.length ? sub : null;
  drawProblems();
  reg.out.hidden = problems.length > 0;
  if (problems.length) return;
  const code = encodeSubmission(sub);
  if (code !== reg.code.value) {
    copied = false;
    drawCopy();
  }
  reg.code.value = code;
  if (SUBMIT_FORM.url) {
    reg.form.hidden = false;
    reg.form.href = SUBMIT_FORM.entry ? `${SUBMIT_FORM.url}?usp=pp_url&entry.${SUBMIT_FORM.entry}=${encodeURIComponent(code)}` : SUBMIT_FORM.url;
    howtoMsg = SUBMIT_FORM.entry ? M('「フォームを開く」で、送る内容が入ったフォームが開きます。そのまま送信してください。', '“Open the form” opens it with the entry filled in. Just send it.') : M('「コピー」してから「フォームを開く」で、送る内容を貼って送信してください。', 'Press “Copy”, then “Open the form”, paste the entry and send it.');
  } else {
    reg.form.hidden = true;
    howtoMsg = M('登録の受け付けは準備中です。もうしばらくお待ちください。', 'Adding voices is not open yet. Please wait a little longer.');
  }
  reg.howto.textContent = howtoMsg();
});
let howtoMsg: Msg = () => '';
reg.copy.addEventListener('click', () => {
  const code = reg.code.value;
  const done = () => {
    // コピーの間に送る内容が変わっていたら、「コピーしました」にしない
    if (reg.code.value !== code) return;
    copied = true;
    drawCopy();
  };
  navigator.clipboard?.writeText(code).then(done, () => {
    reg.code.select();
  }) ?? reg.code.select();
});

/* このサイトで事前に測ったお手本（名前で探して選ぶ。英語のページでは英語名で並べ、日本語の名前でも選べる） */
const labelOf = (id: string, l: Lang) => {
  const v = ENTRY_BY_ID.get(id)!;
  const g = groupOf(v, l);
  return g ? (l === 'en' ? `${nameOf(v, l)} (${g})` : `${v.name}（${g}）`) : nameOf(v, l);
};
const pickCatalog = (p: (typeof PROFILES)[number]) => {
  const v = ENTRY_BY_ID.get(p.id)!;
  // お手本を録っている・計算している途中なら、先に止めて音を捨てる
  if (isBusy(refState)) {
    refToken++;
    refAnalysingMic = false;
    refTake.stop();
    refTake.drop();
  }
  wanted = null;
  setTarget(p.features, v.name, M('このサイトで測った代表値', 'a voice measured by this site'), undefined, undefined, undefined, v.nameEn);
};
/** 声のページから来た時のお手本（?target=）。ファイルを選ぶ画面を開いている間は、閉じるまで待つ */
let wanted: (typeof PROFILES)[number] | null = null;
function autoPick(): void {
  if (!wanted || choosingFile) return;
  const p = wanted;
  wanted = null;
  if (!target && !isBusy(refState)) pickCatalog(p);
}
// 声は裏で読む。読み終えたら一覧が出る
let byLabel = new Map<string, (typeof PROFILES)[number]>();
ref.catalog.addEventListener('change', () => {
  const p = byLabel.get(ref.catalog.value.trim());
  if (!p) return;
  ref.catalog.value = '';
  pickCatalog(p);
});
/** お手本の一覧を、今の言葉で並べ直す */
function fillCatalogList(): void {
  byLabel = new Map(PROFILES.flatMap((p) => [[labelOf(p.id, 'ja'), p] as const, [labelOf(p.id, 'en'), p] as const]));
  const labels = PROFILES.map((p) => labelOf(p.id, lang)).sort((a, b) => a.localeCompare(b, lang));
  $('ref-catalog-list').replaceChildren(
    ...labels.map((label) => {
      const o = document.createElement('option');
      o.value = label;
      return o;
    }),
  );
}
if (tabAudioSupported()) ref.tab.hidden = ref.tabNote.hidden = false;
void voicesReady.then(() => {
  if (!PROFILES.length) return;
  fillCatalogList();
  ref.catalogBox.hidden = false;
  $('ref-catalog-count').textContent = t(`${PROFILES.length} 件`, `${PROFILES.length}`);
  // 声のページからのリンク: ?target=<名前>（いつも日本語の名前）
  const name = new URLSearchParams(location.search).get('target');
  const p = name ? PROFILES.find((x) => ENTRY_BY_ID.get(x.id)!.name === name) : undefined;
  // 読み終える前に、マイク・タブ・ファイルでお手本を聞かせはじめていたら、そちらを使う（ファイルを選ぶ画面を開いている間は、閉じるまで待つ）
  if (p && !target && !isBusy(refState)) {
    wanted = p;
    autoPick();
  }
});

/* ---- 2. 真似 ---- */
const topicBox = $('topic-box');
const lineHint = $('line-hint');
const topic = { label: $('topic-label'), text: $('topic-text'), next: $<HTMLButtonElement>('topic-next'), read: $<HTMLButtonElement>('topic-read') };
let prompt = nextPromptIndex(null);
let reading = false;
/** 決まった文の番号 */
let passage = nextReadingIndex(null);
function showTopic(): void {
  topic.label.textContent = reading ? t('決まった文（お手本の声で読んでください）', 'Set text (read it in the model’s voice)') : t('お題（お手本の声で話してください）', 'Prompt (talk in the model’s voice)');
  topic.text.textContent = reading ? readingText(passage) : promptText(prompt);
  topic.text.classList.toggle('reading', reading);
  topic.read.textContent = reading ? t('お題にもどす', 'Back to prompts') : t('決まった文を読む', 'Read a set text');
  topic.next.textContent = reading ? t('次の文', 'Next text') : t('次のお題', 'Next prompt');
}
topic.next.addEventListener('click', () => {
  if (reading) passage = nextReadingIndex(passage);
  else prompt = nextPromptIndex(prompt);
  showTopic();
});
topic.read.addEventListener('click', () => {
  reading = !reading;
  if (reading) passage = nextReadingIndex(passage);
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
const mimLive = createLiveAnalysis($('mim-live'));
const mimTake = new Take({ wave: createWave($<HTMLCanvasElement>('mim-wave')), live: mimLive, fill: $('mim-fill'), sec: $('mim-sec'), done: mim.done }, MIM_DONE_AFTER, false, () => mimFinish());

type MimState = 'locked' | 'idle' | 'asking' | 'listening' | 'analysing' | 'done' | 'failed';
let mimState: MimState = 'locked';
let mimToken = 0;

/** 真似の所を描く。`redraw` は言葉を切り替えた時（声の玉はそのまま） */
function showMim(next: MimState, msg: Msg, bad = false, redraw = false): void {
  mimState = next;
  mimMsg = msg;
  mimBad = bad;
  mim.stage.dataset.state = next;
  mimLive.mode(next === 'listening' ? 'listening' : next === 'analysing' ? 'analysing' : 'off');
  if (!redraw) orb.mode(ORB_MODE[next] ?? 'idle');
  lockMics();
  mim.status.textContent = msg();
  mim.status.classList.toggle('bad', bad);
  mim.start.hidden = !(next === 'locked' || next === 'idle' || next === 'failed' || next === 'done');
  mim.start.disabled = next === 'locked';
  mim.start.textContent = next === 'done' ? t('もう一度真似する', 'Imitate again') : t('真似して話す', 'Imitate');
  mim.done.textContent = t('話し終えた', 'Done');
  mim.cancel.textContent = t('やめる', 'Stop');
  mim.done.hidden = next !== 'listening';
  mim.cancel.hidden = !(next === 'listening' || next === 'asking');
  ref.change.disabled = next === 'asking' || next === 'listening' || next === 'analysing';
  topic.next.disabled = topic.read.disabled = next === 'asking' || next === 'listening' || next === 'analysing';
}

async function mimStart(): Promise<void> {
  if (!target) return;
  const my = ++mimToken;
  mimTake.drop();
  showMim('asking', M('マイクの許可を待っています…', 'Waiting for microphone permission…'));
  try {
    const m = await openMic(mimTake.onChunk, mimEnded, mics.get());
    if (my !== mimToken || mimState !== 'asking') {
      m.stop();
      return;
    }
    mimTake.begin(m);
    void mics.refresh();
    const label = m.label ?? '';
    const isLine = !!target.contour;
    showMim('listening', () => {
      const on = label ? t(`マイク: ${label}`, ` Microphone: ${label}`) : '';
      return isLine
        ? t(`お手本と同じセリフを、お手本のように言ってください。言い終えたら「話し終えた」を押してください。`, 'Say the same line as the model, imitating it. Press “Done” when you finish.') + on
        : t(`お手本のように話してください。一言でもかまいませんが、長く話すほど多くの項目で比べられます（最大 ${LISTEN_MAX} 秒）。`, `Talk like the model. A single phrase is fine, but the longer you talk, the more items are compared (up to ${LISTEN_MAX} s).`) + on;
    });
  } catch (e) {
    if (my !== mimToken) return;
    mimTake.stop();
    mimTake.drop();
    if ((e as { name?: string } | null)?.name === 'MicGoneError') mics.reset();
    showMim('failed', () => micErrorText(e), true);
  }
}

function mimFinish(): void {
  if (mimState !== 'listening' || !target) return;
  const got = mimTake.take();
  if (!got) {
    showMim('failed', M('声が届きませんでした。もう一度試してください。', 'No voice reached the page. Please try again.'), true);
    return;
  }
  showMim('analysing', M('計算しています…', 'Working it out…'));
  const my = mimToken;
  void Promise.all([measureAsync(got.pcm, got.rate, { minVoicedSeconds: ONE_LINE_SECONDS, contour: !!target.contour }), mimLive.analysing(ANALYSE_MS)]).then(([m]) => {
    if (my !== mimToken || mimState !== 'analysing' || !target) return;
    if (!m.ok) {
      showMim('failed', () => failText(m.reason, m.info.voicedSeconds, false), true);
      return;
    }
    if (!render(target, forLength(m.features, m.info.voicedSeconds), m.info.contour)) {
      showMim('failed', M('お手本と比べられる項目がありませんでした。お手本か声を測り直してください。', 'No item could be compared with the model. Measure the model or your voice again.'), true);
      return;
    }
    showMim('done', M('測りました。結果は下にあります。', 'Measured. The result is below.'));
    $('result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
}

/** 真似を録っている・計算している途中なら、止めて音を捨てる。止めたら true */
function mimStop(): boolean {
  if (!isBusy(mimState)) return false;
  mimToken++;
  mimTake.stop();
  mimTake.drop();
  return true;
}
function mimCancel(): void {
  mimToken++;
  mimTake.stop();
  mimTake.drop();
  showMim(target ? 'idle' : 'locked', M('やめました。音は捨てました。', 'Stopped. The sound was thrown away.'));
}
/** マイクが外れた時: 話し終えられる長さがあれば、そこまでで測る。無ければ止めて、そのことを伝える */
function mimEnded(): void {
  if (mimState !== 'listening') return;
  if (mimTake.seconds >= MIM_DONE_AFTER) {
    mimFinish();
    return;
  }
  mimToken++;
  mimTake.stop();
  mimTake.drop();
  showMim('failed', M('マイクが外れたので止めました。つなぎ直して、もう一度押してください。', 'The microphone went away, so this stopped. Plug it back in and press again.'), true);
}

mim.start.addEventListener('click', () => void mimStart());
mim.done.addEventListener('click', mimFinish);
mim.cancel.addEventListener('click', mimCancel);
document.addEventListener('visibilitychange', () => {
  // お手本を聞かせている時は止めない（ほかのタブやアプリで流すため。音が来ないまま WAIT_MAX 秒で止まる）
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
      return model ? t('お手本の音が聞こえませんでした。音量を上げるか、マイクの近くで流してください。', 'The model could not be heard. Turn the volume up or play it closer to the microphone.') : t('声が聞こえませんでした。マイクが消音になっていないか、使うマイクが合っているか確かめてください。', 'No voice was heard. Check that the microphone is not muted and that the right one is chosen.');
    case 'quiet':
      return model ? t('お手本の音が小さくて測れませんでした。音量を上げてください。', 'The model was too quiet to measure. Turn the volume up.') : t('声が小さくて測れませんでした。マイクに少し近づいて話してください。', 'The voice was too quiet to measure. Move a little closer to the microphone.');
    case 'noisy':
      return model ? t('お手本に、声のほかの音（BGM・効果音・雑音）が多くて測れませんでした。声だけの所を選んでください。', 'The model has too many other sounds (BGM, effects, noise). Choose a part with the voice alone.') : t('まわりの音が大きくて、声とうまく分けられませんでした。静かな所で、もう一度話してください。', 'The surroundings were too loud to separate the voice. Try again somewhere quiet.');
    case 'clipped':
      return model ? t('お手本の音が大きすぎて、割れていました。音量を少し下げてください。', 'The model was so loud that it distorted. Turn the volume down a little.') : t('声が大きすぎて、音が割れていました。マイクから少し離れてください。', 'The voice was so loud that it distorted. Move a little away from the microphone.');
    case 'short':
      return model
        ? t(`お手本の声を ${v} 秒分しか測れませんでした。声がはっきり聞こえるセリフを、1 つ以上流してください。`, `Only ${v} s of the model’s voice was measured. Play at least one line where the voice is clear.`)
        : t(`声を ${v} 秒分しか測れませんでした。「おはようございます」くらいの長さで、ささやかずに言ってください。`, `Only ${v} s of voice was measured. Say at least a short phrase, like “good morning everyone”, without whispering.`);
    default:
      return t('うまく数字にできませんでした。もう一度試してください。', 'It could not be measured. Please try again.');
  }
}

/* ---- 結果 ---- */
/** 点数: 輪（CSS の --score）と、数えあがる数字。動きを減らす設定では、すぐその数 */
function showScore(score: number): void {
  const gauge = $('gauge');
  const num = $('score');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 輪は毎回、まずすぐ 0 に戻し、それから点数まで満ちる
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
/** 出している結果（言葉を切り替えた時に出し直すため） */
let shown: { tg: Target; mine: Features; mineContour?: Contour; score: number; before: number } | null = null;
function render(tg: Target, mine: Features, mineContour?: Contour): boolean {
  const voice = mimicScore(tg.features, mine);
  const line = tg.contour && mineContour ? compareLines(tg.contour, mineContour) : null;
  if (!voice && !line) return false;
  const score = line ? lineScore(line, voice?.score ?? null) : voice!.score;
  tries++;
  const before = best;
  best = Math.max(best, score);
  shown = { tg, mine, ...(mineContour ? { mineContour } : {}), score, before };
  showScore(score);
  $('result').hidden = false;
  paint();
  return true;
}
/** 結果の言葉と図（今の言葉で。点数の数えあがりはしない） */
function paint(): void {
  if (!shown) return;
  const { tg, mine, mineContour, score, before } = shown;
  const voice = mimicScore(tg.features, mine);
  const line = tg.contour && mineContour ? compareLines(tg.contour, mineContour) : null;
  const tgName = nameOf(tg);
  $('score-label').textContent = t(`${tg.name ? `「${tg.name}」` : 'お手本'}との近さ${line ? '（セリフ真似）' : ''}`, `Closeness to ${tg.name ? `“${tgName}”` : 'the model'}${line ? ' (line mimic)' : ''}`);
  $('score-word').textContent = scoreWord(score);
  $('best').textContent = tries === 1 ? '' : score > before ? t(`最高点を更新しました（${tries} 回目）`, `New best! (try ${tries})`) : t(`このお手本での最高は ${best} 点です（${tries} 回目）`, `Your best with this model is ${best} (try ${tries})`);

  // セリフ真似: 点数の 3 つの内訳と、重ねた 2 本の高さの線
  const subs = $('subscores');
  subs.hidden = !line;
  $('line-box').hidden = !line;
  if (line) {
    const part = (id: string, v: number | null) => {
      const e = $(id);
      e.style.setProperty('--v', String(v ?? 0));
      e.querySelector('b')!.textContent = v === null ? '—' : String(v);
    };
    part('sub-into', line.intonation);
    part('sub-timing', line.timing);
    part('sub-voice', voice?.score ?? null);
    drawLineChart($('line-chart'), tg.contour!, line.warped);
    $('line-seconds').textContent = t(`${line.refSeconds.toFixed(1)} 秒`, `${line.refSeconds.toFixed(1)} s`);
  }

  const diffs = differences(tg.features, mine);
  const list = $('advice');
  list.replaceChildren();
  const tips: { text: string; why?: string }[] = [];
  for (const tip of (line?.tips ?? []).slice(0, 2)) tips.push({ text: tip.text });
  for (const tip of adviceFor(diffs, 3))
    tips.push({
      text: tip.text,
      why: t(`（${FEATURE_BY_KEY[tip.key].name}: お手本 ${formatFeature(tip.key, tg.features[tip.key])}・あなた ${formatFeature(tip.key, mine[tip.key])}）`, ` (${FEATURE_BY_KEY[tip.key].name}: model ${formatFeature(tip.key, tg.features[tip.key])}, you ${formatFeature(tip.key, mine[tip.key])})`),
    });
  if (!tips.length) list.append(el('li', undefined, line ? t('ほぼそろっています。次は、声の出し方の細かい所（息・響き）も寄せてみてください。', 'Nearly matched. Next, try matching the finer points too (breath and resonance).') : t('ほぼそろっています。次は、セリフ 1 つをお手本にして、言い回しや語尾も寄せてみてください。', 'Nearly matched. Next, use a single line as the model and match the phrasing and endings too.')));
  for (const tip of tips.slice(0, 3)) {
    const li = el('li');
    li.append(el('strong', undefined, tip.text));
    if (tip.why) li.append(el('span', 'why', tip.why));
    list.append(li);
  }

  renderGroups($('compare'), (d) => {
    const a = tg.features[d.key],
      b = mine[d.key];
    const value = el('div', 'value two');
    value.append(el('span', undefined, t(`お手本 ${formatFeature(d.key, a)}`, `Model ${formatFeature(d.key, a)}`)), el('span', undefined, t(`あなた ${formatFeature(d.key, b)}`, `You ${formatFeature(d.key, b)}`)));
    return itemRow(d, [{ value: a, cls: 'ref' }, { value: b }], value);
  });

  // 飾り（共有カード・声紋）は最後に。古いブラウザーで描けなくても、点数と直し方は出す
  decor(() => share.update({ kind: 'mimic', features: mine, model: { name: tgName, features: tg.features }, score, word: scoreWord(score), line: !!line }));
  decor(() =>
    mountShapes($('shapes'), $('shape-guide'), [
      { who: t('お手本', 'Model'), ...(tg.name ? { sub: tgName } : {}), f: tg.features },
      { who: t('あなた', 'You'), sub: t(`${tries} 回目`, `Try ${tries}`), f: mine },
    ]),
  );
}
/** 飾りを描く。描けない時は飛ばす（結果と案内は止めない） */
function decor(f: () => void): void {
  try {
    f();
  } catch {
    /* 描けない時は、その飾りだけ出さない */
  }
}

showRef('idle', M('お手本の聞かせ方を選んでください。', 'Choose how to play the model.'));
showMim('locked', M('先にお手本を聞かせてください。', 'Play the model first.'));

onLang(() => {
  showRef(refState, refMsg, refBad, true);
  showMim(mimState, mimMsg, mimBad, true);
  showTopic();
  if (target) ref.summary.textContent = summaryMsg();
  if (!reg.out.hidden) reg.howto.textContent = howtoMsg();
  drawCopy();
  if (problemSub) drawProblems();
  if (PROFILES.length) {
    $('ref-catalog-count').textContent = t(`${PROFILES.length} 件`, `${PROFILES.length}`);
    fillCatalogList();
  }
  if (!$('result').hidden) paint();
});
