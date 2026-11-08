// マイクを選ぶ所。最初は「いつものマイク（端末の設定）」だけ。名前の一覧は、マイクを一度許可した後に出る
// （「ほかのマイクを選ぶ」を押すと、一覧を出すためだけに許可を求め、すぐ止める。音は受けない）。
// 選んだ物は、このタブを閉じるまで覚える（sessionStorage。声真似の点数のページと共通）。マイクの抜き差しで一覧を作り直す。
// 名前の一覧がまだ見えない時（Safari・Firefox で、このページでまだ許可していない時）も、覚えたマイクを使う
// （「前に選んだマイク」と出す。もう無い時は、録りはじめた時に MicGoneError になり、ページが端末の設定に戻す）。
// 1 つのページに選ぶ所が 2 つある時（声真似の点数）は、どちらで選んでも同じ物にそろえる。
import { listMics, micChoiceSupported, type MicChoice } from '../voice/listen.ts';
import { onLang, t } from '../i18n.ts';

const KEY = 'voice-match-mic';
const defaultLabel = () => t('いつものマイク（端末の設定）', 'Default microphone (device setting)');
const savedLabel = () => t('前に選んだマイク', 'The microphone you chose before');

export interface MicPicker {
  /** 選んでいるマイクの deviceId（空なら端末の設定） */
  get(): string;
  /** 端末の設定に戻す（選んだマイクが無くなった時） */
  reset(): void;
  /** マイクを許可した後に、名前の一覧を作り直す */
  refresh(): Promise<void>;
  /** 録っている間は選べなくする */
  lock(on: boolean): void;
}

const load = (): string => {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};
const save = (id: string): void => {
  try {
    if (id) sessionStorage.setItem(KEY, id);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* 覚えられない時は、次にまた選ぶ */
  }
};

export function micPicker(parts: { box: HTMLElement; select: HTMLSelectElement; find: HTMLButtonElement }[], onError?: (text: string) => void): MicPicker {
  let chosen = load();
  let mics: MicChoice[] = [];
  const supported = micChoiceSupported();
  for (const p of parts) p.box.hidden = !supported;

  function draw(): void {
    if (chosen && !mics.some((m) => m.id === chosen) && mics.length) chosen = '';
    // 一覧が見えない間は、覚えたマイクを名前なしで出す
    const unseen = !!chosen && !mics.length;
    for (const p of parts) {
      const opts = [new Option(defaultLabel(), ''), ...(unseen ? [new Option(savedLabel(), chosen)] : []), ...mics.map((m) => new Option(m.label, m.id))];
      p.select.replaceChildren(...opts);
      p.select.value = chosen;
      p.find.hidden = mics.length > 0;
    }
  }
  async function refresh(ask = false): Promise<void> {
    if (!supported) return;
    try {
      mics = await listMics(ask);
    } catch (e) {
      if (ask) onError?.(t('マイクの一覧を出せませんでした。ブラウザーの設定で、このページにマイクを許可してください。', 'The list of microphones could not be shown. Allow the microphone for this page in your browser settings.'));
      void e;
      return;
    }
    draw();
  }
  for (const p of parts) {
    p.select.addEventListener('change', () => {
      chosen = p.select.value;
      save(chosen);
      draw();
    });
    p.find.addEventListener('click', () => void refresh(true));
  }
  if (supported) navigator.mediaDevices.addEventListener?.('devicechange', () => void refresh());
  draw();
  onLang(draw);
  void refresh();
  return {
    // 一覧に無いマイクは draw が外す。一覧がまだ見えない時は、覚えたマイクをそのまま使う
    get: () => (supported ? chosen : ''),
    reset() {
      chosen = '';
      save('');
      draw();
    },
    refresh: () => refresh(),
    lock(on) {
      for (const p of parts) p.select.disabled = p.find.disabled = on;
    },
  };
}
