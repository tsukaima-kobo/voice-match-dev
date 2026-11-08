// src/ui/share-card.ts の角の丸い四角の試験。にせの 2D の絵の道具で、描く手順だけを見る。
// roundRect の無いブラウザー（Safari 15 まで など）でも、誤りにならず arcTo で描けること。
import { describe, expect, it } from 'vitest';
import { roundRect } from '../src/ui/share-card.ts';

function fakeCtx(withRoundRect: boolean) {
  const calls: [string, ...number[]][] = [];
  const ctx = {
    beginPath: () => void calls.push(['beginPath']),
    moveTo: (x: number, y: number) => void calls.push(['moveTo', x, y]),
    arcTo: (x1: number, y1: number, x2: number, y2: number, r: number) => void calls.push(['arcTo', x1, y1, x2, y2, r]),
    closePath: () => void calls.push(['closePath']),
    ...(withRoundRect ? { roundRect: (x: number, y: number, w: number, h: number, r: number) => void calls.push(['roundRect', x, y, w, h, r]) } : {}),
  };
  return { ctx, calls };
}

describe('roundRect', () => {
  it('roundRect があれば、それを使う', () => {
    const { ctx, calls } = fakeCtx(true);
    roundRect(ctx as never, 10, 20, 100, 50, 8);
    expect(calls).toEqual([['beginPath'], ['roundRect', 10, 20, 100, 50, 8]]);
  });
  it('roundRect が無ければ、arcTo で 4 つの角を描いて閉じる', () => {
    const { ctx, calls } = fakeCtx(false);
    expect(() => roundRect(ctx as never, 10, 20, 100, 50, 8)).not.toThrow();
    expect(calls).toEqual([
      ['beginPath'],
      ['moveTo', 18, 20],
      ['arcTo', 110, 20, 110, 70, 8],
      ['arcTo', 110, 70, 10, 70, 8],
      ['arcTo', 10, 70, 10, 20, 8],
      ['arcTo', 10, 20, 110, 20, 8],
      ['closePath'],
    ]);
  });
  it('角の丸みは、短い辺の半分まで', () => {
    const { ctx, calls } = fakeCtx(false);
    roundRect(ctx as never, 0, 0, 40, 10, 44);
    expect(calls.filter((c) => c[0] === 'arcTo').every((c) => c[5] === 5)).toBe(true);
  });
});
