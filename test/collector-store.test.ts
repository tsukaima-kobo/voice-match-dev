// 収集の拡張機能の記録（collector/src/store.ts）の試験。chrome.storage.local の代わりを置き、保存できない時の知らせ方を確かめる
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addToFile, keyOf, loadFile, recordWindow, TROUBLE_TEXT, troubleOf } from '../collector/src/store.ts';
import type { measureVoice } from '../src/voice/measure.ts';
import type { VoiceWindow } from '../src/data/types.ts';

const mem = new Map<string, unknown>();
let failGet: Error | null = null,
  failSet: Error | null = null;
const fakeChrome = () => ({
  runtime: { id: 'abc', getURL: (p: string) => p },
  storage: {
    local: {
      get: async (k: string) => {
        if (failGet) throw failGet;
        return mem.has(k) ? { [k]: structuredClone(mem.get(k)) } : {};
      },
      set: async (o: Record<string, unknown>) => {
        if (failSet) throw failSet;
        for (const [k, v] of Object.entries(o)) mem.set(k, structuredClone(v));
      },
      remove: async (k: string) => void mem.delete(k),
    },
  },
});

const INVALIDATED = new Error('Extension context invalidated.');
const QUOTA = new Error('QUOTA_BYTES quota exceeded');
const finished = () => ({ pcm: new Float32Array(48000).fill(0.5), video: 'abc123def45', t0: 100, t1: 130 });
const measured = (() => ({ ok: true, features: { pitch: 200 }, info: { voicedSeconds: 12, gapTonal: 0.1, loudDb: -20, floorDb: -50 } })) as unknown as typeof measureVoice;

beforeEach(() => {
  mem.clear();
  failGet = failSet = null;
  vi.stubGlobal('chrome', fakeChrome());
});
afterEach(() => vi.unstubAllGlobals());

describe('保存できない時のわけ', () => {
  it('拡張機能が読み直された・保存する場所がいっぱい・そのほか', () => {
    expect(troubleOf(INVALIDATED)).toBe('gone');
    expect(troubleOf(QUOTA)).toBe('full');
    expect(troubleOf(new Error('disk'))).toBe('other');
    // 読み直された後は runtime.id が無くなり、chrome.storage も読めない
    vi.stubGlobal('chrome', { runtime: {} });
    expect(troubleOf(new TypeError("Cannot read properties of undefined (reading 'local')"))).toBe('gone');
  });
});

describe('窓を記録する', () => {
  it('記録し、同じ所は二度足さない', async () => {
    const a = await recordWindow('v-0001', finished(), 48000, '2026-11-08', measured);
    expect(a.kind).toBe('added');
    const b = await recordWindow('v-0001', finished(), 48000, '2026-11-08', measured);
    expect(b.kind).toBe('overlap');
    expect((await loadFile('v-0001')).windows.length).toBe(1);
  });
  it('測れなかった窓は、わけを付けて除く。音はどの時も手放す', async () => {
    const d = finished();
    const r = await recordWindow('v-0001', d, 48000, '2026-11-08', (() => ({ ok: false, reason: 'noisy', info: {} })) as unknown as typeof measureVoice);
    expect(r).toEqual({ kind: 'dropped', reason: 'noisy' });
    expect(d.pcm.every((x) => x === 0)).toBe(true);
    expect(mem.size).toBe(0);
  });
  it('数字にする所で落ちても、止まらずに知らせ、音は手放す', async () => {
    const d = finished();
    const r = await recordWindow('v-0001', d, 48000, '2026-11-08', () => {
      throw new RangeError('boom');
    });
    expect(r).toMatchObject({ kind: 'failed', step: 'measure', trouble: 'other' });
    expect(r.kind === 'failed' && r.text).toContain('boom');
    expect(d.pcm.every((x) => x === 0)).toBe(true);
  });
  it('拡張機能が読み直された後は、ページを読み直すよう知らせる', async () => {
    failGet = INVALIDATED;
    const r = await recordWindow('v-0001', finished(), 48000, '2026-11-08', measured);
    expect(r).toMatchObject({ kind: 'failed', step: 'save', trouble: 'gone', text: TROUBLE_TEXT.gone });
  });
  it('保存する場所がいっぱいなら、書き出して消すよう知らせる', async () => {
    failSet = QUOTA;
    const r = await recordWindow('v-0001', finished(), 48000, '2026-11-08', measured);
    expect(r).toMatchObject({ kind: 'failed', step: 'save', trouble: 'full', text: TROUBLE_TEXT.full });
    expect(mem.size).toBe(0);
  });
  it('そのほかの失敗は、中身を添えて知らせる', async () => {
    failSet = new Error('IO error');
    const r = await recordWindow('v-0001', finished(), 48000, '2026-11-08', measured);
    expect(r).toMatchObject({ kind: 'failed', step: 'save', trouble: 'other' });
    expect(r.kind === 'failed' && r.text).toContain('IO error');
  });
  it('いくつかのタブで同時に足しても、取りこぼさない', async () => {
    const w = (t0: number) => ({ video: 'a', t0, t1: t0 + 30, measuredAt: '2026-11-08', version: '3.2.0', features: {}, voicedSeconds: 12, gapTonal: 0, snrDb: 30 }) as unknown as VoiceWindow;
    await Promise.all([0, 30, 60, 90].map((t0) => addToFile('v-0002', w(t0))));
    expect((mem.get(keyOf('v-0002')) as { windows: unknown[] }).windows.length).toBe(4);
  });
});
