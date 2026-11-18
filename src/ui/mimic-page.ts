// 声真似練習場（mimic.html）: マイクでお手本を録る → 何回でも聞き直す → 順番に真似して話す → 近さの点数・直し方・点数表。
// 2026-11-18 からゲームにした（運営「ゲーム感覚の場所に。お手本もマイクから直接取る方式のみ。マイクによって差が出ちゃうから」）。
//   遊び方: 「声真似」（お手本の声を真似する）と「逆再生チャレンジ」（逆再生した言葉を真似し、録った声を逆にして元の言葉と比べる）。
//   人: 何人でも（MAX_PLAYERS まで）順番に。点数表は、お手本ごとの最高点を足して合計にする。配信・コラボ向けに、キーボードでも遊べる。
//   ノイズカット: なし・小（RNNoise）・大（Demucs。WebGPU のパソコンだけ）から 1 つ。src/voice/clean.ts。2 つ重ねると声が崩れるので、重ねない。
//     お手本と真似の両方に、同じ物をかける（お手本を録った時の選び方を、そのお手本の間ずっと使う。変えた物は次のお手本から）。
// お手本が 1 つのセリフ（話しはじめから終わりまで LINE_MAX_SECONDS 以内）なら「セリフ真似」: 抑揚・タイミング（mimic/line.ts）と
// 声の質（mimic.ts）で比べ、2 本の線を重ねた図を出す。それより長いお手本は「声全体」: 声の数字だけで比べる。
// 音（お手本と真似）は、このページを開いている間だけメモリーに置き、何回でも聞き直せる（運営「その音声を利用者のブラウザのキャッシュに
// 持って、離れる時に消えるように」）。端末に書き込む所（localStorage・IndexedDB など）には置かない。ページを離れる時（pagehide）に
// 0 で埋めて捨てる。どこにも送らない。点数表と名前もメモリーだけ。
// お手本を録っている間は、ほかのタブやアプリで動画を流してマイクに聞かせられるよう、ページが隠れても止めない（音が来てから 35 秒で
// 止まる。音が来ないまま 60 秒たった時も止める）。真似して話す時は、ページが隠れたらすぐ止める。
// 声の登録は、声を登録するページ（register.html）に分けた（タブの音・音声ファイルも使えるように）。
// 画面（2026-11-18、運営「ゲーム画面は逆再生キングみたいに、文字は下の方に隠して遊びやすい形に」）: 遊ぶ所を 1 つの大きな枠（#game）に
// まとめ、段階（data-phase）で中身を入れ替える。ref = お手本を録る、mim = 聞いて真似する、result = 点数。今することは短い 1 行（#cue）
// だけにして字幕のように下に出し、説明・設定・くわしい結果は、下の折りたたみ（.more）に置く。点数は、数えあがる数字・ランク・
// お手本とあなたの高さの線を重ねた図（2026-11-19、運営が示した配信の動画を見て、遊び方の作りだけを取った）。名前・絵・見た目は、ほかのゲームから写さない。
// 声から性別や年齢を判断しない。お題のランダムはお題の選び方だけ。
import { micErrorText, openMic, type Mic } from '../voice/listen.ts';
import type { MeasureFail, Measured } from '../voice/measure.ts';
import { createWave, type Wave } from '../voice/wave.ts';
import { createOrb, type OrbMode } from './orb.ts';
import { micPicker } from './mic-picker.ts';
import { createLiveAnalysis, type LiveAnalysis } from './live-analysis.ts';
import { measureAsync } from '../voice/measure-async.ts';
import { FEATURE_BY_KEY, forLength, formatFeature, ONE_LINE_SECONDS, type Features } from '../voice/features.ts';
import type { Contour } from '../voice/measure.ts';
import { compareLines, LINE_MAX_SECONDS, lineScore } from '../mimic/line.ts';
import { drawLineChart } from './line-chart.ts';
import { mountShapes } from './voiceprint.ts';
import { el, itemRow, renderGroups } from './items.ts';
import { adviceFor, differences, mimicScore, scoreRank, scoreWord } from '../mimic/mimic.ts';
import { nextPromptIndex, nextReadingIndex, promptText, readingText } from '../prompts/prompts.ts';
import { mountLang, onLang, t } from '../i18n.ts';
import { mountFooter, mountGithubLink, mountShare } from './share.ts';
import { cleanAudio, musicSupport, type CleanChoice, type CleanStage, type MusicSupport } from '../voice/clean.ts';
import { createPlayback, reversed, type Clip } from './playback.ts';

/** 録る長さの最大（秒） */
const LISTEN_MAX = 35;
/** 「録り終えた」「話し終えた」を押せるまで（秒） */
const REF_DONE_AFTER = 1;
const MIM_DONE_AFTER = 1;
/** 計算中の演出の長さ（ミリ秒）。その間に Worker が測る */
const ANALYSE_MS = 1500;
/** お手本を録る時、これより小さい音は「まだ始まっていない」として数えない（RMS） */
const START_RMS = 0.003;
/**
 * ただし、マイクの音が全体に小さい時（入力レベルが低い・離れたマイク）は、それまでの静かな所（いちばん小さかった塊）より
 * START_OVER_FLOOR 倍（約 16 dB）大きければ始める（START_MIN_RMS より小さい音では始めない）。静かな所を START_FLOOR_CHUNKS 個見てから
 */
const START_MIN_RMS = 0.0002;
const START_OVER_FLOOR = 6;
const START_FLOOR_CHUNKS = 4;
/** お手本を録る時、音が来ないまま、これだけたったら止める（秒。マイクを開いたままにしない） */
const WAIT_MAX = 60;
/** 挑戦する人の数の上限 */
const MAX_PLAYERS = 8;
/**
 * 声真似で測る、いちばん短い声（秒）と、取れた声の周期の数の下限。「はい」「えっ」のような一言（声は 0.2 秒ほど・周期 40 ほど）も測る。
 * 声の項目のうち一言で測れる物（features.ts の ONE_LINE_SECONDS の物）は、これより長ければ使う。3 秒・8 秒から測る項目は今までどおり
 */
const WORD_SECONDS = 0.15;
const WORD_CYCLES = 20;
/** 声真似で使う項目（一言で測れる物は、声が WORD_SECONDS 以上あれば使う）。0.4 秒より長い声では forLength と同じ */
const wordFeatures = (f: Features, voiced: number): Features => forLength(f, Math.max(voiced, ONE_LINE_SECONDS));
/**
 * 小さいだけの音（measure.ts の quiet）は、雑音の床より LIFT_SNR_DB（measure.ts の MIN_SNR_DB と同じ）以上大きければ、
 * いちばん大きい所を LIFT_TO_DB まで上げて測り直す。点数に使う項目は、音の大きさで変わらない（雑音との差は、上げても同じ）
 */
