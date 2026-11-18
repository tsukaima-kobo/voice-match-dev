// 声を登録するページ（register.html）: 公開されている声を聞かせる（マイク・ほかのタブの音・音声ファイル）→ 数字にする →
// 名前・所属・大枠・リンクを入れて、送る内容（数字と欄の中身だけ）を作る → 利用者が Google フォームで送る。
// 2026-11-18 に声真似の点数のページ（mimic.html）から分けた（声真似はマイクだけにしたが、登録はタブの音・ファイルの方が正しく測れるため）。
// 音はメモリーの中だけ。数字にしたらすぐ捨てる。どこにも送らない、端末にも残さない。
// 声を聞かせている間は、ほかのタブやアプリで動画を流せるよう、ページが隠れても止めない（音が来てから 35 秒で止まる。
// 音が来ないまま 60 秒たった時も止める）。マイクが外れた・タブの共有が止まった時は、聞かせ終えられる長さがあればそこまでで測る。
// 声から性別や年齢を判断しない。
import { micErrorText, openMic, openTabAudio, tabAudioSupported, tabErrorText, type Mic } from '../voice/listen.ts';
import type { MeasureFail, Measured } from '../voice/measure.ts';
import { LONG_MAX_SECONDS, measureLong } from '../voice/combine.ts';
import { createWave, type Wave } from '../voice/wave.ts';
import { createOrb, type OrbMode } from './orb.ts';
import { micPicker } from './mic-picker.ts';
import { createLiveAnalysis, type LiveAnalysis } from './live-analysis.ts';
import { measureAsync } from '../voice/measure-async.ts';
import { forLength, formatFeature, LONG_SECONDS, ONE_LINE_SECONDS, type Features } from '../voice/features.ts';
import { el } from './items.ts';
import { mountLang, onLang, t } from '../i18n.ts';
import { mountFooter, mountGithubLink } from './share.ts';
import { checkSubmission, encodeSubmission, makeSubmission } from '../submit/code.ts';
import { SUBMIT_FORM } from '../submit/config.ts';
import { KINDS } from '../data/kinds.ts';

/** 聞く長さの最大（秒） */
const LISTEN_MAX = 35;
/** 「聞かせ終えた」を押せるまで（秒） */
const REF_DONE_AFTER = 1;
/** 計算中の演出の長さ（ミリ秒）。その間に Worker が測る */
const ANALYSE_MS = 1500;
/** マイク・タブから測っている時だけ、解析パネルの計算中の演出を出す（ファイルの時は出さない） */
let refAnalysingMic = false;
/** 声の登録に要る声（秒。壁 ① と同じ） */
const REG_MIN_VOICED = LONG_SECONDS;
/** 雑音の床が分からない短いファイル（声だけを切り出した物）は、前後に無音を足して測り直す（その時は登録しない） */
const PAD_FILE_MAX_SECONDS = 15;
/**
 * 音声ファイルの大きさの上限。ファイルは、読むと全部がメモリーに乗る。mp3・m4a などは読むと 10 倍以上の大きさになる
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
export const FILE_RATE = 24000;
/** 声を聞かせる時、これより小さい音は「まだ始まっていない」として数えない（RMS） */
const START_RMS = 0.003;
/** 声を聞かせる時、音が来ないまま、これだけたったら止める（秒。マイク・タブの音を開いたままにしない） */
const WAIT_MAX = 60;

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
mountLang({ ja: '声を登録する｜voice-match', en: 'Add a voice | voice-match' });
mountGithubLink();
mountFooter();
/** 案内の文（今の言葉で作る関数。切り替えた時に作り直す） */
type Msg = () => string;
const M = (ja: string, en: string): Msg => () => t(ja, en);
/** 声の玉（見た目だけ） */
const orb = createOrb($('orb'));
const ORB_MODE: Record<string, OrbMode> = { listening: 'listening', analysing: 'analysing', ready: 'done' };
/** マイクを選ぶ所 */
const mics = micPicker([{ box: $('ref-mic-pick'), select: $<HTMLSelectElement>('ref-mic-select'), find: $<HTMLButtonElement>('ref-mic-find') }], (msg) => {
  refMsg = msg;
  refBad = true;
  ref.status.textContent = msg();
  ref.status.classList.add('bad');
});
const isBusy = (st: string) => st === 'asking' || st === 'listening' || st === 'analysing';
const lockMics = () => mics.lock(isBusy(refState));

