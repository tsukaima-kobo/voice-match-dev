// 「じっくり測ったあなたの声」を、声のページの比べる相手に入れる（この端末のブラウザーだけ。数字だけ。どこにも送らない）。
// じっくり測る（measure.html）で「声のページの相手に入れる」を押した時だけ残し、「外す」で消す。
// 本人がその中で何位に出るかで、サイトの当たりやすさを確かめるため。読めない・版が違う時は、無い物として扱う。
import { FEATURE_KEYS, type Features } from '../voice/features.ts';

const KEY = 'voice-match-mine';

export interface Mine {
  v: 1;
  /** 測り方の版（違う版の数字とは比べない） */
  m: string;
  /** 使った窓の数 */
  windows: number;
  /** 測った日（YYYY-MM-DD） */
  date: string;
  features: Features;
}

export function loadMine(measureVersion: string): Mine | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<Mine>;
    if (o.v !== 1 || o.m !== measureVersion || typeof o.features !== 'object' || o.features === null) return null;
    const f = o.features as Record<string, unknown>;
    if (!FEATURE_KEYS.every((k) => f[k] === null || typeof f[k] === 'number')) return null;
    return o as Mine;
  } catch {
    return null;
  }
}

/** 残す。残せなかった時（ブラウザーが許さない時）は false */
export function saveMine(mine: Mine): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(mine));
    return true;
  } catch {
    return false;
  }
}

export function clearMine(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* (nothing kept) */
  }
}