const LIFT_SNR_DB = 15;
const LIFT_TO_DB = -30;
/** 最後に録った時のマイクの名前（音が小さい・聞こえない時に出す） */
let micUsed = '';

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
mountLang({ ja: '声真似練習場｜voice-match', en: 'Voice-mimic studio | voice-match' });
mountGithubLink();
mountFooter();
/** 結果のシェア（X など） */
const share = mountShare($('share'));
/** 案内の文（今の言葉で作る関数。切り替えた時に作り直す） */
type Msg = () => string;
const M = (ja: string, en: string): Msg => () => t(ja, en);
/** 声の玉（お手本と真似の両方で使う。見た目だけ） */
const orb = createOrb($('orb'));
const ORB_MODE: Record<string, OrbMode> = { listening: 'listening', cleaning: 'analysing', analysing: 'analysing', ready: 'done', done: 'done' };
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollTo = (e: HTMLElement) => e.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'start' });
/** 遊ぶ所の枠（段階で中身を入れ替える） */
const game = $('game');
/** 何も出さない案内 */
const NONE: Msg = () => '';

/* ---- 遊び方 ---- */
type Mode = 'mimic' | 'reverse';
const modeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="mode"]')];
let mode: Mode = 'mimic';

/* ---- 挑戦する人と点数表（メモリーだけ） ---- */
interface Player {
  id: number;
  name: string;
  /** 今のお手本での最高点（まだ無ければ null） */
  best: number | null;
  /** 今のお手本で真似した回数 */
  roundTries: number;
  /** 前のお手本までの最高点の合計 */
  total: number;
  /** 真似した回数（全部） */
  tries: number;
  /** 最後に真似した声（聞き直す用。録ったままの向き） */
  last: Clip | null;
  /** last が逆再生チャレンジの声か（点数表の ▶ では、逆にして、比べた向きで鳴らす） */
  lastReverse: boolean;
}
let nextPlayerId = 1;
const newPlayer = (name: string): Player => ({ id: nextPlayerId++, name, best: null, roundTries: 0, total: 0, tries: 0, last: null, lastReverse: false });
/** 名前を入れずに始めた時の 1 人目（言葉を切り替えたら、その言葉に） */
let defaultNamed = true;
const players: Player[] = [newPlayer(t('あなた', 'You'))];
let turn = 0;
const current = () => players[Math.min(turn, players.length - 1)]!;
const playerList = $('players');
const playerAdd = $<HTMLFormElement>('player-add');
const playerName = $<HTMLInputElement>('player-name');

/** お手本が変わった・遊び方を変えた時: 今のお手本での最高点を合計に入れる */
function endRound(): void {
  for (const p of players) {
    p.total += p.best ?? 0;
    p.best = null;
    p.roundTries = 0;
  }
}

function drawPlayers(): void {
  const busy = isBusy(refState) || isBusy(mimState);
  playerList.replaceChildren(
    ...players.map((p, i) => {
      // 1 人の時は「の番」・番号・枠の色を出さない（対戦の相手がいるように見えた。人を足した時だけ、同じ画面で順番に回す）
      const many = players.length > 1;
      const li = el('li', many && i === turn ? 'player now' : 'player');
      const pick = el('button', 'player-pick');
      pick.type = 'button';
      pick.disabled = busy;
      if (many) pick.append(el('span', 'player-no', String(i + 1)));
      pick.append(el('span', 'player-name', p.name));
      if (many && i === turn) pick.append(el('span', 'player-turn', t('の番', '’s turn')));
      if (many) {
        pick.setAttribute('aria-pressed', String(i === turn));
        pick.title = t(`${p.name}の番にする`, `Make it ${p.name}’s turn`);
      }
      pick.addEventListener('click', () => {
        turn = i;
        drawPlayers();
        drawTurn();
      });
      li.append(pick);
      if (players.length > 1) {
        const del = el('button', 'player-del', '×');
        del.type = 'button';
        del.disabled = busy;
        del.setAttribute('aria-label', t(`${p.name}を外す`, `Remove ${p.name}`));
        del.addEventListener('click', () => {
          players.splice(i, 1);
          if (p.last) p.last.pcm.fill(0);
          if (shown?.who === p) shown.clip = null;
          if (turn > i || turn >= players.length) turn = Math.max(0, turn - 1);
          drawPlayers();
          drawTurn();
          drawBoard();
        });
        li.append(del);
      }
      return li;
    }),
  );
  const full = players.length >= MAX_PLAYERS;
  playerName.disabled = full || busy;
  $<HTMLButtonElement>('player-add-button').disabled = full || busy;
}
playerAdd.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = playerName.value.trim().slice(0, 20);
  if (!name || players.length >= MAX_PLAYERS) return;
  // 1 人目が名前の無いまま（あなた）で、まだ誰も真似していなければ、1 人目をこの名前にする
  if (players.length === 1 && defaultNamed && players[0]!.tries === 0) {
    players[0]!.name = name;
    defaultNamed = false;
  } else players.push(newPlayer(name));
  playerName.value = '';
  drawPlayers();
  drawTurn();
  drawBoard();
});

const turnBox = $('turn');
function drawTurn(): void {
  const p = current();
  turnBox.hidden = players.length < 2;
  turnBox.replaceChildren(el('span', 'turn-label', t('今の番', 'Now playing')), el('strong', 'turn-name', p.name), el('span', 'turn-count', t(`${turn + 1} 人目 / ${players.length} 人`, `${turn + 1} of ${players.length}`)));
  nextBtn.hidden = players.length < 2;
}

/** 点数表（いつも出す。まだ真似していない人は、順位を「—」に） */
function drawBoard(): void {
  const any = players.some((p) => p.tries > 0);
  $<HTMLButtonElement>('board-clear').disabled = !any;
  const rows = players.map((p) => ({ p, sum: p.total + (p.best ?? 0) })).sort((a, b) => b.sum - a.sum || (b.p.best ?? -1) - (a.p.best ?? -1) || Number(b.p.tries > 0) - Number(a.p.tries > 0));
  let rank = 0;
  let prev = Number.NaN;
  $('board-body').replaceChildren(
    ...rows.map(({ p, sum }, i) => {
      if (sum !== prev) rank = i + 1;
      prev = sum;
      const tr = el('tr', p === current() ? 'now' : undefined);
      tr.append(el('td', 'rank', p.tries > 0 ? String(rank) : '—'), el('td', 'who', p.name), el('td', 'num', p.best === null ? '—' : String(p.best)), el('td', 'num', String(sum)), el('td', 'num', String(p.tries)));
      const cell = el('td');
      if (p.last) {
        const b = el('button', 'board-play');
        b.type = 'button';
        b.dataset.play = `p${p.id}`;
        cell.append(b);
      }
      tr.append(cell);
      return tr;
    }),
  );
  drawPlay();
}
$('board-clear').addEventListener('click', () => {
  for (const p of players) {
    p.best = null;
    p.roundTries = 0;
    p.total = 0;
    p.tries = 0;
    p.last?.pcm.fill(0);
    p.last = null;
  }
  if (shown) shown.clip = null;
  playback.stop();
  drawBoard();
});