/* ---- 録る ---- */
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
    // 描く繰り返しの中ではなく、ここで確かめる（声をほかのタブで流している間は、このページが隠れていることがある）
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

/* ---- 声を聞かせる ---- */
const ref = {
  stage: $('ref'),
  pick: $('ref-pick'),
  mic: $<HTMLButtonElement>('ref-mic'),
  tab: $<HTMLButtonElement>('ref-tab'),
  tabNote: $('ref-tab-note'),
  fileButton: $<HTMLButtonElement>('ref-file-button'),
  file: $<HTMLInputElement>('ref-file'),
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
/** 測った声。登録できる長さがあれば、登録に使う声の質も持つ */
interface Target {
  features: Features;
  reg?: { quality: { voicedSeconds: number; gapTonal: number; snrDb: number } };
  voicedSeconds: number;
  /** 声だけを切り出したファイルに、無音を足して測った（雑音との差が分からないので、登録には使わない） */
  padded?: boolean;
}
let target: Target | null = null;
let refKind: 'mic' | 'tab' = 'mic';

let refMsg: Msg = () => '',
  refBad = false;
/** 声の所を描く。`redraw` は言葉を切り替えた時（声の玉はそのまま） */
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
  const busy = isBusy(next);
  ref.pick.hidden = next === 'ready';
  for (const b of [ref.mic, ref.tab, ref.fileButton]) b.disabled = busy;
  ref.name.disabled = busy;
  ref.done.hidden = next !== 'listening';
  ref.cancel.hidden = !(next === 'listening' || next === 'asking');
  ref.change.hidden = next !== 'ready';
  ref.summary.hidden = next !== 'ready';
  reg.box.hidden = !(next === 'ready' && target?.reg);
  const short = next === 'ready' && !!target && !target.reg;
  regShort.hidden = !short;
  // 無音を足して測ったファイルは、声が足りていても登録できない（「声が足りない」と出さない）
  if (short && target!.padded && target!.voicedSeconds >= REG_MIN_VOICED) regShort.textContent = t('声だけを切り出したファイルなので、雑音の大きさが分からず、登録には使えません。声の前後の静かな所も入ったファイルにすると、登録できます。', 'This file has only the voice cut out, so the noise level cannot be told and it cannot be used to add the voice. Use a file that also has the quiet parts before and after the voice.');
  else if (short) regShort.textContent = t(`登録するには、声が ${REG_MIN_VOICED} 秒以上いります（今は ${target!.voicedSeconds.toFixed(1)} 秒）。セリフをいくつか続けて聞かせてください。`, `To add the voice, ${REG_MIN_VOICED} s of voice is needed (now ${target!.voicedSeconds.toFixed(1)} s). Play several lines in a row.`);
  ref.done.textContent = t('聞かせ終えた', 'Done');
  ref.cancel.textContent = t('やめる', 'Stop');
  ref.change.textContent = t('ほかの声にする', 'Use another voice');
}

