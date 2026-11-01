// 収集の拡張機能の、DOM を使わない部分（test/collector.test.ts で試す）。
// 再生中の音を 30 秒ずつの窓にまとめ、途切れ（一時停止・シーク・広告・速度の変更・動画の切り替え）があれば、その窓は捨てる。
// 窓の音は measure.ts で数字にしたら捨てる。残すのは数字・動画 ID・時刻だけ。
import type { Measured } from '../../src/voice/measure.ts';
import type { VoiceFile, VoiceWindow } from '../../src/data/types.ts';

export const WINDOW_SECONDS = 30;

/** 今の再生の様子（content.ts が動画の要素から読む） */
export interface PlayState {
  video: string | null;
  time: number;
  paused: boolean;
  seeking: boolean;
  rate: number;
  ad: boolean;
}

export type BreakReason = 'ad' | 'paused' | 'speed' | 'jump' | 'other-video' | 'no-video';

export interface Finished {
  pcm: Float32Array;
  video: string;
  t0: number;
  t1: number;
}

/** 音のかたまりを受けて、30 秒たまったら 1 つの窓を返す */
export class Windower {
  private chunks: Float32Array[] = [];
  private got = 0;
  private t0 = 0;
  private video: string | null = null;
  readonly sampleRate: number;
  /** 最後に窓を捨てた理由（パネルに出す） */
  lastBreak: BreakReason | null = null;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  /** たまっている秒数 */
  seconds(): number {
    return this.got / this.sampleRate;
  }

  reset(reason: BreakReason | null): void {
    if (this.got > 0 && reason) this.lastBreak = reason;
    this.chunks = [];
    this.got = 0;
  }

  push(samples: Float32Array, s: PlayState): Finished | null {
    const dur = samples.length / this.sampleRate;
    const stop: BreakReason | null = !s.video ? 'no-video' : s.ad ? 'ad' : s.paused || s.seeking ? 'paused' : s.rate !== 1 ? 'speed' : null;
    if (stop || !s.video) {
      this.reset(stop);
      return null;
    }
    if (this.video !== null && s.video !== this.video) this.reset('other-video');
    this.video = s.video;
    if (this.got === 0) this.t0 = s.time - dur;
    // (the video's clock should have moved as far as the sound: more than a second off is a seek)
    else if (Math.abs(s.time - (this.t0 + this.got / this.sampleRate + dur)) > 1) {
      this.reset('jump');
      this.t0 = s.time - dur;
    }
    this.chunks.push(samples);
    this.got += samples.length;
    if (this.got < WINDOW_SECONDS * this.sampleRate) return null;
    const pcm = new Float32Array(this.got);
    let at = 0;
    for (const c of this.chunks) {
      pcm.set(c, at);
      at += c.length;
    }
    const done: Finished = { pcm, video: s.video, t0: Math.max(0, Math.round(this.t0 * 10) / 10), t1: Math.round(s.time * 10) / 10 };
    this.chunks = [];
    this.got = 0;
    this.lastBreak = null;
    return done;
  }
}

/** 数字にした結果を窓に（測れなかった時は null） */
export function windowOf(m: Measured, f: Omit<Finished, 'pcm'>, version: string, date: string): VoiceWindow | null {
  if (!m.ok) return null;
  return {
    video: f.video,
    t0: f.t0,
    t1: f.t1,
    measuredAt: date,
    version,
    features: m.features,
    voicedSeconds: m.info.voicedSeconds,
    gapTonal: Math.round(m.info.gapTonal * 1000) / 1000,
    snrDb: Math.round((m.info.loudDb - m.info.floorDb) * 10) / 10,
  };
}

/** 同じ動画の同じ所を、もう一度測った窓か（半分以上重なる） */
export function overlapsExisting(file: VoiceFile, w: VoiceWindow): boolean {
  return file.windows.some((x) => {
    if (x.video !== w.video) return false;
    const inter = Math.min(x.t1, w.t1) - Math.max(x.t0, w.t0);
    return inter > 0.5 * Math.min(x.t1 - x.t0, w.t1 - w.t0);
  });
}

/** 窓を足す（重なる物は足さない）。足したら true */
export function addWindow(file: VoiceFile, w: VoiceWindow): boolean {
  if (overlapsExisting(file, w)) return false;
  file.windows.push(w);
  file.windows.sort((a, b) => (a.video < b.video ? -1 : a.video > b.video ? 1 : a.t0 - b.t0));
  return true;
}

/** YouTube の住所から動画 ID */
export function videoIdOf(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = u.pathname.match(/^\/live\/([\w-]{6,})/);
  return m ? m[1]! : null;
}