/* ---- ノイズカット（なし・小・大から 1 つ。2 つ重ねると声が崩れるので、重ねない） ---- */
const cleanInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="clean"]')];
const cleanBig = $<HTMLInputElement>('clean-big');
const cleanBigLabel = $('clean-big-label');
const cleanNote = $('clean-note');
let music: MusicSupport | null = null;
const cleanLevel = () => cleanInputs.find((r) => r.checked)?.value ?? 'off';
const choiceNow = (): CleanChoice => {
  const v = cleanLevel();
  return { denoise: v === 'small', music: v === 'big' && !!music?.ok };
};
const choiceText = (c: CleanChoice) => (c.music ? t('ノイズカット 大', 'strong noise cut') : c.denoise ? t('ノイズカット 小', 'light noise cut') : t('ノイズカットなし', 'no noise cut'));
/** 属性の title を、日本語と英語の両方で置き換える（言葉を切り替えても合うように） */
function setTitle(e: HTMLElement, ja: string, en: string): void {
  e.setAttribute('data-ja-title', ja);
  e.setAttribute('data-en-title', en);
  e.title = t(ja, en);
}
/** ノイズカットの短い注意（くわしい説明は、下の折りたたみ） */
function drawClean(): void {
  const notes: string[] = [];
  if (music && !music.ok) {
    if (music.why === 'gpu') setTitle(cleanBigLabel, 'ノイズカットの「大」は、このブラウザーでは使えません（WebGPU のパソコンの Chrome・Edge など）', '“Strong” noise cut is not available in this browser (needs WebGPU: Chrome, Edge… on a computer)');
    else setTitle(cleanBigLabel, 'ノイズカットの「大」の AI が、まだこのサイトにありません', 'The AI for “Strong” noise cut is not on this site yet');
  } else if (music?.ok && cleanLevel() === 'big' && !model) notes.push(t(`「大」は、最初の 1 回だけ AI（約 ${Math.round(music.bytes / 1e6)} MB）を読みます。音は送りません`, `“Strong” reads the AI (about ${Math.round(music.bytes / 1e6)} MB) the first time only. No sound is sent`));
  if (model) {
    const now = choiceNow();
    const same = now.denoise === model.clean.denoise && now.music === model.clean.music;
    if (!same) notes.push(t(`今のお手本は「${choiceText(model.clean)}」。変えた物は、次のお手本から`, `This model uses “${choiceText(model.clean)}”. Changes apply from the next model`));
  }
  cleanNote.textContent = notes.join(t('。', '. '));
  cleanNote.hidden = !notes.length;
}
cleanBig.disabled = true;
void musicSupport().then((s) => {
  music = s;
  if (!s.ok && cleanBig.checked) cleanInputs.find((r) => r.value === 'off')!.checked = true;
  lockAll();
  drawClean();
});
for (const c of cleanInputs) c.addEventListener('change', drawClean);

/** 音をきれいにしている間の文（言葉を切り替えても出したままにする） */
function cleanMsg(stage: CleanStage, done: number, total: number): Msg {
  switch (stage) {
    case 'download':
      return M(`ノイズカット（大）の AI を読んでいます… ${Math.floor((done / total) * 100)}%（最初の 1 回だけ）`, `Loading the AI for strong noise cut… ${Math.floor((done / total) * 100)}% (first time only)`);
    case 'prepare':
      return M(`ノイズカット（大）の AI を用意しています… ${done} / ${total}`, `Getting the AI for strong noise cut ready… ${done} / ${total}`);
    case 'separate':
      return M(`ノイズカット（大）をかけています… ${done} / ${total}`, `Applying strong noise cut… ${done} / ${total}`);
    default:
      return M('ノイズカット（小）をかけています…', 'Applying light noise cut…');
  }
}

/* ---- マイク ---- */
const mics = micPicker([{ box: $('mic-pick'), select: $<HTMLSelectElement>('mic-select'), find: $<HTMLButtonElement>('mic-find') }], (msg) => {
  const st = mimState === 'locked' ? ref.status : mim.status;
  if (mimState === 'locked') {
    refMsg = msg;
    refBad = true;
  } else {
    mimMsg = msg;
    mimBad = true;
  }
  st.textContent = msg();
  st.classList.add('bad');
});
const isBusy = (st: string) => st === 'asking' || st === 'listening' || st === 'cleaning' || st === 'analysing';
function lockAll(): void {
  const busy = isBusy(refState) || isBusy(mimState);
  mics.lock(busy);
  for (const r of modeInputs) r.disabled = busy;
  for (const r of cleanInputs) r.disabled = busy || (r === cleanBig && !music?.ok);
  drawPlayers();
  drawPlay();
}

/* ---- 配信向けの表示（このタブを閉じるまで覚える） ---- */
const STREAM_KEY = 'voice-match-stream-view';
const streamView = $<HTMLInputElement>('stream-view');
try {
  streamView.checked = sessionStorage.getItem(STREAM_KEY) === '1';
} catch {
  /* 覚えられない */
}
const applyStream = () => document.body.classList.toggle('stream-view', streamView.checked);
streamView.addEventListener('change', () => {
  applyStream();
  try {
    if (streamView.checked) sessionStorage.setItem(STREAM_KEY, '1');
    else sessionStorage.removeItem(STREAM_KEY);
  } catch {
    /* 覚えられない */
  }
});
applyStream();