async function refListen(kind: 'mic' | 'tab'): Promise<void> {
  const my = ++refToken;
  refKind = kind;
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
            `声を流して、マイクに聞かせてください。音が聞こえたら数えはじめます。声が 8 秒以上いります。流し終えたら「聞かせ終えた」を押してください（最大 ${LISTEN_MAX} 秒）。${label ? `マイク: ${label}` : ''}`,
            `Play the voice to the microphone. Counting starts when sound is heard. At least 8 s of voice is needed. Press “Done” when it ends (up to ${LISTEN_MAX} s).${label ? ` Microphone: ${label}` : ''}`,
          )
        : t(
            `選んだタブで、声を再生してください。流し終えたら動画を止めて、このページで「聞かせ終えた」を押してください（音が来てから ${LISTEN_MAX} 秒で止まります）。`,
            `Play the voice in the chosen tab. When it ends, pause the video and press “Done” on this page (it stops ${LISTEN_MAX} s after the sound starts).`,
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
    showRef('failed', M('音が届きませんでした。音量を上げて、もう一度試してください。', 'No sound reached the page. Turn the volume up and try again.'), true);
    return;
  }
  refAnalysingMic = true;
  showRef('analysing', M('声を計算しています…', 'Working out the voice…'));
  const my = refToken;
  void Promise.all([measureAsync(got.pcm, got.rate, { minVoicedSeconds: ONE_LINE_SECONDS }), refLive.analysing(ANALYSE_MS)]).then(([m]) => {
    refAnalysingMic = false;
    if (my !== refToken || refState !== 'analysing') return;
    if (!m.ok) {
      showRef('failed', () => failText(m.reason, m.info.voicedSeconds, true), true);
      return;
    }
    targetFrom(m, false);
  });
}

/** 測った声から Target を作る（登録は、声が足りて、無音を足していない時だけ） */
function targetFrom(m: Extract<Measured, { ok: true }>, padded: boolean): void {
  const i = m.info;
  const canReg = !padded && i.voicedSeconds >= REG_MIN_VOICED;
  setTarget(forLength(m.features, i.voicedSeconds), M(`声 ${i.voicedSeconds.toFixed(1)} 秒分`, `${i.voicedSeconds.toFixed(1)} s of voice`), canReg ? { quality: { voicedSeconds: i.voicedSeconds, gapTonal: i.gapTonal, snrDb: i.loudDb - i.floorDb } } : undefined, i.voicedSeconds, padded);
}

/** まとめの文（言葉を切り替えた時に出し直す） */
let summaryMsg: Msg = () => '';
function setTarget(features: Features, from: Msg, regInfo: Target['reg'] | undefined, voicedSeconds: number, padded = false): void {
  target = { features, voicedSeconds, ...(regInfo ? { reg: regInfo } : {}), ...(padded ? { padded } : {}) };
  resetRegister(ref.name.value.trim());
  const f = features;
  summaryMsg = () => t(`声を測りました（${from()}）。声の高さ ${formatFeature('pitch', f.pitch)}・抑揚 ${formatFeature('pitchRange', f.pitchRange)}・速さ ${formatFeature('rate', f.rate)}。`, `The voice was measured (${from()}). Pitch ${formatFeature('pitch', f.pitch)}, intonation ${formatFeature('pitchRange', f.pitchRange)}, rate ${formatFeature('rate', f.rate)}.`);
  ref.summary.textContent = summaryMsg();
  showRef('ready', regInfo ? M('測りました。下の欄を入れて、送る内容を作ってください。', 'Measured. Fill in the form below and make the entry.') : M('測りました。', 'Measured.'));
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
  showRef('idle', M('声の聞かせ方を選んでください。', 'Choose how to play the voice.'));
});
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
      : M('タブの共有が止まったので止めました。もう一度押して、声のタブを選んでください。', 'Sharing the tab stopped, so this stopped. Press again and choose the tab with the voice.'),
    true,
  );
}
/** 音が来ないまま WAIT_MAX 秒たった時: 止めて伝える（マイク・タブの音を開いたままにしない） */
function refQuiet(): void {
  if (refState !== 'listening') return;
  refStop();
  showRef('failed', M(`音が聞こえないまま ${WAIT_MAX} 秒たったので止めました。声を流せるようにしてから、もう一度押してください。`, `No sound was heard for ${WAIT_MAX} s, so this stopped. Get the voice ready to play, then press again.`), true);
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
      // 短いファイル: 測る所（Worker）で測る（画面を止めない）
      const opts = { minVoicedSeconds: ONE_LINE_SECONDS };
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
    setTarget(forLength(m.features, m.voicedSeconds), part, canReg ? { quality: { voicedSeconds: m.voicedSeconds, gapTonal: m.gapTonal, snrDb: m.snrDb } } : undefined, m.voicedSeconds);
  } catch {
    // 測る途中の思わぬ誤り: 「ファイルを読んでいます…」のまま止まらないように、ボタンを戻して伝える
    if (my === refToken) showRef('failed', M('このファイルを数字にできませんでした。もう一度試すか、ほかのファイルを選んでください。', 'This file could not be measured. Try again, or choose another file.'), true);
  } finally {
    // 音はすぐ捨てる（測れた時も、途中で誤りが出た時も）
    sound.pcm.fill(0);
    padded?.fill(0);
  }
}

