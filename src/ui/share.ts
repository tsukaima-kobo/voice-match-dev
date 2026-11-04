// 結果のシェア（X など）と、作った人のリンク、GitHub のスター（設定がある時だけ）。
// - X に投稿: X の投稿の画面を、文・サイトの住所・ハッシュタグを入れた状態で新しいタブで開く（画像は付けられないので、
//   「画像を保存」してから投稿の画面で添える）。スマホなど、ファイルを共有できるブラウザーでは「画像つきで共有」も出す。
// - 共有カードは share-card.ts。押すまで、どこにも何も送らない（このサイトから外へ通信しない。開くのは X の画面だけ）。
// - GitHub のスターの導線は site-config.ts の github が空の間は出さない（本番のリリースまで）。
import { githubUrl, makerLinks, SITE, xIntent } from '../site-config.ts';
import { onLang, t } from '../i18n.ts';
import { drawCard, type CardData } from './share-card.ts';
import githubStars from './github-stars.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** 共有の文（今の言葉で） */
export function shareText(d: CardData): string {
  if (d.kind === 'voice')
    return d.top
      ? t(`わたしの声に一番近いのは「${d.top.name}」でした（${d.top.word}）。あなたの声は誰に近い？`, `My voice is closest to “${d.top.name}” (${d.top.word}). Whose voice is yours closest to?`)
      : t('声を 45 項目で測って、声紋にしてみた。あなたの声はどんな模様？', 'I measured my voice in 45 ways and turned it into a voiceprint. What does yours look like?');
  const who = d.model.name;
  return who
    ? t(`「${who}」の声真似、${d.score} 点でした（${d.word}）。あなたは何点？`, `I scored ${d.score} imitating “${who}” (${d.word}). Can you beat it?`)
    : t(`声真似の点数、${d.score} 点でした（${d.word}）。あなたは何点？`, `My voice-mimic score: ${d.score} (${d.word}). Can you beat it?`);
}

/** GitHub のスターの誘い（設定が無ければ null） */
export function starCta(): HTMLElement | null {
  const url = githubUrl();
  if (!url) return null;
  const box = el('div', 'star-cta');
  const label = () => {
    box.replaceChildren();
    const a = el('a', 'button-link');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = t('GitHub でスターする', 'Star it on GitHub');
    const n = githubStars();
    if (n !== null) a.append(el('span', 'star-count', `★ ${n.toLocaleString()}`));
    box.append(el('p', undefined, t('楽しかったら、GitHub でスターをお願いします。このサイトはオープンソースです。', 'If you enjoyed it, a star on GitHub helps a lot. This site is open source.')), a);
  };
  label();
  onLang(label);
  return box;
}

/** 作った人のリンク（足元・シェアの所） */
export function makerBox(compact = false): HTMLElement {
  const box = el('div', compact ? 'maker compact' : 'maker');
  const draw = () => {
    box.replaceChildren();
    const head = el('p', 'maker-head');
    head.append(el('span', undefined, t('作った人', 'Made by')), el('b', undefined, t(SITE.maker.name, SITE.maker.nameEn)));
    const list = el('ul', 'maker-links');
    for (const l of makerLinks()) {
      const li = el('li');
      const a = el('a', `maker-link ${l.id}`, l.name);
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', t(`${SITE.maker.name}の ${l.name}（新しいタブで開きます）`, `${SITE.maker.nameEn} on ${l.name} (opens in a new tab)`));
      li.append(a);
      list.append(li);
    }
    box.append(head, list);
  };
  draw();
  onLang(draw);
  return box;
}

/** 見出しに GitHub のリンク（設定がある時だけ） */
export function mountGithubLink(): void {
  const url = githubUrl();
  if (!url) return;
  const a = el('a', 'gh-link');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  const draw = () => {
    a.textContent = 'GitHub';
    const n = githubStars();
    if (n !== null) a.append(el('span', 'star-count', `★ ${n.toLocaleString()}`));
    a.setAttribute('aria-label', t('GitHub のリポジトリ（新しいタブで開きます）', 'GitHub repository (opens in a new tab)'));
  };
  draw();
  onLang(draw);
  document.querySelector('.site .lang-switch')?.before(a);
}

