// 声紋（src/ui/voiceprint.ts）が WebGL の文脈を失った時の試験。WebGL と canvas は、何もしない代わりを置く（描く所は画面で確かめる）
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceprint } from '../src/ui/voiceprint.ts';
import { FEATURE_KEYS, type Features } from '../src/voice/features.ts';

/** どの名前を読んでも、呼んでも、自分を返す何もしない物（数にすると 0） */
function anything(log?: string[]): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : p),
    set: () => true,
    apply: () => p,
  });
  return new Proxy(
    {},
    {
      get: (_, k) => {
        if (k === Symbol.toPrimitive) return () => 0;
        if (typeof k === 'string' && log) return (...a: unknown[]) => (log.push(k), a.length ? p : p);
        return p;
      },
      set: () => true,
    },
  );
}

class FakeCanvas {
  className = '';
  width = 0;
  height = 0;
  readonly style = { display: '' };
  parent: FakeBox | null = null;
  readonly calls: string[] = [];
  private readonly on = new Map<string, (e: unknown) => void>();
  lost = false;
  readonly gl = new Proxy(anything() as object, {
    get: (t, k) => {
      if (k === 'getShaderParameter' || k === 'getProgramParameter') return () => true;
      if (k === 'isContextLost') return () => this.lost;
      if (k === 'getExtension') return () => null;
      return Reflect.get(t, k);
    },
  });
  readonly ctx2d = anything(this.calls);
  get isConnected() {
    return !!this.parent;
  }
  get clientWidth() {
    return 300;
  }
  setAttribute() {}
  addEventListener(type: string, f: (e: unknown) => void) {
    this.on.set(type, f);
  }
  removeEventListener() {}
  fire(type: string) {
    this.on.get(type)?.({ preventDefault() {} });
  }
  getContext(kind: string) {
    return kind === 'webgl2' ? this.gl : this.ctx2d;
  }
  remove() {
    if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this);
    this.parent = null;
  }
}
class FakeBox {
  kids: FakeCanvas[] = [];
  readonly clientWidth = 300;
  setAttribute() {}
  append(...k: FakeCanvas[]) {
    for (const c of k) {
      c.parent = this;
      this.kids.push(c);
    }
  }
}

const feats = Object.fromEntries(FEATURE_KEYS.map((k) => [k, null])) as Features;

describe('声紋が WebGL の文脈を失った時', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('数字の札を消し、しばらく戻らなければ 2D の図に替え、戻ったら声紋に戻す', () => {
    vi.useFakeTimers();
    const off = { addEventListener() {}, removeEventListener() {} };
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { createElement: () => new FakeCanvas(), hidden: false, body: {}, ...off });
    vi.stubGlobal('matchMedia', () => ({ matches: false, ...off }));
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', fontFamily: 'sans-serif' }));
    vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => setTimeout(() => f(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    class Obs {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Obs);
    vi.stubGlobal('ResizeObserver', Obs);

    const box = new FakeBox();
    const vp = createVoiceprint(box as unknown as HTMLElement)!;
    expect(vp).not.toBe(null);
    const [gl, over] = box.kids as [FakeCanvas, FakeCanvas];
    vp.set(feats);
    vp.focus('shape', 'pitch');
    // 描き出しが終わって、札が出ている
    vi.advanceTimersByTime(3000);
    expect(over.calls).toContain('fillText');

    gl.lost = true;
    gl.fire('webglcontextlost');
    expect(over.calls.at(-1)).toBe('clearRect');
    const n = over.calls.length;
    vi.advanceTimersByTime(1000);
    // 失っている間は描かない（札も出さない）
    expect(over.calls.length).toBe(n);
    expect(box.kids.length).toBe(2);
    vi.advanceTimersByTime(300);
    const flat = box.kids[2]!;
    expect(flat.className).toBe('shape-canvas');
    expect(gl.style.display).toBe('none');
    expect(over.style.display).toBe('none');

    gl.lost = false;
    gl.fire('webglcontextrestored');
    expect(box.kids).toEqual([gl, over]);
    expect(gl.style.display).toBe('');
    vi.advanceTimersByTime(100);
    expect(over.calls.length).toBeGreaterThan(n);
    vp.dispose();
  });

  it('すぐ戻った時は 2D の図に替えない', () => {
    vi.useFakeTimers();
    const off = { addEventListener() {}, removeEventListener() {} };
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { createElement: () => new FakeCanvas(), hidden: false, body: {}, ...off });
    vi.stubGlobal('matchMedia', () => ({ matches: true, ...off }));
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', fontFamily: 'sans-serif' }));
    vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => setTimeout(() => f(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    class Obs {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Obs);
    vi.stubGlobal('ResizeObserver', Obs);
    const box = new FakeBox();
    const vp = createVoiceprint(box as unknown as HTMLElement)!;
    const [gl] = box.kids as [FakeCanvas];
    vp.set(feats);
    vi.advanceTimersByTime(100);
    gl.lost = true;
    gl.fire('webglcontextlost');
    vi.advanceTimersByTime(300);
    gl.lost = false;
    gl.fire('webglcontextrestored');
    vi.advanceTimersByTime(3000);
    expect(box.kids.length).toBe(2);
    vp.dispose();
  });
});