/* 声をサイトに登録する（アキネーター方式。壁 ① をここで確かめ、送るのは利用者が Google フォームで） */
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
// 送る内容を作った後に欄を変えたら、前の送る内容とフォームのリンクを隠す（作り直すまで、前の名前などのまま送らないように）
for (const type of ['input', 'change'])
  reg.box.addEventListener(type, (e) => {
    if (e.target !== reg.code) reg.out.hidden = true;
  });
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
  reg.box.open = true;
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

if (tabAudioSupported()) ref.tab.hidden = ref.tabNote.hidden = false;

// ページを離れる時は止めて、音を捨てる。戻るで戻った時に「聞いています」のまま止まって見えないよう、画面も戻す
// （タブを切り替えただけでは来ない。声をほかのタブで流している間は止めない）
window.addEventListener('pagehide', () => {
  if (refState === 'asking' || refState === 'listening') refCancel();
  else refTake.stop();
});

function failText(reason: MeasureFail, voiced: number | undefined, _model = true): string {
  const v = (voiced ?? 0).toFixed(1);
  switch (reason) {
    case 'silent':
      return t('音が聞こえませんでした。音量を上げるか、マイクの近くで流してください。', 'Nothing could be heard. Turn the volume up or play it closer to the microphone.');
    case 'quiet':
      return t('音が小さくて測れませんでした。音量を上げてください。', 'It was too quiet to measure. Turn the volume up.');
    case 'noisy':
      // ほかの音のほか、静かな所でも、息の多い声・ささやき声でこうなる。ほかの音が多いとは言い切らない
      return t('声をはっきり聞き取れませんでした。BGM・効果音・雑音や、息の多い声・ささやき声だと、こうなることがあります。声がはっきりした、声だけの所を選んでください。', 'The voice could not be picked out clearly. BGM, sound effects, noise, or a breathy or whispered voice can cause this. Choose a part where the voice is clear and alone.');
    case 'clipped':
      return t('音が大きすぎて、割れていました。音量を少し下げてください。', 'It was so loud that it distorted. Turn the volume down a little.');
    case 'short':
      return t(`声を ${v} 秒分しか測れませんでした。声がはっきり聞こえるセリフを、いくつか続けて流してください。`, `Only ${v} s of voice was measured. Play several lines in a row where the voice is clear.`);
    default:
      return t('うまく数字にできませんでした。もう一度試してください。', 'It could not be measured. Please try again.');
  }
}

showRef('idle', M('声の聞かせ方を選んでください。', 'Choose how to play the voice.'));

onLang(() => {
  showRef(refState, refMsg, refBad, true);
  if (target) ref.summary.textContent = summaryMsg();
  if (!reg.out.hidden) reg.howto.textContent = howtoMsg();
  drawCopy();
  if (problemSub) drawProblems();
});