/** 足元に、作った人のリンク（と GitHub）を置く */
export function mountFooter(): void {
  const foot = document.querySelector('footer.site-foot');
  if (!foot) return;
  const box = el('div', 'foot-maker');
  box.append(makerBox(true));
  const url = githubUrl();
  if (url) {
    const a = el('a', 'gh-foot', 'GitHub');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    box.append(a);
  }
  foot.append(box);
}

export interface ShareUi {
  /** 結果が出た時・言葉を切り替えた時に、カードを作り直す */
  update(d: CardData): void;
}

/** 結果のシェアの所を `box` に作る */
export function mountShare(box: HTMLElement): ShareUi {
  box.classList.add('share');
  let data: CardData | null = null;
  let card: HTMLCanvasElement | null = null;
  const head = el('header', 'section-head');
  const kicker = el('p', 'kicker');
  const title = el('h2');
  const lead = el('p');
  head.append(kicker, title, lead);
  const row = el('div', 'share-row');
  const preview = el('img', 'share-preview');
  preview.alt = '';
  preview.width = 1080;
  preview.height = 1350;
  const side = el('div', 'share-side');
  const xBtn = el('a', 'button-link share-x');
  xBtn.target = '_blank';
  xBtn.rel = 'noopener noreferrer';
  const save = el('button', 'share-save');
  save.type = 'button';
  const native = el('button', 'share-native');
  native.type = 'button';
  native.hidden = true;
  const hint = el('p', 'hint');
  const actions = el('div', 'actions');
  actions.append(xBtn, native, save);
  side.append(actions, hint, makerBox());
  const star = starCta();
  if (star) side.append(star);
  row.append(preview, side);
  box.replaceChildren(head, row);

  // (files can be shared: a phone's share sheet, where X takes the picture too)
  const probe = typeof File !== 'undefined' ? new File([new Uint8Array(1)], 'voice-match.png', { type: 'image/png' }) : null;
  const canShareFiles = !!(probe && navigator.canShare?.({ files: [probe] }));

  const labels = () => {
    kicker.textContent = t('シェア', 'Share');
    title.textContent = t('結果をシェアする', 'Share your result');
    lead.textContent = t('カードに載るのは、結果と数字と声紋だけです。音・あなたの名前・顔などは載りません。押すまで、どこにも何も送りません。', 'The card shows only the result, numbers and voiceprint — never the sound, your name or your face. Nothing is sent anywhere until you press.');
    xBtn.textContent = t('X に投稿', 'Post on X');
    save.textContent = t('画像を保存', 'Save the image');
    native.textContent = t('画像つきで共有', 'Share with the image');
    hint.textContent = canShareFiles
      ? t('「画像つきで共有」で X を選ぶと、カードの画像も一緒に投稿できます。', 'Choose X in “Share with the image” to post the card along with it.')
      : t('X に画像も載せる時は、先に「画像を保存」してから、投稿の画面で画像を添えてください。', 'To post the card on X, save the image first, then attach it in the post window.');
    preview.alt = t('共有カードの見本', 'Preview of the share card');
  };
  const refresh = () => {
    if (!data) return;
    card = drawCard(data);
    preview.src = card.toDataURL('image/png');
    xBtn.href = xIntent(shareText(data));
  };
  save.addEventListener('click', () => {
    if (!card) return;
    const a = el('a');
    a.href = card.toDataURL('image/png');
    a.download = 'voice-match.png';
    a.click();
  });
  native.hidden = !canShareFiles;
  native.addEventListener('click', () => {
    if (!card || !data) return;
    const text = shareText(data);
    card.toBlob((b) => {
      if (!b) return;
      const file = new File([b], 'voice-match.png', { type: 'image/png' });
      void navigator.share({ files: [file], text: `${text} ${SITE.url} ${SITE.hashtags.map((h) => `#${h}`).join(' ')}` }).catch(() => {});
    }, 'image/png');
  });
  labels();
  onLang(() => {
    labels();
    refresh();
  });
  return {
    update(d) {
      data = d;
      refresh();
    },
  };
}
