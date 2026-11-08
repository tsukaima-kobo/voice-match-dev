// src/voice/listen.ts の試験。マイク・AudioContext はにせ物（音は流れない）。
// 確かめること: マイクを開いた後に始める途中で失敗しても（AudioContext・ScriptProcessor・resume）、マイクを止め、AudioContext を閉じてから誤りを返す。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Fail = 'context' | 'script' | 'resume' | null;
let fail: Fail = null;
let contexts: FakeContext[] = [];

class FakeTrack {
  stopped = false;
  listeners = new Set<() => void>();
  label = 'にせのマイク';
  stop() {
    this.stopped = true;
  }
  addEventListener(_: string, f: () => void) {
    this.listeners.add(f);
  }
  removeEventListener(_: string, f: () => void) {
    this.listeners.delete(f);
  }
}
class FakeStream {
  constructor(public tracks: FakeTrack[] = [new FakeTrack()]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}
const node = () => ({ connect() {}, disconnect() {} });
class FakeContext {
  closed = 0;
  sampleRate = 48000;
  destination = {};
  audioWorklet = { addModule: () => Promise.reject(new Error('no worklet')) };
  constructor() {
    if (fail === 'context') throw new Error('too many AudioContexts');
    contexts.push(this);
  }
  createMediaStreamSource() {
    return node();
  }
  createScriptProcessor() {
    if (fail === 'script') throw new Error('no ScriptProcessor');
    return { ...node(), onaudioprocess: null };
  }
  resume() {
    return fail === 'resume' ? Promise.reject(new Error('cannot resume')) : Promise.resolve();
  }
  close() {
    this.closed++;
    return Promise.resolve();
  }
}

let stream: FakeStream;
beforeEach(() => {
  fail = null;
  contexts = [];
  stream = new FakeStream();
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('window', { AudioContext: FakeContext });
  vi.stubGlobal('MediaStream', FakeStream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve(stream) } });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const load = async () => {
  vi.resetModules();
  return import('../src/voice/listen.ts');
};

describe('openMic が始める途中で失敗した時', () => {
  for (const f of ['context', 'script', 'resume'] as const) {
    it(`${f}: マイクを止め、AudioContext を閉じてから誤りを返す`, async () => {
      fail = f;
      const { openMic } = await load();
      await expect(openMic(() => {})).rejects.toThrow();
      expect(stream.tracks.every((t) => t.stopped)).toBe(true);
      expect(stream.tracks.every((t) => t.listeners.size === 0)).toBe(true);
      expect(contexts.every((c) => c.closed === 1)).toBe(true);
    });
  }
  it('うまく始まった時は開いたまま。stop で止めて閉じる', async () => {
    const { openMic } = await load();
    const mic = await openMic(() => {});
    expect(mic.rate).toBe(48000);
    expect(stream.tracks.some((t) => t.stopped)).toBe(false);
    expect(contexts[0]!.closed).toBe(0);
    mic.stop();
    expect(stream.tracks.every((t) => t.stopped)).toBe(true);
    expect(contexts[0]!.closed).toBe(1);
  });
});
