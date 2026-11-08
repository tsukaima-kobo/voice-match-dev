// src/ui/mic-picker.ts の試験。ページの部品・sessionStorage・マイクの一覧は、にせ物。
// 確かめること: マイクの名前の一覧がまだ見えない時（Safari・Firefox の最初）も、前に選んだマイクを使う。一覧に無くなったら、端末の設定に戻す。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeOption {
  constructor(
    public text: string,
    public value: string,
  ) {}
}
const fakeSelect = () => {
  const s = { options: [] as FakeOption[], value: '', disabled: false, listeners: [] as (() => void)[] };
  return Object.assign(s, {
    replaceChildren: (...o: FakeOption[]) => void (s.options = o),
    addEventListener: (_: string, f: () => void) => void s.listeners.push(f),
  });
};
let devices: { kind: string; deviceId: string; label: string }[] = [];
let store: Map<string, string>;

beforeEach(() => {
  store = new Map([['voice-match-mic', 'mic-b']]);
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('Option', FakeOption);
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia() {}, enumerateDevices: () => Promise.resolve(devices), addEventListener() {} } });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const mount = async () => {
  vi.resetModules();
  const { micPicker } = await import('../src/ui/mic-picker.ts');
  const select = fakeSelect();
  const picker = micPicker([{ box: { hidden: false } as HTMLElement, select: select as unknown as HTMLSelectElement, find: { hidden: false, disabled: false, addEventListener() {} } as unknown as HTMLButtonElement }]);
  await new Promise((r) => setTimeout(r, 0));
  return { picker, select };
};

describe('micPicker', () => {
  it('名前の一覧が見えない間も、前に選んだマイクを使い、選ぶ所にも出す', async () => {
    devices = [{ kind: 'audioinput', deviceId: '', label: '' }];
    const { picker, select } = await mount();
    expect(picker.get()).toBe('mic-b');
    expect(select.value).toBe('mic-b');
    expect(select.options.map((o) => o.value)).toEqual(['', 'mic-b']);
  });
  it('一覧が見えて、そこにあれば、そのマイク', async () => {
    devices = [
      { kind: 'audioinput', deviceId: 'mic-a', label: 'A' },
      { kind: 'audioinput', deviceId: 'mic-b', label: 'B' },
    ];
    const { picker, select } = await mount();
    expect(picker.get()).toBe('mic-b');
    expect(select.options.map((o) => o.text)).toEqual(['いつものマイク（端末の設定）', 'A', 'B']);
  });
  it('一覧が見えて、もう無ければ、端末の設定に戻す', async () => {
    devices = [{ kind: 'audioinput', deviceId: 'mic-a', label: 'A' }];
    const { picker, select } = await mount();
    expect(picker.get()).toBe('');
    expect(select.value).toBe('');
  });
});
