// じっくり測る（measure.html）の、画面の無い部分。決まった文を読み続けた声を 30 秒ずつに切って測り、
// サイトの声の代表値と同じ作り方（30 秒ごとの数字 → 高さが外れた窓を除く → 項目ごとの中央値）でまとめる。
// 窓の決まりは tools/lib.ts の SELECT と同じ（test/session.test.ts で確かめる）。音は持たない（切った窓は、測る所へ渡したら手放す）。
// 乱数を使うのは、決まった文の並びだけ。
import { type Features } from './features.ts';
import { medianFeatures, LONG_WINDOW_SECONDS } from './combine.ts';
import { quantileOf, type MeasureFail } from './measure.ts';

/** 読む長さの目安（分） */
export const SESSION_MINUTES = 20;
/** 窓の決まり（tools/lib.ts の SELECT と同じ） */
export const SESSION_SELECT = {
  /** 窓 1 つに要る声（秒） */
  minVoicedSeconds: 8,
  /** その人の高さの中央値から、これより離れた窓は除く（半音） */
  maxPitchOffSt: 3,
  /** 高さで除くのは、窓がこれ以上ある時だけ */
  pitchCheckFrom: 5,
  /** 代表値を作る最少の窓 */
  minWindows: 10,
} as const;

/** 1 つの窓（30 秒）を測った結果。t0 は読みはじめからの秒（止めていた間は数えない） */
export type SessionWindow = { t0: number; ok: true; voicedSeconds: number; snrDb: number; features: Features } | { t0: number; ok: false; reason: MeasureFail };

/** 届いた音を、決まった長さの窓に切る。足りない分は次に回す。drop() で途中の音を捨てる */
export class WindowCutter {
  private parts: Float32Array[] = [];
  private have = 0;
  constructor(readonly size: number) {}
  /** 届いた音を足す。窓がそろったら、その窓を返す（写しなので、受けた側で手放してよい） */
  push(x: Float32Array): Float32Array[] {
    this.parts.push(x);
    this.have += x.length;
    const out: Float32Array[] = [];
    while (this.have >= this.size) {
      const w = new Float32Array(this.size);
      let at = 0;
      while (at < this.size) {
        const p = this.parts[0]!;
        const n = Math.min(p.length, this.size - at);
        w.set(p.subarray(0, n), at);
        at += n;
        if (n === p.length) this.parts.shift();
        else this.parts[0] = p.subarray(n);
      }
      this.have -= this.size;
      out.push(w);
    }
    return out;
  }
  /** まだ窓にならない音（サンプル数） */
  get pending(): number {
    return this.have;
  }
  drop(): void {
    for (const p of this.parts) p.fill(0);
    this.parts = [];
    this.have = 0;
  }
}

/** 窓の長さ（サンプル数） */
export const windowSize = (rate: number): number => Math.round(LONG_WINDOW_SECONDS * rate);

/** 窓をまとめる: 測れた窓 → 高さが外れた窓を除く → 中央値。窓が足りなければ median は null */
export function summarize(windows: readonly SessionWindow[]): { median: Features | null; used: number; pitchOff: number; failed: number } {
  const good = windows.filter((w): w is Extract<SessionWindow, { ok: true }> => w.ok && w.voicedSeconds >= SESSION_SELECT.minVoicedSeconds && w.features.pitch !== null);
  let kept = good;
  if (good.length >= SESSION_SELECT.pitchCheckFrom) {
    const st = good.map((w) => 12 * Math.log2(w.features.pitch! / 100));
    const mid = quantileOf(st, 0.5);
    kept = good.filter((_, i) => Math.abs(st[i]! - mid) <= SESSION_SELECT.maxPitchOffSt);
  }
  return {
    median: kept.length >= SESSION_SELECT.minWindows ? medianFeatures(kept) : null,
    used: kept.length,
    pitchOff: good.length - kept.length,
    failed: windows.length - good.length,
  };
}

/** 0〜n-1 を混ぜた並び（決まった文を、同じ物が続かないように順に出すため） */
export function shuffled(n: number, random: () => number = Math.random): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** 書き出すファイル（数字だけ。音・名前は入らない） */
export interface SessionFile {
  kind: 'voice-match-session';
  version: 1;
  measureVersion: string;
  /** 測った日（YYYY-MM-DD） */
  date: string;
  /** 使ったマイクの名前（端末が教えた物。分からなければ無し） */
  mic?: string;
  windows: SessionWindow[];
  median: Features | null;
}

export function sessionFile(o: { measureVersion: string; date: string; mic?: string; windows: readonly SessionWindow[] }): SessionFile {
  return { kind: 'voice-match-session', version: 1, measureVersion: o.measureVersion, date: o.date, ...(o.mic ? { mic: o.mic } : {}), windows: [...o.windows], median: summarize(o.windows).median };
}