/* ---- 聞き直す ---- */
const playback = createPlayback(() => drawPlay());
/** 聞き直すボタン（data-play の key ごと）の文字 */
function playLabel(key: string): string {
  const rev = mode === 'reverse';
  switch (key) {
    case 'model':
      return rev ? t('▶ 逆再生を聞く', '▶ Play reversed') : t('▶ お手本を聞く', '▶ Play the model');
    case 'original':
      return t('▶ 元の言葉を聞く（答え）', '▶ Play the original word (answer)');
    case 'mine':
      return rev ? t('▶ 自分の声（そのまま）', '▶ My voice (as recorded)') : t('▶ 自分の声', '▶ My voice');
    case 'mine-rev':
      return t('▶ 逆にした自分の声', '▶ My voice reversed');
    default:
      return '▶';
  }
}
/** 鳴らす物（key から） */
function clipOf(key: string): { clip: Clip; reverse: boolean } | null {
  if (key === 'model' && model) return { clip: model.clip, reverse: mode === 'reverse' };
  if (key === 'original' && model) return { clip: model.clip, reverse: false };
  if ((key === 'mine' || key === 'mine-rev') && shown?.clip) return { clip: shown.clip, reverse: key === 'mine-rev' };
  if (key.startsWith('p')) {
    const p = players.find((x) => `p${x.id}` === key);
    if (p?.last) return { clip: p.last, reverse: p.lastReverse };
  }
  return null;
}
function drawPlay(): void {
  // 録っている間は鳴らさない（マイクに入るため）
  const recording = refState === 'asking' || refState === 'listening' || mimState === 'asking' || mimState === 'listening';
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-play]')) {
    const key = b.dataset.play!;
    const on = playback.playing === key;
    b.textContent = on ? t('■ 止める', '■ Stop') : playLabel(key);
    b.classList.toggle('playing', on);
    b.disabled = recording || !clipOf(key);
  }
}
function togglePlay(key: string): void {
  if (playback.playing === key) {
    playback.stop();
    return;
  }
  const c = clipOf(key);
  if (c) playback.play(key, c.clip, c.reverse);
}
document.addEventListener('click', (e) => {
  const b = (e.target as Element | null)?.closest<HTMLButtonElement>('button[data-play]');
  if (b && !b.disabled) togglePlay(b.dataset.play!);
});

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
  /** 待っている間の、いちばん小さかった塊の大きさ（RMS。全く 0 の塊は数えない）と、見た塊の数 */
  private floor = Infinity;
  private floorChunks = 0;
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
    if (this.waitForSound && this.got === 0) {
      const r = rms(x);
      const overFloor = this.floorChunks >= START_FLOOR_CHUNKS && r >= START_MIN_RMS && r >= this.floor * START_OVER_FLOOR;
      if (r < START_RMS && !overFloor) {
        if (r > 1e-7) {
          this.floor = Math.min(this.floor, r);
          this.floorChunks++;
        }
        // 音が来ないまま WAIT_MAX 秒たったら止める（ページが隠れていても、届いた音の長さで数える）
        this.waited += x.length;
        if (this.waited / this.rate >= WAIT_MAX) this.onQuiet();
        return;
      }
    }
    this.chunks.push(x);
    this.got += x.length;
    // 押せるようにするのは描く繰り返しでもするが、描けない時（画面が止まっている時など）のため、ここでも
    if (this.ui.done.disabled && this.got / this.rate >= this.doneAfter) this.ui.done.disabled = false;
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
    this.floor = Infinity;
    this.floorChunks = 0;
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
  take(): Clip | null {
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
    for (const c of this.chunks) c.fill(0);
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

/** 録った音をきれいにして（選んだ物だけ）、測る。測るのは写し（measureAsync は渡した音を 0 で埋める）。逆再生チャレンジの真似は逆にして測る */
async function cleanAndMeasure(raw: Clip, choice: CleanChoice, reverse: boolean, contour: boolean, onStage: (m: Msg) => void, live: LiveAnalysis, analysing: () => void): Promise<{ clip: Clip; m: Measured } | { error: 'clean' }> {
  let clip = raw;
  if (choice.denoise || choice.music) {
    try {
      clip = await cleanAudio(raw.pcm, raw.rate, choice, (stage, done, total) => onStage(cleanMsg(stage, done, total)));
    } catch {
      return { error: 'clean' };
    } finally {
      // 元の音は、きれいにした後（できなかった時も）すぐ捨てる
      raw.pcm.fill(0);
    }
  }
  analysing();
  const opts = { minVoicedSeconds: WORD_SECONDS, minCycles: WORD_CYCLES, contour };
  const copy = () => (reverse ? reversed(clip.pcm) : clip.pcm.slice());
  let [m] = await Promise.all([measureAsync(copy(), clip.rate, opts), live.analysing(ANALYSE_MS)]);
  const { loudDb, floorDb } = m.info;
  if (!m.ok && m.reason === 'quiet' && loudDb !== undefined && floorDb !== undefined && loudDb - floorDb >= LIFT_SNR_DB) {
    const x = copy();
    let peak = 0;
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]!));
    // 上げすぎて割れないように、いちばん大きい点は 0.9 まで
    const g = Math.min(10 ** ((LIFT_TO_DB - loudDb) / 20), 0.9 / Math.max(peak, 1e-9));
    if (g > 1) {
      for (let i = 0; i < x.length; i++) x[i]! *= g;
      m = await measureAsync(x, clip.rate, opts);
    } else x.fill(0);
  }
  return { clip, m };
}

/* ---- 1. お手本 ---- */
const ref = {
  stage: $('ref'),
  pick: $('ref-pick'),
  name: $<HTMLInputElement>('ref-name'),
  rec: $<HTMLButtonElement>('ref-rec'),
  done: $<HTMLButtonElement>('ref-done'),
  cancel: $<HTMLButtonElement>('ref-cancel'),
  play: $('ref-play'),
  original: $<HTMLButtonElement>('play-original'),
  summary: $('ref-summary'),
  status: $('ref-status'),
};
const refLive = createLiveAnalysis($('ref-live'));
const refTake = new Take({ wave: createWave($<HTMLCanvasElement>('ref-wave')), live: refLive, fill: $('ref-fill'), sec: $('ref-sec'), done: ref.done }, REF_DONE_AFTER, true, () => refFinish(), () => refQuiet());

type RefState = 'idle' | 'asking' | 'listening' | 'cleaning' | 'analysing' | 'ready' | 'failed';
let refState: RefState = 'idle';
let refToken = 0;
/** 比べる相手（お手本の数字） */
interface Target {
  features: Features;
  name: string;
  /** セリフ真似の時だけ: お手本の高さと大きさの動き */
  contour?: Contour;
}
/** お手本: 音（きれいにした後の物）・数字・その時の選び方 */
interface Model {
  clip: Clip;
  target: Target;
  clean: CleanChoice;
  /** お手本の言葉（まとめの文） */
  from: Msg;
}
let model: Model | null = null;

let refMsg: Msg = () => '',
  refBad = false,
  mimMsg: Msg = () => '',
  mimBad = false;
