// 声の一覧のページ（voices.html）: サイトに入っている声を、所属ごとに並べる。名前・所属で探す・大枠で絞る。
// 出すのはサイトのデータにある物だけ（名前・所属・大枠・公式ページ）。探す言葉と大枠は URL（?q= ・?kind=）に入れて、そのまま共有できる。
import { CATALOG, voicesReady } from '../data/load.ts';
import { filterCatalog, groupByAffiliation } from '../data/catalog-search.ts';
import { KIND_BY_ID, KINDS, kindLabel, kindsOf, maskOf } from '../data/kinds.ts';
import { el } from './items.ts';
import { mountLang, onLang, t } from '../i18n.ts';
import { mountFooter, mountGithubLink } from './share.ts';

mountLang({ ja: '声の一覧｜voice-match', en: 'Voices | voice-match' });
mountGithubLink();
mountFooter();

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
/** 一度に出す数（声が増えても重くならないように。続きは「もっと見る」） */
const PAGE = 400;

const params = new URLSearchParams(location.search);
const input = $<HTMLInputElement>('vl-q');
input.value = params.get('q') ?? '';
input.placeholder = t('例: 名前の一部、所属', 'e.g. part of a name, or an agency');
let kindMask = (() => {
  const k = params.get('kind');
  return k && KIND_BY_ID.has(k) ? maskOf([k]) : 0;
})();
let limit = PAGE;
let ready = false;

/** URL を今の探し方に合わせる（履歴は増やさない） */
function keepInUrl(): void {
  const p = new URLSearchParams(location.search);
  const q = input.value.trim();
  if (q) p.set('q', q);
  else p.delete('q');
  const k = kindsOf(kindMask)[0];
  if (k) p.set('kind', k.id);
  else p.delete('kind');
  const s = p.toString();
  history.replaceState(null, '', `${location.pathname}${s ? `?${s}` : ''}${location.hash}`);
}

function drawKindChips(): void {
  const counts = KINDS.map((k) => [k, CATALOG.filter((e) => e.kinds?.includes(k.id)).length] as const).filter(([, n]) => n > 0);
  if (kindMask && !counts.some(([k]) => 1 << k.bit === kindMask)) kindMask = 0;
  $('kind-filter').hidden = !counts.length;
  const chip = (mask: number, label: string, n: number) => {
    const b = el('button', 'kind-chip');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(mask === kindMask));
    b.append(label, el('span', 'n', String(n)));
    b.addEventListener('click', () => {
      if (mask === kindMask) return;
      kindMask = mask;
      limit = PAGE;
      keepInUrl();
      drawKindChips();
      draw();
    });
    return b;
  };
  $('kind-chips').replaceChildren(chip(0, t('すべて', 'All'), CATALOG.length), ...counts.map(([k, n]) => chip(1 << k.bit, kindLabel(k), n)));
}

function draw(): void {
  const box = $('vl-groups');
  const more = $<HTMLButtonElement>('vl-more');
  if (!ready) {
    $('vl-count').textContent = t('読み込んでいます…', 'Loading…');
    return;
  }
  if (!CATALOG.length) {
    $('vl-count').textContent = t('まだ声が入っていません。', 'No voices yet.');
    box.replaceChildren();
    more.hidden = true;
    return;
  }
  const hits = filterCatalog(CATALOG, input.value, kindMask);
  const narrowed = hits.length !== CATALOG.length;
  $('vl-count').textContent = narrowed
    ? hits.length
      ? t(`${CATALOG.length} 人のうち ${hits.length} 人`, `${hits.length} of ${CATALOG.length} voices`)
      : t(`${CATALOG.length} 人の中に見つかりませんでした。`, `Not found among the ${CATALOG.length} voices.`)
    : t(`${CATALOG.length} 人`, `${CATALOG.length} voices`);
  let left = limit;
  const sections: HTMLElement[] = [];
  for (const g of groupByAffiliation(hits)) {
    if (left <= 0) break;
    const sec = el('section', 'vl-group card');
    const head = el('h2');
    head.append(g.group ?? t('所属なし', 'No agency'), el('span', 'n', t(`${g.entries.length} 人`, String(g.entries.length))));
    const ul = el('ul', 'vl-list');
    for (const v of g.entries.slice(0, left)) {
      const li = el('li', 'vl-item');
      const a = el('a', 'vl-name', v.name);
      a.href = v.links.profile;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.append(a);
      const kinds = (v.kinds ?? []).map((id) => KIND_BY_ID.get(id)).filter((k) => k !== undefined);
      // (the category is shown only when it tells something: when every voice is a VTuber, the tag says nothing)
      if (kinds.length && (kinds.length > 1 || hasManyKinds)) {
        const tags = el('span', 'vl-tags');
        for (const k of kinds) tags.append(el('span', 'vl-tag', kindLabel(k)));
        li.append(tags);
      }
      const mim = el('a', 'vl-act', t('この声で声真似', 'Mimic this voice'));
      mim.href = `./mimic.html?target=${encodeURIComponent(v.name)}`;
      mim.title = t(`${v.name}の声で声真似の点数をみる`, `Try imitating ${v.name}`);
      li.append(mim);
      ul.append(li);
    }
    left -= g.entries.length;
    sec.append(head, ul);
    sections.push(sec);
  }
  box.replaceChildren(...sections);
  const rest = hits.length - limit;
  more.hidden = rest <= 0;
  more.textContent = t(`もっと見る（あと ${rest} 人）`, `Show more (${rest} left)`);
}

let hasManyKinds = false;
let timer = 0;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    limit = PAGE;
    keepInUrl();
    draw();
  }, 120);
});
$('vl-more').addEventListener('click', () => {
  limit += PAGE;
  draw();
});
onLang(() => {
  input.placeholder = t('例: 名前の一部、所属', 'e.g. part of a name, or an agency');
  if (!ready) return;
  drawKindChips();
  draw();
});

draw();
void voicesReady.then(() => {
  ready = true;
  hasManyKinds = new Set(CATALOG.flatMap((e) => e.kinds ?? [])).size > 1;
  drawKindChips();
  draw();
});
