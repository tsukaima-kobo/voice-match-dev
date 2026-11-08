// 声のかたち（src/ui/voice-shape.ts）の、数字から図の値への写し方と、図の読み方の言葉。描く所は画面で確かめる。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { levelWord, renderGuide, SHAPE_LAYERS, shapeParams, type ShapeView } from '../src/ui/voice-shape.ts';
import { setLang } from '../src/i18n.ts';
import { FEATURE_BY_KEY, FEATURE_KEYS, type Features } from '../src/voice/features.ts';

const none = Object.fromEntries(FEATURE_KEYS.map((k) => [k, null])) as Features;

describe('声のかたち', () => {
  it('名前を挙げた項目は、どれも本当にある項目から読む', () => {
    for (const l of SHAPE_LAYERS) for (const i of l.items) expect(FEATURE_BY_KEY[i.key], i.key).toBeDefined();
  });
  it('数字を棒と同じ 0–1 の目盛りに置き、測っていない物は空にする', () => {
    const d = FEATURE_BY_KEY.pitch;
    const p = shapeParams({ ...none, pitch: d.hi, rate: null, hnr: FEATURE_BY_KEY.hnr.lo });
    expect(p.pitch).toBe(1);
    expect(p.hnr).toBe(0);
    expect(p.rate).toBeNull();
    expect(shapeParams({ ...none, pitch: 150 })).toEqual(shapeParams({ ...none, pitch: 150 }));
  });
  it('数字がどのあたりかを、言葉で言う', () => {
    const d = FEATURE_BY_KEY.pitch;
    expect(levelWord('pitch', d.lo)).toBe(`かなり${d.low}`);
    expect(levelWord('pitch', d.hi)).toBe(`かなり${d.high}`);
    expect(levelWord('pitch', null)).toBe('まだ測っていません');
    expect(levelWord('mfcc2', 0)).toBe('');
  });
});

describe('図の読み方の言葉', () => {
  afterEach(() => {
    setLang('ja');
    vi.unstubAllGlobals();
  });
  it('層と項目の名前・説明は、読み込んだ後に切り替えた言葉で出る（音色の名前も）', () => {
    // 言葉を切り替えるのに要る物だけの、ページの代わり
    vi.stubGlobal('document', { documentElement: { lang: 'ja', dataset: {} }, querySelectorAll: () => [] });
    vi.stubGlobal('location', { href: 'https://example.com/' });
    const timbre = () => SHAPE_LAYERS.flatMap((l) => l.items).find((i) => i.key === 'mfcc2')!;
    expect(timbre().name).toBe('音色');
    setLang('en');
    expect(timbre().name).toBe('Timbre');
    expect(SHAPE_LAYERS[0]!.name).toBe('Shape');
    expect(timbre().fig).toMatch(/^The fingerprint/);
    setLang('ja');
    expect(timbre().name).toBe('音色');
    // 名前の無い項目は、項目の名前を使う（name を持たない）
    expect(SHAPE_LAYERS[0]!.items.every((i) => !('name' in i))).toBe(true);
  });
});

/* ---- 図の読み方の案内（項目を順に光らせる）。要る所だけの、ページの代わりで ---- */
class FakeEl {
  className = '';
  textContent = '';
  type = '';
  readonly isConnected = true;
  readonly attrs = new Map<string, string>();
  readonly kids: FakeEl[] = [];
  private readonly on = new Map<string, Set<(e: unknown) => void>>();
  append(...k: unknown[]) {
    for (const x of k) if (x instanceof FakeEl) this.kids.push(x);
  }
  replaceChildren(...k: unknown[]) {
    this.kids.length = 0;
    this.append(...k);
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  addEventListener(type: string, f: (e: unknown) => void, opts?: { signal?: AbortSignal }) {
    const set = this.on.get(type) ?? new Set();
    set.add(f);
    this.on.set(type, set);
    opts?.signal?.addEventListener('abort', () => set.delete(f));
  }
  fire(type: string, e: unknown = {}) {
    for (const f of [...(this.on.get(type) ?? [])]) f(e);
  }
  all(): FakeEl[] {
    return this.kids.flatMap((k) => [k, ...k.all()]);
  }
}

describe('図の読み方の案内', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('案内を止めたら、光らせていた項目を消す（押した名前が無いのに、光ったままにしない）', () => {
    vi.useFakeTimers();
    let seen: (es: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { createElement: () => new FakeEl() });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(f: typeof seen) {
          seen = f;
        }
        observe() {}
        disconnect() {}
      },
    );
    const focus: [string | null, string | null][] = [];
    const view: ShapeView = { set() {}, focus: (l, i) => void focus.push([l, i ?? null]), dispose() {} };
    const box = new FakeEl();
    renderGuide(box as unknown as HTMLElement, [view], [{ who: 'あなた', f: none }]);
    seen([{ isIntersecting: true }]);
    vi.advanceTimersByTime(2600 * 3);
    // 2 つ目の項目まで光らせた
    expect(focus.at(-1)).toEqual(['shape', 'pitchRange']);
    box.fire('pointerdown');
    expect(focus.at(-1)).toEqual([null, null]);
    const chips = box.all().filter((e) => e.className === 'shape-chip');
    expect(chips.every((c) => c.attrs.get('aria-pressed') === 'false')).toBe(true);
    // もう進まない
    const n = focus.length;
    vi.advanceTimersByTime(2600 * 5);
    expect(focus.length).toBe(n);
    // 名前を押したら、その項目を光らせたまま
    chips[3]!.fire('click');
    expect(focus.at(-1)).toEqual(['shape', 'pitchMotion']);
    expect(chips[3]!.attrs.get('aria-pressed')).toBe('true');
  });
});