/** お手本の所を描く。`redraw` は言葉を切り替えた時（声の玉はそのまま） */
function showRef(next: RefState, msg: Msg, bad = false, redraw = false): void {
  refState = next;
  refMsg = msg;
  refBad = bad;
  ref.stage.dataset.state = next;
  refLive.mode(next === 'listening' ? 'listening' : next === 'analysing' ? 'analysing' : 'off');
  if (!redraw) orb.mode(ORB_MODE[next] ?? 'idle');
  ref.status.textContent = msg();
  ref.status.classList.toggle('bad', bad);
  const busy = isBusy(next);
  const rev = mode === 'reverse';
  ref.pick.hidden = next === 'ready' || busy;
  ref.name.disabled = busy;
  ref.rec.hidden = busy;
  ref.rec.textContent = model ? (rev ? t('新しい言葉を録る', 'Record a new word') : t('新しいお手本を録る', 'Record a new model')) : t('● 録る', '● Record');
  ref.rec.classList.toggle('primary', !model);
  // キーボードの印（Space は、お手本が無い時だけ「録る」。ある時は「真似する」）
  ref.rec.dataset.key = model ? '' : 'Space';
  ref.done.hidden = next !== 'listening';
  ref.cancel.hidden = !(next === 'listening' || next === 'asking');
  ref.done.textContent = t('録り終えた', 'Done');
  ref.cancel.textContent = t('やめる', 'Stop');
  ref.play.hidden = !model || busy;
  ref.original.hidden = !rev;
  ref.summary.hidden = !model || busy;
  if (model) ref.summary.textContent = summaryOf(model);
  lockAll();
  drawClean();
  drawStage();
}

async function refListen(): Promise<void> {
  const my = ++refToken;
  playback.stop();
  // 真似を録っている・計算している途中なら、止めて音を捨てる
  mimStop();
  refTake.drop();
  showRef('asking', M('マイクの許可を待っています…', 'Waiting for microphone permission…'));
  try {
    const m = await openMic(refTake.onChunk, refEnded, mics.get());
    if (my !== refToken || refState !== 'asking') {
      m.stop();
      return;
    }
    refTake.begin(m);
    void mics.refresh();
    const label = m.label ?? '';
    micUsed = label;
    showRef('listening', () => t(`音が聞こえたら数えはじめます（最大 ${LISTEN_MAX} 秒）。`, `Counting starts when sound is heard (up to ${LISTEN_MAX} s).`) + (label ? t(`マイク: ${label}`, ` Microphone: ${label}`) : ''));
  } catch (e) {
    if (my !== refToken) return;
    refTake.stop();
    refTake.drop();
    if ((e as { name?: string } | null)?.name === 'MicGoneError') mics.reset();
    showRef('failed', () => micErrorText(e), true);
  }
}

function refFinish(): void {
  if (refState !== 'listening') return;
  const got = refTake.take();
  if (!got) {
    showRef('failed', M('お手本の音が届きませんでした。マイクを確かめて、もう一度録ってください。', 'No sound reached the page. Check the microphone and record again.'), true);
    return;
  }
  const my = refToken;
  const choice = choiceNow();
  showRef(choice.denoise || choice.music ? 'cleaning' : 'analysing', M('お手本を計算しています…', 'Working out the model…'));
  void cleanAndMeasure(
    got,
    choice,
    false,
    true,
    (msg) => {
      if (my === refToken && refState === 'cleaning') showRef('cleaning', msg);
    },
    refLive,
    () => {
      if (my === refToken && refState === 'cleaning') showRef('analysing', M('お手本を計算しています…', 'Working out the model…'));
    },
  ).then((r) => {
    if (my !== refToken || !isBusy(refState)) {
      if ('clip' in r) r.clip.pcm.fill(0);
      return;
    }
    if ('error' in r) {
      showRef('failed', M('ノイズカットをかけられませんでした。ノイズカットを「なし」にするか、ページを読み直して、もう一度録ってください。', 'The noise cut could not be applied. Set the noise cut to “Off” or reload the page, then record again.'), true);
      return;
    }
    const { clip, m } = r;
    if (!m.ok) {
      clip.pcm.fill(0);
      showRef('failed', () => failText(m.reason, m.info.voicedSeconds, true), true);
      return;
    }
    setModel(clip, m, choice);
  });
}

/** 今のお手本の短いまとめ（1 行） */
function summaryOf(md: Model): string {
  const f = md.target.features;
  const name = md.target.name;
  const head = name ? t(`「${name}」・`, `“${name}”, `) : '';
  if (mode === 'reverse') return head + t(`逆再生チャレンジ・${md.from()}`, `reverse challenge, ${md.from()}`);
  return head + t(`${md.target.contour ? 'セリフ真似' : '声全体'}・${md.from()}・声の高さ ${formatFeature('pitch', f.pitch)}`, `${md.target.contour ? 'line mimic' : 'whole voice'}, ${md.from()}, pitch ${formatFeature('pitch', f.pitch)}`);
}

/** 測ったお手本を置く（前のお手本の音は捨て、点数表は新しいお手本の回にする） */
function setModel(clip: Clip, m: Extract<Measured, { ok: true }>, choice: CleanChoice): void {
  const i = m.info;
  const line = i.contour && i.speechSeconds <= LINE_MAX_SECONDS ? i.contour : undefined;
  dropModel();
  endRound();
  model = {
    clip,
    target: { features: wordFeatures(m.features, i.voicedSeconds), name: ref.name.value.trim(), ...(line ? { contour: line } : {}) },
    clean: choice,
    from: line ? M(`${i.speechSeconds.toFixed(1)} 秒`, `${i.speechSeconds.toFixed(1)} s`) : M(`声 ${i.voicedSeconds.toFixed(1)} 秒分`, `${i.voicedSeconds.toFixed(1)} s of voice`),
  };
  showResult(false);
  shown = null;
  drawMimHints();
  showRef('ready', NONE);
  showMim('idle', NONE);
  drawBoard();
  // スマホでは、上の見出しの分だけ下がっているので、遊ぶ枠を画面の上に合わせる
  scrollTo(game);
}
/** お手本の音を捨てる */
function dropModel(): void {
  if (!model) return;
  if (playback.playing === 'model' || playback.playing === 'original') playback.stop();
  model.clip.pcm.fill(0);
  model = null;
}

/** 止めて、録っている音を捨てる */
function refStop(): void {
  refToken++;
  refTake.stop();
  refTake.drop();
}
function refCancel(): void {
  refStop();
  showRef(model ? 'ready' : 'idle', M('やめました。録っていた音は捨てました。', 'Stopped. The sound being recorded was thrown away.'));
}
/** マイクが外れた時: 録り終えられる長さがあれば、そこまでで測る。無ければ止めて、そのことを伝える */
function refEnded(): void {
  if (refState !== 'listening') return;
  if (refTake.seconds >= REF_DONE_AFTER) {
    refFinish();
    return;
  }
  refStop();
  showRef('failed', M('マイクが外れたので止めました。つなぎ直して、もう一度押してください。', 'The microphone went away, so this stopped. Plug it back in and press again.'), true);
}
/** お手本の音が来ないまま WAIT_MAX 秒たった時: 止めて伝える（マイクを開いたままにしない） */
function refQuiet(): void {
  if (refState !== 'listening') return;
  refStop();
  showRef('failed', M(`音が聞こえないまま ${WAIT_MAX} 秒たったので止めました。もう一度押してください。`, `No sound was heard for ${WAIT_MAX} s, so this stopped. Press again.`), true);
}

