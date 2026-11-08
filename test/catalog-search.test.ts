// 声の一覧（src/data/catalog-search.ts）の試験。
import { describe, expect, it } from 'vitest';
import { filterCatalog, groupByAffiliation, searchKey } from '../src/data/catalog-search.ts';
import { maskOf } from '../src/data/kinds.ts';
import type { CatalogEntry } from '../src/data/types.ts';

const e = (id: string, name: string, group?: string, kinds: string[] = ['vtuber']): CatalogEntry => ({ id, name, ...(group ? { group } : {}), kinds, links: { profile: `https://example.com/${id}` } });
const list = [
  e('v-1', 'アイラニ・イオフィフティーン', 'hololive Indonesia 1期生'),
  e('v-2', '春崎エアル', 'にじさんじ'),
  e('v-3', '静凛', 'にじさんじ'),
  e('v-4', 'Ｓａｍｐｌｅ　Ｓｉｎｇｅｒ', undefined, ['singer']),
  e('v-5', '熱千めら', 'ホロライブ', ['vtuber', 'singer']),
];

describe('声の一覧', () => {
  it('全角と半角・大文字と小文字・ひらがなとカタカナ・空白・点の違いは気にしない', () => {
    expect(searchKey('Ｓａｍｐｌｅ　Ｓｉｎｇｅｒ')).toBe('samplesinger');
    expect(searchKey('アイラニ・イオフィフティーン')).toBe(searchKey('あいらに いおふぃふてぃーん'));
  });
  it('名前か所属で探す（言葉が複数なら、全部に合う物）', () => {
    expect(filterCatalog(list, 'えある').map((x) => x.id)).toEqual(['v-2']);
    expect(filterCatalog(list, 'にじさんじ').map((x) => x.id)).toEqual(['v-2', 'v-3']);
    expect(filterCatalog(list, 'にじさんじ 静').map((x) => x.id)).toEqual(['v-3']);
    expect(filterCatalog(list, 'sample singer').map((x) => x.id)).toEqual(['v-4']);
    expect(filterCatalog(list, '  ').length).toBe(list.length);
    expect(filterCatalog(list, 'いない人')).toEqual([]);
  });
  it('大枠で絞る', () => {
    expect(filterCatalog(list, '', maskOf(['singer'])).map((x) => x.id)).toEqual(['v-4', 'v-5']);
    expect(filterCatalog(list, 'ホロ', maskOf(['singer'])).map((x) => x.id)).toEqual(['v-5']);
  });
  it('所属ごとにまとめる。人の多い所属が先、所属の無い人は最後、名前は順に', () => {
    const g = groupByAffiliation(list);
    expect(g.map((x) => x.group)).toEqual(['にじさんじ', 'hololive Indonesia 1期生', 'ホロライブ', null]);
    expect(g[0]!.entries.map((x) => x.id)).toEqual(['v-2', 'v-3']);
  });
});
