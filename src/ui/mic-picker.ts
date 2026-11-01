// マイクを選ぶ所。最初は「いつものマイク（端末の設定）」だけ。名前の一覧は、マイクを一度許可した後に出る
// （「ほかのマイクを選ぶ」を押すと、一覧を出すためだけに許可を求め、すぐ止める。音は受けない）。
// 選んだ物は、このタブを閉じるまで覚える（sessionStorage。声真似の点数のページと共通）。マイクの抜き差しで一覧を作り直す。
// 1 つのページに選ぶ所が 2 つある時（声真似の点数）は、どちらで選んでも同じ物にそろえる。
import { listMics, micChoiceSupported, type MicChoice } from '../voice/listen.ts';

const KEY = 'voice-twin-mic';
const DEFAULT_LABEL = 'いつものマイク（端末の設定）';

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
    /* (not kept: chosen again next time) */
  }
};

export function micPicker(parts: { box: HTMLElement; select: HTMLSelectElement; find: HTMLButtonElement }[], onError?: (text: string) => void): MicPicker {
  let chosen = load();
  let mics: MicChoice[] = [];
  const supported = micChoiceSupported();
  for (const p of parts) p.box.hidden = !supported;

  function draw(): void {
    if (chosen && !mics.some((m) => m.id === chosen) && mics.length) chosen = '';
    for (const p of parts) {
      const opts = [new Option(DEFAULT_LABEL, ''), ...mics.map((m) => new Option(m.label, m.id))];
      p.select.replaceChildren(...opts);
      p.select.value = mics.some((m) => m.id === chosen) ? chosen : '';
      p.find.hidden = mics.length > 0;
    }
  }
  async function refresh(ask = false): Promise<void> {
    if (!supported) return;
    try {
      mics = await listMics(ask);
    } catch (e) {
      if (ask) onError?.('マイクの一覧を出せませんでした。ブラウザーの設定で、このページにマイクを許可してください。');
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
  void refresh();
  return {
    get: () => (mics.some((m) => m.id === chosen) ? chosen : ''),
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