ref.rec.addEventListener('click', () => void refListen());
ref.done.addEventListener('click', refFinish);
ref.cancel.addEventListener('click', refCancel);

/* ---- 遊び方を変えた時: お手本はそのまま、点数は新しい回に ---- */
for (const r of modeInputs)
  r.addEventListener('change', () => {
    if (!r.checked) return;
    mode = r.value === 'reverse' ? 'reverse' : 'mimic';
    playback.stop();
    if (model) endRound();
    showResult(false);
    shown = null;
    drawMimHints();
    showRef(refState, model ? NONE : refMsg, refBad);
    if (model) showMim('idle', NONE);
    drawBoard();
  });

/* ---- 2. 真似 ---- */
const topicBox = $('topic-box');
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
/** 真似の所のお題（お手本が長い「声全体」の時だけ。セリフ・逆再生では、同じ言葉を言うので出さない） */
function drawMimHints(): void {
  topicBox.hidden = !model || mode === 'reverse' || !!model.target.contour;
}

/* ---- 段階と、今することの短い 1 行（字幕のように下に出す） ---- */
type Phase = 'ref' | 'mim' | 'result';
function phaseNow(): Phase {
  // お手本が無い・新しいお手本を録っている間は「お手本を録る」。録り直しに失敗した時は、前のお手本で続けられる
  if (!model || isBusy(refState)) return 'ref';
  return mimState === 'done' && shown ? 'result' : 'mim';
}
function cueText(ph: Phase): string {
  const rev = mode === 'reverse';
  if (ph === 'ref') {
    if (refState === 'asking') return t('マイクの許可を待っています', 'Waiting for the microphone');
    if (refState === 'listening') return rev ? t('言葉を言ってください', 'Say the word') : t('お手本を聞かせてください', 'Play the model to the mic');
    if (refState === 'cleaning' || refState === 'analysing') return t('お手本を計算しています…', 'Working out the model…');
    return rev ? t('逆再生する言葉を録ろう', 'Record a word to reverse') : t('お手本を録ろう', 'Record a model');
  }
  if (ph === 'result') return '';
  const line = !!model?.target.contour;
  switch (mimState) {
    case 'asking':
      return t('マイクの許可を待っています', 'Waiting for the microphone');
    case 'listening':
      return rev ? t('聞こえたとおりに真似して！', 'Imitate it just as you heard it!') : line ? t('同じセリフを言ってください', 'Say the same line') : t('お手本のように話してください', 'Talk like the model');
    case 'cleaning':
    case 'analysing':
      return t('採点しています…', 'Scoring…');
    default:
      return rev ? t('逆再生を聞いて、真似しよう', 'Play it reversed, then imitate it') : line ? t('お手本を聞いて、同じセリフを真似しよう', 'Listen, then say the same line like the model') : t('お手本を聞いて、お手本のように話そう', 'Listen, then talk like the model');
  }
}
const cue = $('cue');
/** 枠の段階と、今することの 1 行を描く（showRef・showMim の最後に） */
function drawStage(): void {
  const ph = phaseNow();
  game.dataset.phase = ph;
  game.dataset.ref = refState;
  game.dataset.mim = mimState;
  const text = cueText(ph);
  if (cue.textContent !== text) cue.textContent = text;
  requestAnimationFrame(placeCue);
}
/** 今することの 1 行は、枠が画面より長い時、画面の下に貼り付ける（CSS の sticky）。ただし、そこにボタンやうまくいかなかった
 *  知らせがある時は貼り付けない（隠さない。その時は、枠のいちばん下に置く） */
function placeCue(): void {
  if (!cue.textContent) return;
  const room = innerHeight - cue.offsetHeight - 24;
  const keep = game.querySelectorAll<HTMLElement>('.actions, .result-actions, .playback, .status.bad');
  let cover = false;
  for (const e of keep) {
    if (!e.offsetHeight || !e.textContent?.trim()) continue;
    const b = e.getBoundingClientRect();
    if (b.bottom > room && b.top < innerHeight) cover = true;
  }
  cue.classList.toggle('flow', cover);
}
addEventListener('scroll', placeCue, { passive: true });
addEventListener('resize', placeCue);

const mim = {
  stage: $('mim'),
  start: $<HTMLButtonElement>('mim-start'),
  done: $<HTMLButtonElement>('mim-done'),
  cancel: $<HTMLButtonElement>('mim-cancel'),
  status: $('mim-status'),
};
const mimLive = createLiveAnalysis($('mim-live'));
const mimTake = new Take({ wave: createWave($<HTMLCanvasElement>('mim-wave')), live: mimLive, fill: $('mim-fill'), sec: $('mim-sec'), done: mim.done }, MIM_DONE_AFTER, false, () => mimFinish());

type MimState = 'locked' | 'idle' | 'asking' | 'listening' | 'cleaning' | 'analysing' | 'done' | 'failed';
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
  mim.status.textContent = msg();
  mim.status.classList.toggle('bad', bad);
  mim.start.hidden = !(next === 'locked' || next === 'idle' || next === 'failed' || next === 'done');
  mim.start.disabled = next === 'locked';
  mim.start.textContent = next === 'done' ? t('もう一度真似する', 'Imitate again') : t('真似する', 'Imitate');
  mim.done.textContent = t('話し終えた', 'Done');
  mim.cancel.textContent = t('やめる', 'Stop');
  mim.done.hidden = next !== 'listening';
  mim.cancel.hidden = !(next === 'listening' || next === 'asking');
  const busy = isBusy(next);
  ref.rec.disabled = busy;
  topic.next.disabled = topic.read.disabled = busy;
  nextBtn.disabled = againBtn.disabled = busy;
  lockAll();
  drawStage();
}

