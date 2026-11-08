// 収集の拡張機能の記録（chrome.storage.local）と、30 秒の窓を数字にして記録するまで（test/collector-store.test.ts で試す）。
// 保存の失敗は、パネルに出す言葉に分ける: 拡張機能が読み直された（このページでは、もう保存できない）・保存する場所がいっぱい・そのほか。
import { MEASURE_VERSION, measureVoice } from '../../src/voice/measure.ts';
import type { VoiceFile, VoiceWindow } from '../../src/data/types.ts';
import { addWindow, windowOf, type Finished } from './windowing.ts';

export const MIN_VOICED = 8;
export const keyOf = (id: string) => `voices:${id}`;

/** gone: 拡張機能が読み直された・外された。full: 保存する場所がいっぱい */
export type Trouble = 'gone' | 'full' | 'other';

/** この拡張機能が、まだ chrome の API を使えるか（読み直した後の古いページでは、runtime.id が無くなる） */
export function alive(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

export function troubleOf(e: unknown): Trouble {
  const msg = e instanceof Error ? e.message : String(e);
  if (/context invalidated/i.test(msg) || !alive()) return 'gone';
  if (/quota/i.test(msg)) return 'full';
  return 'other';
}

export const TROUBLE_TEXT = {
  gone: '拡張機能が読み直されました。このページを読み直してから、もう一度押してください（ここまでの記録は残っています）。',
  full: '記録を保存する場所がいっぱいです。「書き出し」でファイルにしてから「記録を消す」で消してください。',
} as const;

/** 板に出す言葉。failed は、そのほかの失敗の時の文（例「書き出せませんでした」） */
export function troubleText(e: unknown, failed: string): string {
  const k = troubleOf(e);
  return k === 'other' ? `${failed}（${e instanceof Error ? e.message : String(e)}）` : TROUBLE_TEXT[k];
}

export async function loadFile(id: string): Promise<VoiceFile> {
  const got = await chrome.storage.local.get(keyOf(id));
  const f = got[keyOf(id)] as VoiceFile | undefined;
  return f && Array.isArray(f.windows) ? f : { id, windows: [] };
}

/**
 * 同じ ID をいくつかのタブで同時に測っても、記録を取りこぼさない: 読む→足す→書くを、タブをまたぐ鍵の中で行う
 * （鍵は YouTube のページどうしで共通。無いブラウザーでは鍵なし）
 */
export function locked<T>(id: string, f: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request(`voice-match-collector:${id}`, f) : f();
}

export async function addToFile(id: string, w: VoiceWindow): Promise<{ f: VoiceFile; added: boolean }> {
  return locked(id, async () => {
    const f = await loadFile(id);
    const added = addWindow(f, w);
    if (added) await chrome.storage.local.set({ [keyOf(f.id)]: f });
    return { f, added };
  });
}

export async function clearFile(id: string): Promise<void> {
  await locked(id, () => chrome.storage.local.remove(keyOf(id)));
}

export type Recorded =
  | { kind: 'added'; f: VoiceFile; w: VoiceWindow }
  | { kind: 'overlap'; f: VoiceFile }
  /** 測れなかった（reason は measure.ts の理由。invalid は数字が欠けた） */
  | { kind: 'dropped'; reason: string }
  | { kind: 'failed'; step: 'measure' | 'save'; trouble: Trouble; text: string };

/** 窓を数字にして記録する。音は、うまくいってもいかなくても、ここで手放す（残るのは数字だけ） */
export async function recordWindow(id: string, done: Finished, sampleRate: number, date: string, measure: typeof measureVoice = measureVoice): Promise<Recorded> {
  let w: VoiceWindow | null;
  try {
    const m = measure(done.pcm, sampleRate, { minVoicedSeconds: MIN_VOICED });
    w = windowOf(m, done, MEASURE_VERSION, date);
    if (!w) return { kind: 'dropped', reason: m.ok ? 'invalid' : m.reason };
  } catch (e) {
    return { kind: 'failed', step: 'measure', trouble: 'other', text: `${done.t0.toFixed(0)}〜${done.t1.toFixed(0)} 秒: 数字にできませんでした（${e instanceof Error ? e.message : String(e)}）` };
  } finally {
    done.pcm.fill(0);
  }
  try {
    const { f, added } = await addToFile(id, w);
    return added ? { kind: 'added', f, w } : { kind: 'overlap', f };
  } catch (e) {
    return { kind: 'failed', step: 'save', trouble: troubleOf(e), text: troubleText(e, '記録を保存できませんでした') };
  }
}
