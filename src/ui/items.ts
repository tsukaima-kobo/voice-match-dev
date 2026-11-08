// 項目の並び（声のページの「あなたの声」と、声真似の点数の「お手本とあなた」で共通）。
// まとまり（高さ・響き…）ごとの枠に並べ、意味を言葉にしにくい項目（features.ts の detail）は「細かい項目」に畳む。
import { displayValue, FEATURES, GROUP_NAMES, type FeatureDef, type FeatureGroup } from '../voice/features.ts';
import { t } from '../i18n.ts';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 1 行: 名前・目盛り（点はいくつでも）・数字 */
export function itemRow(d: FeatureDef, dots: { value: number | null; cls?: string }[], value: HTMLElement): HTMLElement {
  const row = el('div', 'item');
  const label = el('div', 'label', d.name);
  label.title = d.about;
  const scale = el('div', 'scale');
  scale.append(el('div', 'line'));
  const xs = dots.filter((p) => p.value !== null).map((p) => ({ ...p, x: displayValue(d.key, p.value!) * 100 }));
  if (xs.length >= 2) {
    // 2 つ以上なら、その間を線でつなぐ: お手本とあなたのずれ
    const span = el('div', 'span');
    span.style.setProperty('--from', `${Math.min(...xs.map((p) => p.x))}%`);
    span.style.setProperty('--to', `${Math.max(...xs.map((p) => p.x))}%`);
    scale.append(span);
  }
  for (const p of xs) {
    const dot = el('div', p.cls ? `dot ${p.cls}` : 'dot');
    dot.style.setProperty('--x', `${p.x}%`);
    scale.append(dot);
  }
  const ends = el('div', 'ends');
  ends.append(el('span', undefined, d.low), el('span', undefined, d.high));
  scale.append(ends);
  row.append(label, scale, value);
  return row;
}

/** まとまりごとの枠を `box` に作り直す */
export function renderGroups(box: HTMLElement, makeRow: (d: FeatureDef) => HTMLElement): void {
  box.replaceChildren();
  const groups = [...new Set(FEATURES.map((d) => d.group))] as FeatureGroup[];
  groups.forEach((g, i) => {
    const card = el('div', 'group');
    card.style.setProperty('--i', String(i));
    const h = el('h3');
    h.append(el('span', 'gno', String(i + 1).padStart(2, '0')), GROUP_NAMES[g]);
    card.append(h);
    const defs = FEATURES.filter((x) => x.group === g);
    for (const d of defs.filter((x) => !x.detail)) card.append(makeRow(d));
    const more = defs.filter((x) => x.detail);
    if (more.length) {
      const det = el('details', 'more');
      det.append(el('summary', undefined, t(`細かい項目（${more.length}）`, `More items (${more.length})`)));
      for (const d of more) det.append(makeRow(d));
      card.append(det);
    }
    box.append(card);
  });
}