async function mimStart(): Promise<void> {
  if (!model || isBusy(refState)) return;
  const my = ++mimToken;
  playback.stop();
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
    micUsed = label;
    showMim('listening', () => {
      const on = label ? t(`マイク: ${label}`, ` Microphone: ${label}`) : '';
      const long = mode !== 'reverse' && !model?.target.contour;
      return (long ? t(`長く話すほど多くの項目で比べられます（最大 ${LISTEN_MAX} 秒）。`, `The longer you talk, the more items are compared (up to ${LISTEN_MAX} s).`) : t('言い終えたら「話し終えた」を押してください。', 'Press “Done” when you finish.')) + on;
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
  if (mimState !== 'listening' || !model) return;
  const got = mimTake.take();
  if (!got) {
    showMim('failed', M('声が届きませんでした。もう一度試してください。', 'No voice reached the page. Please try again.'), true);
    return;
  }
  const my = mimToken;
  const md = model;
  const who = current();
  const rev = mode === 'reverse';
  showMim(md.clean.denoise || md.clean.music ? 'cleaning' : 'analysing', M('計算しています…', 'Working it out…'));
  void cleanAndMeasure(
    got,
    md.clean,
    rev,
    !!md.target.contour,
    (msg) => {
      if (my === mimToken && mimState === 'cleaning') showMim('cleaning', msg);
    },
    mimLive,
    () => {
      if (my === mimToken && mimState === 'cleaning') showMim('analysing', M('計算しています…', 'Working it out…'));
    },
  ).then((r) => {
    if (my !== mimToken || !isBusy(mimState) || model !== md) {
      if ('clip' in r) r.clip.pcm.fill(0);
      return;
    }
    if ('error' in r) {
      showMim('failed', M('ノイズカットをかけられませんでした。ノイズカットを「なし」にして、お手本から録り直してください。', 'The noise cut could not be applied. Set the noise cut to “Off” and record the model again.'), true);
      return;
    }
    const { clip, m } = r;
    if (!m.ok) {
      clip.pcm.fill(0);
      showMim('failed', () => failText(m.reason, m.info.voicedSeconds, false), true);
      return;
    }
    if (!render(md.target, wordFeatures(m.features, m.info.voicedSeconds), m.info.contour, who, clip)) {
      clip.pcm.fill(0);
      showMim('failed', M('お手本と比べられる項目がありませんでした。お手本か声を録り直してください。', 'No item could be compared with the model. Record the model or your voice again.'), true);
      return;
    }
    showMim('done', M('測りました。', 'Measured.'));
    scrollTo(game);
  });
}

/** 真似を録っている・計算している途中なら、止めて音を捨てる。止めたら true */
function mimStop(): boolean {
  if (!isBusy(mimState)) return false;
  mimToken++;
  mimTake.stop();
  mimTake.drop();
  showMim(model ? 'idle' : 'locked', model ? NONE : M('先にお手本を録ってください。', 'Record the model first.'));
  return true;
}
function mimCancel(): void {
  mimToken++;
  mimTake.stop();
  mimTake.drop();
  showMim(model ? 'idle' : 'locked', M('やめました。音は捨てました。', 'Stopped. The sound was thrown away.'));
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

/* ---- 次の人へ・もう一度 ---- */
const nextBtn = $<HTMLButtonElement>('next-player');
const againBtn = $<HTMLButtonElement>('again');
function nextPlayer(): void {
  if (players.length < 2 || isBusy(mimState) || isBusy(refState)) return;
  turn = (turn + 1) % players.length;
  playback.stop();
  drawPlayers();
  drawTurn();
  drawBoard();
  if (model) showMim('idle', NONE);
  scrollTo(game);
}
nextBtn.addEventListener('click', nextPlayer);
againBtn.addEventListener('click', () => {
  if (isBusy(mimState) || isBusy(refState)) return;
  scrollTo(game);
  void mimStart();
});
/* ---- くわしい結果（下の折りたたみ）---- */
const detail = $<HTMLDetailsElement>('detail');
/** 点数（枠の中）と、くわしい結果（下の折りたたみ）を出す・隠す */
function showResult(on: boolean): void {
  $('result').hidden = !on;
  detail.hidden = !on;
}
$('more-result').addEventListener('click', () => {
  detail.open = true;
  scrollTo(detail);
});

document.addEventListener('visibilitychange', () => {
  // お手本を録っている時は止めない（ほかのタブやアプリで流してマイクに聞かせるため。音が来ないまま WAIT_MAX 秒で止まる）
  if (document.hidden && (mimState === 'listening' || mimState === 'asking')) mimCancel();
});
// ページを離れる時: 録るのを止め、録った音（お手本・真似）を全部 0 で埋めて捨てる。点数表と名前は数字と文字だけなので残す
// （戻るで戻った時に、聞き直すボタンが無音を鳴らさないよう、画面も最初に戻す）
window.addEventListener('pagehide', () => {
  refStop();
  mimToken++;
  mimTake.stop();
  mimTake.drop();
  playback.close();
  dropModel();
  for (const p of players) {
    p.last?.pcm.fill(0);
    p.last = null;
  }
  if (shown?.clip) shown.clip.pcm.fill(0);
  shown = null;
  showResult(false);
  showRef('idle', M('録った音は、ページを離れた時に捨てました。', 'Recorded sound was thrown away when you left the page.'));
  showMim('locked', M('先にお手本を録ってください。', 'Record the model first.'));
  drawBoard();
});

function failText(reason: MeasureFail, voiced: number | undefined, isModel: boolean): string {
  const v = (voiced ?? 0).toFixed(2);
  const mic = micUsed ? t(`（使ったマイク: ${micUsed}）`, ` (mic used: ${micUsed})`) : '';
  switch (reason) {
    case 'silent':
      return (isModel ? t('お手本の音が聞こえませんでした', 'The model could not be heard') : t('声が聞こえませんでした', 'No voice was heard')) + mic + t('。消音になっていないか、上の「使うマイク」が合っているか確かめてください。', '. Check that the mic is not muted and that “Mic in use” at the top is the right one.');
    case 'quiet':
      // 雑音より十分大きい音は上げて測り直すので、ここに来るのは、小さい上に雑音との差も少ない音
      return (isModel ? t('お手本の音が小さくて、まわりの雑音と分けられませんでした', 'The model was too quiet to tell apart from the background noise') : t('声が小さくて、まわりの雑音と分けられませんでした', 'The voice was too quiet to tell apart from the background noise')) + mic + t('。上の「使うマイク」が、音を聞かせているマイクか確かめてください。合っていれば、流す音量か、端末のマイクの音量（入力レベル）を上げてください。', '. Check that “Mic in use” at the top is the mic you are playing into. If it is, turn up the playback volume or the device’s mic input level.');
    case 'noisy':
      // ほかの音のほか、静かな所でも、息の多い声・ささやき声でこうなる。ほかの音が多いとは言い切らない
      return isModel
        ? t('お手本の声をはっきり聞き取れませんでした。BGM・効果音・雑音や、息の多い声・ささやき声だと、こうなることがあります。ノイズカット（BGM があれば「大」）を使うか、声だけの所を聞かせてください。', 'The model’s voice could not be picked out clearly. BGM, sound effects, noise, or a breathy or whispered voice can cause this. Use the noise cut (“Strong” if there is BGM), or play a part with the voice alone.')
        : t('声をはっきり聞き取れませんでした。まわりの音や、息の多い声・ささやき声だと、こうなることがあります。静かな所で、ささやかずに、もう一度話してください。', 'The voice could not be picked out clearly. Background sound, or a breathy or whispered voice, can cause this. Try again somewhere quiet, without whispering.');
    case 'clipped':
      return isModel ? t('お手本の音が大きすぎて、割れていました。少し離れるか、音量を下げてください。', 'The model was so loud that it distorted. Move back a little or turn the volume down.') : t('声が大きすぎて、音が割れていました。マイクから少し離れてください。', 'The voice was so loud that it distorted. Move a little away from the microphone.');
    case 'short':
      return isModel
        ? t(`お手本の声を ${v} 秒分しか測れませんでした。「はい」のような一言でも測れます。声がはっきり入るように、もう一度聞かせてください。`, `Only ${v} s of the model’s voice was measured. Even one word like “yes” works. Play it again so the voice comes through clearly.`)
        : t(`声を ${v} 秒分しか測れませんでした。「はい」のような一言でも測れます。ささやかずに、声を出してもう一度言ってください。`, `Only ${v} s of voice was measured. Even one word like “yes” works. Say it again out loud, without whispering.`);
    default:
      return t('うまく数字にできませんでした。もう一度試してください。', 'It could not be measured. Please try again.');
  }
}

/* ---- 結果 ---- */
/** 点数: 輪（CSS の --score）と、数えあがる数字と、ランク。動きを減らす設定では、すぐその数 */
function showScore(score: number): void {
  const gauge = $('gauge');
  const num = $('score');
  // ランクは、点数が数えあがった後に出す（毎回、出し直す）
  const rank = $('rank');
  rank.textContent = scoreRank(score);
  rank.classList.remove('pop');
  void rank.offsetWidth;
  rank.classList.add('pop');
  // 輪は毎回、まずすぐ 0 に戻し、それから点数まで満ちる
  gauge.style.transition = 'none';
  gauge.style.setProperty('--score', '0');
  void getComputedStyle(gauge).getPropertyValue('--score');
  gauge.style.transition = '';
  gauge.style.setProperty('--score', String(score));
  num.textContent = String(score);
  if (still()) return;
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
/** 出している結果（言葉を切り替えた時に出し直すため）。clip は、この真似の声（聞き直す用） */
let shown: { tg: Target; mine: Features; mineContour?: Contour; score: number; before: number | null; who: Player; tries: number; reverse: boolean; clip: Clip | null } | null = null;
function render(tg: Target, mine: Features, mineContour: Contour | undefined, who: Player, clip: Clip): boolean {
  const voice = mimicScore(tg.features, mine);
  const line = tg.contour && mineContour ? compareLines(tg.contour, mineContour) : null;
  if (!voice && !line) return false;
  const score = line ? lineScore(line, voice?.score ?? null) : voice!.score;
  const before = who.best;
  who.best = Math.max(who.best ?? 0, score);
  who.roundTries++;
  who.tries++;
  // 聞き直す用に、この人の最後の声として持つ（前の声は捨てる）
  if (who.last && who.last !== clip) who.last.pcm.fill(0);
  who.last = clip;
  who.lastReverse = mode === 'reverse';
  shown = { tg, mine, ...(mineContour ? { mineContour } : {}), score, before, who, tries: who.roundTries, reverse: mode === 'reverse', clip };
  showScore(score);
  showResult(true);
  paint();
  drawBoard();
  return true;
}
/** 結果の言葉と図（今の言葉で。点数の数えあがりはしない） */
function paint(): void {
  if (!shown) return;
  const { tg, mine, mineContour, score, before, who, tries, reverse } = shown;
  const voice = mimicScore(tg.features, mine);
  const line = tg.contour && mineContour ? compareLines(tg.contour, mineContour) : null;
  const tgName = tg.name;
  const many = players.length > 1;
  const whoJa = many ? `${who.name}：` : '';
  const whoEn = many ? `${who.name}: ` : '';
  const what = reverse ? t(`${tgName ? `「${tgName}」` : '元の言葉'}との近さ（逆再生チャレンジ）`, `closeness to ${tgName ? `“${tgName}”` : 'the original word'} (reverse challenge)`) : t(`${tgName ? `「${tgName}」` : 'お手本'}との近さ${line ? '（セリフ真似）' : ''}`, `closeness to ${tgName ? `“${tgName}”` : 'the model'}${line ? ' (line mimic)' : ''}`);
  $('score-label').textContent = t(whoJa, whoEn) + what;
  $('score-word').textContent = scoreWord(score);
  $('best').textContent = tries === 1 ? '' : before !== null && score > before ? t(`最高点を更新しました（${tries} 回目）`, `New best! (try ${tries})`) : t(`このお手本での${many ? `${who.name}の` : ''}最高は ${who.best} 点です（${tries} 回目）`, `${many ? `${who.name}’s` : 'Your'} best with this model is ${who.best} (try ${tries})`);
  $('play-mine-rev').hidden = !reverse;
  // キーボードの M は、比べた向きの声（逆再生チャレンジでは、逆にした声）
  $('play-mine').dataset.key = reverse ? '' : 'M';
  $('play-mine-rev').dataset.key = reverse ? 'M' : '';
  drawPlay();

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
      { who: t('お手本', 'Model'), ...(tgName ? { sub: tgName } : {}), f: tg.features },
      { who: many ? who.name : t('あなた', 'You'), sub: t(`${tries} 回目`, `Try ${tries}`), f: mine },
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

/* ---- キーボード（配信向け） ---- */
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const tg = e.target as HTMLElement | null;
  if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
  // ボタンや要約にいる時の Space・Enter は、その物を押す（ここでは何もしない）
  if ((e.key === ' ' || e.key === 'Enter') && tg && /^(BUTTON|A|SUMMARY)$/.test(tg.tagName)) return;
  const key = e.key.toLowerCase();
  if (key === ' ') {
    e.preventDefault();
    if (refState === 'listening') refFinish();
    else if (mimState === 'listening') mimFinish();
    else if (isBusy(refState) || isBusy(mimState)) return;
    else if (!model) void refListen();
    else void mimStart();
  } else if (key === 'p') togglePlay('model');
  else if (key === 'o' && mode === 'reverse') togglePlay('original');
  else if (key === 'm' && shown?.clip) togglePlay(mode === 'reverse' ? 'mine-rev' : 'mine');
  else if (key === 'n') nextPlayer();
  else if (key === 'escape') {
    if (playback.playing) playback.stop();
    else if (refState === 'listening' || refState === 'asking') refCancel();
    else if (mimState === 'listening' || mimState === 'asking') mimCancel();
  }
});

showRef('idle', NONE);
showMim('locked', M('先にお手本を録ってください。', 'Record the model first.'));
drawTurn();
drawBoard();

onLang(() => {
  if (defaultNamed && players.length === 1 && players[0]!.tries === 0) players[0]!.name = t('あなた', 'You');
  showRef(refState, refMsg, refBad, true);
  showMim(mimState, mimMsg, mimBad, true);
  showTopic();
  drawMimHints();
  drawTurn();
  drawBoard();
  drawClean();
  drawPlay();
  if (!$('result').hidden) paint();
});
