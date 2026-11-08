// 録っている間の高さの線（src/ui/live-analysis.ts の pitchOf）の試験。図を描く所は画面で確かめる。
import { describe, expect, it } from 'vitest';
import { LIVE_F0_MAX, pitchOf } from '../src/ui/live-analysis.ts';

const SR = 16000;
/** 倍音を含む声のような音（16 kHz・直近の約 70 ms） */
function tone(f: number, harmonics = true): Float32Array {
  const x = new Float32Array(1099);
  for (let i = 0; i < x.length; i++) {
    let v = 0;
    for (let h = 1; h * f < 7000 && (harmonics || h === 1); h++) v += Math.sin((2 * Math.PI * h * f * i) / SR + h * 0.3) / h;
    x[i] = 0.3 * v;
  }
  return x;
}

describe('高さの線', () => {
  it('65〜1090 Hz の高さを、2 % 以内で追う（歌や高い声真似も）', () => {
    for (const f of [65, 100, 220, 440, 600, 800, 1000, 1090]) {
      expect(Math.abs(pitchOf(tone(f)) / f - 1), `${f} Hz`).toBeLessThan(0.02);
      expect(Math.abs(pitchOf(tone(f, false)) / f - 1), `${f} Hz の純音`).toBeLessThan(0.02);
    }
  });
  it('上限より高い音は、1 オクターブ下と取り違えずに、無しにする', () => {
    expect(LIVE_F0_MAX).toBe(1100);
    for (const f of [1150, 1300, 1500, 2000, 3000]) {
      expect(pitchOf(tone(f)), `${f} Hz`).toBe(0);
      expect(pitchOf(tone(f, false)), `${f} Hz の純音`).toBe(0);
    }
  });
  it('雑音や無音には、高さを付けない', () => {
    let s = 1;
    const noise = new Float32Array(1099).map(() => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5);
    expect(pitchOf(noise)).toBe(0);
    expect(pitchOf(new Float32Array(1099))).toBe(0);
  });
});
