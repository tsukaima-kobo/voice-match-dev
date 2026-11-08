// public/lang.js の試験。ページの代わりに、にせの location・localStorage・navigator・document の中で動かす。
// 確かめること: URL の ?lang= で選んだ言葉は、ボタンと同じく覚える。覚えられない端末でも、言葉は決まる。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const code = readFileSync(new URL('../public/lang.js', import.meta.url), 'utf8');
const KEY = 'voice-match-lang';

function run(o: { search?: string; saved?: string | null; browser?: string; blocked?: boolean }) {
  const store = new Map<string, string>();
  if (o.saved) store.set(KEY, o.saved);
  const localStorage = {
    getItem: (k: string) => {
      if (o.blocked) throw new Error('blocked');
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (o.blocked) throw new Error('blocked');
      store.set(k, v);
    },
  };
  const documentElement = { lang: '', dataset: {} as Record<string, string> };
  runInNewContext(code, { URLSearchParams, location: { search: o.search ?? '' }, localStorage, navigator: { language: o.browser ?? 'ja-JP' }, document: { documentElement } });
  return { lang: documentElement.dataset.lang, htmlLang: documentElement.lang, saved: store.get(KEY) ?? null };
}

describe('public/lang.js', () => {
  it('?lang= の言葉で始め、その言葉を覚える', () => {
    expect(run({ search: '?lang=en', browser: 'ja-JP' })).toEqual({ lang: 'en', htmlLang: 'en', saved: 'en' });
    expect(run({ search: '?lang=ja', saved: 'en', browser: 'en-US' })).toEqual({ lang: 'ja', htmlLang: 'ja', saved: 'ja' });
  });
  it('?lang= が無い・違う値なら、前に選んだ言葉、無ければブラウザーの言葉（覚えた物は変えない）', () => {
    expect(run({ saved: 'en', browser: 'ja-JP' })).toEqual({ lang: 'en', htmlLang: 'en', saved: 'en' });
    expect(run({ search: '?lang=fr', browser: 'ja' })).toEqual({ lang: 'ja', htmlLang: 'ja', saved: null });
    expect(run({ browser: 'en-GB' })).toEqual({ lang: 'en', htmlLang: 'en', saved: null });
  });
  it('覚えられない端末でも、?lang= とブラウザーの言葉で決まる', () => {
    expect(run({ search: '?lang=en', browser: 'ja-JP', blocked: true }).lang).toBe('en');
    expect(run({ browser: 'en-US', blocked: true }).lang).toBe('en');
    expect(run({ browser: 'ja-JP', blocked: true }).lang).toBe('ja');
  });
});
