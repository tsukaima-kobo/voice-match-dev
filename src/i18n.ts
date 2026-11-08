// 言葉（日本語・英語）。同じページの中で、見出しの右の「JP / EN」で切り替える。
// ページに書いた言葉は、両方を書いておき（lang="ja" と lang="en" の要素）、CSS で片方だけ見せる。
// プログラムが出す言葉は t(日本語, 英語)。切り替えた時は onLang に登録した関数で出し直す。
// 最初の言葉は public/lang.js が決める（URL の ?lang=、前に選んだ言葉、ブラウザーの言葉の順）。選んだ言葉だけを、この端末に覚える。
// ブラウザーの無い所（試験・tools）では日本語。
export type Lang = 'ja' | 'en';
const KEY = 'voice-match-lang';

export let lang: Lang = typeof document !== 'undefined' && document.documentElement.dataset.lang === 'en' ? 'en' : 'ja';
const listeners = new Set<() => void>();

/** 今の言葉で */
export const t = (ja: string, en: string): string => (lang === 'en' ? en : ja);
/** 言葉を切り替えた時に呼ぶ */
export function onLang(f: () => void): void {
  listeners.add(f);
}

/** 属性（placeholder・aria-label・title）: data-en-placeholder などに英語を書いておく。日本語は最初の値を覚える */
function applyAttrs(): void {
  for (const a of ['placeholder', 'aria-label', 'title'] as const) {
    for (const e of document.querySelectorAll<HTMLElement>(`[data-en-${a}]`)) {
      const jaKey = `data-ja-${a}`;
      if (!e.hasAttribute(jaKey)) e.setAttribute(jaKey, e.getAttribute(a) ?? '');
      e.setAttribute(a, lang === 'en' ? e.getAttribute(`data-en-${a}`)! : e.getAttribute(jaKey)!);
    }
  }
}

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  document.documentElement.lang = l;
  document.documentElement.dataset.lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* 覚えられない時は、次にまた選ぶ */
  }
  // 住所（URL）が言葉を指定していたら、選んだ言葉に合わせる
  const u = new URL(location.href);
  if (u.searchParams.has('lang')) {
    u.searchParams.set('lang', l);
    history.replaceState(history.state, '', u);
  }
  applyAttrs();
  for (const f of listeners) f();
}

/** 見出しに「JP / EN」を置き、ページの題も言葉に合わせる */
export function mountLang(title: { ja: string; en: string }): void {
  const setTitle = () => (document.title = t(title.ja, title.en));
  const box = document.createElement('div');
  box.className = 'lang-switch';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Language / 言葉');
  const make = (l: Lang, label: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => setLang(l));
    return b;
  };
  const ja = make('ja', 'JP'),
    en = make('en', 'EN');
  box.append(ja, en);
  const sync = () => {
    ja.setAttribute('aria-pressed', String(lang === 'ja'));
    en.setAttribute('aria-pressed', String(lang === 'en'));
    setTitle();
  };
  document.querySelector('.site')?.append(box);
  onLang(sync);
  sync();
  applyAttrs();
}
