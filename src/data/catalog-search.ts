// 声の一覧（voices.html）の、画面の無い部分。名前・所属（英語の名前でも）で探す・大枠で絞る・所属ごとに分ける。DOM なし・乱数なし。
// 探す言葉は、全角と半角・大文字と小文字・ひらがなとカタカナ・空白と「・」の違いを気にしない。
import type { CatalogEntry } from './types.ts';
import { maskOf } from './kinds.ts';

/** 探すための形（全角半角・大文字小文字・ひらがなカタカナ・空白や記号の違いをそろえる） */
export function searchKey(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・･·.\-_／/]+/g, '');
}

/**
 * 言葉と大枠で絞る。言葉は空白で区切ると、全部を含む物（名前と所属のどちらに入っていてもよい）。
 * kindMask が 0 なら大枠で絞らない
 */
export function filterCatalog(entries: readonly CatalogEntry[], query: string, kindMask = 0): CatalogEntry[] {
  const words = query.normalize('NFKC').split(/\s+/).map(searchKey).filter(Boolean);
  return entries.filter((e) => {
    if (kindMask && (maskOf(e.kinds ?? []) & kindMask) === 0) return false;
    if (!words.length) return true;
    const hay = searchKey([e.name, e.nameEn, e.group, e.groupEn].filter(Boolean).join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/** 所属ごとに分ける。人の多い所属から（同じ数なら名前順）。所属の無い声は最後。中は名前順。groupEn は、その所属の英語の名前（誰かにあれば） */
export function groupByAffiliation(entries: readonly CatalogEntry[]): { group: string | null; groupEn?: string; entries: CatalogEntry[] }[] {
  const by = new Map<string | null, CatalogEntry[]>();
  for (const e of entries) {
    const g = e.group?.trim() || null;
    const list = by.get(g);
    if (list) list.push(e);
    else by.set(g, [e]);
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, 'ja');
  return [...by]
    .map(([group, list]) => {
      const groupEn = list.find((e) => e.groupEn)?.groupEn;
      return { group, ...(group && groupEn ? { groupEn } : {}), entries: list.sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id)) };
    })
    .sort((a, b) => (a.group === null ? 1 : 0) - (b.group === null ? 1 : 0) || b.entries.length - a.entries.length || cmp(a.group ?? '', b.group ?? ''));
}
